/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol SDL render bridge is compiled only by the WASM target."
#endif

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#include "dll.h"
#include "render_backend/render_backend.h"
#include "render_backend/sokol_webgpu_backend.h"
#include "sdl/sdl.h"
#include "sdl/sdl_private.h"
#include "sdl/sdl_state.h"
#include "wasm/wasm_platform_shell.h"

static const AstoniaRendererBackend *g_renderer;
static bool g_frame_open;

typedef struct sdl_backend_texture {
	AstoniaRendererTexture texture;
	int width;
	int height;
	uint8_t alpha;
} SdlBackendTexture;

int sdl_init(int width, int height, char *title, int monitor)
{
	if (!astonia_wasm_platform_shell_init(width, height)) {
		return 0;
	}

	g_renderer = astonia_sokol_webgpu_renderer_backend();
	g_frame_open = false;
	sdl_frames = 0;
	if (!g_renderer->init(width, height, title, monitor)) {
		astonia_wasm_platform_shell_shutdown();
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

	astonia_wasm_platform_shell_shutdown();
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

DLL_EXPORT int astonia_wasm_native_state_check(void)
{
	SdlNativeStateSnapshot snapshot;

	sdl_native_state_snapshot(&snapshot);
	return snapshot.initialized && snapshot.cache_best == 0 && snapshot.cache_last == MAX_TEXCACHE - 1 &&
	       snapshot.cache_empty_heads == MAX_TEXHASH && snapshot.first_prev == STX_NONE && snapshot.first_next == 1 &&
	       snapshot.first_generation == 1 && snapshot.first_work_state == TX_WORK_IDLE && snapshot.last_next == STX_NONE &&
	       snapshot.texture_jobs_mutex_ready && snapshot.texture_jobs_cond_ready && snapshot.texture_jobs_count == 0 &&
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

SDL_Texture *sdl_backend_create_texture_from_argb8888(
    int width, int height, const uint32_t *pixels, size_t pitch_bytes)
{
	SdlBackendTexture *texture;
	uint8_t *rgba;
	AstoniaRendererTextureDesc desc;
	AstoniaRendererTexture renderer_texture;
	size_t row_bytes;

	if (!g_renderer || !g_renderer->create_texture || width <= 0 || height <= 0 || !pixels ||
	    !sdl_backend_argb8888_pitch_is_valid(width, pitch_bytes)) {
		return NULL;
	}

	row_bytes = (size_t)width * 4u;
	rgba = malloc(row_bytes * (size_t)height);
	if (!rgba) {
		return NULL;
	}

	for (int y = 0; y < height; y++) {
		const uint8_t *row = (const uint8_t *)pixels + (size_t)y * pitch_bytes;
		astonia_renderer_argb8888_to_rgba8888(rgba + (size_t)y * row_bytes, (const uint32_t *)row, (size_t)width);
	}

	desc.width = width;
	desc.height = height;
	desc.format = ASTONIA_RENDERER_TEXTURE_FORMAT_RGBA8888;
	renderer_texture = g_renderer->create_texture(&desc, rgba, row_bytes);
	free(rgba);
	if (renderer_texture.id == ASTONIA_RENDERER_TEXTURE_INVALID.id) {
		return NULL;
	}

	texture = malloc(sizeof(*texture));
	if (!texture) {
		g_renderer->destroy_texture(renderer_texture);
		return NULL;
	}

	texture->texture = renderer_texture;
	texture->width = width;
	texture->height = height;
	texture->alpha = 255u;
	return (SDL_Texture *)texture;
}

void sdl_backend_destroy_texture(SDL_Texture *raw_texture)
{
	SdlBackendTexture *texture = (SdlBackendTexture *)raw_texture;

	if (!texture) {
		return;
	}
	if (g_renderer && g_renderer->destroy_texture && texture->texture.id != ASTONIA_RENDERER_TEXTURE_INVALID.id) {
		g_renderer->destroy_texture(texture->texture);
	}
	free(texture);
}

int sdl_backend_get_texture_size(SDL_Texture *raw_texture, float *width, float *height)
{
	SdlBackendTexture *texture = (SdlBackendTexture *)raw_texture;

	if (!texture) {
		return 0;
	}
	if (width) {
		*width = (float)texture->width;
	}
	if (height) {
		*height = (float)texture->height;
	}
	return 1;
}

int sdl_backend_set_texture_alpha(SDL_Texture *raw_texture, uint8_t alpha)
{
	SdlBackendTexture *texture = (SdlBackendTexture *)raw_texture;

	if (!texture) {
		return 0;
	}
	texture->alpha = alpha;
	return 1;
}

int sdl_backend_blit_texture(SDL_Texture *raw_texture, const SdlBackendRect *src, const SdlBackendRect *dst)
{
	SdlBackendTexture *texture = (SdlBackendTexture *)raw_texture;
	AstoniaRendererTexturedVertex vertices[4];
	AstoniaRendererColor color;
	float u0, v0, u1, v1;

	if (!g_renderer || !g_renderer->draw_textured_quad || !texture || !src || !dst || texture->width <= 0 ||
	    texture->height <= 0 || dst->w <= 0.0f || dst->h <= 0.0f) {
		return 0;
	}

	u0 = src->x / (float)texture->width;
	v0 = src->y / (float)texture->height;
	u1 = (src->x + src->w) / (float)texture->width;
	v1 = (src->y + src->h) / (float)texture->height;
	color = (AstoniaRendererColor){255u, 255u, 255u, texture->alpha};

	vertices[0] = (AstoniaRendererTexturedVertex){dst->x, dst->y, u0, v0, color};
	vertices[1] = (AstoniaRendererTexturedVertex){dst->x + dst->w, dst->y, u1, v0, color};
	vertices[2] = (AstoniaRendererTexturedVertex){dst->x + dst->w, dst->y + dst->h, u1, v1, color};
	vertices[3] = (AstoniaRendererTexturedVertex){dst->x, dst->y + dst->h, u0, v1, color};

	return g_renderer->draw_textured_quad(texture->texture, vertices);
}

static AstoniaRendererColor sdl_backend_color(uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	return (AstoniaRendererColor){
		.r = r,
		.g = g,
		.b = b,
		.a = a,
	};
}

int sdl_backend_fill_rect(const SdlBackendRect *rect, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	AstoniaRendererRect backend_rect;

	if (!g_renderer || !g_renderer->fill_rect || !rect) {
		return 0;
	}

	backend_rect = (AstoniaRendererRect){
		.x = rect->x,
		.y = rect->y,
		.w = rect->w,
		.h = rect->h,
	};
	return g_renderer->fill_rect(&backend_rect, sdl_backend_color(r, g, b, a));
}

int sdl_backend_draw_points(
    const SdlBackendPoint *points, size_t count, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	AstoniaRendererPoint *backend_points;
	int result;

	if (!g_renderer || !g_renderer->draw_points || !points || count == 0u) {
		return 0;
	}

	backend_points = malloc(count * sizeof(*backend_points));
	if (!backend_points) {
		return 0;
	}

	for (size_t i = 0; i < count; i++) {
		backend_points[i] = (AstoniaRendererPoint){
			.x = points[i].x,
			.y = points[i].y,
		};
	}

	result = g_renderer->draw_points(backend_points, count, sdl_backend_color(r, g, b, a));
	free(backend_points);
	return result;
}

int sdl_backend_draw_lines(const SdlBackendLine *lines, size_t count, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	AstoniaRendererLine *backend_lines;
	int result;

	if (!g_renderer || !g_renderer->draw_lines || !lines || count == 0u) {
		return 0;
	}

	backend_lines = malloc(count * sizeof(*backend_lines));
	if (!backend_lines) {
		return 0;
	}

	for (size_t i = 0; i < count; i++) {
		backend_lines[i] = (AstoniaRendererLine){
			.x0 = lines[i].x0,
			.y0 = lines[i].y0,
			.x1 = lines[i].x1,
			.y1 = lines[i].y1,
		};
	}

	result = g_renderer->draw_lines(backend_lines, count, sdl_backend_color(r, g, b, a));
	free(backend_lines);
	return result;
}

static AstoniaRendererBlendMode sdl_backend_blend_mode_from_int(int mode)
{
	switch (mode) {
	case 0:
		return ASTONIA_RENDERER_BLEND_NORMAL;
	case 1:
		return ASTONIA_RENDERER_BLEND_ADDITIVE;
	case 2:
		return ASTONIA_RENDERER_BLEND_MOD;
	case 3:
		return ASTONIA_RENDERER_BLEND_MUL;
	case 4:
		return ASTONIA_RENDERER_BLEND_NONE;
	default:
		return ASTONIA_RENDERER_BLEND_NORMAL;
	}
}

int sdl_backend_set_blend_mode(int mode)
{
	if (!g_renderer || !g_renderer->set_blend_mode) {
		return 0;
	}

	return g_renderer->set_blend_mode(sdl_backend_blend_mode_from_int(mode));
}

int sdl_backend_get_blend_mode(void)
{
	if (!g_renderer || !g_renderer->get_blend_mode) {
		return 0;
	}

	switch (g_renderer->get_blend_mode()) {
	case ASTONIA_RENDERER_BLEND_NORMAL:
		return 0;
	case ASTONIA_RENDERER_BLEND_ADDITIVE:
		return 1;
	case ASTONIA_RENDERER_BLEND_MOD:
		return 2;
	case ASTONIA_RENDERER_BLEND_MUL:
		return 3;
	case ASTONIA_RENDERER_BLEND_NONE:
		return 4;
	default:
		return 0;
	}
}
