/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#include "render_backend/render_backend.h"

int main(void)
{
	AstoniaRendererClearColor clear = {
		.r = 0.0f,
		.g = 0.0f,
		.b = 0.0f,
		.a = 1.0f,
	};

	if (ASTONIA_RENDERER_BACKEND_SDL3 == ASTONIA_RENDERER_BACKEND_SOKOL_WEBGPU) {
		return 1;
	}
	if (clear.a != 1.0f) {
		return 1;
	}

	return 0;
}
