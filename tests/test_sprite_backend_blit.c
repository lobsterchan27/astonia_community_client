/*
 * Focused sprite backend route tests.
 *
 * Compiles the SDL sprite cache with SDL_RENDER_BACKEND_TEXTURES_FOR_TEST so
 * sprite upload/blit goes through the same native backend bridge used by WASM.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "render_backend/render_backend.h"
#include "sdl/sdl.h"
#include "sdl/sdl_private.h"

typedef struct spy_texture {
	int width;
	int height;
	uint8_t alpha;
	uint8_t first_pixel[4];
} SpyTexture;

static int g_create_count;
static int g_blit_count;
static int g_alpha_count;
static int g_destroy_count;
static int g_last_upload_width;
static int g_last_upload_height;
static uint8_t g_last_blit_alpha;
static SdlBackendRect g_last_src;
static SdlBackendRect g_last_dst;

static int fail_at(int line, const char *expr)
{
	fprintf(stderr, "sprite backend blit failed at line %d: %s\n", line, expr);
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

static void spy_reset(void)
{
	g_create_count = 0;
	g_blit_count = 0;
	g_alpha_count = 0;
	g_destroy_count = 0;
	g_last_upload_width = 0;
	g_last_upload_height = 0;
	g_last_blit_alpha = 0u;
	memset(&g_last_src, 0, sizeof(g_last_src));
	memset(&g_last_dst, 0, sizeof(g_last_dst));
}

SDL_Texture *sdl_backend_create_texture_from_argb8888(
    int width, int height, const uint32_t *pixels, size_t pitch_bytes)
{
	SpyTexture *texture;
	uint8_t converted[4];

	if (height <= 0 || !pixels || !sdl_backend_argb8888_pitch_is_valid(width, pitch_bytes)) {
		return NULL;
	}

	texture = calloc(1, sizeof(*texture));
	if (!texture) {
		return NULL;
	}

	astonia_renderer_argb8888_to_rgba8888(converted, pixels, 1u);
	memcpy(texture->first_pixel, converted, sizeof(converted));
	texture->width = width;
	texture->height = height;
	texture->alpha = 255u;

	g_create_count++;
	g_last_upload_width = width;
	g_last_upload_height = height;
	return (SDL_Texture *)texture;
}

void sdl_backend_destroy_texture(SDL_Texture *raw_texture)
{
	if (raw_texture) {
		g_destroy_count++;
	}
	free(raw_texture);
}

int sdl_backend_get_texture_size(SDL_Texture *raw_texture, float *width, float *height)
{
	SpyTexture *texture = (SpyTexture *)raw_texture;

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
	SpyTexture *texture = (SpyTexture *)raw_texture;

	if (!texture) {
		return 0;
	}

	texture->alpha = alpha;
	g_alpha_count++;
	return 1;
}

int sdl_backend_blit_texture(SDL_Texture *raw_texture, const SdlBackendRect *src, const SdlBackendRect *dst)
{
	SpyTexture *texture = (SpyTexture *)raw_texture;

	if (!texture || !src || !dst) {
		return 0;
	}

	g_blit_count++;
	g_last_blit_alpha = texture->alpha;
	g_last_src = *src;
	g_last_dst = *dst;
	return 1;
}

static int test_argb_to_rgba_conversion(void)
{
	const uint32_t src[2] = {0x11223344u, 0x80abcdefu};
	uint8_t dst[8];

	astonia_renderer_argb8888_to_rgba8888(dst, src, 2u);
	CHECK(dst[0] == 0x22u);
	CHECK(dst[1] == 0x33u);
	CHECK(dst[2] == 0x44u);
	CHECK(dst[3] == 0x11u);
	CHECK(dst[4] == 0xabu);
	CHECK(dst[5] == 0xcdu);
	CHECK(dst[6] == 0xefu);
	CHECK(dst[7] == 0x80u);
	return 0;
}

static int test_backend_pitch_guard(void)
{
	uint32_t pixels[4] = {0};

	spy_reset();
	CHECK(sdl_backend_create_texture_from_argb8888(2, 2, pixels, sizeof(uint32_t)) == NULL);
	CHECK(g_create_count == 0);
	return 0;
}

static int test_real_sprite_upload_and_clipped_blit(void)
{
	int cache_index;
	int width;
	int height;
	int sx;
	int sy;
	int clipsx;
	int clipsy;
	int clipex;
	int clipey;
	int x_offset;
	int y_offset;
	uint16_t flags;

	CHECK(sdl_init_for_tests());
	spy_reset();

	cache_index = sdl_tx_load(2u, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0, 0, NULL, 0, 0);
	CHECK(cache_index != STX_NONE);
	flags = sdl_texture_get_flags_for_test(cache_index);
	CHECK((flags & SF_SPRITE) != 0);
	CHECK((flags & SF_DIDMAKE) != 0);
	CHECK((flags & SF_DIDTEX) != 0);
	CHECK(g_create_count == 1);

	width = sdlt_xres(cache_index);
	height = sdlt_yres(cache_index);
	CHECK(width > 10);
	CHECK(height > 10);
	CHECK(g_last_upload_width == width * sdl_scale);
	CHECK(g_last_upload_height == height * sdl_scale);

	sx = 10;
	sy = 20;
	clipsx = sx + 2;
	clipsy = sy + 3;
	clipex = sx + width - 4;
	clipey = sy + height - 5;
	x_offset = 7;
	y_offset = 11;

	sdl_tex_alpha(cache_index, 192);
	sdl_blit(cache_index, sx, sy, clipsx, clipsy, clipex, clipey, x_offset, y_offset);
	sdl_tex_alpha(cache_index, 255);

	CHECK(g_alpha_count == 2);
	CHECK(g_blit_count == 1);
	CHECK(g_last_blit_alpha == 192u);
	CHECK(float_equal(g_last_src.x, 2.0f * (float)sdl_scale));
	CHECK(float_equal(g_last_src.y, 3.0f * (float)sdl_scale));
	CHECK(float_equal(g_last_src.w, (float)((width - 6) * sdl_scale)));
	CHECK(float_equal(g_last_src.h, (float)((height - 8) * sdl_scale)));
	CHECK(float_equal(g_last_dst.x, (float)((clipsx + x_offset) * sdl_scale)));
	CHECK(float_equal(g_last_dst.y, (float)((clipsy + y_offset) * sdl_scale)));
	CHECK(float_equal(g_last_dst.w, (float)((width - 6) * sdl_scale)));
	CHECK(float_equal(g_last_dst.h, (float)((height - 8) * sdl_scale)));

	sdl_native_state_reset_cache();
	CHECK(g_destroy_count == 1);

	sdl_shutdown_for_tests();
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
	if (run_test("argb to rgba conversion", test_argb_to_rgba_conversion) != 0) {
		return 1;
	}
	if (run_test("backend pitch guard", test_backend_pitch_guard) != 0) {
		return 1;
	}
	if (run_test("real sprite upload and clipped blit", test_real_sprite_upload_and_clipped_blit) != 0) {
		return 1;
	}
	return 0;
}
