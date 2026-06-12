/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol WebGPU renderer backend is WASM-only."
#endif

#include "render_backend/sokol_webgpu_backend.h"

#include <stdbool.h>

#include "sokol_app.h"
#include "sokol_gfx.h"
#include "sokol_glue.h"
#include "sokol_log.h"

typedef struct sokol_webgpu_state {
	bool initialized;
	int frames;
} SokolWebgpuState;

static SokolWebgpuState g_sokol_webgpu;

static int sokol_webgpu_init(int width, int height, const char *title, int monitor)
{
	sg_desc desc = {0};

	(void)width;
	(void)height;
	(void)title;
	(void)monitor;

	desc.environment = sglue_environment();
	desc.logger.func = slog_func;
	sg_setup(&desc);

	if (!sg_isvalid()) {
		g_sokol_webgpu.initialized = false;
		return 0;
	}

	g_sokol_webgpu.initialized = true;
	g_sokol_webgpu.frames = 0;
	return 1;
}

static void sokol_webgpu_shutdown(void)
{
	if (g_sokol_webgpu.initialized) {
		sg_shutdown();
	}
	g_sokol_webgpu.initialized = false;
	g_sokol_webgpu.frames = 0;
}

static int sokol_webgpu_begin_frame(AstoniaRendererClearColor clear_color)
{
	sg_pass pass = {0};

	if (!g_sokol_webgpu.initialized) {
		return 0;
	}

	pass.action.colors[0].load_action = SG_LOADACTION_CLEAR;
	pass.action.colors[0].clear_value = (sg_color){clear_color.r, clear_color.g, clear_color.b, clear_color.a};
	pass.swapchain = sglue_swapchain();
	sg_begin_pass(&pass);

	return 1;
}

static int sokol_webgpu_end_frame(void)
{
	if (!g_sokol_webgpu.initialized) {
		return 0;
	}

	sg_end_pass();
	sg_commit();
	g_sokol_webgpu.frames++;
	return 1;
}

static int sokol_webgpu_frame_count(void)
{
	return g_sokol_webgpu.frames;
}

const AstoniaRendererBackend *astonia_sokol_webgpu_renderer_backend(void)
{
	static const AstoniaRendererBackend backend = {
		.kind = ASTONIA_RENDERER_BACKEND_SOKOL_WEBGPU,
		.name = "sokol-webgpu",
		.init = sokol_webgpu_init,
		.shutdown = sokol_webgpu_shutdown,
		.begin_frame = sokol_webgpu_begin_frame,
		.end_frame = sokol_webgpu_end_frame,
		.frame_count = sokol_webgpu_frame_count,
	};
	return &backend;
}
