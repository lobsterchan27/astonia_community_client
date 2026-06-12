/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#include "render_backend/render_backend.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct fake_renderer_state {
	int initialized;
	int frame_open;
	int frames;
	int init_width;
	int init_height;
	int init_monitor;
	const char *init_title;
	AstoniaRendererClearColor clear_color;

	uint32_t next_texture_id;
	uint32_t live_texture_id;
	AstoniaRendererTextureDesc texture_desc;
	const void *texture_pixels;
	size_t texture_pitch;
	AstoniaRendererRect update_rect;
	const void *update_pixels;
	size_t update_pitch;
	uint32_t destroyed_texture_id;

	AstoniaRendererTexturedVertex quad[4];
	AstoniaRendererTexture quad_texture;
	AstoniaRendererRect fill_rect;
	AstoniaRendererColor fill_color;
	AstoniaRendererLine lines[2];
	size_t line_count;
	AstoniaRendererColor line_color;
	AstoniaRendererPoint points[3];
	size_t point_count;
	AstoniaRendererColor point_color;
	AstoniaRendererSolidVertex solid_vertices[3];
	uint16_t solid_indices[3];
	size_t solid_vertex_count;
	size_t solid_index_count;
	AstoniaRendererBlendMode blend_mode;
} FakeRendererState;

static FakeRendererState g_fake;

static int fail_at(int line, const char *expr)
{
	fprintf(stderr, "renderer backend contract failed at line %d: %s\n", line, expr);
	return 1;
}

#define CHECK(expr)        \
	do {                   \
		if (!(expr)) {     \
			return fail_at(__LINE__, #expr); \
		}                  \
	} while (0)

static int float_equal(float left, float right)
{
	const float epsilon = 0.0001f;

	return left > right - epsilon && left < right + epsilon;
}

static int color_equal(AstoniaRendererColor left, AstoniaRendererColor right)
{
	return left.r == right.r && left.g == right.g && left.b == right.b && left.a == right.a;
}

static int rect_equal(AstoniaRendererRect left, AstoniaRendererRect right)
{
	return float_equal(left.x, right.x) && float_equal(left.y, right.y) && float_equal(left.w, right.w) &&
	       float_equal(left.h, right.h);
}

static void fake_reset(void)
{
	memset(&g_fake, 0, sizeof(g_fake));
	g_fake.next_texture_id = 1u;
	g_fake.blend_mode = ASTONIA_RENDERER_BLEND_NORMAL;
}

static int fake_init(int width, int height, const char *title, int monitor)
{
	g_fake.initialized = 1;
	g_fake.init_width = width;
	g_fake.init_height = height;
	g_fake.init_title = title;
	g_fake.init_monitor = monitor;
	return 1;
}

static void fake_shutdown(void)
{
	g_fake.initialized = 0;
	g_fake.frame_open = 0;
	g_fake.live_texture_id = 0u;
}

static int fake_begin_frame(AstoniaRendererClearColor clear_color)
{
	if (!g_fake.initialized || g_fake.frame_open) {
		return 0;
	}

	g_fake.frame_open = 1;
	g_fake.clear_color = clear_color;
	return 1;
}

static int fake_end_frame(void)
{
	if (!g_fake.initialized || !g_fake.frame_open) {
		return 0;
	}

	g_fake.frame_open = 0;
	g_fake.frames++;
	return 1;
}

static int fake_frame_count(void)
{
	return g_fake.frames;
}

static AstoniaRendererTexture fake_create_texture(
    const AstoniaRendererTextureDesc *desc, const void *pixels, size_t pitch_bytes)
{
	AstoniaRendererTexture texture = ASTONIA_RENDERER_TEXTURE_INVALID;

	if (!g_fake.initialized || !desc || desc->width <= 0 || desc->height <= 0 || !pixels || pitch_bytes == 0u) {
		return texture;
	}

	texture.id = g_fake.next_texture_id++;
	g_fake.live_texture_id = texture.id;
	g_fake.texture_desc = *desc;
	g_fake.texture_pixels = pixels;
	g_fake.texture_pitch = pitch_bytes;
	return texture;
}

static int fake_update_texture(
    AstoniaRendererTexture texture, const AstoniaRendererRect *rect, const void *pixels, size_t pitch_bytes)
{
	if (!g_fake.initialized || texture.id == 0u || texture.id != g_fake.live_texture_id || !rect || !pixels ||
	    pitch_bytes == 0u) {
		return 0;
	}

	g_fake.update_rect = *rect;
	g_fake.update_pixels = pixels;
	g_fake.update_pitch = pitch_bytes;
	return 1;
}

static void fake_destroy_texture(AstoniaRendererTexture texture)
{
	g_fake.destroyed_texture_id = texture.id;
	if (texture.id == g_fake.live_texture_id) {
		g_fake.live_texture_id = 0u;
	}
}

static int fake_draw_textured_quad(AstoniaRendererTexture texture, const AstoniaRendererTexturedVertex vertices[4])
{
	if (!g_fake.initialized || texture.id == 0u || texture.id != g_fake.live_texture_id || !vertices) {
		return 0;
	}

	g_fake.quad_texture = texture;
	memcpy(g_fake.quad, vertices, sizeof(g_fake.quad));
	return 1;
}

static int fake_fill_rect(const AstoniaRendererRect *rect, AstoniaRendererColor color)
{
	if (!g_fake.initialized || !rect) {
		return 0;
	}

	g_fake.fill_rect = *rect;
	g_fake.fill_color = color;
	return 1;
}

static int fake_draw_lines(const AstoniaRendererLine *lines, size_t count, AstoniaRendererColor color)
{
	if (!g_fake.initialized || !lines || count == 0u || count > 2u) {
		return 0;
	}

	memcpy(g_fake.lines, lines, count * sizeof(lines[0]));
	g_fake.line_count = count;
	g_fake.line_color = color;
	return 1;
}

static int fake_draw_points(const AstoniaRendererPoint *points, size_t count, AstoniaRendererColor color)
{
	if (!g_fake.initialized || !points || count == 0u || count > 3u) {
		return 0;
	}

	memcpy(g_fake.points, points, count * sizeof(points[0]));
	g_fake.point_count = count;
	g_fake.point_color = color;
	return 1;
}

static int fake_draw_solid_triangles(const AstoniaRendererSolidVertex *vertices, size_t vertex_count,
    const uint16_t *indices, size_t index_count)
{
	if (!g_fake.initialized || !vertices || !indices || vertex_count != 3u || index_count != 3u) {
		return 0;
	}

	memcpy(g_fake.solid_vertices, vertices, vertex_count * sizeof(vertices[0]));
	memcpy(g_fake.solid_indices, indices, index_count * sizeof(indices[0]));
	g_fake.solid_vertex_count = vertex_count;
	g_fake.solid_index_count = index_count;
	return 1;
}

static int fake_set_blend_mode(AstoniaRendererBlendMode mode)
{
	switch (mode) {
	case ASTONIA_RENDERER_BLEND_NORMAL:
	case ASTONIA_RENDERER_BLEND_ADDITIVE:
	case ASTONIA_RENDERER_BLEND_MOD:
	case ASTONIA_RENDERER_BLEND_MUL:
	case ASTONIA_RENDERER_BLEND_NONE:
		g_fake.blend_mode = mode;
		return 1;
	default:
		return 0;
	}
}

static AstoniaRendererBlendMode fake_get_blend_mode(void)
{
	return g_fake.blend_mode;
}

static const AstoniaRendererBackend g_fake_backend = {
	.kind = ASTONIA_RENDERER_BACKEND_SOKOL_WEBGPU,
	.name = "fake-renderer",
	.init = fake_init,
	.shutdown = fake_shutdown,
	.begin_frame = fake_begin_frame,
	.end_frame = fake_end_frame,
	.frame_count = fake_frame_count,
	.create_texture = fake_create_texture,
	.update_texture = fake_update_texture,
	.destroy_texture = fake_destroy_texture,
	.draw_textured_quad = fake_draw_textured_quad,
	.fill_rect = fake_fill_rect,
	.draw_lines = fake_draw_lines,
	.draw_points = fake_draw_points,
	.draw_solid_triangles = fake_draw_solid_triangles,
	.set_blend_mode = fake_set_blend_mode,
	.get_blend_mode = fake_get_blend_mode,
};

static int test_contract_shape(void)
{
	CHECK(ASTONIA_RENDERER_TEXTURE_INVALID.id == 0u);
	CHECK(sizeof(AstoniaRendererTexture) == sizeof(uint32_t));
	CHECK(ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888 != ASTONIA_RENDERER_TEXTURE_FORMAT_RGBA8888);
	CHECK(ASTONIA_RENDERER_BLEND_NORMAL == 0);
	CHECK(ASTONIA_RENDERER_BLEND_ADDITIVE == 1);
	CHECK(ASTONIA_RENDERER_BLEND_MOD == 2);
	CHECK(ASTONIA_RENDERER_BLEND_MUL == 3);
	CHECK(ASTONIA_RENDERER_BLEND_NONE == 4);

	CHECK(g_fake_backend.init != NULL);
	CHECK(g_fake_backend.shutdown != NULL);
	CHECK(g_fake_backend.begin_frame != NULL);
	CHECK(g_fake_backend.end_frame != NULL);
	CHECK(g_fake_backend.frame_count != NULL);
	CHECK(g_fake_backend.create_texture != NULL);
	CHECK(g_fake_backend.update_texture != NULL);
	CHECK(g_fake_backend.destroy_texture != NULL);
	CHECK(g_fake_backend.draw_textured_quad != NULL);
	CHECK(g_fake_backend.fill_rect != NULL);
	CHECK(g_fake_backend.draw_lines != NULL);
	CHECK(g_fake_backend.draw_points != NULL);
	CHECK(g_fake_backend.draw_solid_triangles != NULL);
	CHECK(g_fake_backend.set_blend_mode != NULL);
	CHECK(g_fake_backend.get_blend_mode != NULL);

	return 0;
}

static int test_frame_lifecycle(void)
{
	const AstoniaRendererBackend *backend = &g_fake_backend;
	AstoniaRendererClearColor clear = {
		.r = 0.02f,
		.g = 0.05f,
		.b = 0.10f,
		.a = 1.0f,
	};

	fake_reset();
	CHECK(backend->init(1024, 768, "Astonia", 1) == 1);
	CHECK(g_fake.init_width == 1024);
	CHECK(g_fake.init_height == 768);
	CHECK(g_fake.init_title != NULL && strcmp(g_fake.init_title, "Astonia") == 0);
	CHECK(g_fake.init_monitor == 1);
	CHECK(backend->begin_frame(clear) == 1);
	CHECK(float_equal(g_fake.clear_color.r, clear.r));
	CHECK(float_equal(g_fake.clear_color.g, clear.g));
	CHECK(float_equal(g_fake.clear_color.b, clear.b));
	CHECK(float_equal(g_fake.clear_color.a, clear.a));
	CHECK(backend->begin_frame(clear) == 0);
	CHECK(backend->end_frame() == 1);
	CHECK(backend->frame_count() == 1);
	CHECK(backend->end_frame() == 0);
	backend->shutdown();
	CHECK(g_fake.initialized == 0);

	return 0;
}

static int test_texture_lifecycle(void)
{
	const AstoniaRendererBackend *backend = &g_fake_backend;
	const uint32_t pixels[4] = {
		0xff0000ffu,
		0xff00ff00u,
		0xffff0000u,
		0xffffffffu,
	};
	const uint32_t update_pixels[2] = {
		0x800000ffu,
		0x80ffffffu,
	};
	AstoniaRendererTextureDesc desc = {
		.width = 2,
		.height = 2,
		.format = ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888,
	};
	AstoniaRendererRect update_rect = {
		.x = 0.0f,
		.y = 1.0f,
		.w = 2.0f,
		.h = 1.0f,
	};
	AstoniaRendererTexture texture;

	fake_reset();
	CHECK(backend->init(320, 200, "Texture Test", 0) == 1);
	texture = backend->create_texture(&desc, pixels, 2u * sizeof(pixels[0]));
	CHECK(texture.id != 0u);
	CHECK(g_fake.texture_desc.width == 2);
	CHECK(g_fake.texture_desc.height == 2);
	CHECK(g_fake.texture_desc.format == ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888);
	CHECK(g_fake.texture_pixels == pixels);
	CHECK(g_fake.texture_pitch == 2u * sizeof(pixels[0]));

	CHECK(backend->update_texture(texture, &update_rect, update_pixels, 2u * sizeof(update_pixels[0])) == 1);
	CHECK(rect_equal(g_fake.update_rect, update_rect));
	CHECK(g_fake.update_pixels == update_pixels);
	CHECK(g_fake.update_pitch == 2u * sizeof(update_pixels[0]));

	backend->destroy_texture(texture);
	CHECK(g_fake.destroyed_texture_id == texture.id);
	CHECK(g_fake.live_texture_id == 0u);
	CHECK(backend->update_texture(texture, &update_rect, update_pixels, 2u * sizeof(update_pixels[0])) == 0);

	return 0;
}

static int test_textured_quad_blit_shape(void)
{
	const AstoniaRendererBackend *backend = &g_fake_backend;
	const uint32_t pixels[1] = {0xffffffffu};
	const AstoniaRendererColor white = {
		.r = 255u,
		.g = 255u,
		.b = 255u,
		.a = 192u,
	};
	AstoniaRendererTextureDesc desc = {
		.width = 1,
		.height = 1,
		.format = ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888,
	};
	AstoniaRendererTexturedVertex quad[4] = {
		{.x = 10.0f, .y = 20.0f, .u = 0.0f, .v = 0.0f, .color = white},
		{.x = 42.0f, .y = 20.0f, .u = 1.0f, .v = 0.0f, .color = white},
		{.x = 42.0f, .y = 84.0f, .u = 1.0f, .v = 1.0f, .color = white},
		{.x = 10.0f, .y = 84.0f, .u = 0.0f, .v = 1.0f, .color = white},
	};
	AstoniaRendererTexture texture;

	fake_reset();
	CHECK(backend->init(320, 200, "Blit Test", 0) == 1);
	texture = backend->create_texture(&desc, pixels, sizeof(pixels[0]));
	CHECK(backend->draw_textured_quad(texture, quad) == 1);
	CHECK(g_fake.quad_texture.id == texture.id);
	CHECK(float_equal(g_fake.quad[0].x, 10.0f));
	CHECK(float_equal(g_fake.quad[0].y, 20.0f));
	CHECK(float_equal(g_fake.quad[1].x, 42.0f));
	CHECK(float_equal(g_fake.quad[2].y, 84.0f));
	CHECK(float_equal(g_fake.quad[2].u, 1.0f));
	CHECK(float_equal(g_fake.quad[2].v, 1.0f));
	CHECK(color_equal(g_fake.quad[3].color, white));

	return 0;
}

static int test_primitive_calls(void)
{
	const AstoniaRendererBackend *backend = &g_fake_backend;
	const AstoniaRendererColor color = {
		.r = 18u,
		.g = 52u,
		.b = 86u,
		.a = 128u,
	};
	AstoniaRendererRect rect = {
		.x = 3.0f,
		.y = 4.0f,
		.w = 30.0f,
		.h = 40.0f,
	};
	AstoniaRendererLine lines[2] = {
		{.x0 = 1.0f, .y0 = 2.0f, .x1 = 3.0f, .y1 = 4.0f},
		{.x0 = 5.0f, .y0 = 6.0f, .x1 = 7.0f, .y1 = 8.0f},
	};
	AstoniaRendererPoint points[3] = {
		{.x = 9.0f, .y = 10.0f},
		{.x = 11.0f, .y = 12.0f},
		{.x = 13.0f, .y = 14.0f},
	};
	AstoniaRendererSolidVertex vertices[3] = {
		{.x = 0.0f, .y = 0.0f, .color = color},
		{.x = 20.0f, .y = 0.0f, .color = color},
		{.x = 20.0f, .y = 20.0f, .color = color},
	};
	uint16_t indices[3] = {0u, 1u, 2u};

	fake_reset();
	CHECK(backend->init(320, 200, "Primitive Test", 0) == 1);

	CHECK(backend->fill_rect(&rect, color) == 1);
	CHECK(rect_equal(g_fake.fill_rect, rect));
	CHECK(color_equal(g_fake.fill_color, color));

	CHECK(backend->draw_lines(lines, 2u, color) == 1);
	CHECK(g_fake.line_count == 2u);
	CHECK(float_equal(g_fake.lines[1].x1, 7.0f));
	CHECK(float_equal(g_fake.lines[1].y1, 8.0f));
	CHECK(color_equal(g_fake.line_color, color));

	CHECK(backend->draw_points(points, 3u, color) == 1);
	CHECK(g_fake.point_count == 3u);
	CHECK(float_equal(g_fake.points[2].x, 13.0f));
	CHECK(float_equal(g_fake.points[2].y, 14.0f));
	CHECK(color_equal(g_fake.point_color, color));

	CHECK(backend->draw_solid_triangles(vertices, 3u, indices, 3u) == 1);
	CHECK(g_fake.solid_vertex_count == 3u);
	CHECK(g_fake.solid_index_count == 3u);
	CHECK(g_fake.solid_indices[0] == 0u);
	CHECK(g_fake.solid_indices[1] == 1u);
	CHECK(g_fake.solid_indices[2] == 2u);
	CHECK(color_equal(g_fake.solid_vertices[2].color, color));

	return 0;
}

static int test_blend_mode_behavior(void)
{
	const AstoniaRendererBackend *backend = &g_fake_backend;

	fake_reset();
	CHECK(backend->get_blend_mode() == ASTONIA_RENDERER_BLEND_NORMAL);
	CHECK(backend->set_blend_mode(ASTONIA_RENDERER_BLEND_ADDITIVE) == 1);
	CHECK(backend->get_blend_mode() == ASTONIA_RENDERER_BLEND_ADDITIVE);
	CHECK(backend->set_blend_mode(ASTONIA_RENDERER_BLEND_MOD) == 1);
	CHECK(backend->get_blend_mode() == ASTONIA_RENDERER_BLEND_MOD);
	CHECK(backend->set_blend_mode(ASTONIA_RENDERER_BLEND_MUL) == 1);
	CHECK(backend->get_blend_mode() == ASTONIA_RENDERER_BLEND_MUL);
	CHECK(backend->set_blend_mode(ASTONIA_RENDERER_BLEND_NONE) == 1);
	CHECK(backend->get_blend_mode() == ASTONIA_RENDERER_BLEND_NONE);
	CHECK(backend->set_blend_mode((AstoniaRendererBlendMode)99) == 0);
	CHECK(backend->get_blend_mode() == ASTONIA_RENDERER_BLEND_NONE);

	return 0;
}

static int run_test(const char *name, int (*test_func)(void))
{
	int result = test_func();

	if (result != 0) {
		fprintf(stderr, "not ok - %s\n", name);
		return result;
	}

	fprintf(stderr, "ok - %s\n", name);
	return 0;
}

int main(void)
{
	if (run_test("contract shape", test_contract_shape) != 0) {
		return 1;
	}
	if (run_test("frame lifecycle", test_frame_lifecycle) != 0) {
		return 1;
	}
	if (run_test("texture lifecycle", test_texture_lifecycle) != 0) {
		return 1;
	}
	if (run_test("textured quad blit shape", test_textured_quad_blit_shape) != 0) {
		return 1;
	}
	if (run_test("primitive calls", test_primitive_calls) != 0) {
		return 1;
	}
	if (run_test("blend mode behavior", test_blend_mode_behavior) != 0) {
		return 1;
	}

	return 0;
}
