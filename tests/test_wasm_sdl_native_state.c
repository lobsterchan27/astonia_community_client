/*
 * Focused WASM SDL native-state harness.
 *
 * Validates renderer-independent cache/image/resource state without SDL
 * renderer types, sprite upload, text, or browser-side asset parsing.
 */

#include <stdint.h>
#include <stdio.h>

#include "astonia.h"
#include "sdl/sdl_state.h"

uint64_t game_options = GO_NOTSET;

static int fake_texture_jobs_mutex;
static int fake_texture_jobs_cond;

static int fail_at(int line, const char *expr)
{
	fprintf(stderr, "wasm sdl native state failed at line %d: %s\n", line, expr);
	return 1;
}

#define CHECK(expr)        \
	do {                   \
		if (!(expr)) {     \
			return fail_at(__LINE__, #expr); \
		}                  \
	} while (0)

int main(void)
{
	SdlNativeStateSnapshot snapshot;

	sdl_multi = 0;
	g_tex_jobs.mutex = NULL;
	g_tex_jobs.cond = NULL;
	CHECK(!sdl_native_state_init(1280, 720));
	sdl_native_state_snapshot(&snapshot);
	CHECK(snapshot.initialized == 0);
	CHECK(snapshot.texture_jobs_mutex_ready == 0);
	CHECK(snapshot.texture_jobs_cond_ready == 0);

	g_tex_jobs.mutex = (struct SDL_Mutex *)&fake_texture_jobs_mutex;
	g_tex_jobs.cond = NULL;
	CHECK(!sdl_native_state_init(1280, 720));

	g_tex_jobs.mutex = NULL;
	g_tex_jobs.cond = (struct SDL_Condition *)&fake_texture_jobs_cond;
	CHECK(!sdl_native_state_init(1280, 720));

	g_tex_jobs.mutex = (struct SDL_Mutex *)&fake_texture_jobs_mutex;
	g_tex_jobs.cond = (struct SDL_Condition *)&fake_texture_jobs_cond;
	game_options = GO_NOTSET;
	CHECK(sdl_native_state_init(1280, 720));
	sdl_native_state_snapshot(&snapshot);

	CHECK(snapshot.initialized == 1);
	CHECK(snapshot.scale == 1);
	CHECK(snapshot.yres == 650);
	CHECK(snapshot.render_offset_x == 240);
	CHECK(snapshot.render_offset_y == 35);
	CHECK(snapshot.cache_size == 8000);
	CHECK(snapshot.multi == 0);
	CHECK(snapshot.cache_best == 0);
	CHECK(snapshot.cache_last == MAX_TEXCACHE - 1);
	CHECK(snapshot.cache_empty_heads == MAX_TEXHASH);
	CHECK(snapshot.first_prev == STX_NONE);
	CHECK(snapshot.first_next == 1);
	CHECK(snapshot.first_generation == 1);
	CHECK(snapshot.first_work_state == TX_WORK_IDLE);
	CHECK(snapshot.last_prev == MAX_TEXCACHE - 2);
	CHECK(snapshot.last_next == STX_NONE);
	CHECK(snapshot.texture_jobs_mutex_ready == 1);
	CHECK(snapshot.texture_jobs_cond_ready == 1);
	CHECK(snapshot.texture_jobs_count == 0);
	CHECK(snapshot.image_state_zero == 0);
	CHECK(snapshot.gx1_zip_ready == 1);
	CHECK(snapshot.gx1_probe_sprite_ready == 1);
	CHECK(sdl_native_resource_probe_sprite(2));

	sdl_native_state_shutdown();
	sdl_native_state_shutdown();
	sdl_native_state_snapshot(&snapshot);
	CHECK(snapshot.initialized == 0);
	CHECK(snapshot.scale == 1);
	CHECK(snapshot.yres == 600);
	CHECK(snapshot.gx1_zip_ready == 0);
	CHECK(snapshot.gx1_probe_sprite_ready == 0);

	return 0;
}
