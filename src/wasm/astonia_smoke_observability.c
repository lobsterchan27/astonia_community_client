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
ASTONIA_SMOKE_WEAK int astonia_wasm_render_present_failure_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_create_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_upload_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_blit_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_queue_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_queue_peak;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_enqueue_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_job_drop_count;
ASTONIA_SMOKE_WEAK int astonia_wasm_texture_cpu_work_count;

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

ASTONIA_SMOKE_EXPORT int astonia_smoke_texture_blit_count(void)
{
	return astonia_wasm_texture_blit_count;
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
