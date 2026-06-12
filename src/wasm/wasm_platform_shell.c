/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * Link-safe WASM shell for the SDL platform surface that is not owned by the
 * current Sokol renderer bridge. This is intentionally not final input,
 * cursor, capture, focus, or background loading behavior.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM platform shell is compiled only by the Emscripten target."
#endif

#include "wasm/wasm_platform_shell.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <SDL3/SDL.h>

#include "astonia.h"
#include "sdl/sdl.h"
#include "sdl/sdl_private.h"
#include "sdl/sdl_state.h"

SDL_Window *sdlwnd = NULL;
SDL_Renderer *sdlren = NULL;

zip_t *sdl_zip1 = NULL;
zip_t *sdl_zip2 = NULL;
zip_t *sdl_zip1p = NULL;
zip_t *sdl_zip2p = NULL;
zip_t *sdl_zip1m = NULL;
zip_t *sdl_zip2m = NULL;

SDL_Semaphore *prework = NULL;
SDL_Mutex *premutex = NULL;
SDL_AtomicInt worker_quit;
SDL_Thread **worker_threads = NULL;
struct zip_handles *worker_zips = NULL;

long long sdl_time_mutex = 0;
uint64_t sdl_backgnd_wait = 0;
uint64_t sdl_backgnd_work = 0;
uint64_t sdl_backgnd_jobs = 0;

static void close_sprite_archives(void)
{
	if (sdl_zip1m) {
		zip_close(sdl_zip1m);
		sdl_zip1m = NULL;
	}
	if (sdl_zip1p) {
		zip_close(sdl_zip1p);
		sdl_zip1p = NULL;
	}
	if (sdl_zip1) {
		zip_close(sdl_zip1);
		sdl_zip1 = NULL;
	}
	if (sdl_zip2m) {
		zip_close(sdl_zip2m);
		sdl_zip2m = NULL;
	}
	if (sdl_zip2p) {
		zip_close(sdl_zip2p);
		sdl_zip2p = NULL;
	}
	if (sdl_zip2) {
		zip_close(sdl_zip2);
		sdl_zip2 = NULL;
	}
}

static void open_sprite_archives(void)
{
	close_sprite_archives();

	sdl_zip1 = zip_open("res/gx1.zip", ZIP_RDONLY, NULL);
	sdl_zip1p = zip_open("res/gx1_patch.zip", ZIP_RDONLY, NULL);
	sdl_zip1m = zip_open("res/gx1_mod.zip", ZIP_RDONLY, NULL);

	switch (sdl_scale) {
	case 2:
		sdl_zip2 = zip_open("res/gx2.zip", ZIP_RDONLY, NULL);
		sdl_zip2p = zip_open("res/gx2_patch.zip", ZIP_RDONLY, NULL);
		sdl_zip2m = zip_open("res/gx2_mod.zip", ZIP_RDONLY, NULL);
		break;
	case 3:
		sdl_zip2 = zip_open("res/gx3.zip", ZIP_RDONLY, NULL);
		sdl_zip2p = zip_open("res/gx3_patch.zip", ZIP_RDONLY, NULL);
		sdl_zip2m = zip_open("res/gx3_mod.zip", ZIP_RDONLY, NULL);
		break;
	case 4:
		sdl_zip2 = zip_open("res/gx4.zip", ZIP_RDONLY, NULL);
		sdl_zip2p = zip_open("res/gx4_patch.zip", ZIP_RDONLY, NULL);
		sdl_zip2m = zip_open("res/gx4_mod.zip", ZIP_RDONLY, NULL);
		break;
	default:
		break;
	}
}

int astonia_wasm_platform_shell_init(int width, int height)
{
	sdl_multi = 0;
	SDL_SetAtomicInt(&worker_quit, 0);
	if (!sdl_native_state_init(width, height)) {
		return 0;
	}

	open_sprite_archives();
	if (!sdl_zip1) {
		close_sprite_archives();
		sdl_native_state_shutdown();
		return 0;
	}
	return 1;
}

void astonia_wasm_platform_shell_shutdown(void)
{
	sdl_native_state_shutdown();
	close_sprite_archives();
	SDL_SetAtomicInt(&worker_quit, 1);
	worker_threads = NULL;
	worker_zips = NULL;
	prework = NULL;
	premutex = NULL;
	sdlwnd = NULL;
	sdlren = NULL;
}

void sdl_loop(void)
{
}

bool sdl_is_shown(void)
{
	return true;
}

bool sdl_has_focus(void)
{
	return true;
}

void sdl_set_cursor_pos(int x, int y)
{
	(void)x;
	(void)y;
}

void sdl_capture_mouse(int flag)
{
	(void)flag;
}

void sdl_set_cursor(int cursor)
{
	(void)cursor;
}

SDL_Cursor *sdl_create_cursor(char *filename)
{
	(void)filename;
	return NULL;
}

int sdl_create_cursors(void)
{
	return 1;
}

void sdl_set_title(char *title)
{
	(void)title;
}

void *sdl_create_texture(int width, int height)
{
	(void)width;
	(void)height;
	return NULL;
}

void sdl_render_copy(void *tex, void *sr, void *dr)
{
	(void)tex;
	(void)sr;
	(void)dr;
}

void sdl_render_copy_ex(void *tex, void *sr, void *dr, double angle)
{
	(void)tex;
	(void)sr;
	(void)dr;
	(void)angle;
}

void sdl_flush_textinput(void)
{
}

int sdl_check_mouse(void)
{
	return 0;
}

void sdl_pre_add(unsigned int sprite, signed char sink, unsigned char freeze, unsigned char scale, char cr, char cg,
    char cb, char light, char sat, int c1, int c2, int c3, int shine, char ml, char ll, char rl, char ul, char dl)
{
	(void)sprite;
	(void)sink;
	(void)freeze;
	(void)scale;
	(void)cr;
	(void)cg;
	(void)cb;
	(void)light;
	(void)sat;
	(void)c1;
	(void)c2;
	(void)c3;
	(void)shine;
	(void)ml;
	(void)ll;
	(void)rl;
	(void)ul;
	(void)dl;
}

int if_single_thread_process_one_job(void)
{
	return 0;
}

int sdl_pre_do(void)
{
	return 1;
}

void sdl_dump(FILE *fp)
{
	if (!fp) {
		return;
	}
	fprintf(fp, "WASM SDL platform shell:\n");
	fprintf(fp, "XRES: %d\n", XRES);
	fprintf(fp, "YRES: %d\n", YRES);
	fprintf(fp, "sdl_scale: %d\n", sdl_scale);
	fprintf(fp, "sdl_frames: %d\n", sdl_frames);
	fprintf(fp, "sdl_multi: %d\n", sdl_multi);
}
