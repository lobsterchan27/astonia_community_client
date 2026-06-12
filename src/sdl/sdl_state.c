/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * Renderer-independent SDL compatibility state shared by the native SDL client
 * and the WASM Sokol bridge.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dll.h"
#include "astonia.h"
#include "sdl/sdl.h"
#include "sdl/sdl_state.h"

#define SDL_GO_DEFAULTS (GO_CONTEXT | GO_ACTION | GO_BIGBAR | GO_PREDICT | GO_SHORT | GO_MAPSAVE)
#define SDL_RESOURCE_PROBE_SPRITE 2u

// Scale and resolution settings.
DLL_EXPORT int sdl_scale = 1;
DLL_EXPORT int sdl_frames = 0;
#ifdef __EMSCRIPTEN__
DLL_EXPORT int sdl_multi = 0;
#else
DLL_EXPORT int sdl_multi = 4;
#endif
DLL_EXPORT int sdl_cache_size = 8000;
DLL_EXPORT int __yres = YRES0;

// Texture cache data.
struct sdl_texture sdlt[MAX_TEXCACHE];
int sdlt_best, sdlt_last;
int sdlt_cache[MAX_TEXHASH];

// Image cache and image loading state.
static struct sdl_image sdli_storage[MAXSPRITE];
struct sdl_image *sdli = sdli_storage;

static int sdli_state_storage[MAXSPRITE];
int *sdli_state = sdli_state_storage;

// Texture job queue metadata. Native SDL creates the mutex/condition in
// sdl_texture.c; the WASM state slice only needs the single-thread metadata.
texture_job_queue_t g_tex_jobs;

// Statistics.
int texc_used = 0;
long long mem_png = 0;
long long mem_tex = 0;
long long texc_hit = 0, texc_miss = 0, texc_pre = 0;

// Timing.
long long sdl_time_preload = 0;
long long sdl_time_make = 0;
long long sdl_time_make_main = 0;
long long sdl_time_load = 0;
long long sdl_time_alloc = 0;
long long sdl_time_tex = 0;
long long sdl_time_tex_main = 0;
long long sdl_time_text = 0;
long long sdl_time_blit = 0;
long long sdl_time_pre1 = 0;
long long sdl_time_pre2 = 0;
long long sdl_time_pre3 = 0;

int maxpanic = 0;

static int g_native_state_initialized = 0;
static int g_render_offset_x = 0;
static int g_render_offset_y = 0;
static int g_gx1_zip_ready = 0;
static int g_gx1_probe_sprite_ready = 0;

static unsigned int read_le16(const unsigned char *buffer)
{
	return (unsigned int)buffer[0] | ((unsigned int)buffer[1] << 8);
}

static unsigned long read_le32(const unsigned char *buffer)
{
	return (unsigned long)buffer[0] | ((unsigned long)buffer[1] << 8) | ((unsigned long)buffer[2] << 16) |
	       ((unsigned long)buffer[3] << 24);
}

static int zip_has_magic(const char *path)
{
	unsigned char header[4];
	FILE *file = fopen(path, "rb");
	int ok;

	if (!file) {
		return 0;
	}

	ok = fread(header, 1, sizeof(header), file) == sizeof(header) && header[0] == 'P' && header[1] == 'K' &&
	     header[2] == 0x03 && header[3] == 0x04;
	fclose(file);
	return ok;
}

static unsigned char *find_zip_eocd(FILE *file, unsigned char **out_tail, size_t *out_tail_size)
{
	static const unsigned char eocd_signature[] = {'P', 'K', 0x05, 0x06};
	long file_size;
	size_t tail_size;
	unsigned char *tail;

	if (fseek(file, 0, SEEK_END) != 0) {
		return NULL;
	}
	file_size = ftell(file);
	if (file_size < 22) {
		return NULL;
	}

	tail_size = (size_t)(file_size < 66000 ? file_size : 66000);
	tail = malloc(tail_size);
	if (!tail) {
		return NULL;
	}

	if (fseek(file, file_size - (long)tail_size, SEEK_SET) != 0 || fread(tail, 1, tail_size, file) != tail_size) {
		free(tail);
		return NULL;
	}

	for (size_t i = tail_size - 22;; i--) {
		if (memcmp(tail + i, eocd_signature, sizeof(eocd_signature)) == 0) {
			*out_tail = tail;
			*out_tail_size = tail_size;
			return tail + i;
		}
		if (i == 0) {
			break;
		}
	}

	free(tail);
	return NULL;
}

static int zip_contains_entry(const char *path, const char *entry_name)
{
	unsigned char *tail = NULL;
	unsigned char *eocd;
	unsigned char header[46];
	size_t tail_size = 0;
	size_t entry_name_len = strlen(entry_name);
	unsigned int total_entries;
	unsigned long central_directory_offset;
	FILE *file = fopen(path, "rb");
	int found = 0;

	if (!file) {
		return 0;
	}

	eocd = find_zip_eocd(file, &tail, &tail_size);
	if (!eocd) {
		fclose(file);
		return 0;
	}

	total_entries = read_le16(eocd + 10);
	central_directory_offset = read_le32(eocd + 16);

	if (fseek(file, (long)central_directory_offset, SEEK_SET) != 0) {
		free(tail);
		fclose(file);
		return 0;
	}

	for (unsigned int i = 0; i < total_entries; i++) {
		unsigned int name_len;
		unsigned int extra_len;
		unsigned int comment_len;

		if (fread(header, 1, sizeof(header), file) != sizeof(header)) {
			break;
		}
		if (header[0] != 'P' || header[1] != 'K' || header[2] != 0x01 || header[3] != 0x02) {
			break;
		}

		name_len = read_le16(header + 28);
		extra_len = read_le16(header + 30);
		comment_len = read_le16(header + 32);

		if (name_len == entry_name_len) {
			char name_buffer[64];
			if (name_len >= sizeof(name_buffer)) {
				break;
			}
			if (fread(name_buffer, 1, name_len, file) != name_len) {
				break;
			}
			name_buffer[name_len] = '\0';
			if (memcmp(name_buffer, entry_name, name_len) == 0) {
				found = 1;
				break;
			}
		} else if (fseek(file, (long)name_len, SEEK_CUR) != 0) {
			break;
		}

		if (fseek(file, (long)(extra_len + comment_len), SEEK_CUR) != 0) {
			break;
		}
	}

	free(tail);
	fclose(file);
	return found;
}

void sdl_native_state_reset_cache(void)
{
	int i;

	memset(sdlt, 0, sizeof(sdlt));
	for (i = 0; i < MAX_TEXCACHE; i++) {
		uint16_t *flags_ptr = (uint16_t *)&sdlt[i].flags;
		__atomic_store_n(flags_ptr, 0, __ATOMIC_RELAXED);
		sdlt[i].prev = i - 1;
		sdlt[i].next = i + 1;
		sdlt[i].hnext = STX_NONE;
		sdlt[i].hprev = STX_NONE;
		sdlt[i].generation = 1;
		sdlt[i].work_state = TX_WORK_IDLE;
	}
	sdlt[0].prev = STX_NONE;
	sdlt[MAX_TEXCACHE - 1].next = STX_NONE;
	sdlt_best = 0;
	sdlt_last = MAX_TEXCACHE - 1;

	for (i = 0; i < MAX_TEXHASH; i++) {
		sdlt_cache[i] = STX_NONE;
	}

	memset(sdli_storage, 0, sizeof(sdli_storage));
	memset(sdli_state_storage, 0, sizeof(sdli_state_storage));
	{
		struct SDL_Mutex *mutex = g_tex_jobs.mutex;
		struct SDL_Condition *cond = g_tex_jobs.cond;
		memset(&g_tex_jobs, 0, sizeof(g_tex_jobs));
		g_tex_jobs.mutex = mutex;
		g_tex_jobs.cond = cond;
	}

	texc_used = 0;
	mem_png = 0;
	mem_tex = 0;
	texc_hit = 0;
	texc_miss = 0;
	texc_pre = 0;

	sdl_time_preload = 0;
	sdl_time_make = 0;
	sdl_time_make_main = 0;
	sdl_time_load = 0;
	sdl_time_alloc = 0;
	sdl_time_tex = 0;
	sdl_time_tex_main = 0;
	sdl_time_text = 0;
	sdl_time_blit = 0;
	sdl_time_pre1 = 0;
	sdl_time_pre2 = 0;
	sdl_time_pre3 = 0;

	maxpanic = 0;
}

void sdl_native_state_configure_frame(int width, int height, int *render_offset_x, int *render_offset_y)
{
	int offset_x = 0;
	int offset_y = 0;

	sdl_scale = 1;
	__yres = YRES0;

	if (width > 0 && height > 0 && (width != XRES || height != YRES)) {
		int tmp_scale = 1;
		int off = 0;

		if (width / XRES >= 4 && height / YRES0 >= 4) {
			sdl_scale = 4;
		} else if (width / XRES >= 3 && height / YRES0 >= 3) {
			sdl_scale = 3;
		} else if (width / XRES >= 2 && height / YRES0 >= 2) {
			sdl_scale = 2;
		}

		if (width / XRES >= 4 && height / YRES2 >= 4) {
			tmp_scale = 4;
		} else if (width / XRES >= 3 && height / YRES2 >= 3) {
			tmp_scale = 3;
		} else if (width / XRES >= 2 && height / YRES2 >= 2) {
			tmp_scale = 2;
		}

		if (tmp_scale > sdl_scale || height < YRES0) {
			sdl_scale = tmp_scale;
			YRES = height / sdl_scale;
		}

		tmp_scale = 1;
		if (width / XRES >= 4 && height / YRES3 >= 4) {
			tmp_scale = 4;
		} else if (width / XRES >= 3 && height / YRES3 >= 3) {
			tmp_scale = 3;
		} else if (width / XRES >= 2 && height / YRES3 >= 2) {
			tmp_scale = 2;
		}

		if (tmp_scale > sdl_scale) {
			sdl_scale = tmp_scale;
			YRES = height / sdl_scale;
		}

		YRES = height / sdl_scale;

		if (game_options & GO_SMALLTOP) {
			off += 40;
		}
		if (game_options & GO_SMALLBOT) {
			off += 40;
		}

		if (YRES > YRES1 - off) {
			YRES = YRES1 - off;
		}

		offset_x = (width / sdl_scale - XRES) / 2;
		offset_y = (height / sdl_scale - YRES) / 2;
	}

	if (game_options & GO_NOTSET) {
		if (YRES >= 620) {
			game_options = SDL_GO_DEFAULTS;
		} else if (YRES >= 580) {
			game_options = SDL_GO_DEFAULTS | GO_SMALLBOT;
		} else {
			game_options = SDL_GO_DEFAULTS | GO_SMALLBOT | GO_SMALLTOP;
		}
	}

	g_render_offset_x = offset_x;
	g_render_offset_y = offset_y;

	if (render_offset_x) {
		*render_offset_x = offset_x;
	}
	if (render_offset_y) {
		*render_offset_y = offset_y;
	}
}

int sdl_native_resource_probe_sprite(unsigned int sprite)
{
	char entry_name[16];

	if (sprite >= MAXSPRITE) {
		return 0;
	}

	snprintf(entry_name, sizeof(entry_name), "%08u.png", sprite);
	return zip_contains_entry("res/gx1.zip", entry_name);
}

int sdl_native_state_init(int width, int height)
{
	sdl_native_state_configure_frame(width, height, NULL, NULL);
	sdl_native_state_reset_cache();
	g_gx1_zip_ready = zip_has_magic("res/gx1.zip");
	g_gx1_probe_sprite_ready = sdl_native_resource_probe_sprite(SDL_RESOURCE_PROBE_SPRITE);
	g_native_state_initialized = g_gx1_zip_ready && g_gx1_probe_sprite_ready;
	return g_native_state_initialized;
}

void sdl_native_state_shutdown(void)
{
	sdl_native_state_reset_cache();
	sdl_scale = 1;
	sdl_frames = 0;
	__yres = YRES0;
	g_native_state_initialized = 0;
	g_gx1_zip_ready = 0;
	g_gx1_probe_sprite_ready = 0;
	g_render_offset_x = 0;
	g_render_offset_y = 0;
}

int sdl_native_state_is_initialized(void)
{
	return g_native_state_initialized;
}

void sdl_native_state_snapshot(SdlNativeStateSnapshot *snapshot)
{
	int empty_heads = 0;

	if (!snapshot) {
		return;
	}

	for (int i = 0; i < MAX_TEXHASH; i++) {
		if (sdlt_cache[i] == STX_NONE) {
			empty_heads++;
		}
	}

	memset(snapshot, 0, sizeof(*snapshot));
	snapshot->initialized = g_native_state_initialized;
	snapshot->scale = sdl_scale;
	snapshot->yres = YRES;
	snapshot->render_offset_x = g_render_offset_x;
	snapshot->render_offset_y = g_render_offset_y;
	snapshot->cache_size = sdl_cache_size;
	snapshot->multi = sdl_multi;
	snapshot->cache_best = sdlt_best;
	snapshot->cache_last = sdlt_last;
	snapshot->cache_empty_heads = empty_heads;
	snapshot->first_prev = sdlt[0].prev;
	snapshot->first_next = sdlt[0].next;
	snapshot->first_generation = (int)sdlt[0].generation;
	snapshot->first_work_state = (int)work_state_load(&sdlt[0]);
	snapshot->last_prev = sdlt[MAX_TEXCACHE - 1].prev;
	snapshot->last_next = sdlt[MAX_TEXCACHE - 1].next;
	snapshot->image_state_zero = sdli_state[0];
	snapshot->gx1_zip_ready = g_gx1_zip_ready;
	snapshot->gx1_probe_sprite_ready = g_gx1_probe_sprite_ready;
}
