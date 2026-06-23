/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "Sokol WebGPU implementation is compiled only by the WASM target."
#endif

#define SOKOL_IMPL
#include "sokol_app.h"
#include "sokol_gfx.h"
#include "sokol_glue.h"
#include "sokol_log.h"

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
		return 0;
	}

	img = _sg_lookup_image(image.id);
	if (!img || !img->wgpu.tex || x < 0 || y < 0 || x + width > img->cmn.width || y + height > img->cmn.height ||
	    img->cmn.pixel_format != SG_PIXELFORMAT_RGBA8) {
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
