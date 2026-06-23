/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "Sokol WebGPU implementation is compiled only by the WASM target."
#endif

#include <limits.h>

#define SOKOL_IMPL
#include "sokol_app.h"
#include "sokol_gfx.h"
#include "sokol_glue.h"
#include "sokol_log.h"

extern int astonia_wasm_texture_upload_context_sprite;
extern int astonia_wasm_texture_upload_first_failure_code;
extern int astonia_wasm_texture_upload_first_failure_sprite;
extern int astonia_wasm_texture_upload_first_failure_width;
extern int astonia_wasm_texture_upload_first_failure_height;
extern int astonia_wasm_texture_upload_first_failure_pitch;
extern int astonia_wasm_texture_upload_first_failure_row;
extern int astonia_wasm_texture_upload_first_failure_rect_x;
extern int astonia_wasm_texture_upload_first_failure_rect_y;
extern int astonia_wasm_texture_upload_first_failure_rect_w;
extern int astonia_wasm_texture_upload_first_failure_rect_h;

static void note_wgpu_upload_failure(int code, int width, int height, size_t pitch_bytes, int row, int rect_x,
    int rect_y, int rect_w, int rect_h)
{
	if (astonia_wasm_texture_upload_first_failure_code != 0) {
		return;
	}

	astonia_wasm_texture_upload_first_failure_code = code;
	astonia_wasm_texture_upload_first_failure_sprite = astonia_wasm_texture_upload_context_sprite;
	astonia_wasm_texture_upload_first_failure_width = width;
	astonia_wasm_texture_upload_first_failure_height = height;
	astonia_wasm_texture_upload_first_failure_pitch = pitch_bytes > (size_t)INT_MAX ? INT_MAX : (int)pitch_bytes;
	astonia_wasm_texture_upload_first_failure_row = row;
	astonia_wasm_texture_upload_first_failure_rect_x = rect_x;
	astonia_wasm_texture_upload_first_failure_rect_y = rect_y;
	astonia_wasm_texture_upload_first_failure_rect_w = rect_w;
	astonia_wasm_texture_upload_first_failure_rect_h = rect_h;
}

int astonia_sokol_webgpu_update_image_region(
    sg_image image, int x, int y, int width, int height, const void *pixels, size_t pitch_bytes)
{
#if defined(SOKOL_WGPU)
	_sg_image_t *img;
	_SG_STRUCT(WGPUTexelCopyBufferLayout, wgpu_layout);
	_SG_STRUCT(WGPUTexelCopyTextureInfo, wgpu_copy_tex);
	_SG_STRUCT(WGPUExtent3D, wgpu_extent);

	if (!_sg.wgpu.valid || !_sg.wgpu.queue || image.id == SG_INVALID_ID || !pixels || width <= 0 || height <= 0 ||
	    pitch_bytes < (size_t)width * 4u) {
		note_wgpu_upload_failure(301, width, height, pitch_bytes, y, x, y, width, height);
		return 0;
	}

	img = _sg_lookup_image(image.id);
	if (!img || !img->wgpu.tex || x < 0 || y < 0 || x + width > img->cmn.width || y + height > img->cmn.height ||
	    img->cmn.pixel_format != SG_PIXELFORMAT_RGBA8) {
		note_wgpu_upload_failure(302, img ? img->cmn.width : width, img ? img->cmn.height : height, pitch_bytes, y,
		    x, y, width, height);
		return 0;
	}

	wgpu_copy_tex.texture = img->wgpu.tex;
	wgpu_copy_tex.mipLevel = 0;
	wgpu_copy_tex.origin.x = (uint32_t)x;
	wgpu_copy_tex.origin.y = (uint32_t)y;
	wgpu_copy_tex.origin.z = 0;
	wgpu_copy_tex.aspect = WGPUTextureAspect_All;
	wgpu_layout.bytesPerRow = (uint32_t)pitch_bytes;
	wgpu_layout.rowsPerImage = (uint32_t)height;
	wgpu_extent.width = (uint32_t)width;
	wgpu_extent.height = (uint32_t)height;
	wgpu_extent.depthOrArrayLayers = 1;
	wgpuQueueWriteTexture(_sg.wgpu.queue, &wgpu_copy_tex, pixels, pitch_bytes * (size_t)height, &wgpu_layout, &wgpu_extent);
	return 1;
#else
	(void)image;
	(void)x;
	(void)y;
	(void)width;
	(void)height;
	(void)pixels;
	(void)pitch_bytes;
	return 0;
#endif
}
