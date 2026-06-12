/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol WebGPU harness is compiled only by the WASM target."
#endif

#include "sdl/sdl.h"
#include "sokol_app.h"
#include "sokol_log.h"

static int g_renderer_ready;

static void harness_init(void)
{
	g_renderer_ready = sdl_init(1280, 720, "Astonia Sokol WebGPU Renderer", 0);
	if (!g_renderer_ready) {
		sapp_request_quit();
	}
}

static void harness_frame(void)
{
	if (!g_renderer_ready) {
		return;
	}

	if (sdl_clear()) {
		(void)sdl_render();
	}
}

static void harness_cleanup(void)
{
	sdl_exit();
	g_renderer_ready = 0;
}

sapp_desc sokol_main(int argc, char *argv[])
{
	sapp_desc desc = {0};

	(void)argc;
	(void)argv;

	desc.init_cb = harness_init;
	desc.frame_cb = harness_frame;
	desc.cleanup_cb = harness_cleanup;
	desc.width = 1280;
	desc.height = 720;
	desc.sample_count = 1;
	desc.window_title = "Astonia WASM/WebGPU Client";
	desc.logger.func = slog_func;
	desc.html5.canvas_selector = "#canvas";
	desc.html5.canvas_resize = false;
	desc.html5.update_document_title = false;

	return desc;
}
