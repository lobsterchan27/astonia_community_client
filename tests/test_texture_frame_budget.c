/*
 * Focused browser texture frame-budget contract tests.
 *
 * Compiles the native SDL texture cache with ASTONIA_TEXTURE_FRAME_BUDGET_FOR_TEST
 * so sprite decode/prep and backend upload take the same non-blocking path used
 * by the WASM renderer bridge.
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
	uint8_t first_pixel[4];
} SpyTexture;

static int g_create_count;
static int g_last_upload_width;
static int g_last_upload_height;

static int fail_at(int line, const char *expr)
{
	fprintf(stderr, "texture frame budget failed at line %d: %s\n", line, expr);
	return 1;
}

#define CHECK(expr)        \
	do {                   \
		if (!(expr)) {     \
			return fail_at(__LINE__, #expr); \
		}                  \
	} while (0)

static void spy_reset(void)
{
	g_create_count = 0;
	g_last_upload_width = 0;
	g_last_upload_height = 0;
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

	g_create_count++;
	g_last_upload_width = width;
	g_last_upload_height = height;
	return (SDL_Texture *)texture;
}

int sdl_backend_upload_texture_argb8888_frame_budget_step(SdlBackendTextureUploadState *state, int width, int height,
    const uint32_t *pixels, size_t pitch_bytes, uint64_t deadline_ticks, SDL_Texture **out_texture)
{
	int did_work = 0;

	if (!state || !out_texture || !pixels || height <= 0 || !sdl_backend_argb8888_pitch_is_valid(width, pitch_bytes)) {
		return -1;
	}
	*out_texture = NULL;
	state->width = width;
	state->height = height;

	while (state->next_y < height && (deadline_ticks == 0 || !did_work || SDL_GetTicks() < deadline_ticks)) {
		state->next_y++;
		did_work = 1;
	}

	if (state->next_y < height) {
		return 0;
	}

	*out_texture = sdl_backend_create_texture_from_argb8888(width, height, pixels, pitch_bytes);
	memset(state, 0, sizeof(*state));
	return *out_texture ? 1 : -1;
}

void sdl_backend_upload_texture_argb8888_dispose(SdlBackendTextureUploadState *state)
{
	if (!state) {
		return;
	}
	if (state->texture) {
		sdl_backend_destroy_texture((SDL_Texture *)state->texture);
	}
	free(state->row_rgba);
	memset(state, 0, sizeof(*state));
}

void sdl_backend_destroy_texture(SDL_Texture *raw_texture)
{
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
	(void)raw_texture;
	(void)alpha;
	return 1;
}

int sdl_backend_blit_texture(SDL_Texture *raw_texture, const SdlBackendRect *src, const SdlBackendRect *dst)
{
	(void)raw_texture;
	(void)src;
	(void)dst;
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

static int find_sprite_cache_index(unsigned int sprite)
{
	for (int i = 0; i < MAX_TEXCACHE; i++) {
		uint16_t flags = flags_load(&sdlt[i]);
		if ((flags & SF_SPRITE) && sdlt[i].sprite == sprite) {
			return i;
		}
	}
	return STX_NONE;
}

static int request_sprite(unsigned int sprite)
{
	return sdl_tx_load(sprite, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0, 0, NULL, 0, 0);
}

static int test_not_ready_sprite_skips_then_appears(void)
{
	unsigned int sprite = 2u;
	int idx;
	uint16_t flags;
	SdlTextureFrameProgress progress;

	CHECK(sdl_init_for_tests());
	spy_reset();

	CHECK(request_sprite(sprite) == STX_NONE);
	idx = find_sprite_cache_index(sprite);
	CHECK(idx != STX_NONE);
	flags = sdl_texture_get_flags_for_test(idx);
	CHECK((flags & SF_SPRITE) != 0);
	CHECK((flags & SF_DIDMAKE) == 0);
	CHECK((flags & SF_DIDTEX) == 0);
	CHECK(sdl_texture_get_work_state_for_test(idx) == TX_WORK_QUEUED);
	CHECK(g_create_count == 0);

	progress = sdl_texture_advance_frame_budget(1, 0, 0);
	CHECK(progress.cpu_jobs == 1);
	CHECK(progress.gpu_uploads == 0);
	flags = sdl_texture_get_flags_for_test(idx);
	CHECK((flags & SF_DIDMAKE) != 0);
	CHECK((flags & SF_DIDTEX) == 0);
	CHECK(sdl_texture_get_work_state_for_test(idx) == TX_WORK_IDLE);

	CHECK(request_sprite(sprite) == STX_NONE);
	CHECK(g_create_count == 0);

	progress = sdl_texture_advance_frame_budget(0, 1, 0);
	CHECK(progress.cpu_jobs == 0);
	CHECK(progress.gpu_uploads == 1);
	CHECK(g_create_count == 1);
	flags = sdl_texture_get_flags_for_test(idx);
	CHECK((flags & SF_DIDALLOC) != 0);
	CHECK((flags & SF_DIDMAKE) != 0);
	CHECK((flags & SF_DIDTEX) != 0);
	CHECK(sdlt[idx].pixel == NULL);
	CHECK(sdlt[idx].tex != NULL);
	CHECK(g_last_upload_width == sdlt_xres(idx) * sdl_scale);
	CHECK(g_last_upload_height == sdlt_yres(idx) * sdl_scale);

	CHECK(request_sprite(sprite) == idx);
	CHECK(sdl_check_invariants_for_tests() == 0);

	sdl_shutdown_for_tests();
	return 0;
}

static int test_frame_budget_limits_progress_per_call(void)
{
	unsigned int sprites[] = {2u, 3u, 4u};
	SdlTextureFrameProgress progress;

	CHECK(sdl_init_for_tests());
	spy_reset();

	for (size_t i = 0; i < sizeof(sprites) / sizeof(sprites[0]); i++) {
		CHECK(request_sprite(sprites[i]) == STX_NONE);
	}
	CHECK(sdl_get_job_queue_depth_for_test() == 3);

	progress = sdl_texture_advance_frame_budget(1, 1, 0);
	CHECK(progress.cpu_jobs == 1);
	CHECK(progress.gpu_uploads == 1);
	CHECK(g_create_count == 1);
	CHECK(sdl_get_job_queue_depth_for_test() == 2);

	progress = sdl_texture_advance_frame_budget(1, 1, 0);
	CHECK(progress.cpu_jobs == 1);
	CHECK(progress.gpu_uploads == 1);
	CHECK(g_create_count == 2);
	CHECK(sdl_get_job_queue_depth_for_test() == 1);

	progress = sdl_texture_advance_frame_budget(1, 1, 0);
	CHECK(progress.cpu_jobs == 1);
	CHECK(progress.gpu_uploads == 1);
	CHECK(g_create_count == 3);
	CHECK(sdl_get_job_queue_depth_for_test() == 0);

	for (size_t i = 0; i < sizeof(sprites) / sizeof(sprites[0]); i++) {
		CHECK(request_sprite(sprites[i]) != STX_NONE);
	}
	CHECK(sdl_check_invariants_for_tests() == 0);

	sdl_shutdown_for_tests();
	return 0;
}

static int test_stale_generation_job_cannot_publish(void)
{
	unsigned int sprite = 2u;
	int idx;
	uint16_t flags;
	SdlTextureFrameProgress progress;

	CHECK(sdl_init_for_tests());
	spy_reset();

	CHECK(request_sprite(sprite) == STX_NONE);
	idx = find_sprite_cache_index(sprite);
	CHECK(idx != STX_NONE);
	CHECK(sdl_get_job_queue_depth_for_test() == 1);

	sdlt[idx].generation++;
	SDL_LockMutex(g_tex_jobs.mutex);
	work_state_store(&sdlt[idx], TX_WORK_IDLE);
	SDL_UnlockMutex(g_tex_jobs.mutex);

	progress = sdl_texture_advance_frame_budget(1, 1, 0);
	CHECK(progress.cpu_jobs == 0);
	CHECK(progress.gpu_uploads == 0);
	CHECK(sdl_get_job_queue_depth_for_test() == 0);
	flags = sdl_texture_get_flags_for_test(idx);
	CHECK((flags & SF_DIDMAKE) == 0);
	CHECK((flags & SF_DIDTEX) == 0);
	CHECK(g_create_count == 0);
	CHECK(sdl_texture_get_work_state_for_test(idx) == TX_WORK_IDLE);
	CHECK(sdl_check_invariants_for_tests() == 0);

	sdl_shutdown_for_tests();
	return 0;
}

static int test_cpu_make_step_can_pause_before_rows(void)
{
	struct sdl_texture texture;
	struct sdl_image image;
	SdlTextureMakeState state;
	uint32_t source_pixels[16];
	uint64_t deadline;
	int result;
	uint16_t flags;

	memset(&texture, 0, sizeof(texture));
	memset(&image, 0, sizeof(image));
	memset(&state, 0, sizeof(state));
	for (size_t i = 0; i < sizeof(source_pixels) / sizeof(source_pixels[0]); i++) {
		source_pixels[i] = 0xffffffffu;
	}

	CHECK(sdl_init_for_tests());
	image.pixel = source_pixels;
	image.xres = 4;
	image.yres = 4;
	texture.sprite = 2u;
	texture.scale = 100u;
	texture.ml = 10;

	deadline = SDL_GetTicks();
	result = sdl_make_stage12_frame_budget_step(&texture, &image, &state, deadline);
	CHECK(result == 0);
	flags = flags_load(&texture);
	CHECK((flags & SF_DIDALLOC) != 0);
	CHECK((flags & SF_DIDMAKE) == 0);
	CHECK(state.next_y == 0);
	CHECK(texture.pixel != NULL);

	result = sdl_make_stage12_frame_budget_step(&texture, &image, &state, 0);
	CHECK(result == 1);
	flags = flags_load(&texture);
	CHECK((flags & SF_DIDMAKE) != 0);

	xfree(texture.pixel);
	sdl_shutdown_for_tests();
	return 0;
}

static int test_upload_step_can_pause_before_publish(void)
{
	SdlBackendTextureUploadState state;
	uint32_t pixels[16];
	SDL_Texture *texture = NULL;
	uint64_t deadline;
	int result;

	memset(&state, 0, sizeof(state));
	for (size_t i = 0; i < sizeof(pixels) / sizeof(pixels[0]); i++) {
		pixels[i] = 0xff804020u;
	}
	spy_reset();

	deadline = SDL_GetTicks();
	result = sdl_backend_upload_texture_argb8888_frame_budget_step(&state, 4, 4, pixels, 4 * sizeof(uint32_t), deadline,
	    &texture);
	CHECK(result == 0);
	CHECK(texture == NULL);
	CHECK(g_create_count == 0);
	CHECK(state.next_y > 0);
	CHECK(state.next_y < 4);

	result =
	    sdl_backend_upload_texture_argb8888_frame_budget_step(&state, 4, 4, pixels, 4 * sizeof(uint32_t), 0, &texture);
	CHECK(result == 1);
	CHECK(texture != NULL);
	CHECK(g_create_count == 1);
	sdl_backend_destroy_texture(texture);
	return 0;
}

static int run_test(const char *name, int (*fn)(void))
{
	if (fn() != 0) {
		fprintf(stderr, "FAIL: %s\n", name);
		return 1;
	}
	fprintf(stderr, "PASS: %s\n", name);
	return 0;
}

int main(void)
{
	int failed = 0;

	if (run_test("not-ready sprite skips then appears", test_not_ready_sprite_skips_then_appears) != 0) {
		failed = 1;
	}
	if (run_test("frame budget limits progress per call", test_frame_budget_limits_progress_per_call) != 0) {
		failed = 1;
	}
	if (run_test("stale generation job cannot publish", test_stale_generation_job_cannot_publish) != 0) {
		failed = 1;
	}
	if (run_test("CPU make step can pause before rows", test_cpu_make_step_can_pause_before_rows) != 0) {
		failed = 1;
	}
	if (run_test("upload step can pause before publish", test_upload_step_can_pause_before_publish) != 0) {
		failed = 1;
	}

	return failed ? EXIT_FAILURE : EXIT_SUCCESS;
}
