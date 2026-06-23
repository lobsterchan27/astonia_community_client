#if !defined(__EMSCRIPTEN__)
#error "The WASM smoke observability harness is compiled only by the Emscripten target."
#endif

#include "wasm/astonia_smoke_observability.h"

#include <stdint.h>

int login_done;
int sockstate;
int protocol_version;
uint32_t tick;
int lasttick;
int q_size;
int astonia_wasm_render_begin_count;
int astonia_wasm_render_present_count;
int astonia_wasm_render_present_failure_count;
int astonia_wasm_texture_create_count;
int astonia_wasm_texture_upload_count;
int astonia_wasm_texture_blit_count;
int astonia_wasm_texture_job_queue_count;
int astonia_wasm_texture_job_queue_peak;
int astonia_wasm_texture_job_enqueue_count;
int astonia_wasm_texture_job_drop_count;
int astonia_wasm_texture_cpu_work_count;

void wasm_smoke_harness_seed(int next_login_done, int next_sockstate, int next_protocol_version, uint32_t next_tick,
    int next_queued_ticks, int next_queue_size)
{
	login_done = next_login_done;
	sockstate = next_sockstate;
	protocol_version = next_protocol_version;
	tick = next_tick;
	lasttick = next_queued_ticks;
	q_size = next_queue_size;
}

void wasm_smoke_harness_seed_progress(int render_begin_count, int render_present_count,
    int render_present_failure_count, int texture_create_count, int texture_upload_count, int texture_blit_count,
    int texture_job_queue_count, int texture_job_queue_peak, int texture_job_enqueue_count, int texture_job_drop_count,
    int texture_cpu_work_count)
{
	astonia_wasm_render_begin_count = render_begin_count;
	astonia_wasm_render_present_count = render_present_count;
	astonia_wasm_render_present_failure_count = render_present_failure_count;
	astonia_wasm_texture_create_count = texture_create_count;
	astonia_wasm_texture_upload_count = texture_upload_count;
	astonia_wasm_texture_blit_count = texture_blit_count;
	astonia_wasm_texture_job_queue_count = texture_job_queue_count;
	astonia_wasm_texture_job_queue_peak = texture_job_queue_peak;
	astonia_wasm_texture_job_enqueue_count = texture_job_enqueue_count;
	astonia_wasm_texture_job_drop_count = texture_job_drop_count;
	astonia_wasm_texture_cpu_work_count = texture_cpu_work_count;
}
