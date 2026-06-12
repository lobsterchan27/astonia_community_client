/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol SDL render bridge is compiled only by the WASM target."
#endif

#include <stdbool.h>
#include <stdint.h>

#include "astonia.h"
#include "dll.h"
#include "render_backend/sokol_webgpu_backend.h"
#include "sdl/sdl.h"
#include "sdl/sdl_state.h"

DLL_EXPORT uint64_t game_options __attribute__((weak)) = GO_NOTSET;

static const AstoniaRendererBackend *g_renderer;
static bool g_frame_open;

int sdl_init(int width, int height, char *title, int monitor)
{
	if (!sdl_native_state_init(width, height)) {
		return 0;
	}

	g_renderer = astonia_sokol_webgpu_renderer_backend();
	g_frame_open = false;
	sdl_frames = 0;
	if (!g_renderer->init(width, height, title, monitor)) {
		sdl_native_state_shutdown();
		g_renderer = 0;
		return 0;
	}

	return 1;
}

void sdl_exit(void)
{
	if (g_frame_open && g_renderer) {
		(void)g_renderer->end_frame();
	}
	g_frame_open = false;

	if (g_renderer) {
		g_renderer->shutdown();
	}
	g_renderer = 0;
	sdl_native_state_shutdown();
}

int sdl_clear(void)
{
	if (!g_renderer) {
		return 0;
	}

	if (g_frame_open) {
		(void)g_renderer->end_frame();
		g_frame_open = false;
	}

	const AstoniaRendererClearColor clear_color = {
		.r = 0.02f,
		.g = 0.05f,
		.b = 0.10f,
		.a = 1.0f,
	};
	g_frame_open = g_renderer->begin_frame(clear_color) != 0;
	return g_frame_open ? 1 : 0;
}

int sdl_render(void)
{
	if (!g_frame_open || !g_renderer) {
		return 0;
	}

	g_frame_open = false;
	if (!g_renderer->end_frame()) {
		return 0;
	}

	sdl_frames++;
	return 1;
}

DLL_EXPORT int astonia_wasm_native_state_check(void)
{
	SdlNativeStateSnapshot snapshot;

	sdl_native_state_snapshot(&snapshot);
	return snapshot.initialized && snapshot.cache_best == 0 && snapshot.cache_last == MAX_TEXCACHE - 1 &&
	       snapshot.cache_empty_heads == MAX_TEXHASH && snapshot.first_prev == STX_NONE && snapshot.first_next == 1 &&
	       snapshot.first_generation == 1 && snapshot.first_work_state == TX_WORK_IDLE && snapshot.last_next == STX_NONE &&
	       snapshot.gx1_zip_ready && snapshot.gx1_probe_sprite_ready
	           ? 0
	           : 1;
}

DLL_EXPORT int astonia_wasm_native_state_probe_sprite(int sprite)
{
	if (sprite < 0) {
		return 0;
	}

	return sdl_native_resource_probe_sprite((unsigned int)sprite);
}
