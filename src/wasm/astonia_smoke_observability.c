/*
 * Native smoke observability for browser gateway/login tests.
 *
 * These exports are read-only snapshots of native client state. The current
 * minimal WASM build does not link the full client yet, so weak zero-valued
 * fallbacks keep the ABI present until client.c supplies the real globals.
 */

#include "wasm/astonia_smoke_observability.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define ASTONIA_SMOKE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define ASTONIA_SMOKE_EXPORT
#endif

#if defined(__GNUC__) || defined(__clang__)
#define ASTONIA_SMOKE_WEAK __attribute__((weak))
#else
#define ASTONIA_SMOKE_WEAK
#endif

#if defined(ASTONIA_SMOKE_OBSERVABILITY_EXTERNAL_STATE)
extern int login_done;
extern int sockstate;
extern int protocol_version;
extern uint32_t tick;
extern int lasttick;
extern int q_size;
#else
ASTONIA_SMOKE_WEAK int login_done;
ASTONIA_SMOKE_WEAK int sockstate;
ASTONIA_SMOKE_WEAK int protocol_version;
ASTONIA_SMOKE_WEAK uint32_t tick;
ASTONIA_SMOKE_WEAK int lasttick;
ASTONIA_SMOKE_WEAK int q_size;
#endif

ASTONIA_SMOKE_WEAK int astonia_wasm_render_begin_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_render_present_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_render_present_after_login_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_render_present_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_create_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_context_sprite;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_code;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_sprite;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_width;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_height;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_pitch;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_row;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_rect_x;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_rect_y;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_rect_w;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_first_failure_rect_h;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_sample_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_nontransparent_sample_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_last_sample_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_last_nontransparent_sample_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_last_width;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_last_height;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_visible_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_offscreen_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_zero_alpha_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_after_login_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_last_x;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_last_y;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_last_w;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_last_h;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_bounds_min_x;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_bounds_min_y;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_bounds_max_x;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_bounds_max_y;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_queue_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_queue_peak;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_enqueue_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_drop_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_cpu_work_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_texture_create_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_texture_create_image_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_texture_create_view_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_image_pool_size;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_view_pool_size;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_bindgroups_cache_size;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_texture_update_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_texture_update_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_textured_draw_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_textured_draw_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_primitive_draw_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_primitive_draw_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_submit_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_backend_submit_failure_count;

ASTONIA_SMOKE_EXPORT int astonia_smoke_login_done(void)
{
	return login_done;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_sockstate(void)
{
	return sockstate;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_protocol_version(void)
{
	return protocol_version;
}

ASTONIA_SMOKE_EXPORT uint32_t astonia_smoke_tick(void)
{
	return tick;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_queued_ticks(void)
{
	return lasttick;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_queue_size(void)
{
	return q_size;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_render_begin_count(void)
{
	return astonia_wasm_render_begin_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_render_present_count(void)
{
	return astonia_wasm_render_present_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_render_present_after_login_count(void)
{
	return astonia_wasm_render_present_after_login_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_render_present_failure_count(void)
{
	return astonia_wasm_render_present_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_create_count(void)
{
	return astonia_wasm_texture_create_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_count(void)
{
	return astonia_wasm_texture_upload_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_failure_count(void)
{
	return astonia_wasm_texture_upload_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_code(void)
{
	return astonia_wasm_texture_upload_first_failure_code;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_sprite(void)
{
	return astonia_wasm_texture_upload_first_failure_sprite;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_width(void)
{
	return astonia_wasm_texture_upload_first_failure_width;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_height(void)
{
	return astonia_wasm_texture_upload_first_failure_height;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_pitch(void)
{
	return astonia_wasm_texture_upload_first_failure_pitch;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_row(void)
{
	return astonia_wasm_texture_upload_first_failure_row;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_rect_x(void)
{
	return astonia_wasm_texture_upload_first_failure_rect_x;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_rect_y(void)
{
	return astonia_wasm_texture_upload_first_failure_rect_y;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_rect_w(void)
{
	return astonia_wasm_texture_upload_first_failure_rect_w;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_first_failure_rect_h(void)
{
	return astonia_wasm_texture_upload_first_failure_rect_h;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_sample_count(void)
{
	return astonia_wasm_texture_upload_sample_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_nontransparent_sample_count(void)
{
	return astonia_wasm_texture_upload_nontransparent_sample_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_last_sample_count(void)
{
	return astonia_wasm_texture_upload_last_sample_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_last_nontransparent_sample_count(void)
{
	return astonia_wasm_texture_upload_last_nontransparent_sample_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_last_width(void)
{
	return astonia_wasm_texture_upload_last_width;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_upload_last_height(void)
{
	return astonia_wasm_texture_upload_last_height;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_count(void)
{
	return astonia_wasm_texture_blit_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_visible_count(void)
{
	return astonia_wasm_texture_blit_visible_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_offscreen_count(void)
{
	return astonia_wasm_texture_blit_offscreen_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_zero_alpha_count(void)
{
	return astonia_wasm_texture_blit_zero_alpha_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_after_login_count(void)
{
	return astonia_wasm_texture_blit_after_login_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_last_x(void)
{
	return astonia_wasm_texture_blit_last_x;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_last_y(void)
{
	return astonia_wasm_texture_blit_last_y;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_last_w(void)
{
	return astonia_wasm_texture_blit_last_w;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_last_h(void)
{
	return astonia_wasm_texture_blit_last_h;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_bounds_min_x(void)
{
	return astonia_wasm_texture_blit_bounds_min_x;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_bounds_min_y(void)
{
	return astonia_wasm_texture_blit_bounds_min_y;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_bounds_max_x(void)
{
	return astonia_wasm_texture_blit_bounds_max_x;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_bounds_max_y(void)
{
	return astonia_wasm_texture_blit_bounds_max_y;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_job_queue_count(void)
{
	return astonia_wasm_texture_job_queue_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_job_queue_peak(void)
{
	return astonia_wasm_texture_job_queue_peak;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_job_enqueue_count(void)
{
	return astonia_wasm_texture_job_enqueue_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_job_drop_count(void)
{
	return astonia_wasm_texture_job_drop_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_cpu_work_count(void)
{
	return astonia_wasm_texture_cpu_work_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_texture_update_count(void)
{
	return astonia_wasm_backend_texture_update_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_texture_update_failure_count(void)
{
	return astonia_wasm_backend_texture_update_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_texture_create_failure_count(void)
{
	return astonia_wasm_backend_texture_create_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_texture_create_image_failure_count(void)
{
	return astonia_wasm_backend_texture_create_image_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_texture_create_view_failure_count(void)
{
	return astonia_wasm_backend_texture_create_view_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_image_pool_size(void)
{
	return astonia_wasm_backend_image_pool_size;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_view_pool_size(void)
{
	return astonia_wasm_backend_view_pool_size;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_bindgroups_cache_size(void)
{
	return astonia_wasm_backend_bindgroups_cache_size;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_textured_draw_count(void)
{
	return astonia_wasm_backend_textured_draw_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_textured_draw_failure_count(void)
{
	return astonia_wasm_backend_textured_draw_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_primitive_draw_count(void)
{
	return astonia_wasm_backend_primitive_draw_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_primitive_draw_failure_count(void)
{
	return astonia_wasm_backend_primitive_draw_failure_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_submit_count(void)
{
	return astonia_wasm_backend_submit_count;
}

ASTONIA_SMOKE_EXPORT int astonia_smoke_backend_submit_failure_count(void)
{
	return astonia_wasm_backend_submit_failure_count;
}
