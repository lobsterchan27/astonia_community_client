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
	AstoniaRendererBlendMode blend_mode;
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
	g_sokol_webgpu.blend_mode = ASTONIA_RENDERER_BLEND_NORMAL;
	return 1;
}

static void sokol_webgpu_shutdown(void)
{
	if (g_sokol_webgpu.initialized) {
		sg_shutdown();
	}
	g_sokol_webgpu.initialized = false;
	g_sokol_webgpu.frames = 0;
	g_sokol_webgpu.blend_mode = ASTONIA_RENDERER_BLEND_NORMAL;
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

/*
 * The contract is broader than the current clear-frame harness. Texture and
 * primitive operations fail explicitly until the WebGPU draw pipelines exist.
 */
static AstoniaRendererTexture sokol_webgpu_create_texture(
    const AstoniaRendererTextureDesc *desc, const void *pixels, size_t pitch_bytes)
{
	(void)desc;
	(void)pixels;
	(void)pitch_bytes;

	return ASTONIA_RENDERER_TEXTURE_INVALID;
}

static int sokol_webgpu_update_texture(
    AstoniaRendererTexture texture, const AstoniaRendererRect *rect, const void *pixels, size_t pitch_bytes)
{
	(void)texture;
	(void)rect;
	(void)pixels;
	(void)pitch_bytes;

	return 0;
}

static void sokol_webgpu_destroy_texture(AstoniaRendererTexture texture)
{
	(void)texture;
}

static int sokol_webgpu_draw_textured_quad(
    AstoniaRendererTexture texture, const AstoniaRendererTexturedVertex vertices[4])
{
	(void)texture;
	(void)vertices;

	return 0;
}

static int sokol_webgpu_fill_rect(const AstoniaRendererRect *rect, AstoniaRendererColor color)
{
	(void)rect;
	(void)color;

	return 0;
}

static int sokol_webgpu_draw_lines(
    const AstoniaRendererLine *lines, size_t count, AstoniaRendererColor color)
{
	(void)lines;
	(void)count;
	(void)color;

	return 0;
}

static int sokol_webgpu_draw_points(
    const AstoniaRendererPoint *points, size_t count, AstoniaRendererColor color)
{
	(void)points;
	(void)count;
	(void)color;

	return 0;
}

static int sokol_webgpu_draw_solid_triangles(const AstoniaRendererSolidVertex *vertices, size_t vertex_count,
    const uint16_t *indices, size_t index_count)
{
	(void)vertices;
	(void)vertex_count;
	(void)indices;
	(void)index_count;

	return 0;
}

static int sokol_webgpu_set_blend_mode(AstoniaRendererBlendMode mode)
{
	switch (mode) {
	case ASTONIA_RENDERER_BLEND_NORMAL:
	case ASTONIA_RENDERER_BLEND_ADDITIVE:
	case ASTONIA_RENDERER_BLEND_MOD:
	case ASTONIA_RENDERER_BLEND_MUL:
	case ASTONIA_RENDERER_BLEND_NONE:
		g_sokol_webgpu.blend_mode = mode;
		return 1;
	default:
		return 0;
	}
}

static AstoniaRendererBlendMode sokol_webgpu_get_blend_mode(void)
{
	return g_sokol_webgpu.blend_mode;
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
		.create_texture = sokol_webgpu_create_texture,
		.update_texture = sokol_webgpu_update_texture,
		.destroy_texture = sokol_webgpu_destroy_texture,
		.draw_textured_quad = sokol_webgpu_draw_textured_quad,
		.fill_rect = sokol_webgpu_fill_rect,
		.draw_lines = sokol_webgpu_draw_lines,
		.draw_points = sokol_webgpu_draw_points,
		.draw_solid_triangles = sokol_webgpu_draw_solid_triangles,
		.set_blend_mode = sokol_webgpu_set_blend_mode,
		.get_blend_mode = sokol_webgpu_get_blend_mode,
	};
	return &backend;
}
