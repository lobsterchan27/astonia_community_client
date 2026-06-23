#if !defined(__EMSCRIPTEN__)
#error "The Sokol WebGPU async harness is compiled only by Emscripten."
#endif

#include <stdint.h>

#include <emscripten/emscripten.h>

#define SOKOL_IMPL
#define SOKOL_NO_ENTRY
#include "sokol_app.h"

static int g_init_count;
static int g_frame_count;
static int g_cleanup_count;
static int g_device_lost_errors;

static void harness_log(const char *tag, uint32_t log_level, uint32_t log_item, const char *message, uint32_t line_nr,
    const char *filename, void *user_data)
{
	(void)tag;
	(void)log_level;
	(void)message;
	(void)line_nr;
	(void)filename;
	(void)user_data;

	if (log_item == SAPP_LOGITEM_WGPU_DEVICE_LOST) {
		g_device_lost_errors++;
	}
}

static void harness_init(void)
{
	g_init_count++;
}

static void harness_frame(void)
{
	g_frame_count++;
}

static void harness_cleanup(void)
{
	g_cleanup_count++;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_start(void)
{
	sapp_desc desc = {0};

	g_init_count = 0;
	g_frame_count = 0;
	g_cleanup_count = 0;
	g_device_lost_errors = 0;

	desc.init_cb = harness_init;
	desc.frame_cb = harness_frame;
	desc.cleanup_cb = harness_cleanup;
	desc.width = 320;
	desc.height = 180;
	desc.sample_count = 1;
	desc.html5.canvas_selector = "#canvas";
	desc.html5.canvas_resize = true;
	desc.logger.func = harness_log;

	_sapp_emsc_run(&desc);
	return 0;
}

EMSCRIPTEN_KEEPALIVE void wasm_sokol_webgpu_async_harness_request_quit(void)
{
	sapp_request_quit();
}

EMSCRIPTEN_KEEPALIVE void wasm_sokol_webgpu_async_harness_inject_destroyed_device_lost(void)
{
	WGPUStringView msg = _sapp_wgpu_stringview("Device was destroyed");
	_sapp_wgpu_device_lost_cb(0, WGPUDeviceLostReason_Destroyed, msg, 0, 0);
}

EMSCRIPTEN_KEEPALIVE void wasm_sokol_webgpu_async_harness_set_teardown_for_test(int teardown)
{
	_sapp.wgpu.teardown = teardown ? true : false;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_init_state(void)
{
	return (int)_sapp.wgpu.init_state;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_init_done(void)
{
	return _sapp.wgpu.init_done ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_request_adapter_count(void)
{
	return _sapp.wgpu.request_adapter_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_request_device_count(void)
{
	return _sapp.wgpu.request_device_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_surface_create_count(void)
{
	return _sapp.wgpu.surface_create_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_init_count(void)
{
	return g_init_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_frame_count(void)
{
	return g_frame_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_cleanup_count(void)
{
	return g_cleanup_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_sokol_webgpu_async_harness_device_lost_errors(void)
{
	return g_device_lost_errors;
}
