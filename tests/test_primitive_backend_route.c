/*
 * Focused native primitive backend route tests.
 *
 * Compiles SDL drawing with SDL_RENDER_BACKEND_TEXTURES_FOR_TEST so core
 * primitive draw calls use the same backend bridge selected by the WASM path.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sdl/sdl.h"
#include "sdl/sdl_private.h"

#define TEST_RGB16(r, g, b) (uint16_t)((((r)&31) << 10) | (((g)&31) << 5) | ((b)&31))

typedef struct spy_color {
	uint8_t r;
	uint8_t g;
	uint8_t b;
	uint8_t a;
} SpyColor;

static int g_fill_count;
static int g_point_call_count;
static size_t g_total_points;
static size_t g_last_point_count;
static int g_line_call_count;
static int g_blend_set_count;
static int g_backend_blend_mode;
static int g_last_draw_blend_mode;
static uint8_t g_min_alpha;
static uint8_t g_max_alpha;
static SdlBackendRect g_last_rect;
static SdlBackendPoint g_first_point;
static SdlBackendPoint g_last_point;
static SdlBackendLine g_first_line;
static SdlBackendLine g_last_line;
static SpyColor g_last_color;

static int fail_at(int line, const char *expr)
{
	fprintf(stderr, "primitive backend route failed at line %d: %s\n", line, expr);
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
	g_fill_count = 0;
	g_point_call_count = 0;
	g_total_points = 0u;
	g_last_point_count = 0u;
	g_line_call_count = 0;
	g_blend_set_count = 0;
	g_backend_blend_mode = 0;
	g_last_draw_blend_mode = 0;
	g_min_alpha = 255u;
	g_max_alpha = 0u;
	memset(&g_last_rect, 0, sizeof(g_last_rect));
	memset(&g_first_point, 0, sizeof(g_first_point));
	memset(&g_last_point, 0, sizeof(g_last_point));
	memset(&g_first_line, 0, sizeof(g_first_line));
	memset(&g_last_line, 0, sizeof(g_last_line));
	memset(&g_last_color, 0, sizeof(g_last_color));
}

SDL_Texture *sdl_backend_create_texture_from_argb8888(
    int width, int height, const uint32_t *pixels, size_t pitch_bytes)
{
	(void)width;
	(void)height;
	(void)pixels;
	(void)pitch_bytes;
	return NULL;
}

void sdl_backend_destroy_texture(SDL_Texture *texture)
{
	(void)texture;
}

int sdl_backend_get_texture_size(SDL_Texture *texture, float *width, float *height)
{
	(void)texture;
	(void)width;
	(void)height;
	return 0;
}

int sdl_backend_set_texture_alpha(SDL_Texture *texture, uint8_t alpha)
{
	(void)texture;
	(void)alpha;
	return 0;
}

int sdl_backend_blit_texture(SDL_Texture *texture, const SdlBackendRect *src, const SdlBackendRect *dst)
{
	(void)texture;
	(void)src;
	(void)dst;
	return 0;
}

static void spy_capture_color(uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	g_last_color = (SpyColor){
		.r = r,
		.g = g,
		.b = b,
		.a = a,
	};
	if (a < g_min_alpha) {
		g_min_alpha = a;
	}
	if (a > g_max_alpha) {
		g_max_alpha = a;
	}
	g_last_draw_blend_mode = g_backend_blend_mode;
}

int sdl_backend_fill_rect(const SdlBackendRect *rect, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	if (!rect) {
		return 0;
	}

	g_fill_count++;
	g_last_rect = *rect;
	spy_capture_color(r, g, b, a);
	return 1;
}

int sdl_backend_draw_points(const SdlBackendPoint *points, size_t count, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	if (!points || count == 0u) {
		return 0;
	}

	if (g_total_points == 0u) {
		g_first_point = points[0];
	}
	g_point_call_count++;
	g_total_points += count;
	g_last_point_count = count;
	g_last_point = points[count - 1u];
	spy_capture_color(r, g, b, a);
	return 1;
}

int sdl_backend_draw_lines(const SdlBackendLine *lines, size_t count, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
	if (!lines || count == 0u) {
		return 0;
	}

	if (g_line_call_count == 0) {
		g_first_line = lines[0];
	}
	g_line_call_count += (int)count;
	g_last_line = lines[count - 1u];
	spy_capture_color(r, g, b, a);
	return 1;
}

int sdl_backend_set_blend_mode(int mode)
{
	g_backend_blend_mode = mode;
	g_blend_set_count++;
	return 1;
}

int sdl_backend_get_blend_mode(void)
{
	return g_backend_blend_mode;
}

static int test_rectangles_route_to_backend_with_clipping(void)
{
	spy_reset();
	sdl_scale = 2;

	sdl_rect(1, 2, 10, 12, TEST_RGB16(31, 31, 31), 3, 5, 9, 11, 7, 11);
	CHECK(g_fill_count == 1);
	CHECK(float_equal(g_last_rect.x, 20.0f));
	CHECK(float_equal(g_last_rect.y, 32.0f));
	CHECK(float_equal(g_last_rect.w, 12.0f));
	CHECK(float_equal(g_last_rect.h, 12.0f));
	CHECK(g_last_color.r == 255u && g_last_color.g == 255u && g_last_color.b == 255u);
	CHECK(g_last_color.a == 255u);

	sdl_shaded_rect(2, 3, 8, 9, TEST_RGB16(31, 0, 0), 77, 0, 4, 10, 8, 1, 2);
	CHECK(g_fill_count == 2);
	CHECK(float_equal(g_last_rect.x, 6.0f));
	CHECK(float_equal(g_last_rect.y, 12.0f));
	CHECK(float_equal(g_last_rect.w, 12.0f));
	CHECK(float_equal(g_last_rect.h, 8.0f));
	CHECK(g_last_color.r == 255u && g_last_color.g == 0u && g_last_color.b == 0u);
	CHECK(g_last_color.a == 77u);

	sdl_rect(0, 0, 1, 1, TEST_RGB16(31, 31, 31), 2, 2, 4, 4, 0, 0);
	CHECK(g_fill_count == 2);
	return 0;
}

static int test_pixels_route_scaled_points_and_alpha(void)
{
	spy_reset();
	sdl_scale = 3;

	sdl_pixel(4, 5, TEST_RGB16(0, 0, 31), 1, 2);
	CHECK(g_point_call_count == 1);
	CHECK(g_last_point_count == 9u);
	CHECK(g_total_points == 9u);
	CHECK(float_equal(g_first_point.x, 15.0f));
	CHECK(float_equal(g_first_point.y, 21.0f));
	CHECK(g_last_color.r == 0u && g_last_color.g == 0u && g_last_color.b == 255u);
	CHECK(g_last_color.a == 255u);

	sdl_scale = 2;
	sdl_pixel_alpha(4, 5, TEST_RGB16(0, 31, 0), 123, 1, 2);
	CHECK(g_point_call_count == 2);
	CHECK(g_last_point_count == 4u);
	CHECK(g_total_points == 13u);
	CHECK(float_equal(g_first_point.x, 10.0f));
	CHECK(float_equal(g_first_point.y, 14.0f));
	CHECK(g_last_color.r == 0u && g_last_color.g == 255u && g_last_color.b == 0u);
	CHECK(g_last_color.a == 123u);
	return 0;
}

static int test_lines_route_with_clipping(void)
{
	spy_reset();
	sdl_scale = 2;

	sdl_line(-5, 3, 12, 9, TEST_RGB16(31, 31, 31), 0, 0, 10, 8, 1, 2);
	CHECK(g_line_call_count == 1);
	CHECK(float_equal(g_last_line.x0, 2.0f));
	CHECK(float_equal(g_last_line.y0, 10.0f));
	CHECK(float_equal(g_last_line.x1, 20.0f));
	CHECK(float_equal(g_last_line.y1, 18.0f));
	CHECK(g_last_color.a == 255u);

	spy_reset();
	sdl_scale = 2;
	sdl_line_alpha(-10, 5, 20, 5, TEST_RGB16(31, 0, 31), 77, 0, 0, 10, 10, 2, 3);
	CHECK(g_line_call_count == 1);
	CHECK(float_equal(g_last_line.x0, 4.0f));
	CHECK(float_equal(g_last_line.y0, 16.0f));
	CHECK(float_equal(g_last_line.x1, 22.0f));
	CHECK(float_equal(g_last_line.y1, 16.0f));
	CHECK(g_last_color.r == 255u && g_last_color.g == 0u && g_last_color.b == 255u);
	CHECK(g_last_color.a == 77u);

	sdl_line_alpha(-10, -10, -5, -5, TEST_RGB16(31, 31, 31), 255, 0, 0, 10, 10, 0, 0);
	CHECK(g_line_call_count == 1);
	return 0;
}

static int test_outline_rect_routes_closed_backend_lines(void)
{
	spy_reset();
	sdl_scale = 2;

	sdl_rect_outline_alpha(2, 3, 8, 9, TEST_RGB16(0, 31, 31), 88, 1, 4, 7, 10, 1, 2);
	CHECK(g_line_call_count == 4);
	CHECK(g_point_call_count == 0);
	CHECK(g_fill_count == 0);
	CHECK(float_equal(g_first_line.x0, 6.0f));
	CHECK(float_equal(g_first_line.y0, 12.0f));
	CHECK(float_equal(g_first_line.x1, 15.0f));
	CHECK(float_equal(g_first_line.y1, 12.0f));
	CHECK(float_equal(g_last_line.x0, 6.0f));
	CHECK(float_equal(g_last_line.y0, 21.0f));
	CHECK(float_equal(g_last_line.x1, 6.0f));
	CHECK(float_equal(g_last_line.y1, 12.0f));
	CHECK(g_last_color.r == 0u && g_last_color.g == 255u && g_last_color.b == 255u);
	CHECK(g_last_color.a == 88u);

	sdl_rect_outline_alpha(0, 0, 1, 1, TEST_RGB16(31, 31, 31), 200, 2, 2, 4, 4, 0, 0);
	CHECK(g_line_call_count == 4);
	return 0;
}

static int test_aa_line_routes_backend_points_with_per_point_alpha(void)
{
	spy_reset();
	sdl_scale = 1;

	sdl_line_aa(0, 0, 3, 0, TEST_RGB16(31, 31, 31), 200, 0, 0);
	CHECK(g_point_call_count == 8);
	CHECK(g_total_points == 8u);
	CHECK(g_last_point_count == 1u);
	CHECK(float_equal(g_first_point.x, 0.0f));
	CHECK(float_equal(g_first_point.y, 0.0f));
	CHECK(float_equal(g_last_point.x, 2.0f));
	CHECK(float_equal(g_last_point.y, 1.0f));
	CHECK(g_min_alpha == 0u);
	CHECK(g_max_alpha == 200u);
	CHECK(g_last_color.r == 255u && g_last_color.g == 255u && g_last_color.b == 255u);
	CHECK(g_line_call_count == 0);
	return 0;
}

static int test_pretty_and_rain_pixels_route_point_groups(void)
{
	spy_reset();
	sdl_scale = 2;

	sdl_pretty_pixel(10, 20, TEST_RGB16(0, 0, 0), 1, 2);
	CHECK(g_point_call_count == 3);
	CHECK(g_total_points == 13u);
	CHECK(g_last_point_count == 8u);
	CHECK(g_last_color.a == 64u);

	spy_reset();
	sdl_scale = 2;
	sdl_rain_pixel(10, 20, TEST_RGB16(0, 0, 0), 1, 2);
	CHECK(g_point_call_count == 4);
	CHECK(g_total_points == 11u);
	CHECK(g_last_point_count == 5u);
	CHECK(g_last_color.a == 64u);
	return 0;
}

static int test_blend_mode_control_routes_to_backend(void)
{
	spy_reset();
	sdl_scale = 1;

	sdl_set_blend_mode(1);
	CHECK(sdl_get_blend_mode() == 1);
	CHECK(g_backend_blend_mode == 1);
	CHECK(g_blend_set_count == 1);

	sdl_shaded_rect(0, 0, 3, 3, TEST_RGB16(31, 31, 31), 200, 0, 0, 10, 10, 0, 0);
	CHECK(g_fill_count == 1);
	CHECK(g_last_draw_blend_mode == 1);

	sdl_set_blend_mode(99);
	CHECK(sdl_get_blend_mode() == 0);
	CHECK(g_backend_blend_mode == 0);

	sdl_reset_blend_mode();
	CHECK(sdl_get_blend_mode() == 0);
	CHECK(g_backend_blend_mode == 0);
	CHECK(g_blend_set_count == 3);
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
	if (run_test("rectangles route to backend with clipping", test_rectangles_route_to_backend_with_clipping) != 0) {
		return 1;
	}
	if (run_test("pixels route scaled points and alpha", test_pixels_route_scaled_points_and_alpha) != 0) {
		return 1;
	}
	if (run_test("lines route with clipping", test_lines_route_with_clipping) != 0) {
		return 1;
	}
	if (run_test("outline rect routes closed backend lines", test_outline_rect_routes_closed_backend_lines) != 0) {
		return 1;
	}
	if (run_test("aa line routes backend points with per-point alpha", test_aa_line_routes_backend_points_with_per_point_alpha) != 0) {
		return 1;
	}
	if (run_test("pretty and rain pixels route point groups", test_pretty_and_rain_pixels_route_point_groups) != 0) {
		return 1;
	}
	if (run_test("blend mode control routes to backend", test_blend_mode_control_routes_to_backend) != 0) {
		return 1;
	}
	return 0;
}
