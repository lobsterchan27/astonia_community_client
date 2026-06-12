/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef SDL_STATE_H
#define SDL_STATE_H

#include <stdint.h>

// Fixed upper bound for the texture cache metadata.
// Statically allocated at compile time.
#define MAX_TEXCACHE 8000
#define MAX_TEXHASH  8000

#define STX_NONE (-1)

#define SF_USED     (1 << 0)
#define SF_SPRITE   (1 << 1)
#define SF_TEXT     (1 << 2)
#define SF_DIDALLOC (1 << 3)
#define SF_DIDMAKE  (1 << 4)
#define SF_DIDTEX   (1 << 5)

#define IGET_A(c)         ((((uint32_t)(c)) >> 24) & 0xFF)
#define IGET_R(c)         ((((uint32_t)(c)) >> 16) & 0xFF)
#define IGET_G(c)         ((((uint32_t)(c)) >> 8) & 0xFF)
#define IGET_B(c)         ((((uint32_t)(c)) >> 0) & 0xFF)
#define IRGB(r, g, b)     (((uint32_t)(r) << 16) | ((uint32_t)(g) << 8) | ((uint32_t)(b) << 0))
#define IRGBA(r, g, b, a) (((uint32_t)(a) << 24) | ((uint32_t)(r) << 16) | ((uint32_t)(g) << 8) | ((uint32_t)(b) << 0))

// Texture job work state enum.
typedef enum texture_work_state {
	TX_WORK_IDLE = 0, // no job queued, no worker running
	TX_WORK_QUEUED, // job is in queue, not yet taken by a worker
	TX_WORK_IN_WORKER, // worker popped job and is processing
} texture_work_state_t;

struct sdl_texture {
	struct SDL_Texture *tex;
	uint32_t *pixel;

	int prev, next;
	int hprev, hnext;

	_Atomic(uint16_t) flags; // Atomic for lock-free reads, writes under mutex

	// Versioning and work state for robust job queue
	uint32_t generation; // Incremented each time this slot is reused (eviction only)
	// See texture_work_state_t; MUST be modified under g_tex_jobs.mutex
	_Atomic(uint8_t) work_state;

	// ---------- sprites ------------
	// fx
	uint32_t sprite;
	int8_t sink;
	uint8_t scale;
	int16_t cr, cg, cb, light, sat;
	uint16_t c1, c2, c3, shine;

	uint8_t freeze;

	// light
	int8_t ml, ll, rl, ul, dl; // light in middle, left, right, up, down

	// primary
	uint16_t xres; // x resolution in pixels
	uint16_t yres; // y resolution in pixels
	int16_t xoff; // offset to blit position
	int16_t yoff; // offset to blit position

	// ---------- text --------------
	uint16_t text_flags;
	uint32_t text_color;
	char *text;
	void *text_font;
};

struct sdl_image {
	uint32_t *pixel;

	uint16_t flags;
	uint16_t xres, yres;
	int16_t xoff, yoff;
};

// Texture job queue structures.
#define TEX_JOB_CAPACITY 16384 // Large enough to handle all texture cache entries

typedef enum texture_job_kind {
	// Load from disk, allocate pixels, process effects.
	TEXTURE_JOB_MAKE_STAGES_1_2 = 0,
	// Room for future job types (TEXTURE_JOB_FREE, TEXTURE_JOB_RELOAD, etc.)
} texture_job_kind_t;

typedef struct texture_job {
	int cache_index; // index into sdlt[]
	uint32_t generation; // snapshot of sdlt[cache_index].generation
	texture_job_kind_t kind; // what operation to perform
} texture_job_t;

typedef struct texture_job_queue {
	texture_job_t jobs[TEX_JOB_CAPACITY];
	int head; // pop position
	int tail; // push position
	int count; // number of jobs in queue

	struct SDL_Mutex *mutex;
	struct SDL_Condition *cond;
} texture_job_queue_t;

// Lock-free flag operation helpers.
// These provide consistent atomic ordering across all SDL modules.
static inline uint16_t flags_load(struct sdl_texture *st)
{
	uint16_t *flags_ptr = (uint16_t *)&st->flags;
	return __atomic_load_n(flags_ptr, __ATOMIC_ACQUIRE);
}

// Work state load helper.
// Can be called without mutex for diagnostic reads, but any decision based on
// the value that affects eviction or queue state MUST be done under mutex.
static inline uint8_t work_state_load(struct sdl_texture *st)
{
	uint8_t *state_ptr = (uint8_t *)&st->work_state;
	return __atomic_load_n(state_ptr, __ATOMIC_ACQUIRE);
}

// Work state store helper.
// Caller MUST hold g_tex_jobs.mutex.
// Stores are always coordinated with queue state changes under the mutex.
static inline void work_state_store(struct sdl_texture *st, texture_work_state_t new_state)
{
	uint8_t *state_ptr = (uint8_t *)&st->work_state;
	__atomic_store_n(state_ptr, (uint8_t)new_state, __ATOMIC_RELEASE);
}

typedef struct sdl_native_state_snapshot {
	int initialized;
	int scale;
	int yres;
	int render_offset_x;
	int render_offset_y;
	int cache_size;
	int multi;
	int cache_best;
	int cache_last;
	int cache_empty_heads;
	int first_prev;
	int first_next;
	int first_generation;
	int first_work_state;
	int last_prev;
	int last_next;
	int image_state_zero;
	int gx1_zip_ready;
	int gx1_probe_sprite_ready;
} SdlNativeStateSnapshot;

extern struct sdl_texture sdlt[MAX_TEXCACHE];
extern int sdlt_best, sdlt_last;
extern int sdlt_cache[MAX_TEXHASH];
extern struct sdl_image *sdli;
extern int *sdli_state;
extern texture_job_queue_t g_tex_jobs;

extern int sdl_cache_size;
extern int sdl_scale;
extern int sdl_frames;
extern int sdl_multi;
extern int __yres;

extern int texc_used;
extern long long mem_png, mem_tex;
extern long long texc_hit, texc_miss, texc_pre;

extern long long sdl_time_preload;
extern long long sdl_time_make;
extern long long sdl_time_make_main;
extern long long sdl_time_load;
extern long long sdl_time_alloc;
extern long long sdl_time_tex;
extern long long sdl_time_tex_main;
extern long long sdl_time_text;
extern long long sdl_time_blit;
extern long long sdl_time_pre1;
extern long long sdl_time_pre2;
extern long long sdl_time_pre3;

extern int maxpanic;

void sdl_native_state_reset_cache(void);
void sdl_native_state_configure_frame(int width, int height, int *render_offset_x, int *render_offset_y);
int sdl_native_state_init(int width, int height);
void sdl_native_state_shutdown(void);
int sdl_native_state_is_initialized(void);
void sdl_native_state_snapshot(SdlNativeStateSnapshot *snapshot);
int sdl_native_resource_probe_sprite(unsigned int sprite);

#endif
