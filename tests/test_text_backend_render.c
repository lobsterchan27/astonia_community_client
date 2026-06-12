/*
 * Focused native text backend route tests.
 *
 * Compiles SDL text rendering with SDL_RENDER_BACKEND_TEXTURES_FOR_TEST so
 * cached and no-cache text uploads use the same backend bridge used by WASM.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sdl/sdl.h"
#include "sdl/sdl_private.h"

#define TEST_RENDER_TEXT_NOCACHE 64
#define TEST_RENDER__SHADED_FONT 128
#define TEST_RENDER__FRAMED_FONT 256

#define TEST_RGB16(r, g, b) (uint16_t)((((r)&31) << 10) | (((g)&31) << 5) | ((b)&31))

typedef struct spy_texture {
	int width;
	int height;
	uint8_t alpha;
	uint32_t first_argb;
	int nonzero_pixels;
} SpyTexture;

static unsigned char g_empty_raw[] = {255u};
static unsigned char g_a_raw[] = {0u, 1u, 254u, 0u, 255u};
static struct renderfont g_font[128];

static int g_create_count;
static int g_blit_count;
static int g_destroy_count;
static int g_last_upload_width;
static int g_last_upload_height;
static uint32_t g_last_first_argb;
static int g_last_nonzero_pixels;
static SdlBackendRect g_last_src;
static SdlBackendRect g_last_dst;

static int fail_at(int line, const char *expr)
{
	fprintf(stderr, "text backend render failed at line %d: %s\n", line, expr);
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

static void init_test_font(void)
{
	for (int i = 0; i < 128; i++) {
		g_font[i].dim = 1;
		g_font[i].raw = g_empty_raw;
	}

	g_font[(unsigned char)'A'].dim = 3;
	g_font[(unsigned char)'A'].raw = g_a_raw;
}

static void spy_reset(void)
{
	g_create_count = 0;
	g_blit_count = 0;
	g_destroy_count = 0;
	g_last_upload_width = 0;
	g_last_upload_height = 0;
	g_last_first_argb = 0u;
	g_last_nonzero_pixels = 0;
	memset(&g_last_src, 0, sizeof(g_last_src));
	memset(&g_last_dst, 0, sizeof(g_last_dst));
}

SDL_Texture *sdl_backend_create_texture_from_argb8888(
    int width, int height, const uint32_t *pixels, size_t pitch_bytes)
{
	SpyTexture *texture;

	if (height <= 0 || !pixels || !sdl_backend_argb8888_pitch_is_valid(width, pitch_bytes)) {
		return NULL;
	}

	texture = calloc(1, sizeof(*texture));
	if (!texture) {
		return NULL;
	}

	texture->width = width;
	texture->height = height;
	texture->alpha = 255u;

	for (int y = 0; y < height; y++) {
		const uint32_t *row = (const uint32_t *)((const uint8_t *)pixels + (size_t)y * pitch_bytes);
		for (int x = 0; x < width; x++) {
			if (row[x] != 0u) {
				if (texture->first_argb == 0u) {
					texture->first_argb = row[x];
				}
				texture->nonzero_pixels++;
			}
		}
	}

	g_create_count++;
	g_last_upload_width = width;
	g_last_upload_height = height;
	g_last_first_argb = texture->first_argb;
	g_last_nonzero_pixels = texture->nonzero_pixels;
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
	return 1;
}

int sdl_backend_blit_texture(SDL_Texture *raw_texture, const SdlBackendRect *src, const SdlBackendRect *dst)
{
	SpyTexture *texture = (SpyTexture *)raw_texture;

	if (!texture || !src || !dst) {
		return 0;
	}

	g_blit_count++;
	g_last_src = *src;
	g_last_dst = *dst;
	return 1;
}

int sdl_backend_fill_rect(const SdlBackendRect *rect, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	(void)rect;
	(void)r;
	(void)g;
	(void)b;
	(void)a;
	return 1;
}

int sdl_backend_draw_points(const SdlBackendPoint *points, size_t count, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	(void)points;
	(void)count;
	(void)r;
	(void)g;
	(void)b;
	(void)a;
	return 1;
}

int sdl_backend_draw_lines(const SdlBackendLine *lines, size_t count, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	(void)lines;
	(void)count;
	(void)r;
	(void)g;
	(void)b;
	(void)a;
	return 1;
}

int sdl_backend_set_blend_mode(int mode)
{
	(void)mode;
	return 1;
}

int sdl_backend_get_blend_mode(void)
{
	return 0;
}

static int test_cached_text_uses_backend_texture_once(void)
{
	int end_x;

	CHECK(sdl_init_for_tests());
	init_test_font();
	spy_reset();

	end_x = sdl_drawtext(10, 20, TEST_RGB16(31, 0, 0), 0, "A", g_font, 0, 0, 100, 100, 5, 6);
	CHECK(end_x == 13);
	CHECK(g_create_count == 1);
	CHECK(g_blit_count == 1);
	CHECK(g_last_upload_width == 3);
	CHECK(g_last_upload_height == 2);
	CHECK(g_last_first_argb == 0xffff0000u);
	CHECK(g_last_nonzero_pixels == 3);
	CHECK(float_equal(g_last_src.x, 0.0f));
	CHECK(float_equal(g_last_src.y, 0.0f));
	CHECK(float_equal(g_last_src.w, 3.0f));
	CHECK(float_equal(g_last_src.h, 2.0f));
	CHECK(float_equal(g_last_dst.x, 15.0f));
	CHECK(float_equal(g_last_dst.y, 26.0f));
	CHECK(float_equal(g_last_dst.w, 3.0f));
	CHECK(float_equal(g_last_dst.h, 2.0f));

	end_x = sdl_drawtext(30, 40, TEST_RGB16(31, 0, 0), 0, "A", g_font, 0, 0, 100, 100, 0, 0);
	CHECK(end_x == 33);
	CHECK(g_create_count == 1);
	CHECK(g_blit_count == 2);
	CHECK(float_equal(g_last_dst.x, 30.0f));
	CHECK(float_equal(g_last_dst.y, 40.0f));

	sdl_native_state_reset_cache();
	CHECK(g_destroy_count == 1);
	sdl_shutdown_for_tests();
	return 0;
}

static int test_no_cache_text_destroys_backend_texture(void)
{
	int end_x;

	CHECK(sdl_init_for_tests());
	init_test_font();
	spy_reset();

	end_x = sdl_drawtext(
	    7, 9, TEST_RGB16(0, 31, 0), TEST_RENDER_TEXT_NOCACHE, "A", g_font, 0, 0, 100, 100, 0, 0);
	CHECK(end_x == 10);
	CHECK(g_create_count == 1);
	CHECK(g_blit_count == 1);
	CHECK(g_destroy_count == 1);
	CHECK(g_last_upload_width == 3);
	CHECK(g_last_upload_height == 2);
	CHECK(g_last_first_argb == 0xff00ff00u);
	CHECK(sdl_check_invariants_for_tests() == 0);

	sdl_shutdown_for_tests();
	return 0;
}

static int test_framed_cached_text_uploads_backend_texture(void)
{
	CHECK(sdl_init_for_tests());
	init_test_font();
	spy_reset();

	CHECK(sdl_drawtext(1, 2, TEST_RGB16(0, 0, 31), TEST_RENDER__FRAMED_FONT, "A", g_font, 0, 0, 100, 100, 0, 0) == 4);
	CHECK(g_create_count == 1);
	CHECK(g_blit_count == 1);
	CHECK(g_last_upload_width == 5);
	CHECK(g_last_upload_height == 2);
	CHECK(g_last_first_argb == 0xff0000ffu);

	sdl_native_state_reset_cache();
	CHECK(g_destroy_count == 1);
	sdl_shutdown_for_tests();
	return 0;
}

static int test_shaded_no_cache_text_uploads_backend_texture(void)
{
	CHECK(sdl_init_for_tests());
	init_test_font();
	spy_reset();

	CHECK(sdl_drawtext(1, 2, TEST_RGB16(31, 31, 31), TEST_RENDER_TEXT_NOCACHE | TEST_RENDER__SHADED_FONT, "A", g_font,
	          0, 0, 100, 100, 0, 0) == 4);
	CHECK(g_create_count == 1);
	CHECK(g_blit_count == 1);
	CHECK(g_destroy_count == 1);
	CHECK(g_last_upload_width == 5);
	CHECK(g_last_upload_height == 2);
	CHECK(g_last_first_argb == 0xffffffffu);

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
	if (run_test("cached text uses backend texture once", test_cached_text_uses_backend_texture_once) != 0) {
		return 1;
	}
	if (run_test("no-cache text destroys backend texture", test_no_cache_text_destroys_backend_texture) != 0) {
		return 1;
	}
	if (run_test("framed cached text uploads backend texture", test_framed_cached_text_uploads_backend_texture) != 0) {
		return 1;
	}
	if (run_test("shaded no-cache text uploads backend texture", test_shaded_no_cache_text_uploads_backend_texture) != 0) {
		return 1;
	}
	return 0;
}
