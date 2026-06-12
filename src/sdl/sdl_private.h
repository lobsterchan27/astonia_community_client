/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef SDL_PRIVATE_H
#define SDL_PRIVATE_H

#include <stddef.h>
#include <stdint.h>
#include <zip.h>
#include <png.h>
#include <SDL3/SDL.h>
#include <SDL3_mixer/SDL_mixer.h>

#include "sdl/sdl_state.h"

#if defined(__EMSCRIPTEN__) || defined(SDL_RENDER_BACKEND_TEXTURES_FOR_TEST)
#define SDL_USE_RENDER_BACKEND_TEXTURES 1
#endif

#ifndef ASTONIA_RENDERFONT_STRUCT_DEFINED
#define ASTONIA_RENDERFONT_STRUCT_DEFINED
struct renderfont {
	int dim;
	unsigned char *raw;
};
#endif

#ifndef HAVE_DDFONT
#define HAVE_DDFONT
#endif

#define RENDER_TEXT_TERMINATOR '\xB0' // draw text terminator - (zero stays one, too)

struct zip_handles {
	zip_t *zip1;
	zip_t *zip2;
	zip_t *zip1p;
	zip_t *zip2p;
	zip_t *zip1m;
	zip_t *zip2m;
};

int sdl_ic_load(unsigned int sprite, struct zip_handles *zips);
int sdl_pre_backgnd(void *ptr);
int sdl_create_cursors(void);
SDL_Cursor *sdl_create_cursor(char *filename);
void sdl_pre_add(unsigned int sprite, signed char sink, unsigned char freeze, unsigned char scale, char cr, char cg,
    char cb, char light, char sat, int c1, int c2, int c3, int shine, char ml, char ll, char rl, char ul, char dl);
void sdl_lock(void *a);
int sdl_pre_do(void);

#define MAX_SOUND_CHANNELS 32
#define MAXSOUND           100

// SDL3_mixer globals
extern MIX_Mixer *sdl_mixer;
extern MIX_Track *sdl_tracks[MAX_SOUND_CHANNELS];

struct png_helper;
int png_load_helper(struct png_helper *p);
void png_load_helper_exit(struct png_helper *p);

// ============================================================================
// Shared variables from sdl_core.c
// ============================================================================
extern SDL_Window *sdlwnd;
extern SDL_Renderer *sdlren;
extern zip_t *sdl_zip1;
extern zip_t *sdl_zip2;
extern zip_t *sdl_zip1p;
extern zip_t *sdl_zip2p;
extern zip_t *sdl_zip1m;
extern zip_t *sdl_zip2m;
extern SDL_Mutex *premutex;
extern int *sdli_state; // Image loading state machine
extern texture_job_queue_t g_tex_jobs; // Texture job queue
extern int sdl_cache_size; // Requested size (for logging / config), not allocation

// ============================================================================
// Shared variables from sdl_texture.c
// ============================================================================
extern struct sdl_texture sdlt[MAX_TEXCACHE];
extern int sdlt_best, sdlt_last;
extern int sdlt_cache[MAX_TEXHASH];
extern struct sdl_image *sdli;

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

// ============================================================================
// Internal functions from sdl_texture.c
// ============================================================================
void sdl_tx_best(int cache_index);
int sdl_tx_load(unsigned int sprite, signed char sink, unsigned char freeze, unsigned char scale, char cr, char cg,
    char cb, char light, char sat, int c1, int c2, int c3, int shine, char ml, char ll, char rl, char ul, char dl,
    const char *text, int text_color, int text_flags, void *text_font, int checkonly, int preload);
void tex_jobs_init(void);
void tex_jobs_shutdown(void);
int tex_jobs_pop(texture_job_t *out_job, int should_block);

#ifdef DEVELOPER
void sdl_dump_spritecache(void);
#endif

// ============================================================================
// Internal functions from sdl_image.c
// ============================================================================
uint32_t mix_argb(uint32_t c1, uint32_t c2, float w1, float w2);
void sdl_smoothify(uint32_t *pixel, int xres, int yres, int scale);
void png_helper_read(png_structp ps, png_bytep buf, png_size_t len);
int sdl_load_image_png_(struct sdl_image *si, char *filename, zip_t *zip);
int sdl_load_image_png(struct sdl_image *si, char *filename, zip_t *zip, int smoothify);
int do_smoothify(int sprite);
int sdl_load_image(struct sdl_image *si, int sprite, struct zip_handles *zips);
int sdl_ic_load(unsigned int sprite, struct zip_handles *zips);
void sdl_make(struct sdl_texture *st, struct sdl_image *si, int preload);

// ============================================================================
// Internal functions from sdl_effects.c
// ============================================================================
uint32_t sdl_light(int light, uint32_t irgb);
uint32_t sdl_freeze(int freeze, uint32_t irgb);
uint32_t sdl_shine_pix(uint32_t irgb, unsigned short shine);
uint32_t sdl_colorize_pix(uint32_t irgb, unsigned short c1v, unsigned short c2v, unsigned short c3v);
uint32_t sdl_colorize_pix2(uint32_t irgb, unsigned short c1v, unsigned short c2v, unsigned short c3v, int x, int y,
    int xres, int yres, uint32_t *pixel, int sprite);
uint32_t sdl_colorbalance(uint32_t irgb, char cr, char cg, char cb, char light, char sat);

// ============================================================================
// Internal functions from sdl_draw.c
// ============================================================================
SDL_Texture *sdl_maketext(const char *text, struct renderfont *font, uint32_t color, int flags);

#ifdef SDL_USE_RENDER_BACKEND_TEXTURES
typedef struct sdl_backend_rect {
	float x;
	float y;
	float w;
	float h;
} SdlBackendRect;

static inline int sdl_backend_argb8888_pitch_is_valid(int width, size_t pitch_bytes)
{
	return width > 0 && pitch_bytes >= (size_t)width * sizeof(uint32_t);
}

SDL_Texture *sdl_backend_create_texture_from_argb8888(
    int width, int height, const uint32_t *pixels, size_t pitch_bytes);
void sdl_backend_destroy_texture(SDL_Texture *texture);
int sdl_backend_get_texture_size(SDL_Texture *texture, float *width, float *height);
int sdl_backend_set_texture_alpha(SDL_Texture *texture, uint8_t alpha);
int sdl_backend_blit_texture(SDL_Texture *texture, const SdlBackendRect *src, const SdlBackendRect *dst);
#endif

// ============================================================================
// Internal functions from sdl_core.c
// ============================================================================
int if_single_thread_process_one_job(void);

// ============================================================================
// Test-only functions (compiled only when UNIT_TEST is defined)
// ============================================================================

#ifdef UNIT_TEST

// Line clipping function (non-static for testing)
int clip_line(int *x0, int *y0, int *x1, int *y1, int xmin, int ymin, int xmax, int ymax);

// Render call counter functions for test verification
void sdl_test_reset_render_counters(void);
int sdl_test_get_render_point_count(void);
int sdl_test_get_render_line_count(void);
int sdl_test_get_render_rect_count(void);
int sdl_test_get_render_fill_rect_count(void);
int sdl_test_get_render_geometry_count(void);
int sdl_test_get_render_total_count(void);
int sdl_test_get_set_draw_color_count(void);
int sdl_test_get_set_blend_mode_count(void);

// Initialize SDL subsystems for testing without window/audio/real I/O
int sdl_init_for_tests(void);

// Initialize with background worker threads enabled
int sdl_init_for_tests_with_workers(int worker_count);

// Tear down test state (stop workers, free resources)
void sdl_shutdown_for_tests(void);

// Pump the prefetch pipeline without full game loop
int sdl_pre_tick_for_tests(void);

// Check all cache/queue/LRU invariants (returns 0 on success, -1 on bug)
int sdl_check_invariants_for_tests(void);

// Test-only introspection helpers (read-only, no side effects)
uint16_t sdl_texture_get_flags_for_test(int cache_index);
int sdl_texture_get_sprite_for_test(int cache_index);
uint8_t sdl_texture_get_work_state_for_test(int cache_index);
int sdl_get_job_queue_depth_for_test(void);

#endif /* UNIT_TEST */

#endif // SDL_PRIVATE_H
