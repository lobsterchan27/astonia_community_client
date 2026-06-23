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
int astonia_smoke_render_present_failure_count(void);
int astonia_smoke_texture_create_count(void);
int astonia_smoke_texture_upload_count(void);
int astonia_smoke_texture_blit_count(void);
int astonia_smoke_texture_job_queue_count(void);
int astonia_smoke_texture_job_queue_peak(void);
int astonia_smoke_texture_job_enqueue_count(void);
int astonia_smoke_texture_job_drop_count(void);
int astonia_smoke_texture_cpu_work_count(void);

#ifdef __cplusplus
}
#endif

#endif
