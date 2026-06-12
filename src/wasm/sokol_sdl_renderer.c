/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol SDL render bridge is compiled only by the WASM target."
#endif

#include <stdbool.h>

#include "dll.h"
#include "render_backend/sokol_webgpu_backend.h"
#include "sdl/sdl.h"

DLL_EXPORT int sdl_scale = 1;
DLL_EXPORT int sdl_frames = 0;
DLL_EXPORT int sdl_multi = 0;
DLL_EXPORT int sdl_cache_size = 8000;

static const AstoniaRendererBackend *g_renderer;
static bool g_frame_open;

int sdl_init(int width, int height, char *title, int monitor)
{
	g_renderer = astonia_sokol_webgpu_renderer_backend();
	g_frame_open = false;
	sdl_frames = 0;
	return g_renderer->init(width, height, title, monitor);
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
