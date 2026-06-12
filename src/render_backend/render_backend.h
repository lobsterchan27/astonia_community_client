/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef ASTONIA_RENDER_BACKEND_H
#define ASTONIA_RENDER_BACKEND_H

typedef enum astonia_renderer_backend_kind {
	ASTONIA_RENDERER_BACKEND_SDL3 = 1,
	ASTONIA_RENDERER_BACKEND_SOKOL_WEBGPU = 2,
} AstoniaRendererBackendKind;

typedef struct astonia_renderer_clear_color {
	float r;
	float g;
	float b;
	float a;
} AstoniaRendererClearColor;

typedef struct astonia_renderer_backend {
	AstoniaRendererBackendKind kind;
	const char *name;
	int (*init)(int width, int height, const char *title, int monitor);
	void (*shutdown)(void);
	int (*begin_frame)(AstoniaRendererClearColor clear_color);
	int (*end_frame)(void);
	int (*frame_count)(void);
} AstoniaRendererBackend;

#endif
