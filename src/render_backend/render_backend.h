/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef ASTONIA_RENDER_BACKEND_H
#define ASTONIA_RENDER_BACKEND_H

#include <stddef.h>
#include <stdint.h>

typedef enum astonia_renderer_backend_kind {
	ASTONIA_RENDERER_BACKEND_SOKOL_WEBGPU = 1,
} AstoniaRendererBackendKind;

typedef enum astonia_renderer_texture_format {
	ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888 = 1,
	ASTONIA_RENDERER_TEXTURE_FORMAT_RGBA8888 = 2,
} AstoniaRendererTextureFormat;

typedef enum astonia_renderer_blend_mode {
	ASTONIA_RENDERER_BLEND_NORMAL = 0,
	ASTONIA_RENDERER_BLEND_ADDITIVE = 1,
	ASTONIA_RENDERER_BLEND_MOD = 2,
	ASTONIA_RENDERER_BLEND_MUL = 3,
	ASTONIA_RENDERER_BLEND_NONE = 4,
} AstoniaRendererBlendMode;

typedef struct astonia_renderer_clear_color {
	float r;
	float g;
	float b;
	float a;
} AstoniaRendererClearColor;

typedef struct astonia_renderer_color {
	uint8_t r;
	uint8_t g;
	uint8_t b;
	uint8_t a;
} AstoniaRendererColor;

typedef struct astonia_renderer_point {
	float x;
	float y;
} AstoniaRendererPoint;

typedef struct astonia_renderer_rect {
	float x;
	float y;
	float w;
	float h;
} AstoniaRendererRect;

typedef struct astonia_renderer_texture {
	uint32_t id;
} AstoniaRendererTexture;

typedef struct astonia_renderer_texture_desc {
	int width;
	int height;
	AstoniaRendererTextureFormat format;
} AstoniaRendererTextureDesc;

typedef struct astonia_renderer_textured_vertex {
	float x;
	float y;
	float u;
	float v;
	AstoniaRendererColor color;
} AstoniaRendererTexturedVertex;

typedef struct astonia_renderer_solid_vertex {
	float x;
	float y;
	AstoniaRendererColor color;
} AstoniaRendererSolidVertex;

typedef struct astonia_renderer_line {
	float x0;
	float y0;
	float x1;
	float y1;
} AstoniaRendererLine;

#define ASTONIA_RENDERER_TEXTURE_INVALID ((AstoniaRendererTexture){0u})

typedef struct astonia_renderer_backend {
	AstoniaRendererBackendKind kind;
	const char *name;
	int (*init)(int width, int height, const char *title, int monitor);
	void (*shutdown)(void);
	int (*begin_frame)(AstoniaRendererClearColor clear_color);
	int (*end_frame)(void);
	int (*frame_count)(void);
	AstoniaRendererTexture (*create_texture)(
	    const AstoniaRendererTextureDesc *desc, const void *pixels, size_t pitch_bytes);
	int (*update_texture)(AstoniaRendererTexture texture, const AstoniaRendererRect *rect, const void *pixels,
	    size_t pitch_bytes);
	void (*destroy_texture)(AstoniaRendererTexture texture);
	int (*draw_textured_quad)(
	    AstoniaRendererTexture texture, const AstoniaRendererTexturedVertex vertices[4]);
	int (*fill_rect)(const AstoniaRendererRect *rect, AstoniaRendererColor color);
	int (*draw_lines)(const AstoniaRendererLine *lines, size_t count, AstoniaRendererColor color);
	int (*draw_points)(const AstoniaRendererPoint *points, size_t count, AstoniaRendererColor color);
	int (*draw_solid_triangles)(const AstoniaRendererSolidVertex *vertices, size_t vertex_count,
	    const uint16_t *indices, size_t index_count);
	int (*set_blend_mode)(AstoniaRendererBlendMode mode);
	AstoniaRendererBlendMode (*get_blend_mode)(void);
} AstoniaRendererBackend;

#endif
