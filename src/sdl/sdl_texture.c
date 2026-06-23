/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * SDL - Texture Cache Module
 *
 * Texture cache management, hash functions, allocation, and the main sdl_tx_load function.
 */

#include <assert.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <SDL3/SDL.h>
#include <SDL3/SDL_render.h>

#include "dll.h"
#include "astonia.h"
#include "sdl/sdl.h"
#include "sdl/sdl_private.h"
#ifdef DEVELOPER
extern int sockstate; // Declare early for use in wait logging
#endif

#ifdef DEVELOPER
uint64_t sdl_render_wait = 0;
uint64_t sdl_render_wait_count = 0;
#endif

#ifdef __EMSCRIPTEN__
extern int astonia_wasm_texture_job_queue_count;
extern int astonia_wasm_texture_job_queue_peak;
extern int astonia_wasm_texture_job_enqueue_count;
extern int astonia_wasm_texture_job_drop_count;
extern int astonia_wasm_texture_cpu_work_count;
extern int astonia_wasm_texture_upload_context_sprite;

static void astonia_wasm_note_texture_job_queue(void)
{
	astonia_wasm_texture_job_queue_count = g_tex_jobs.count;
	if (g_tex_jobs.count > astonia_wasm_texture_job_queue_peak) {
		astonia_wasm_texture_job_queue_peak = g_tex_jobs.count;
	}
}

static void astonia_wasm_note_texture_upload_context(unsigned int sprite)
{
	astonia_wasm_texture_upload_context_sprite = (int)sprite;
}
#endif

extern SDL_Semaphore *prework;

static int texture_frame_budget_async_enabled(void)
{
#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
	return 1;
#else
	return 0;
#endif
}

#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
typedef struct texture_cpu_frame_work {
	int active;
	texture_job_t job;
	SdlTextureMakeState make_state;
} TextureCpuFrameWork;

static TextureCpuFrameWork g_texture_cpu_frame_work;
static SdlBackendTextureUploadState g_texture_upload_work[MAX_TEXCACHE];

static void texture_frame_budget_dispose_upload(int cache_index)
{
	if (cache_index < 0 || cache_index >= MAX_TEXCACHE) {
		return;
	}
	sdl_backend_upload_texture_argb8888_dispose(&g_texture_upload_work[cache_index]);
}

static void texture_frame_budget_reset_work(void)
{
	memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
	for (int i = 0; i < MAX_TEXCACHE; i++) {
		texture_frame_budget_dispose_upload(i);
	}
}
#endif

// ============================================================================
// New texture job queue implementation
// ============================================================================

void tex_jobs_init(void)
{
	memset(&g_tex_jobs, 0, sizeof(g_tex_jobs));
	g_tex_jobs.mutex = SDL_CreateMutex();
	g_tex_jobs.cond = SDL_CreateCondition();
	if (!g_tex_jobs.mutex || !g_tex_jobs.cond) {
		fail("Failed to create texture job queue mutex/cond");
		exit(1);
	}
}

void tex_jobs_shutdown(void)
{
#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
	texture_frame_budget_reset_work();
#endif
	if (g_tex_jobs.mutex) {
		SDL_DestroyMutex(g_tex_jobs.mutex);
		g_tex_jobs.mutex = NULL;
	}
	if (g_tex_jobs.cond) {
		SDL_DestroyCondition(g_tex_jobs.cond);
		g_tex_jobs.cond = NULL;
	}
}

int tex_jobs_pop(texture_job_t *out_job, int should_block)
{
	texture_job_queue_t *q = &g_tex_jobs;
	SDL_LockMutex(q->mutex);

	// Assert queue invariants
	assert(q->count <= TEX_JOB_CAPACITY && "tex_jobs_pop: count > capacity");
	assert(q->head < TEX_JOB_CAPACITY && "tex_jobs_pop: head >= capacity");
	assert(q->tail < TEX_JOB_CAPACITY && "tex_jobs_pop: tail >= capacity");

	while (q->count == 0) {
		if (!should_block) {
			SDL_UnlockMutex(q->mutex);
			return 0;
		}
		SDL_WaitCondition(q->cond, q->mutex);
	}

	// Pop job from queue
	int head_index = q->head;
	*out_job = q->jobs[head_index];
	q->head = (q->head + 1) % TEX_JOB_CAPACITY;
	q->count--;
#ifdef __EMSCRIPTEN__
	astonia_wasm_note_texture_job_queue();
#endif

	// Zero out the popped slot for debugging clarity
	// (Makes it obvious in debugger/memory dumps when a slot is free vs stale)
	memset(&q->jobs[head_index], 0, sizeof(texture_job_t));

	// Assert the popped job has valid values
	assert(
	    out_job->cache_index >= 0 && out_job->cache_index < MAX_TEXCACHE && "tex_jobs_pop: popped invalid cache_index");
	assert(out_job->generation != 0 && "tex_jobs_pop: popped job with generation=0");
	assert(out_job->kind == TEXTURE_JOB_MAKE_STAGES_1_2 && "tex_jobs_pop: unknown job kind");

	SDL_UnlockMutex(q->mutex);
	return 1;
}

static int tex_jobs_depth_snapshot(void)
{
	int depth;

	if (!g_tex_jobs.mutex) {
		return 0;
	}

	SDL_LockMutex(g_tex_jobs.mutex);
	depth = g_tex_jobs.count;
	SDL_UnlockMutex(g_tex_jobs.mutex);
	return depth;
}

int sdl_texture_queue_cache_index(int cache_index)
{
	struct sdl_texture *slot;
	texture_job_t *job;
	uint16_t flags;

	if (cache_index < 0 || cache_index >= MAX_TEXCACHE || !g_tex_jobs.mutex || !g_tex_jobs.cond) {
		return 0;
	}

	slot = &sdlt[cache_index];
	flags = flags_load(slot);
	if (!(flags & SF_SPRITE) || (flags & SF_DIDMAKE)) {
		return 0;
	}

	SDL_LockMutex(g_tex_jobs.mutex);
	flags = flags_load(slot);
	if (!(flags & SF_SPRITE) || (flags & SF_DIDMAKE) || work_state_load(slot) != TX_WORK_IDLE) {
		SDL_UnlockMutex(g_tex_jobs.mutex);
		return 0;
	}
	if (g_tex_jobs.count >= TEX_JOB_CAPACITY) {
#ifdef __EMSCRIPTEN__
		astonia_wasm_texture_job_drop_count++;
		astonia_wasm_note_texture_job_queue();
#endif
		SDL_UnlockMutex(g_tex_jobs.mutex);
		return 0;
	}

	job = &g_tex_jobs.jobs[g_tex_jobs.tail];
	job->cache_index = cache_index;
	job->generation = slot->generation;
	job->kind = TEXTURE_JOB_MAKE_STAGES_1_2;

	g_tex_jobs.tail = (g_tex_jobs.tail + 1) % TEX_JOB_CAPACITY;
	g_tex_jobs.count++;
	work_state_store(slot, TX_WORK_QUEUED);
#ifdef __EMSCRIPTEN__
	astonia_wasm_texture_job_enqueue_count++;
	astonia_wasm_note_texture_job_queue();
#endif

	SDL_SignalCondition(g_tex_jobs.cond);
	SDL_UnlockMutex(g_tex_jobs.mutex);

	if (sdl_multi && prework) {
		SDL_SignalSemaphore(prework);
	}

	return 1;
}

static void texture_job_finish(struct sdl_texture *tex, uint32_t generation)
{
	if (!g_tex_jobs.mutex) {
		return;
	}

	SDL_LockMutex(g_tex_jobs.mutex);
	if (tex->generation == generation) {
		work_state_store(tex, TX_WORK_IDLE);
	}
	SDL_UnlockMutex(g_tex_jobs.mutex);
}

#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
static int texture_cpu_frame_work_start(void)
{
	texture_job_t job;
	struct sdl_texture *tex;

	if (g_texture_cpu_frame_work.active) {
		return 1;
	}
	if (!tex_jobs_pop(&job, 0)) {
		return 0;
	}

	tex = &sdlt[job.cache_index];
	SDL_LockMutex(g_tex_jobs.mutex);
	if (tex->generation != job.generation) {
		SDL_UnlockMutex(g_tex_jobs.mutex);
		return 1;
	}
	work_state_store(tex, TX_WORK_IN_WORKER);
	SDL_UnlockMutex(g_tex_jobs.mutex);

	memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
	g_texture_cpu_frame_work.active = 1;
	g_texture_cpu_frame_work.job = job;
	return 1;
}

static int texture_cpu_frame_work_step(uint64_t deadline_ticks, int *completed)
{
	struct sdl_texture *tex;
	unsigned int sprite;
	int load_result;
	int make_result;

	*completed = 0;
	if (!texture_cpu_frame_work_start()) {
		return 0;
	}

	tex = &sdlt[g_texture_cpu_frame_work.job.cache_index];
	if (tex->generation != g_texture_cpu_frame_work.job.generation) {
		memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
		return 1;
	}

	sprite = tex->sprite;
	load_result = sdl_ic_load_frame_budget_step(sprite, NULL, deadline_ticks);
	if (load_result == SDL_IMAGE_LOAD_BUSY) {
		return 1;
	}
	if (load_result < 0) {
		texture_job_finish(tex, g_texture_cpu_frame_work.job.generation);
		memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
		*completed = 1;
		return 1;
	}
	if (tex->generation != g_texture_cpu_frame_work.job.generation) {
		memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
		return 1;
	}

	make_result = sdl_make_stage12_frame_budget_step(
	    tex, &sdli[sprite], &g_texture_cpu_frame_work.make_state, deadline_ticks);
	if (make_result < 0) {
		texture_job_finish(tex, g_texture_cpu_frame_work.job.generation);
		memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
		*completed = 1;
		return 1;
	}
	if (make_result == 0) {
		return 1;
	}

	texture_job_finish(tex, g_texture_cpu_frame_work.job.generation);
#ifdef __EMSCRIPTEN__
	astonia_wasm_texture_cpu_work_count++;
#endif
	memset(&g_texture_cpu_frame_work, 0, sizeof(g_texture_cpu_frame_work));
	*completed = 1;
	return 1;
}
#endif

int sdl_texture_process_one_queued_job(void)
{
#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
	int completed = 0;
	return texture_cpu_frame_work_step(SDL_GetTicks(), &completed);
#else
	texture_job_t job;
	struct sdl_texture *tex;
	unsigned int sprite;
	int load_result;

	if (!g_tex_jobs.mutex || !g_tex_jobs.cond) {
		return 0;
	}

	if (!tex_jobs_pop(&job, 0)) {
		return 0;
	}

	tex = &sdlt[job.cache_index];

	SDL_LockMutex(g_tex_jobs.mutex);
	if (tex->generation != job.generation) {
		SDL_UnlockMutex(g_tex_jobs.mutex);
		return 0;
	}
	work_state_store(tex, TX_WORK_IN_WORKER);
	SDL_UnlockMutex(g_tex_jobs.mutex);

	sprite = tex->sprite;
	load_result = sdl_ic_load(sprite, NULL);
	if (load_result < 0) {
		texture_job_finish(tex, job.generation);
		return load_result == SDL_IMAGE_LOAD_BUSY ? 0 : 1;
	}

	if (tex->generation != job.generation) {
		return 0;
	}
	if (!(flags_load(tex) & SF_DIDALLOC)) {
		sdl_make(tex, &sdli[sprite], 1);
	}
	if (tex->generation != job.generation) {
		return 0;
	}
	if ((flags_load(tex) & SF_DIDALLOC) && !(flags_load(tex) & SF_DIDMAKE)) {
		sdl_make(tex, &sdli[sprite], 2);
	}

	texture_job_finish(tex, job.generation);
#ifdef __EMSCRIPTEN__
	astonia_wasm_texture_cpu_work_count++;
#endif
	return 1;
#endif
}

static int texture_ready_without_texture_count(void)
{
	int count = 0;

	for (int i = 0; i < MAX_TEXCACHE; i++) {
		uint16_t flags = flags_load(&sdlt[i]);
		if ((flags & SF_SPRITE) && (flags & SF_DIDMAKE) && !(flags & SF_DIDTEX)) {
			count++;
		}
	}

	return count;
}

static int texture_upload_ready_one(int *scan_cursor, uint64_t deadline_ticks, int *completed)
{
	int start = *scan_cursor;

	*completed = 0;
	for (int checked = 0; checked < MAX_TEXCACHE; checked++) {
		int cache_index = (start + checked) % MAX_TEXCACHE;
		struct sdl_texture *slot = &sdlt[cache_index];
		uint16_t flags = flags_load(slot);

		if ((flags & SF_SPRITE) && (flags & SF_DIDMAKE) && !(flags & SF_DIDTEX)) {
			unsigned int sprite = slot->sprite;

#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
			(void)sprite;
			SDL_Texture *texture = NULL;
			int result;
#ifdef __EMSCRIPTEN__
			astonia_wasm_note_texture_upload_context(sprite);
#endif
			result = sdl_backend_upload_texture_argb8888_frame_budget_step(&g_texture_upload_work[cache_index],
			    slot->xres * sdl_scale, slot->yres * sdl_scale, slot->pixel,
			    (size_t)slot->xres * sizeof(uint32_t) * (size_t)sdl_scale, deadline_ticks, &texture);
			if (result < 0) {
				warn("Renderer texture upload failed in sprite %d (%s, %d,%d)", slot->sprite, slot->text, slot->xres,
				    slot->yres);
				*scan_cursor = (cache_index + 1) % MAX_TEXCACHE;
				return 1;
			}
			if (result == 0) {
				*scan_cursor = cache_index;
				return 1;
			}

			extern long long mem_tex;
			__atomic_add_fetch(&mem_tex, slot->xres * slot->yres * sizeof(uint32_t), __ATOMIC_RELAXED);
#ifdef SDL_FAST_MALLOC
			FREE(slot->pixel);
#else
			xfree(slot->pixel);
#endif
			slot->pixel = NULL;
			slot->tex = texture;
			if (texture) {
				uint16_t *flags_ptr = (uint16_t *)&slot->flags;
				__atomic_fetch_or(flags_ptr, SF_DIDTEX, __ATOMIC_RELEASE);
			}
#else
			sdl_make(slot, &sdli[sprite], 3);
#endif
			*scan_cursor = (cache_index + 1) % MAX_TEXCACHE;
			*completed = 1;
			return 1;
		}
	}

	return 0;
}

static int texture_frame_budget_expired(uint64_t start, int max_ms)
{
	if (max_ms <= 0) {
		return 0;
	}
	return SDL_GetTicks() - start >= (uint64_t)max_ms;
}

SdlTextureFrameProgress sdl_texture_advance_frame_budget(int max_cpu_jobs, int max_gpu_uploads, uint32_t max_ms)
{
	static int upload_scan_cursor;
	SdlTextureFrameProgress progress;
	uint64_t start;
	uint64_t deadline;

	memset(&progress, 0, sizeof(progress));

	if (max_cpu_jobs < 0) {
		max_cpu_jobs = 0;
	}
	if (max_gpu_uploads < 0) {
		max_gpu_uploads = 0;
	}

	start = SDL_GetTicks();
	deadline = max_ms > 0 ? start + (uint64_t)max_ms : 0;

	if (!sdl_multi) {
		while (progress.cpu_jobs < max_cpu_jobs && !texture_frame_budget_expired(start, (int)max_ms)) {
			int completed = 0;
#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
			if (!texture_cpu_frame_work_step(deadline, &completed)) {
				break;
			}
#else
			if (!sdl_texture_process_one_queued_job()) {
				break;
			}
			completed = 1;
#endif
			if (completed) {
				progress.cpu_jobs++;
			} else {
				break;
			}
		}
	}

	while (progress.gpu_uploads < max_gpu_uploads && !texture_frame_budget_expired(start, (int)max_ms)) {
		int completed = 0;
		if (!texture_upload_ready_one(&upload_scan_cursor, deadline, &completed)) {
			break;
		}
		if (completed) {
			progress.gpu_uploads++;
		} else {
			break;
		}
	}

	progress.queue_depth = tex_jobs_depth_snapshot();
	progress.ready_without_texture = texture_ready_without_texture_count();
	return progress;
}

// ============================================================================
// End of texture job queue implementation
// ============================================================================

void sdl_tx_best(int cache_index)
{
	assert(cache_index != STX_NONE && "sdl_tx_best(): sidx=SIDX_NONE");
	assert(cache_index < MAX_TEXCACHE && "sdl_tx_best(): sidx>max_systemcache");

	if (sdlt[cache_index].prev == STX_NONE) {
		assert(cache_index == sdlt_best && "sdl_tx_best(): cache_index should be best");

		return;
	} else if (sdlt[cache_index].next == STX_NONE) {
		assert(cache_index == sdlt_last && "sdl_tx_best(): sidx should be last");

		sdlt_last = sdlt[cache_index].prev;
		sdlt[sdlt_last].next = STX_NONE;
		sdlt[sdlt_best].prev = cache_index;
		sdlt[cache_index].prev = STX_NONE;
		sdlt[cache_index].next = sdlt_best;
		sdlt_best = cache_index;

		return;
	} else {
		sdlt[sdlt[cache_index].prev].next = sdlt[cache_index].next;
		sdlt[sdlt[cache_index].next].prev = sdlt[cache_index].prev;
		sdlt[cache_index].prev = STX_NONE;
		sdlt[cache_index].next = sdlt_best;
		sdlt[sdlt_best].prev = cache_index;
		sdlt_best = cache_index;
		return;
	}
}

static inline unsigned int hashfunc(unsigned int sprite, int ml, int ll, int rl, int ul, int dl)
{
	// FNV-1a hash for better distribution
	// Old XOR-based hash caused linear clustering: sprite N -> bucket N with default lighting
	uint32_t hash = 2166136261u; // FNV-1a offset basis

	// Mix in sprite number
	hash = (hash ^ sprite) * 16777619u; // FNV-1a prime

	// Mix in lighting parameters (cast to unsigned to avoid sign extension issues)
	hash = (hash ^ (uint32_t)(ml & 0xFF)) * 16777619u;
	hash = (hash ^ (uint32_t)(ll & 0xFF)) * 16777619u;
	hash = (hash ^ (uint32_t)(rl & 0xFF)) * 16777619u;
	hash = (hash ^ (uint32_t)(ul & 0xFF)) * 16777619u;
	hash = (hash ^ (uint32_t)(dl & 0xFF)) * 16777619u;

	return hash % (unsigned int)MAX_TEXHASH;
}

static inline unsigned int hashfunc_text(const char *text, int color, int flags)
{
	// FNV-1a hash for better distribution
	// Old approach only used first 4 chars -> poor mixing, edge bucket clustering
	uint32_t hash = 2166136261u; // FNV-1a offset basis

	// Mix in the full string (not just first 4 chars)
	const unsigned char *p = (const unsigned char *)text;
	while (*p) {
		hash = (hash ^ *p) * 16777619u; // FNV-1a prime
		p++;
	}

	// Mix in color and flags
	hash = (hash ^ (uint32_t)color) * 16777619u;
	hash = (hash ^ (uint32_t)flags) * 16777619u;

	return hash % (unsigned int)MAX_TEXHASH;
}

#ifdef UNIT_TEST
// Test-only wrapper to expose hashfunc_text for distribution testing
unsigned int test_hashfunc_text(const char *text, int color, int flags)
{
	return hashfunc_text(text, color, flags);
}
#endif

SDL_Texture *sdl_maketext(const char *text, struct renderfont *font, uint32_t color, int flags);

// Forward declarations
extern SDL_Mutex *premutex;
extern int if_single_thread_process_one_job(void); // in sdl_core.c

void sdl_native_state_destroy_cache_resources(void)
{
	for (int cache_index = 0; cache_index < MAX_TEXCACHE; cache_index++) {
		uint16_t flags = flags_load(&sdlt[cache_index]);

		if (!flags) {
			continue;
		}

		if ((flags & SF_DIDTEX) && sdlt[cache_index].tex) {
#ifdef SDL_USE_RENDER_BACKEND_TEXTURES
			sdl_backend_destroy_texture(sdlt[cache_index].tex);
#else
			SDL_DestroyTexture(sdlt[cache_index].tex);
#endif
			sdlt[cache_index].tex = NULL;
		}

		if ((flags & SF_DIDALLOC) && sdlt[cache_index].pixel) {
#ifdef SDL_FAST_MALLOC
			FREE(sdlt[cache_index].pixel);
#else
			xfree(sdlt[cache_index].pixel);
#endif
			sdlt[cache_index].pixel = NULL;
		}

		if ((flags & SF_TEXT) && sdlt[cache_index].text) {
#ifdef SDL_FAST_MALLOC
			FREE(sdlt[cache_index].text);
#else
			xfree(sdlt[cache_index].text);
#endif
			sdlt[cache_index].text = NULL;
		}
	}
}

// ============================================================================
// Texture Cache Concurrency Invariants
// ============================================================================
//
// The texture cache (sdlt[]) is shared between the render thread and background
// workers. To avoid data races and corruption, we maintain strict invariants:
//
// FLAGS (struct sdl_texture::flags, atomic uint16_t):
//   - SF_USED: Entry is in use (not free for eviction)
//   - SF_SPRITE: Entry holds a sprite texture
//   - SF_TEXT: Entry holds a text texture
//   - SF_DIDALLOC: Pixel buffer allocated (sdlt[].pixel is valid)
//   - SF_DIDMAKE: CPU processing complete (pixels ready for GPU upload)
//   - SF_DIDTEX: GPU texture created (sdlt[].tex is valid)
//
// WORK STATE (struct sdl_texture::work_state, atomic uint8_t):
//   - TX_WORK_IDLE: No work in progress, safe to evict
//   - TX_WORK_QUEUED: Job queued but not yet claimed by a worker
//   - TX_WORK_IN_WORKER: Worker actively processing this entry
//
// OWNERSHIP RULES:
//   Render thread (main):
//     - WRITES: All flags, work_state, LRU pointers (prev/next), hash chains (hnext/hprev)
//     - READS: All fields
//     - Can evict entries when work_state == TX_WORK_IDLE && flags allow
//
//   Background workers:
//     - WRITES: flags (SF_DIDALLOC, SF_DIDMAKE), work_state, pixel buffer, generation checks
//     - READS: Non-atomic sprite parameters (sprite, sink, freeze, scale, colors, lights, etc.)
//     - NEVER touch: LRU pointers, hash chains, tex pointer (GPU texture)
//     - Only operate on entries with jobs they claimed from the queue
//
// FLAG COMBINATION RULES:
//   - SF_DIDTEX => SF_DIDMAKE && SF_DIDALLOC (GPU texture requires completed CPU work)
//   - SF_DIDMAKE => SF_DIDALLOC (CPU work complete requires pixel buffer)
//   - SF_SPRITE and SF_TEXT are mutually exclusive
//   - SF_USED is set whenever any other flags are set
//
// MEMORY ORDERING:
//   - Render thread sets non-atomic fields BEFORE setting flags with RELEASE
//   - Workers read flags with ACQUIRE BEFORE reading non-atomic fields
//   - This establishes happens-before relationship per C11 memory model
//
// EVICTION SAFETY:
//   - Render thread checks work_state under g_tex_jobs.mutex before evicting
//   - If work_state != TX_WORK_IDLE, entry cannot be evicted
//   - Generation counter (uint32_t) invalidates in-flight jobs after eviction
//   - Workers check generation before writing results to detect stale jobs
//
// WORKER CONTRACT:
//   - Workers never touch LRU pointers (prev/next)
//   - Workers never mutate hash chains (hnext/hprev)
//   - Workers only operate on existing entries referenced by jobs
//   - Workers never create or destroy GPU textures (that's render thread only)
//   - Workers set flags atomically to signal completion to render thread
//
// PHASE BOUNDARIES:
//   1. Render thread creates entry, sets sprite params, sets SF_USED | SF_SPRITE
//   2. Worker (or render thread) allocates pixels, sets SF_DIDALLOC
//   3. Worker (or render thread) processes pixels, sets SF_DIDMAKE
//   4. Render thread (only) uploads to GPU, sets SF_DIDTEX
//
// These invariants are tested extensively in test_texture_workers.c
// ============================================================================

// Request struct for texture loading
struct tex_request {
	/* 8-byte-ish on 64-bit: put pointers first */
	const char *text;
	void *text_font;

	/* 32-bit values next */
	uint32_t sprite;
	int c1, c2, c3;
	int shine;
	int text_color;
	int text_flags;
	int checkonly;
	int preload;

	/* 8-bit fields packed together */
	signed char sink;
	unsigned char freeze;
	unsigned char scale;

	char cr, cg, cb;
	char light, sat;
	char ml, ll, rl, ul, dl;
};

static struct tex_request tex_request_from_args(uint32_t sprite, signed char sink, unsigned char freeze,
    unsigned char scale, char cr, char cg, char cb, char light, char sat, int c1, int c2, int c3, int shine, char ml,
    char ll, char rl, char ul, char dl, const char *text, int text_color, int text_flags, void *text_font,
    int checkonly, int preload)
{
	struct tex_request r;

	r.text = text;
	r.text_font = text_font;

	r.sprite = sprite;
	r.c1 = c1;
	r.c2 = c2;
	r.c3 = c3;
	r.shine = shine;
	r.text_color = text_color;
	r.text_flags = text_flags;
	r.checkonly = checkonly;
	r.preload = preload;

	r.sink = sink;
	r.freeze = freeze;
	r.scale = scale;

	r.cr = cr;
	r.cg = cg;
	r.cb = cb;
	r.light = light;
	r.sat = sat;
	r.ml = ml;
	r.ll = ll;
	r.rl = rl;
	r.ul = ul;
	r.dl = dl;

	return r;
}

static int tex_request_hash(const struct tex_request *r)
{
	if (r->text) {
		return (int)hashfunc_text(r->text, r->text_color, r->text_flags);
	} else {
		return (int)hashfunc(r->sprite, r->ml, r->ll, r->rl, r->ul, r->dl);
	}
}

static int tex_entry_matches_request(int idx, const struct tex_request *r)
{
	uint16_t flags = flags_load(&sdlt[idx]);

	if (r->text) {
		/* Text entry */
		if (!(flags & SF_TEXT)) {
			return 0;
		}
		if (!(sdlt[idx].tex)) {
			return 0;
		}
		if (!sdlt[idx].text || strcmp(sdlt[idx].text, r->text) != 0) {
			return 0;
		}
		if (sdlt[idx].text_flags != r->text_flags) {
			return 0;
		}
		if (sdlt[idx].text_color != (uint32_t)r->text_color) {
			return 0;
		}
		if (sdlt[idx].text_font != r->text_font) {
			return 0;
		}
		return 1;
	} else {
		/* Sprite entry */
		if (!(flags & SF_SPRITE)) {
			return 0;
		}
		if (sdlt[idx].sprite != r->sprite) {
			return 0;
		}

		/* Compare sprite params */
		if (sdlt[idx].sink != r->sink || sdlt[idx].freeze != r->freeze || sdlt[idx].scale != r->scale ||
		    sdlt[idx].cr != r->cr || sdlt[idx].cg != r->cg || sdlt[idx].cb != r->cb || sdlt[idx].light != r->light ||
		    sdlt[idx].sat != r->sat || sdlt[idx].c1 != r->c1 || sdlt[idx].c2 != r->c2 || sdlt[idx].c3 != r->c3 ||
		    sdlt[idx].shine != r->shine || sdlt[idx].ml != r->ml || sdlt[idx].ll != r->ll || sdlt[idx].rl != r->rl ||
		    sdlt[idx].ul != r->ul || sdlt[idx].dl != r->dl) {
			return 0;
		}
		return 1;
	}
}

static int texcache_lookup(const struct tex_request *r, int hash, int *out_panic)
{
	int stx = sdlt_cache[hash];
	int panic = 0;

	while (stx != STX_NONE) {
#ifdef DEVELOPER
		// Detect and break self-loops to recover gracefully
		if (sdlt[stx].hnext == stx) {
			warn("Hash self-loop detected at cache_index=%d for sprite=%d - breaking chain", stx, (int)r->sprite);
			sdlt[stx].hnext = STX_NONE;
			if (panic > maxpanic) {
				maxpanic = panic;
			}
			break;
		}
#endif
		if (panic > 1099) {
#ifdef DEVELOPER
			warn("%04d: cache_index=%d, hprev=%d, hnext=%d sprite=%d (%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d,%p) PANIC\n",
			    panic, stx, sdlt[stx].hprev, sdlt[stx].hnext, (int)r->sprite, sdlt[stx].sink, sdlt[stx].freeze,
			    sdlt[stx].scale, sdlt[stx].cr, sdlt[stx].cg, sdlt[stx].cb, sdlt[stx].light, sdlt[stx].sat, sdlt[stx].c1,
			    sdlt[stx].c2, sdlt[stx].c3, sdlt[stx].shine, sdlt[stx].ml, sdlt[stx].ll, sdlt[stx].rl, sdlt[stx].ul,
			    sdlt[stx].dl, (void *)sdlt[stx].text);
			sdl_dump_spritecache();
#endif
			exit(42);
		}

		if (tex_entry_matches_request(stx, r)) {
			*out_panic = panic;
			return stx;
		}

		stx = sdlt[stx].hnext;
		panic++;
	}

	*out_panic = panic;
	return STX_NONE;
}

// Move an existing entry to the head of its hash chain
// This is done when we hit an existing entry to promote it
static void texcache_promote_to_hash_head(int cache_index, int hash)
{
	int ntx, ptx;

	// Remove from old position in hash chain
	ntx = sdlt[cache_index].hnext;
	ptx = sdlt[cache_index].hprev;

	if (ptx == STX_NONE) {
		// Already at head, just update head pointer
		sdlt_cache[hash] = ntx;
	} else {
		sdlt[ptx].hnext = sdlt[cache_index].hnext;
	}

	if (ntx != STX_NONE) {
		sdlt[ntx].hprev = sdlt[cache_index].hprev;
	}

	// Add to head of hash chain
	ntx = sdlt_cache[hash];
	if (ntx != STX_NONE) {
		sdlt[ntx].hprev = cache_index;
	}

	sdlt[cache_index].hprev = STX_NONE;
	sdlt[cache_index].hnext = ntx;
	sdlt_cache[hash] = cache_index;
}

// Build a text entry in a given slot, linking it into the hash chain and LRU
// Returns the cache_index on success, or STX_NONE if text creation failed
static int tex_entry_build_text(int cache_index, const struct tex_request *r, int hash)
{
	float w, h;
	int ntx;

	sdlt[cache_index].tex =
	    sdl_maketext(r->text, (struct renderfont *)r->text_font, (uint32_t)r->text_color, r->text_flags);
	if (!sdlt[cache_index].tex) {
		sdlt[cache_index].xres = 0;
		sdlt[cache_index].yres = 0;
		return STX_NONE;
	}
	sdlt[cache_index].text_color = (uint32_t)r->text_color;
	sdlt[cache_index].text_flags = (uint16_t)r->text_flags;
	sdlt[cache_index].text_font = r->text_font;
#ifdef SDL_FAST_MALLOC
	{
		size_t text_len = strlen(r->text) + 1u;
		sdlt[cache_index].text = MALLOC(text_len);
		if (sdlt[cache_index].text) {
			memcpy(sdlt[cache_index].text, r->text, text_len);
		}
	}
#else
	sdlt[cache_index].text = xstrdup(r->text, MEM_TEMP7);
#endif
#ifdef SDL_USE_RENDER_BACKEND_TEXTURES
	sdl_backend_get_texture_size(sdlt[cache_index].tex, &w, &h);
#else
	SDL_GetTextureSize(sdlt[cache_index].tex, &w, &h);
#endif
	sdlt[cache_index].xres = (uint16_t)w;
	sdlt[cache_index].yres = (uint16_t)h;
	uint16_t *flags_ptr = (uint16_t *)&sdlt[cache_index].flags;
	__atomic_store_n(flags_ptr, SF_USED | SF_TEXT | SF_DIDALLOC | SF_DIDMAKE | SF_DIDTEX, __ATOMIC_RELEASE);

	// Link into hash chain
	ntx = sdlt_cache[hash];
	if (ntx != STX_NONE) {
		sdlt[ntx].hprev = cache_index;
	}
	sdlt[cache_index].hprev = STX_NONE;
	sdlt[cache_index].hnext = ntx;
	sdlt_cache[hash] = cache_index;

	// Link into LRU (at head)
	sdl_tx_best(cache_index);

	return cache_index;
}

// Build a sprite entry in a given slot, linking it into the hash chain and LRU
// Returns the cache_index on success, or STX_NONE if loading failed
static int tex_entry_build_sprite(int cache_index, const struct tex_request *r, int hash)
{
	int ntx;
	int defer_make = texture_frame_budget_async_enabled() && !r->preload;

	if (r->preload != 1 && !defer_make) {
		if (sdl_ic_load(r->sprite, NULL) < 0) {
			return STX_NONE;
		}
	}

	// Initialize all non-atomic fields first
	sdlt[cache_index].sprite = r->sprite;
	sdlt[cache_index].sink = r->sink;
	sdlt[cache_index].freeze = r->freeze;
	sdlt[cache_index].scale = r->scale;
	sdlt[cache_index].cr = r->cr;
	sdlt[cache_index].cg = r->cg;
	sdlt[cache_index].cb = r->cb;
	sdlt[cache_index].light = r->light;
	sdlt[cache_index].sat = r->sat;
	sdlt[cache_index].c1 = (uint16_t)r->c1;
	sdlt[cache_index].c2 = (uint16_t)r->c2;
	sdlt[cache_index].c3 = (uint16_t)r->c3;
	sdlt[cache_index].shine = (uint16_t)r->shine;
	sdlt[cache_index].ml = r->ml;
	sdlt[cache_index].ll = r->ll;
	sdlt[cache_index].rl = r->rl;
	sdlt[cache_index].ul = r->ul;
	sdlt[cache_index].dl = r->dl;

	// Set flags with RELEASE to establish happens-before: workers reading flags with ACQUIRE
	// will see all the above fields as initialized
	uint16_t *flags_ptr = (uint16_t *)&sdlt[cache_index].flags;
	__atomic_store_n(flags_ptr, SF_USED | SF_SPRITE, __ATOMIC_RELEASE);

	if (r->preload != 1 && !defer_make) {
		sdl_make(sdlt + cache_index, sdli + r->sprite, r->preload);
	}

	// Link into hash chain
	ntx = sdlt_cache[hash];
	if (ntx != STX_NONE) {
		sdlt[ntx].hprev = cache_index;
	}
	sdlt[cache_index].hprev = STX_NONE;
	sdlt[cache_index].hnext = ntx;
	sdlt_cache[hash] = cache_index;

	// Link into LRU (at head)
	sdl_tx_best(cache_index);

	return cache_index;
}

// Acquire a slot from the cache (evicting LRU entry if needed)
// Returns a cache index that is safe to reuse, or STX_NONE if we must bail
static int texcache_acquire_slot(void)
{
	int cache_index = sdlt_last;
	int ptx, ntx;

	// Try to evict an entry, potentially trying multiple LRU candidates if workers are stuck
#ifdef DEVELOPER
	static int sdl_eviction_failures = 0;
#endif
	for (int eviction_attempts = 0; eviction_attempts < 10; eviction_attempts++) {
		// delete
		if (!flags_load(&sdlt[cache_index])) {
			// Empty slot, just use it
			break;
		}

		int hash2;
		int can_evict = 1;

		// Check work_state under lock
		if ((sdl_multi || texture_frame_budget_async_enabled()) && (flags_load(&sdlt[cache_index]) & SF_SPRITE)) {
			SDL_LockMutex(g_tex_jobs.mutex);
			if (sdlt[cache_index].work_state != TX_WORK_IDLE) {
				// Slot has queued or in-progress work, cannot evict
				SDL_UnlockMutex(g_tex_jobs.mutex);
				can_evict = 0;
				int candidate = sdlt[cache_index].prev;
				if (candidate == STX_NONE) {
					// No more candidates, give up
#ifdef DEVELOPER
					sdl_eviction_failures++;
					if (sdl_eviction_failures == 1 || (sdl_eviction_failures % 100) == 0) {
						warn("SDL: texture cache eviction failed %d times; workers may be busy", sdl_eviction_failures);
					}
#endif
					return STX_NONE;
				}
				cache_index = candidate;
				continue;
			}
			SDL_UnlockMutex(g_tex_jobs.mutex);
		}

		// If we can't evict this entry, try the next candidate
		if (!can_evict) {
			continue;
		}

			uint16_t flags = flags_load(&sdlt[cache_index]);
#ifdef SDL_TEXTURE_FRAME_BUDGET_ASYNC
			texture_frame_budget_dispose_upload(cache_index);
#endif
			if (flags & SF_SPRITE) {
				hash2 = (int)hashfunc(sdlt[cache_index].sprite, sdlt[cache_index].ml, sdlt[cache_index].ll,
			    sdlt[cache_index].rl, sdlt[cache_index].ul, sdlt[cache_index].dl);
		} else if (flags & SF_TEXT) {
			hash2 = (int)hashfunc_text(
			    sdlt[cache_index].text, (int)sdlt[cache_index].text_color, sdlt[cache_index].text_flags);
		} else {
			hash2 = 0;
			warn("weird entry in texture cache!");
		}

		ntx = sdlt[cache_index].hnext;
		ptx = sdlt[cache_index].hprev;

		if (ptx == STX_NONE) {
			if (sdlt_cache[hash2] != cache_index) {
				fail("sdli[sprite].cache_index!=cache_index\n");
				exit(42);
			}
			sdlt_cache[hash2] = ntx;
		} else {
			sdlt[ptx].hnext = sdlt[cache_index].hnext;
		}

		if (ntx != STX_NONE) {
			sdlt[ntx].hprev = sdlt[cache_index].hprev;
		}

		flags = flags_load(&sdlt[cache_index]);
		if (flags & SF_DIDTEX) {
			__atomic_sub_fetch(
			    &mem_tex, sdlt[cache_index].xres * sdlt[cache_index].yres * sizeof(uint32_t), __ATOMIC_RELAXED);
			if (sdlt[cache_index].tex) {
#ifdef SDL_USE_RENDER_BACKEND_TEXTURES
				sdl_backend_destroy_texture(sdlt[cache_index].tex);
#else
				SDL_DestroyTexture(sdlt[cache_index].tex);
#endif
				sdlt[cache_index].tex = NULL; // Clear pointer after destroying
			}
		} else if (flags & SF_DIDALLOC) {
			if (sdlt[cache_index].pixel) {
#ifdef SDL_FAST_MALLOC
				FREE(sdlt[cache_index].pixel);
#else
				xfree(sdlt[cache_index].pixel);
#endif
				sdlt[cache_index].pixel = NULL;
			}
		}
#ifdef SDL_FAST_MALLOC
		if (flags & SF_TEXT) {
			FREE(sdlt[cache_index].text);
			sdlt[cache_index].text = NULL;
		}
#else
		if (flags & SF_TEXT) {
			xfree(sdlt[cache_index].text);
			sdlt[cache_index].text = NULL;
		}
#endif

		uint16_t *flags_ptr = (uint16_t *)&sdlt[cache_index].flags;
		__atomic_store_n(flags_ptr, 0, __ATOMIC_RELEASE);

		// Bump generation to invalidate any in-flight jobs for old contents
		// Guard against wraparound: skip 0 which is reserved for "never valid"
		uint32_t new_gen = sdlt[cache_index].generation + 1;
		if (new_gen == 0) {
			new_gen = 1;
		}
		sdlt[cache_index].generation = new_gen;
		// Reset work_state to IDLE (safe without mutex here: we already verified
		// work_state was IDLE under mutex above, and flags are now cleared so no
		// worker can queue new jobs for this slot until we reinitialize it)
		sdlt[cache_index].work_state = TX_WORK_IDLE;

		break; // Successfully evicted, exit the retry loop
	}

	// *** SAFETY CHECK ***
	// If after all that the entry is still non-empty, we failed to get a usable slot.
	// Do NOT reuse it; that would corrupt the hash chains.
	if (flags_load(&sdlt[cache_index])) {
#ifdef DEVELOPER
		sdl_eviction_failures++;
		if (sdl_eviction_failures == 1 || (sdl_eviction_failures % 100) == 0) {
			warn("SDL: texture cache eviction failed %d times; workers may be busy", sdl_eviction_failures);
		}
#endif
		// Could not free or find an empty entry in the limited attempts.
		// Safer to bail out than corrupt the cache.
		return STX_NONE;
	}

	// From here on, cache_index is guaranteed empty
	texc_used++;

	return cache_index;
}

// Ensure an existing cache entry is ready for rendering
// For text: always ready (created synchronously)
// For sprites: wait for workers if needed, then create GPU texture if needed
// Returns the cache_index on success, or STX_NONE on timeout
static int tex_entry_ensure_ready(int cache_index, const struct tex_request *r)
{
	if (r->text) {
		/* Text textures are created synchronously; nothing to do. */
		return cache_index;
	}

	if (texture_frame_budget_async_enabled() && !r->preload && (flags_load(&sdlt[cache_index]) & SF_SPRITE)) {
		uint16_t flags = flags_load(&sdlt[cache_index]);

		if (!(flags & SF_DIDMAKE)) {
			(void)sdl_texture_queue_cache_index(cache_index);
			return STX_NONE;
		}
		if (!(flags & SF_DIDTEX)) {
			return STX_NONE;
		}
		return cache_index;
	}

#ifndef SDL_TEXTURE_FRAME_BUDGET_ASYNC
	/* Sprite path - wait for workers and ensure GPU texture is ready */
	if (!r->preload && (flags_load(&sdlt[cache_index]) & SF_SPRITE)) {
		// Wait for background workers to complete processing
		int panic = 0;
#ifdef DEVELOPER
		uint64_t wait_start = 0;
#endif
		while (!(flags_load(&sdlt[cache_index]) & SF_DIDMAKE)) {
#ifdef DEVELOPER
			if (wait_start == 0) {
				wait_start = SDL_GetTicks();
				extern uint64_t sdl_render_wait_count;
				sdl_render_wait_count++;
			}
#endif

			// (function guards on sdl_multi internally)
			if_single_thread_process_one_job();

			SDL_Delay(1);

			if (panic++ > 1000) {
				uint16_t flags = flags_load(&sdlt[cache_index]);
				uint8_t wstate = work_state_load(&sdlt[cache_index]);
				const char *wstate_str = (wstate == TX_WORK_IDLE)        ? "idle"
				                         : (wstate == TX_WORK_QUEUED)    ? "queued"
				                         : (wstate == TX_WORK_IN_WORKER) ? "in_worker"
				                                                         : "unknown";
				// Worker is stuck or taking too long - give up this frame rather than corrupting memory
				warn("Render thread timeout waiting for sprite %d (cache_index=%d, work_state=%s, flags=%s%s%s) - "
				     "giving up "
				     "this frame",
				    sdlt[cache_index].sprite, cache_index, wstate_str, (flags & SF_DIDALLOC) ? "didalloc " : "",
				    (flags & SF_DIDMAKE) ? "didmake " : "", (flags & SF_DIDTEX) ? "didtex" : "");
				// Return STX_NONE to skip this texture this frame - better than use-after-free
				return STX_NONE;
			}
		}
#ifdef DEVELOPER
		if (wait_start > 0) {
			uint64_t wait_time = SDL_GetTicks() - wait_start;
			extern uint64_t sdl_render_wait;
			sdl_render_wait += wait_time;
#ifdef DEVELOPER_NOISY
			// Suppress warnings during boot - only show "real" stalls (>= 10ms)
			extern int sockstate;
			if (sockstate >= 4 && wait_time >= 10) {
				warn("Render thread waited %lu ms for sprite %d", (unsigned long)wait_time, sdlt[cache_index].sprite);
			}
#endif
		}
#endif

		// make texture now if preload didn't finish it
		if (!(flags_load(&sdlt[cache_index]) & SF_DIDTEX)) {
#ifdef DEVELOPER
			Uint64 start = SDL_GetTicks();
			sdl_make(sdlt + cache_index, sdli + r->sprite, 3);
			sdl_time_tex_main += (long long)(SDL_GetTicks() - start);
#else
			sdl_make(sdlt + cache_index, sdli + r->sprite, 3);
#endif
		}
	}
#endif

	return cache_index;
}

// ============================================================================
// End of request struct helpers
// ============================================================================

int sdl_tx_load(uint32_t sprite, signed char sink, unsigned char freeze, unsigned char scale, char cr, char cg, char cb,
    char light, char sat, int c1, int c2, int c3, int shine, char ml, char ll, char rl, char ul, char dl,
    const char *text, int text_color, int text_flags, void *text_font, int checkonly, int preload)
{
	int cache_index, panic = 0;
	int hash;
	int async_render_miss = 0;

	// Build request struct for cleaner parameter handling
	struct tex_request req = tex_request_from_args(sprite, sink, freeze, scale, cr, cg, cb, light, sat, c1, c2, c3,
	    shine, ml, ll, rl, ul, dl, text, text_color, text_flags, text_font, checkonly, preload);

	hash = tex_request_hash(&req);

	if (sprite >= MAXSPRITE) {
		note("illegal sprite %u wanted in sdl_tx_load", sprite);
		return STX_NONE;
	}

	// Try to find existing entry in cache
	cache_index = texcache_lookup(&req, hash, &panic);
	if (cache_index != STX_NONE) {
		// Found existing entry
		if (checkonly) {
			return 1;
		}
		if (preload == 1) {
			return -1;
		}

		if (panic > maxpanic) {
			maxpanic = panic;
		}

		// Ensure texture is ready for rendering (wait for workers, create GPU texture if needed)
		cache_index = tex_entry_ensure_ready(cache_index, &req);
		if (cache_index == STX_NONE) {
			return STX_NONE;
		}

		// Promote to head of LRU and hash chain (cache hit optimization)
		sdl_tx_best(cache_index);
		texcache_promote_to_hash_head(cache_index, hash);

		// Update statistics
		if (!preload) {
			texc_hit++;
		}

		return cache_index;
	}
	if (checkonly) {
		return 0;
	}

	// Acquire an empty slot (evicting LRU if needed)
	cache_index = texcache_acquire_slot();
	if (cache_index == STX_NONE) {
		return STX_NONE; // safe bailout instead of corrupting cache
	}

	// Build text or sprite entry
	if (text) {
		cache_index = tex_entry_build_text(cache_index, &req, hash);
	} else {
		cache_index = tex_entry_build_sprite(cache_index, &req, hash);
		if (cache_index != STX_NONE && texture_frame_budget_async_enabled() && !req.preload) {
			(void)sdl_texture_queue_cache_index(cache_index);
			async_render_miss = 1;
		}
	}

	if (cache_index == STX_NONE) {
		return STX_NONE;
	}

	// update statistics
	if (preload) {
		texc_pre++;
	} else if (sprite) { // Do not count missed text sprites. Those are expected.
		texc_miss++;
	}

	if (async_render_miss) {
		return STX_NONE;
	}

	return cache_index;
}

#ifdef DEVELOPER
int *dumpidx;

static int dump_cmp(const void *ca, const void *cb)
{
	int a, b, tmp;

	a = *(const int *)ca;
	b = *(const int *)cb;

	if (!flags_load(&sdlt[a])) {
		return 1;
	}
	if (!flags_load(&sdlt[b])) {
		return -1;
	}

	if (flags_load(&sdlt[a]) & SF_TEXT) {
		return 1;
	}
	if (flags_load(&sdlt[b]) & SF_TEXT) {
		return -1;
	}

	if (((tmp = (int)sdlt[a].sprite - (int)sdlt[b].sprite) != 0)) {
		return tmp;
	}

	if (((tmp = sdlt[a].ml - sdlt[b].ml) != 0)) {
		return tmp;
	}
	if (((tmp = sdlt[a].ll - sdlt[b].ll) != 0)) {
		return tmp;
	}
	if (((tmp = sdlt[a].rl - sdlt[b].rl) != 0)) {
		return tmp;
	}
	if (((tmp = sdlt[a].ul - sdlt[b].ul) != 0)) {
		return tmp;
	}

	return sdlt[a].dl - sdlt[b].dl;
}

void sdl_dump_spritecache(void)
{
	int i, n, cnt = 0, uni = 0, text = 0;
	double size = 0;
	char filename[MAX_PATH];
	FILE *fp;

	dumpidx = xmalloc(sizeof(int) * (size_t)MAX_TEXCACHE, MEM_TEMP);
	for (i = 0; i < MAX_TEXCACHE; i++) {
		dumpidx[i] = i;
	}

	qsort(dumpidx, (size_t)MAX_TEXCACHE, sizeof(int), dump_cmp);

	if (localdata) {
		sprintf(filename, "%s%s", localdata, "sdlt.txt");
	} else {
		sprintf(filename, "%s", "sdlt.txt");
	}
	fp = fopen(filename, "w");
	if (fp == NULL) {
		xfree(dumpidx);
		return;
	}

	for (i = 0; i < MAX_TEXCACHE; i++) {
		n = dumpidx[i];
		if (!flags_load(&sdlt[n])) {
			break;
		}

		uint16_t flags_n = flags_load(&sdlt[n]);
		if (flags_n & SF_TEXT) {
			text++;
		} else {
			if (i == 0 || sdlt[dumpidx[i]].sprite != sdlt[dumpidx[i - 1]].sprite) {
				uni++;
			}
			cnt++;
		}

		if (flags_n & SF_SPRITE) {
			fprintf(fp, "Sprite: %6u %s%s%s%s\n", sdlt[n].sprite, (flags_n & SF_USED) ? "SF_USED " : "",
			    (flags_n & SF_DIDALLOC) ? "SF_DIDALLOC " : "", (flags_n & SF_DIDMAKE) ? "SF_DIDMAKE " : "",
			    (flags_n & SF_DIDTEX) ? "SF_DIDTEX " : "");
		}

		/*fprintf(fp,"Sprite: %6d, Lights: %2d,%2d,%2d,%2d,%2d, Light: %3d, Colors: %3d,%3d,%3d, Colors: %4X,%4X,%4X,
		   Sink: %2d, Freeze: %2d, Scale: %3d, Sat: %3d, Shine: %3d, %dx%d\n", sdlt[n].sprite, sdlt[n].ml, sdlt[n].ll,
		       sdlt[n].rl,
		       sdlt[n].ul,
		       sdlt[n].dl,
		       sdlt[n].light,
		       sdlt[n].cr,
		       sdlt[n].cg,
		       sdlt[n].cb,
		       sdlt[n].c1,
		       sdlt[n].c2,
		       sdlt[n].c3,
		       sdlt[n].sink,
		       sdlt[n].freeze,
		       sdlt[n].scale,
		       sdlt[n].sat,
		       sdlt[n].shine,
		       sdlt[n].xres,
		       sdlt[n].yres);*/
		if (flags_n & SF_TEXT) {
			fprintf(fp, "Color: %08X, Flags: %04X, Font: %p, Text: %s (%dx%d)\n", sdlt[n].text_color,
			    sdlt[n].text_flags, sdlt[n].text_font, sdlt[n].text, sdlt[n].xres, sdlt[n].yres);
		}

		size += (double)(sdlt[n].xres) * (double)(sdlt[n].yres) * sizeof(uint32_t);
	}
	fprintf(fp, "\n%d unique sprites, %d sprites + %d texts of %d used. %.2fM texture memory.\n", uni, cnt, text,
	    MAX_TEXCACHE, size / (1024.0 * 1024.0));
	fclose(fp);
	xfree(dumpidx);
}
#endif

int sdlt_xoff(int cache_index)
{
	return sdlt[cache_index].xoff;
}

int sdlt_yoff(int cache_index)
{
	return sdlt[cache_index].yoff;
}

int sdlt_xres(int cache_index)
{
	return sdlt[cache_index].xres;
}

int sdlt_yres(int cache_index)
{
	return sdlt[cache_index].yres;
}

int sdl_tex_xres(int cache_index)
{
	return sdlt[cache_index].xres;
}

int sdl_tex_yres(int cache_index)
{
	return sdlt[cache_index].yres;
}

void sdl_tex_alpha(int cache_index, int alpha)
{
	if (sdlt[cache_index].tex) {
#ifdef SDL_USE_RENDER_BACKEND_TEXTURES
		sdl_backend_set_texture_alpha(sdlt[cache_index].tex, (uint8_t)alpha);
#else
		SDL_SetTextureAlphaMod(sdlt[cache_index].tex, (Uint8)alpha);
#endif
	}
}

long long sdl_get_mem_tex(void)
{
	return (long long)__atomic_load_n(&mem_tex, __ATOMIC_RELAXED);
}
