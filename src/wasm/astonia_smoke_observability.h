#ifndef ASTONIA_SMOKE_OBSERVABILITY_H
#define ASTONIA_SMOKE_OBSERVABILITY_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

int astonia_smoke_login_done(void);
int astonia_smoke_sockstate(void);
int astonia_smoke_protocol_version(void);
uint32_t astonia_smoke_tick(void);
int astonia_smoke_queued_ticks(void);
int astonia_smoke_queue_size(void);
int astonia_smoke_render_begin_count(void);
int astonia_smoke_render_present_count(void);
int astonia_smoke_render_present_after_login_count(void);
int astonia_smoke_render_present_failure_count(void);
int astonia_smoke_texture_create_count(void);
int astonia_smoke_texture_upload_count(void);
int astonia_smoke_texture_upload_failure_count(void);
int astonia_smoke_texture_upload_first_failure_code(void);
int astonia_smoke_texture_upload_first_failure_sprite(void);
int astonia_smoke_texture_upload_first_failure_width(void);
int astonia_smoke_texture_upload_first_failure_height(void);
int astonia_smoke_texture_upload_first_failure_pitch(void);
int astonia_smoke_texture_upload_first_failure_row(void);
int astonia_smoke_texture_upload_first_failure_rect_x(void);
int astonia_smoke_texture_upload_first_failure_rect_y(void);
int astonia_smoke_texture_upload_first_failure_rect_w(void);
int astonia_smoke_texture_upload_first_failure_rect_h(void);
int astonia_smoke_texture_upload_sample_count(void);
int astonia_smoke_texture_upload_nontransparent_sample_count(void);
int astonia_smoke_texture_upload_last_sample_count(void);
int astonia_smoke_texture_upload_last_nontransparent_sample_count(void);
int astonia_smoke_texture_upload_last_width(void);
int astonia_smoke_texture_upload_last_height(void);
int astonia_smoke_texture_blit_count(void);
int astonia_smoke_texture_blit_visible_count(void);
int astonia_smoke_texture_blit_offscreen_count(void);
int astonia_smoke_texture_blit_zero_alpha_count(void);
int astonia_smoke_texture_blit_after_login_count(void);
int astonia_smoke_texture_blit_last_x(void);
int astonia_smoke_texture_blit_last_y(void);
int astonia_smoke_texture_blit_last_w(void);
int astonia_smoke_texture_blit_last_h(void);
int astonia_smoke_texture_blit_bounds_min_x(void);
int astonia_smoke_texture_blit_bounds_min_y(void);
int astonia_smoke_texture_blit_bounds_max_x(void);
int astonia_smoke_texture_blit_bounds_max_y(void);
int astonia_smoke_texture_job_queue_count(void);
int astonia_smoke_texture_job_queue_peak(void);
int astonia_smoke_texture_job_enqueue_count(void);
int astonia_smoke_texture_job_drop_count(void);
int astonia_smoke_texture_cpu_work_count(void);
int astonia_smoke_backend_texture_update_count(void);
int astonia_smoke_backend_texture_update_failure_count(void);
int astonia_smoke_backend_texture_create_failure_count(void);
int astonia_smoke_backend_texture_create_image_failure_count(void);
int astonia_smoke_backend_texture_create_view_failure_count(void);
int astonia_smoke_backend_image_pool_size(void);
int astonia_smoke_backend_view_pool_size(void);
int astonia_smoke_backend_bindgroups_cache_size(void);
int astonia_smoke_backend_textured_draw_count(void);
int astonia_smoke_backend_textured_draw_failure_count(void);
int astonia_smoke_backend_primitive_draw_count(void);
int astonia_smoke_backend_primitive_draw_failure_count(void);
int astonia_smoke_backend_submit_count(void);
int astonia_smoke_backend_submit_failure_count(void);

#ifdef __cplusplus
}
#endif

#endif
