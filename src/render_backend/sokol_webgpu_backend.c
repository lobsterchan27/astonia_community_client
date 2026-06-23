/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol WebGPU renderer backend is WASM-only."
#endif

#include "render_backend/sokol_webgpu_backend.h"

#include <stdbool.h>
#include <limits.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#include "sokol_app.h"
#include "sokol_gfx.h"
#include "sokol_glue.h"
#include "sokol_log.h"

int astonia_sokol_webgpu_update_image_region(
    sg_image image, int x, int y, int width, int height, const void *pixels, size_t pitch_bytes);

typedef struct sokol_webgpu_state {
	bool initialized;
	int frames;
	int width;
	int height;
	AstoniaRendererBlendMode blend_mode;
	sg_environment environment;
	sg_shader sprite_shader;
	sg_pipeline sprite_pipelines[5];
	sg_sampler sprite_sampler;
	sg_buffer sprite_vertex_buffer;
	sg_shader solid_shader;
	sg_pipeline solid_point_pipelines[5];
	sg_pipeline solid_line_pipelines[5];
	sg_pipeline solid_triangle_pipelines[5];
	sg_buffer solid_vertex_buffer;
} SokolWebgpuState;

typedef struct sokol_texture_slot {
	uint32_t id;
	sg_image image;
	sg_view view;
	int width;
	int height;
	AstoniaRendererTextureFormat source_format;
} SokolTextureSlot;

typedef struct sprite_vertex {
	float x;
	float y;
	float u;
	float v;
	uint8_t r;
	uint8_t g;
	uint8_t b;
	uint8_t a;
} SpriteVertex;

typedef struct primitive_vertex {
	float x;
	float y;
	uint8_t r;
	uint8_t g;
	uint8_t b;
	uint8_t a;
} PrimitiveVertex;

typedef struct screen_vs_params {
	float screen_size[2];
	float pad[2];
} ScreenVsParams;

static SokolWebgpuState g_sokol_webgpu;

#define SOKOL_MAX_TEXTURES          16384
#define SOKOL_RESOURCE_POOL_SIZE    SOKOL_MAX_TEXTURES
#define SOKOL_SPRITE_VERTEX_BYTES   (4 * 1024 * 1024)
#define SOKOL_SOLID_VERTEX_BYTES    (4 * 1024 * 1024)
#define SOKOL_BLEND_MODE_COUNT       5
#define SOKOL_SPRITE_VERTEX_COUNT   6
#define SOKOL_SPRITE_TRIANGLE_COUNT 6
#define SOKOL_WGPU_BINDGROUPS_CACHE_SIZE 16384

static SokolTextureSlot g_texture_slots[SOKOL_MAX_TEXTURES];
static uint32_t g_next_texture_id = 1u;

extern int astonia_wasm_backend_texture_update_count;
extern int astonia_wasm_backend_texture_update_failure_count;
extern int astonia_wasm_backend_texture_create_failure_count;
extern int astonia_wasm_backend_texture_create_image_failure_count;
extern int astonia_wasm_backend_texture_create_view_failure_count;
extern int astonia_wasm_backend_image_pool_size;
extern int astonia_wasm_backend_view_pool_size;
extern int astonia_wasm_backend_bindgroups_cache_size;
extern int astonia_wasm_backend_textured_draw_count;
extern int astonia_wasm_backend_textured_draw_failure_count;
extern int astonia_wasm_backend_primitive_draw_count;
extern int astonia_wasm_backend_primitive_draw_failure_count;
extern int astonia_wasm_backend_submit_count;
extern int astonia_wasm_backend_submit_failure_count;
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

static int size_to_smoke_int(size_t value)
{
	return value > (size_t)INT_MAX ? INT_MAX : (int)value;
}

static void note_backend_upload_failure(int code, int width, int height, size_t pitch_bytes, int row, int rect_x,
    int rect_y, int rect_w, int rect_h)
{
	if (astonia_wasm_texture_upload_first_failure_code != 0) {
		return;
	}

	astonia_wasm_texture_upload_first_failure_code = code;
	astonia_wasm_texture_upload_first_failure_sprite = astonia_wasm_texture_upload_context_sprite;
	astonia_wasm_texture_upload_first_failure_width = width;
	astonia_wasm_texture_upload_first_failure_height = height;
	astonia_wasm_texture_upload_first_failure_pitch = size_to_smoke_int(pitch_bytes);
	astonia_wasm_texture_upload_first_failure_row = row;
	astonia_wasm_texture_upload_first_failure_rect_x = rect_x;
	astonia_wasm_texture_upload_first_failure_rect_y = rect_y;
	astonia_wasm_texture_upload_first_failure_rect_w = rect_w;
	astonia_wasm_texture_upload_first_failure_rect_h = rect_h;
}

static const char g_sprite_shader_wgsl[] =
    "struct VsParams {\n"
    "  screen_size: vec2<f32>,\n"
    "  pad: vec2<f32>,\n"
    "};\n"
    "@group(0) @binding(0) var<uniform> vs_params: VsParams;\n"
    "struct VertexInput {\n"
    "  @location(0) pos: vec2<f32>,\n"
    "  @location(1) uv: vec2<f32>,\n"
    "  @location(2) color: vec4<f32>,\n"
    "};\n"
    "struct VertexOutput {\n"
    "  @builtin(position) position: vec4<f32>,\n"
    "  @location(0) uv: vec2<f32>,\n"
    "  @location(1) color: vec4<f32>,\n"
    "};\n"
    "@vertex fn vs_main(in: VertexInput) -> VertexOutput {\n"
    "  var out: VertexOutput;\n"
    "  let clip_x = (in.pos.x / vs_params.screen_size.x) * 2.0 - 1.0;\n"
    "  let clip_y = 1.0 - (in.pos.y / vs_params.screen_size.y) * 2.0;\n"
    "  out.position = vec4<f32>(clip_x, clip_y, 0.0, 1.0);\n"
    "  out.uv = in.uv;\n"
    "  out.color = in.color;\n"
    "  return out;\n"
    "}\n"
    "@group(1) @binding(0) var sprite_tex: texture_2d<f32>;\n"
    "@group(1) @binding(1) var sprite_smp: sampler;\n"
    "@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n"
    "  return textureSample(sprite_tex, sprite_smp, in.uv) * in.color;\n"
    "}\n";

static const char g_solid_shader_wgsl[] =
    "struct VsParams {\n"
    "  screen_size: vec2<f32>,\n"
    "  pad: vec2<f32>,\n"
    "};\n"
    "@group(0) @binding(0) var<uniform> vs_params: VsParams;\n"
    "struct VertexInput {\n"
    "  @location(0) pos: vec2<f32>,\n"
    "  @location(1) color: vec4<f32>,\n"
    "};\n"
    "struct VertexOutput {\n"
    "  @builtin(position) position: vec4<f32>,\n"
    "  @location(0) color: vec4<f32>,\n"
    "};\n"
    "@vertex fn vs_main(in: VertexInput) -> VertexOutput {\n"
    "  var out: VertexOutput;\n"
    "  let clip_x = (in.pos.x / vs_params.screen_size.x) * 2.0 - 1.0;\n"
    "  let clip_y = 1.0 - (in.pos.y / vs_params.screen_size.y) * 2.0;\n"
    "  out.position = vec4<f32>(clip_x, clip_y, 0.0, 1.0);\n"
    "  out.color = in.color;\n"
    "  return out;\n"
    "}\n"
    "@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {\n"
    "  return in.color;\n"
    "}\n";

static SokolTextureSlot *find_texture_slot(AstoniaRendererTexture texture)
{
	if (texture.id == ASTONIA_RENDERER_TEXTURE_INVALID.id) {
		return NULL;
	}

	for (size_t i = 0; i < SOKOL_MAX_TEXTURES; i++) {
		if (g_texture_slots[i].id == texture.id) {
			return &g_texture_slots[i];
		}
	}

	return NULL;
}

static SokolTextureSlot *find_free_texture_slot(void)
{
	for (size_t i = 0; i < SOKOL_MAX_TEXTURES; i++) {
		if (g_texture_slots[i].id == ASTONIA_RENDERER_TEXTURE_INVALID.id) {
			return &g_texture_slots[i];
		}
	}

	return NULL;
}

static uint32_t next_texture_id(void)
{
	uint32_t id = g_next_texture_id++;

	if (g_next_texture_id == ASTONIA_RENDERER_TEXTURE_INVALID.id) {
		g_next_texture_id = 1u;
	}
	return id ? id : g_next_texture_id++;
}

static int prepare_rgba_pixels(const AstoniaRendererTextureDesc *desc, const void *pixels, size_t pitch_bytes,
    uint8_t **out_allocated, const void **out_pixels, size_t *out_pitch)
{
	const size_t row_bytes = (size_t)desc->width * 4u;

	*out_allocated = NULL;
	*out_pixels = NULL;
	*out_pitch = row_bytes;

	if (!pixels || pitch_bytes < row_bytes || desc->width <= 0 || desc->height <= 0) {
		return 0;
	}

	if (desc->format == ASTONIA_RENDERER_TEXTURE_FORMAT_RGBA8888 && pitch_bytes == row_bytes) {
		*out_pixels = pixels;
		return 1;
	}

	*out_allocated = malloc(row_bytes * (size_t)desc->height);
	if (!*out_allocated) {
		return 0;
	}

	for (int y = 0; y < desc->height; y++) {
		const uint8_t *src_row = (const uint8_t *)pixels + (size_t)y * pitch_bytes;
		uint8_t *dst_row = *out_allocated + (size_t)y * row_bytes;

		if (desc->format == ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888) {
			astonia_renderer_argb8888_to_rgba8888(dst_row, (const uint32_t *)src_row, (size_t)desc->width);
		} else if (desc->format == ASTONIA_RENDERER_TEXTURE_FORMAT_RGBA8888) {
			memcpy(dst_row, src_row, row_bytes);
		} else {
			free(*out_allocated);
			*out_allocated = NULL;
			return 0;
		}
	}

	*out_pixels = *out_allocated;
	return 1;
}

static int update_texture_full(
    SokolTextureSlot *slot, const AstoniaRendererTextureDesc *desc, const void *pixels, size_t pitch_bytes)
{
	uint8_t *allocated = NULL;
	const void *upload_pixels = NULL;
	size_t upload_pitch = 0u;
	sg_image_data data = {0};

	if (!prepare_rgba_pixels(desc, pixels, pitch_bytes, &allocated, &upload_pixels, &upload_pitch)) {
		return 0;
	}

	(void)upload_pitch;
	data.mip_levels[0].ptr = upload_pixels;
	data.mip_levels[0].size = (size_t)desc->width * (size_t)desc->height * 4u;
	sg_update_image(slot->image, &data);
	free(allocated);
	return 1;
}

static bool blend_mode_is_valid(AstoniaRendererBlendMode mode)
{
	return mode >= ASTONIA_RENDERER_BLEND_NORMAL && mode <= ASTONIA_RENDERER_BLEND_NONE;
}

static int blend_mode_index(AstoniaRendererBlendMode mode)
{
	return blend_mode_is_valid(mode) ? (int)mode : (int)ASTONIA_RENDERER_BLEND_NORMAL;
}

static void configure_pipeline_blend(sg_pipeline_desc *pipeline_desc, AstoniaRendererBlendMode mode)
{
	sg_blend_state *blend = &pipeline_desc->colors[0].blend;

	switch (mode) {
	case ASTONIA_RENDERER_BLEND_NONE:
		blend->enabled = false;
		break;
	case ASTONIA_RENDERER_BLEND_ADDITIVE:
		blend->enabled = true;
		blend->src_factor_rgb = SG_BLENDFACTOR_SRC_ALPHA;
		blend->dst_factor_rgb = SG_BLENDFACTOR_ONE;
		blend->src_factor_alpha = SG_BLENDFACTOR_ONE;
		blend->dst_factor_alpha = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
		break;
	case ASTONIA_RENDERER_BLEND_MOD:
		blend->enabled = true;
		blend->src_factor_rgb = SG_BLENDFACTOR_ZERO;
		blend->dst_factor_rgb = SG_BLENDFACTOR_SRC_COLOR;
		blend->src_factor_alpha = SG_BLENDFACTOR_ZERO;
		blend->dst_factor_alpha = SG_BLENDFACTOR_ONE;
		break;
	case ASTONIA_RENDERER_BLEND_MUL:
		blend->enabled = true;
		blend->src_factor_rgb = SG_BLENDFACTOR_DST_COLOR;
		blend->dst_factor_rgb = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
		blend->src_factor_alpha = SG_BLENDFACTOR_ONE;
		blend->dst_factor_alpha = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
		break;
	case ASTONIA_RENDERER_BLEND_NORMAL:
	default:
		blend->enabled = true;
		blend->src_factor_rgb = SG_BLENDFACTOR_SRC_ALPHA;
		blend->dst_factor_rgb = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
		blend->src_factor_alpha = SG_BLENDFACTOR_ONE;
		blend->dst_factor_alpha = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
		break;
	}
}

static int create_sprite_pipeline(void)
{
	sg_shader_desc shader_desc = {0};
	sg_pipeline_desc pipeline_desc = {0};
	sg_buffer_desc buffer_desc = {0};
	sg_sampler_desc sampler_desc = {0};

	shader_desc.vertex_func.source = g_sprite_shader_wgsl;
	shader_desc.vertex_func.entry = "vs_main";
	shader_desc.fragment_func.source = g_sprite_shader_wgsl;
	shader_desc.fragment_func.entry = "fs_main";
	shader_desc.attrs[0].base_type = SG_SHADERATTRBASETYPE_FLOAT;
	shader_desc.attrs[1].base_type = SG_SHADERATTRBASETYPE_FLOAT;
	shader_desc.attrs[2].base_type = SG_SHADERATTRBASETYPE_FLOAT;
	shader_desc.uniform_blocks[0].stage = SG_SHADERSTAGE_VERTEX;
	shader_desc.uniform_blocks[0].size = sizeof(ScreenVsParams);
	shader_desc.uniform_blocks[0].wgsl_group0_binding_n = 0u;
	shader_desc.views[0].texture.stage = SG_SHADERSTAGE_FRAGMENT;
	shader_desc.views[0].texture.image_type = SG_IMAGETYPE_2D;
	shader_desc.views[0].texture.sample_type = SG_IMAGESAMPLETYPE_FLOAT;
	shader_desc.views[0].texture.wgsl_group1_binding_n = 0u;
	shader_desc.samplers[0].stage = SG_SHADERSTAGE_FRAGMENT;
	shader_desc.samplers[0].sampler_type = SG_SAMPLERTYPE_FILTERING;
	shader_desc.samplers[0].wgsl_group1_binding_n = 1u;
	shader_desc.texture_sampler_pairs[0].stage = SG_SHADERSTAGE_FRAGMENT;
	shader_desc.texture_sampler_pairs[0].view_slot = 0u;
	shader_desc.texture_sampler_pairs[0].sampler_slot = 0u;
	shader_desc.label = "astonia-sprite-shader";

	g_sokol_webgpu.sprite_shader = sg_make_shader(&shader_desc);
	if (sg_query_shader_state(g_sokol_webgpu.sprite_shader) != SG_RESOURCESTATE_VALID) {
		return 0;
	}

	pipeline_desc.shader = g_sokol_webgpu.sprite_shader;
	pipeline_desc.layout.buffers[0].stride = sizeof(SpriteVertex);
	pipeline_desc.layout.attrs[0].format = SG_VERTEXFORMAT_FLOAT2;
	pipeline_desc.layout.attrs[0].offset = offsetof(SpriteVertex, x);
	pipeline_desc.layout.attrs[1].format = SG_VERTEXFORMAT_FLOAT2;
	pipeline_desc.layout.attrs[1].offset = offsetof(SpriteVertex, u);
	pipeline_desc.layout.attrs[2].format = SG_VERTEXFORMAT_UBYTE4N;
	pipeline_desc.layout.attrs[2].offset = offsetof(SpriteVertex, r);
	pipeline_desc.colors[0].pixel_format = g_sokol_webgpu.environment.defaults.color_format;
	pipeline_desc.primitive_type = SG_PRIMITIVETYPE_TRIANGLES;
	pipeline_desc.sample_count = g_sokol_webgpu.environment.defaults.sample_count;
	pipeline_desc.label = "astonia-sprite-pipeline";

	for (int mode = 0; mode < SOKOL_BLEND_MODE_COUNT; mode++) {
		configure_pipeline_blend(&pipeline_desc, (AstoniaRendererBlendMode)mode);
		g_sokol_webgpu.sprite_pipelines[mode] = sg_make_pipeline(&pipeline_desc);
		if (sg_query_pipeline_state(g_sokol_webgpu.sprite_pipelines[mode]) != SG_RESOURCESTATE_VALID) {
			return 0;
		}
	}

	buffer_desc.size = SOKOL_SPRITE_VERTEX_BYTES;
	buffer_desc.usage.vertex_buffer = true;
	buffer_desc.usage.stream_update = true;
	buffer_desc.label = "astonia-sprite-vertex-stream";
	g_sokol_webgpu.sprite_vertex_buffer = sg_make_buffer(&buffer_desc);
	if (sg_query_buffer_state(g_sokol_webgpu.sprite_vertex_buffer) != SG_RESOURCESTATE_VALID) {
		return 0;
	}

	sampler_desc.min_filter = SG_FILTER_NEAREST;
	sampler_desc.mag_filter = SG_FILTER_NEAREST;
	sampler_desc.mipmap_filter = SG_FILTER_NEAREST;
	sampler_desc.wrap_u = SG_WRAP_CLAMP_TO_EDGE;
	sampler_desc.wrap_v = SG_WRAP_CLAMP_TO_EDGE;
	sampler_desc.label = "astonia-sprite-sampler";
	g_sokol_webgpu.sprite_sampler = sg_make_sampler(&sampler_desc);
	if (sg_query_sampler_state(g_sokol_webgpu.sprite_sampler) != SG_RESOURCESTATE_VALID) {
		return 0;
	}

	return 1;
}

static int create_solid_pipelines(void)
{
	sg_shader_desc shader_desc = {0};
	sg_pipeline_desc pipeline_desc = {0};
	sg_buffer_desc buffer_desc = {0};

	shader_desc.vertex_func.source = g_solid_shader_wgsl;
	shader_desc.vertex_func.entry = "vs_main";
	shader_desc.fragment_func.source = g_solid_shader_wgsl;
	shader_desc.fragment_func.entry = "fs_main";
	shader_desc.attrs[0].base_type = SG_SHADERATTRBASETYPE_FLOAT;
	shader_desc.attrs[1].base_type = SG_SHADERATTRBASETYPE_FLOAT;
	shader_desc.uniform_blocks[0].stage = SG_SHADERSTAGE_VERTEX;
	shader_desc.uniform_blocks[0].size = sizeof(ScreenVsParams);
	shader_desc.uniform_blocks[0].wgsl_group0_binding_n = 0u;
	shader_desc.label = "astonia-solid-shader";

	g_sokol_webgpu.solid_shader = sg_make_shader(&shader_desc);
	if (sg_query_shader_state(g_sokol_webgpu.solid_shader) != SG_RESOURCESTATE_VALID) {
		return 0;
	}

	pipeline_desc.shader = g_sokol_webgpu.solid_shader;
	pipeline_desc.layout.buffers[0].stride = sizeof(PrimitiveVertex);
	pipeline_desc.layout.attrs[0].format = SG_VERTEXFORMAT_FLOAT2;
	pipeline_desc.layout.attrs[0].offset = offsetof(PrimitiveVertex, x);
	pipeline_desc.layout.attrs[1].format = SG_VERTEXFORMAT_UBYTE4N;
	pipeline_desc.layout.attrs[1].offset = offsetof(PrimitiveVertex, r);
	pipeline_desc.colors[0].pixel_format = g_sokol_webgpu.environment.defaults.color_format;
	pipeline_desc.sample_count = g_sokol_webgpu.environment.defaults.sample_count;
	pipeline_desc.label = "astonia-solid-pipeline";

	for (int mode = 0; mode < SOKOL_BLEND_MODE_COUNT; mode++) {
		configure_pipeline_blend(&pipeline_desc, (AstoniaRendererBlendMode)mode);

		pipeline_desc.primitive_type = SG_PRIMITIVETYPE_POINTS;
		g_sokol_webgpu.solid_point_pipelines[mode] = sg_make_pipeline(&pipeline_desc);
		if (sg_query_pipeline_state(g_sokol_webgpu.solid_point_pipelines[mode]) != SG_RESOURCESTATE_VALID) {
			return 0;
		}

		pipeline_desc.primitive_type = SG_PRIMITIVETYPE_LINES;
		g_sokol_webgpu.solid_line_pipelines[mode] = sg_make_pipeline(&pipeline_desc);
		if (sg_query_pipeline_state(g_sokol_webgpu.solid_line_pipelines[mode]) != SG_RESOURCESTATE_VALID) {
			return 0;
		}

		pipeline_desc.primitive_type = SG_PRIMITIVETYPE_TRIANGLES;
		g_sokol_webgpu.solid_triangle_pipelines[mode] = sg_make_pipeline(&pipeline_desc);
		if (sg_query_pipeline_state(g_sokol_webgpu.solid_triangle_pipelines[mode]) != SG_RESOURCESTATE_VALID) {
			return 0;
		}
	}

	buffer_desc.size = SOKOL_SOLID_VERTEX_BYTES;
	buffer_desc.usage.vertex_buffer = true;
	buffer_desc.usage.stream_update = true;
	buffer_desc.label = "astonia-solid-vertex-stream";
	g_sokol_webgpu.solid_vertex_buffer = sg_make_buffer(&buffer_desc);
	if (sg_query_buffer_state(g_sokol_webgpu.solid_vertex_buffer) != SG_RESOURCESTATE_VALID) {
		return 0;
	}

	return 1;
}

static int sokol_webgpu_init(int width, int height, const char *title, int monitor)
{
	sg_desc desc = {0};

	(void)title;
	(void)monitor;

	g_sokol_webgpu.environment = sglue_environment();
	desc.environment = g_sokol_webgpu.environment;
	desc.image_pool_size = SOKOL_RESOURCE_POOL_SIZE;
	desc.view_pool_size = SOKOL_RESOURCE_POOL_SIZE;
	desc.wgpu.bindgroups_cache_size = SOKOL_WGPU_BINDGROUPS_CACHE_SIZE;
	desc.logger.func = slog_func;
	sg_setup(&desc);
	{
		sg_desc resolved_desc = sg_query_desc();
		astonia_wasm_backend_image_pool_size = resolved_desc.image_pool_size;
		astonia_wasm_backend_view_pool_size = resolved_desc.view_pool_size;
		astonia_wasm_backend_bindgroups_cache_size = resolved_desc.wgpu.bindgroups_cache_size;
	}

	if (!sg_isvalid()) {
		g_sokol_webgpu.initialized = false;
		return 0;
	}

	g_sokol_webgpu.initialized = true;
	g_sokol_webgpu.frames = 0;
	g_sokol_webgpu.width = width;
	g_sokol_webgpu.height = height;
	g_sokol_webgpu.blend_mode = ASTONIA_RENDERER_BLEND_NORMAL;
	memset(g_texture_slots, 0, sizeof(g_texture_slots));
	g_next_texture_id = 1u;
	if (!create_sprite_pipeline() || !create_solid_pipelines()) {
		sg_shutdown();
		memset(&g_sokol_webgpu, 0, sizeof(g_sokol_webgpu));
		return 0;
	}
	return 1;
}

static void sokol_webgpu_shutdown(void)
{
	if (g_sokol_webgpu.initialized) {
		for (size_t i = 0; i < SOKOL_MAX_TEXTURES; i++) {
			if (g_texture_slots[i].id != ASTONIA_RENDERER_TEXTURE_INVALID.id) {
				sg_destroy_view(g_texture_slots[i].view);
				sg_destroy_image(g_texture_slots[i].image);
			}
		}
		if (g_sokol_webgpu.sprite_sampler.id) {
			sg_destroy_sampler(g_sokol_webgpu.sprite_sampler);
		}
		if (g_sokol_webgpu.sprite_vertex_buffer.id) {
			sg_destroy_buffer(g_sokol_webgpu.sprite_vertex_buffer);
		}
		if (g_sokol_webgpu.solid_vertex_buffer.id) {
			sg_destroy_buffer(g_sokol_webgpu.solid_vertex_buffer);
		}
		for (int i = 0; i < SOKOL_BLEND_MODE_COUNT; i++) {
			if (g_sokol_webgpu.sprite_pipelines[i].id) {
				sg_destroy_pipeline(g_sokol_webgpu.sprite_pipelines[i]);
			}
			if (g_sokol_webgpu.solid_point_pipelines[i].id) {
				sg_destroy_pipeline(g_sokol_webgpu.solid_point_pipelines[i]);
			}
			if (g_sokol_webgpu.solid_line_pipelines[i].id) {
				sg_destroy_pipeline(g_sokol_webgpu.solid_line_pipelines[i]);
			}
			if (g_sokol_webgpu.solid_triangle_pipelines[i].id) {
				sg_destroy_pipeline(g_sokol_webgpu.solid_triangle_pipelines[i]);
			}
		}
		if (g_sokol_webgpu.sprite_shader.id) {
			sg_destroy_shader(g_sokol_webgpu.sprite_shader);
		}
		if (g_sokol_webgpu.solid_shader.id) {
			sg_destroy_shader(g_sokol_webgpu.solid_shader);
		}
		sg_shutdown();
	}
	memset(&g_sokol_webgpu, 0, sizeof(g_sokol_webgpu));
	memset(g_texture_slots, 0, sizeof(g_texture_slots));
	g_next_texture_id = 1u;
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
	if (!pass.swapchain.invalid) {
		g_sokol_webgpu.width = pass.swapchain.width;
		g_sokol_webgpu.height = pass.swapchain.height;
	}
	sg_begin_pass(&pass);

	return 1;
}

static int sokol_webgpu_end_frame(void)
{
	if (!g_sokol_webgpu.initialized) {
		astonia_wasm_backend_submit_failure_count++;
		return 0;
	}

	sg_end_pass();
	sg_commit();
	if (!sg_isvalid()) {
		astonia_wasm_backend_submit_failure_count++;
		return 0;
	}
	astonia_wasm_backend_submit_count++;
	g_sokol_webgpu.frames++;
	return 1;
}

static int sokol_webgpu_frame_count(void)
{
	return g_sokol_webgpu.frames;
}

static void sokol_webgpu_destroy_texture(AstoniaRendererTexture texture);

static AstoniaRendererTexture sokol_webgpu_create_texture(
    const AstoniaRendererTextureDesc *desc, const void *pixels, size_t pitch_bytes)
{
	AstoniaRendererTexture texture = ASTONIA_RENDERER_TEXTURE_INVALID;
	SokolTextureSlot *slot;
	sg_image_desc image_desc = {0};
	sg_view_desc view_desc = {0};

	if (!g_sokol_webgpu.initialized || !desc || desc->width <= 0 || desc->height <= 0 ||
	    (pixels && pitch_bytes == 0u) || (!pixels && pitch_bytes != 0u) ||
	    (desc->format != ASTONIA_RENDERER_TEXTURE_FORMAT_ARGB8888 &&
	        desc->format != ASTONIA_RENDERER_TEXTURE_FORMAT_RGBA8888)) {
		astonia_wasm_backend_texture_create_failure_count++;
		note_backend_upload_failure(101, desc ? desc->width : 0, desc ? desc->height : 0, pitch_bytes, -1, 0, 0,
		    desc ? desc->width : 0, desc ? desc->height : 0);
		return texture;
	}

	slot = find_free_texture_slot();
	if (!slot) {
		astonia_wasm_backend_texture_create_failure_count++;
		note_backend_upload_failure(102, desc->width, desc->height, pitch_bytes, -1, 0, 0, desc->width, desc->height);
		return texture;
	}

	image_desc.width = desc->width;
	image_desc.height = desc->height;
	image_desc.pixel_format = SG_PIXELFORMAT_RGBA8;
	image_desc.usage.dynamic_update = true;
	image_desc.label = "astonia-sprite-texture";
	slot->image = sg_make_image(&image_desc);
	if (sg_query_image_state(slot->image) != SG_RESOURCESTATE_VALID) {
		astonia_wasm_backend_texture_create_failure_count++;
		astonia_wasm_backend_texture_create_image_failure_count++;
		note_backend_upload_failure(103, desc->width, desc->height, pitch_bytes, -1, 0, 0, desc->width, desc->height);
		memset(slot, 0, sizeof(*slot));
		return texture;
	}

	view_desc.texture.image = slot->image;
	view_desc.label = "astonia-sprite-texture-view";
	slot->view = sg_make_view(&view_desc);
	if (sg_query_view_state(slot->view) != SG_RESOURCESTATE_VALID) {
		astonia_wasm_backend_texture_create_failure_count++;
		astonia_wasm_backend_texture_create_view_failure_count++;
		note_backend_upload_failure(104, desc->width, desc->height, pitch_bytes, -1, 0, 0, desc->width, desc->height);
		sg_destroy_image(slot->image);
		memset(slot, 0, sizeof(*slot));
		return texture;
	}

	slot->id = next_texture_id();
	slot->width = desc->width;
	slot->height = desc->height;
	slot->source_format = desc->format;
	texture.id = slot->id;

	if (pixels && !update_texture_full(slot, desc, pixels, pitch_bytes)) {
		astonia_wasm_backend_texture_create_failure_count++;
		note_backend_upload_failure(105, desc->width, desc->height, pitch_bytes, -1, 0, 0, desc->width, desc->height);
		sokol_webgpu_destroy_texture(texture);
		return ASTONIA_RENDERER_TEXTURE_INVALID;
	}

	return texture;
}

static int sokol_webgpu_update_texture(
    AstoniaRendererTexture texture, const AstoniaRendererRect *rect, const void *pixels, size_t pitch_bytes)
{
	SokolTextureSlot *slot;
	AstoniaRendererTextureDesc desc;
	uint8_t *allocated = NULL;
	const void *upload_pixels = NULL;
	size_t upload_pitch = 0u;
	int x, y, width, height;

	if (!g_sokol_webgpu.initialized || !rect || !pixels || pitch_bytes == 0u) {
		astonia_wasm_backend_texture_update_failure_count++;
		note_backend_upload_failure(201, 0, 0, pitch_bytes, -1, 0, 0, 0, 0);
		return 0;
	}

	slot = find_texture_slot(texture);
	if (!slot) {
		astonia_wasm_backend_texture_update_failure_count++;
		note_backend_upload_failure(202, 0, 0, pitch_bytes, -1, 0, 0, 0, 0);
		return 0;
	}

	x = (int)rect->x;
	y = (int)rect->y;
	width = (int)rect->w;
	height = (int)rect->h;
	if (rect->x != (float)x || rect->y != (float)y || rect->w != (float)width || rect->h != (float)height || x < 0 ||
	    y < 0 || width <= 0 || height <= 0 || x + width > slot->width || y + height > slot->height) {
		astonia_wasm_backend_texture_update_failure_count++;
		note_backend_upload_failure(203, slot->width, slot->height, pitch_bytes, y, x, y, width, height);
		return 0;
	}

	desc.width = width;
	desc.height = height;
	desc.format = slot->source_format;
	if (!prepare_rgba_pixels(&desc, pixels, pitch_bytes, &allocated, &upload_pixels, &upload_pitch)) {
		astonia_wasm_backend_texture_update_failure_count++;
		note_backend_upload_failure(204, slot->width, slot->height, pitch_bytes, y, x, y, width, height);
		return 0;
	}

	int ok = astonia_sokol_webgpu_update_image_region(slot->image, x, y, width, height, upload_pixels, upload_pitch);
	free(allocated);
	if (ok) {
		astonia_wasm_backend_texture_update_count++;
	} else {
		astonia_wasm_backend_texture_update_failure_count++;
		note_backend_upload_failure(205, slot->width, slot->height, pitch_bytes, y, x, y, width, height);
	}
	return ok;
}

static void sokol_webgpu_destroy_texture(AstoniaRendererTexture texture)
{
	SokolTextureSlot *slot = find_texture_slot(texture);

	if (!slot) {
		return;
	}

	sg_destroy_view(slot->view);
	sg_destroy_image(slot->image);
	memset(slot, 0, sizeof(*slot));
}

static int sokol_webgpu_draw_textured_quad(
    AstoniaRendererTexture texture, const AstoniaRendererTexturedVertex vertices[4])
{
	SokolTextureSlot *slot;
	SpriteVertex sprite_vertices[SOKOL_SPRITE_VERTEX_COUNT];
	ScreenVsParams params;
	sg_bindings bindings = {0};
	sg_pipeline pipeline;
	int vertex_offset;

	pipeline = g_sokol_webgpu.sprite_pipelines[blend_mode_index(g_sokol_webgpu.blend_mode)];
	if (!g_sokol_webgpu.initialized || !vertices || !pipeline.id ||
	    !g_sokol_webgpu.sprite_vertex_buffer.id || !g_sokol_webgpu.sprite_sampler.id || g_sokol_webgpu.width <= 0 ||
	    g_sokol_webgpu.height <= 0) {
		astonia_wasm_backend_textured_draw_failure_count++;
		return 0;
	}

	slot = find_texture_slot(texture);
	if (!slot) {
		astonia_wasm_backend_textured_draw_failure_count++;
		return 0;
	}

	sprite_vertices[0] = (SpriteVertex){
		.x = vertices[0].x, .y = vertices[0].y, .u = vertices[0].u, .v = vertices[0].v,
		.r = vertices[0].color.r, .g = vertices[0].color.g, .b = vertices[0].color.b, .a = vertices[0].color.a};
	sprite_vertices[1] = (SpriteVertex){
		.x = vertices[1].x, .y = vertices[1].y, .u = vertices[1].u, .v = vertices[1].v,
		.r = vertices[1].color.r, .g = vertices[1].color.g, .b = vertices[1].color.b, .a = vertices[1].color.a};
	sprite_vertices[2] = (SpriteVertex){
		.x = vertices[2].x, .y = vertices[2].y, .u = vertices[2].u, .v = vertices[2].v,
		.r = vertices[2].color.r, .g = vertices[2].color.g, .b = vertices[2].color.b, .a = vertices[2].color.a};
	sprite_vertices[3] = sprite_vertices[0];
	sprite_vertices[4] = sprite_vertices[2];
	sprite_vertices[5] = (SpriteVertex){
		.x = vertices[3].x, .y = vertices[3].y, .u = vertices[3].u, .v = vertices[3].v,
		.r = vertices[3].color.r, .g = vertices[3].color.g, .b = vertices[3].color.b, .a = vertices[3].color.a};

	vertex_offset = sg_append_buffer(g_sokol_webgpu.sprite_vertex_buffer, SG_RANGE_REF(sprite_vertices));
	if (sg_query_buffer_overflow(g_sokol_webgpu.sprite_vertex_buffer)) {
		astonia_wasm_backend_textured_draw_failure_count++;
		return 0;
	}

	params = (ScreenVsParams){
		.screen_size = {(float)g_sokol_webgpu.width, (float)g_sokol_webgpu.height},
		.pad = {0.0f, 0.0f},
	};

	bindings.vertex_buffers[0] = g_sokol_webgpu.sprite_vertex_buffer;
	bindings.vertex_buffer_offsets[0] = vertex_offset;
	bindings.views[0] = slot->view;
	bindings.samplers[0] = g_sokol_webgpu.sprite_sampler;

	sg_apply_pipeline(pipeline);
	sg_apply_uniforms(0, SG_RANGE_REF(params));
	sg_apply_bindings(&bindings);
	sg_draw(0, SOKOL_SPRITE_TRIANGLE_COUNT, 1);

	astonia_wasm_backend_textured_draw_count++;
	return 1;
}

static PrimitiveVertex primitive_vertex(float x, float y, AstoniaRendererColor color)
{
	return (PrimitiveVertex){
		.x = x,
		.y = y,
		.r = color.r,
		.g = color.g,
		.b = color.b,
		.a = color.a,
	};
}

static int sokol_webgpu_draw_primitive_vertices(sg_pipeline pipeline, const PrimitiveVertex *vertices, size_t vertex_count)
{
	ScreenVsParams params;
	sg_bindings bindings = {0};
	sg_range vertex_range;
	int vertex_offset;

	if (!g_sokol_webgpu.initialized || !pipeline.id || !g_sokol_webgpu.solid_vertex_buffer.id || !vertices ||
	    vertex_count == 0u || vertex_count > (size_t)INT_MAX || g_sokol_webgpu.width <= 0 ||
	    g_sokol_webgpu.height <= 0) {
		astonia_wasm_backend_primitive_draw_failure_count++;
		return 0;
	}

	vertex_range = (sg_range){
		.ptr = vertices,
		.size = vertex_count * sizeof(vertices[0]),
	};
	vertex_offset = sg_append_buffer(g_sokol_webgpu.solid_vertex_buffer, &vertex_range);
	if (sg_query_buffer_overflow(g_sokol_webgpu.solid_vertex_buffer)) {
		astonia_wasm_backend_primitive_draw_failure_count++;
		return 0;
	}

	params = (ScreenVsParams){
		.screen_size = {(float)g_sokol_webgpu.width, (float)g_sokol_webgpu.height},
		.pad = {0.0f, 0.0f},
	};

	bindings.vertex_buffers[0] = g_sokol_webgpu.solid_vertex_buffer;
	bindings.vertex_buffer_offsets[0] = vertex_offset;

	sg_apply_pipeline(pipeline);
	sg_apply_uniforms(0, SG_RANGE_REF(params));
	sg_apply_bindings(&bindings);
	sg_draw(0, (int)vertex_count, 1);

	astonia_wasm_backend_primitive_draw_count++;
	return 1;
}

static int sokol_webgpu_fill_rect(const AstoniaRendererRect *rect, AstoniaRendererColor color)
{
	PrimitiveVertex vertices[6];
	sg_pipeline pipeline = g_sokol_webgpu.solid_triangle_pipelines[blend_mode_index(g_sokol_webgpu.blend_mode)];
	float x0, y0, x1, y1;

	if (!rect || rect->w <= 0.0f || rect->h <= 0.0f) {
		return 0;
	}

	x0 = rect->x;
	y0 = rect->y;
	x1 = rect->x + rect->w;
	y1 = rect->y + rect->h;

	vertices[0] = primitive_vertex(x0, y0, color);
	vertices[1] = primitive_vertex(x1, y0, color);
	vertices[2] = primitive_vertex(x1, y1, color);
	vertices[3] = vertices[0];
	vertices[4] = vertices[2];
	vertices[5] = primitive_vertex(x0, y1, color);

	return sokol_webgpu_draw_primitive_vertices(pipeline, vertices, 6u);
}

static int sokol_webgpu_draw_lines(
    const AstoniaRendererLine *lines, size_t count, AstoniaRendererColor color)
{
	enum { STACK_VERTEX_COUNT = 64 };
	PrimitiveVertex stack_vertices[STACK_VERTEX_COUNT];
	PrimitiveVertex *vertices = stack_vertices;
	sg_pipeline pipeline = g_sokol_webgpu.solid_line_pipelines[blend_mode_index(g_sokol_webgpu.blend_mode)];
	size_t vertex_count;
	int result;

	if (!lines || count == 0u || count > (size_t)INT_MAX / 2u) {
		return 0;
	}

	vertex_count = count * 2u;
	if (vertex_count > STACK_VERTEX_COUNT) {
		vertices = malloc(vertex_count * sizeof(*vertices));
		if (!vertices) {
			return 0;
		}
	}

	for (size_t i = 0; i < count; i++) {
		vertices[i * 2u + 0u] = primitive_vertex(lines[i].x0, lines[i].y0, color);
		vertices[i * 2u + 1u] = primitive_vertex(lines[i].x1, lines[i].y1, color);
	}

	result = sokol_webgpu_draw_primitive_vertices(pipeline, vertices, vertex_count);
	if (vertices != stack_vertices) {
		free(vertices);
	}
	return result;
}

static int sokol_webgpu_draw_points(
    const AstoniaRendererPoint *points, size_t count, AstoniaRendererColor color)
{
	enum { STACK_VERTEX_COUNT = 128 };
	PrimitiveVertex stack_vertices[STACK_VERTEX_COUNT];
	PrimitiveVertex *vertices = stack_vertices;
	sg_pipeline pipeline = g_sokol_webgpu.solid_point_pipelines[blend_mode_index(g_sokol_webgpu.blend_mode)];
	int result;

	if (!points || count == 0u || count > (size_t)INT_MAX) {
		return 0;
	}

	if (count > STACK_VERTEX_COUNT) {
		vertices = malloc(count * sizeof(*vertices));
		if (!vertices) {
			return 0;
		}
	}

	for (size_t i = 0; i < count; i++) {
		vertices[i] = primitive_vertex(points[i].x, points[i].y, color);
	}

	result = sokol_webgpu_draw_primitive_vertices(pipeline, vertices, count);
	if (vertices != stack_vertices) {
		free(vertices);
	}
	return result;
}

static int sokol_webgpu_draw_solid_triangles(const AstoniaRendererSolidVertex *vertices, size_t vertex_count,
    const uint16_t *indices, size_t index_count)
{
	enum { STACK_VERTEX_COUNT = 96 };
	PrimitiveVertex stack_vertices[STACK_VERTEX_COUNT];
	PrimitiveVertex *expanded_vertices = stack_vertices;
	sg_pipeline pipeline = g_sokol_webgpu.solid_triangle_pipelines[blend_mode_index(g_sokol_webgpu.blend_mode)];
	int result;

	if (!vertices || !indices || vertex_count == 0u || index_count == 0u || index_count > (size_t)INT_MAX ||
	    index_count % 3u != 0u) {
		return 0;
	}

	if (index_count > STACK_VERTEX_COUNT) {
		expanded_vertices = malloc(index_count * sizeof(*expanded_vertices));
		if (!expanded_vertices) {
			return 0;
		}
	}

	for (size_t i = 0; i < index_count; i++) {
		if ((size_t)indices[i] >= vertex_count) {
			if (expanded_vertices != stack_vertices) {
				free(expanded_vertices);
			}
			return 0;
		}
		expanded_vertices[i] = primitive_vertex(vertices[indices[i]].x, vertices[indices[i]].y, vertices[indices[i]].color);
	}

	result = sokol_webgpu_draw_primitive_vertices(pipeline, expanded_vertices, index_count);
	if (expanded_vertices != stack_vertices) {
		free(expanded_vertices);
	}
	return result;
}

static int sokol_webgpu_set_blend_mode(AstoniaRendererBlendMode mode)
{
	if (!blend_mode_is_valid(mode)) {
		return 0;
	}

	g_sokol_webgpu.blend_mode = mode;
	return 1;
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
