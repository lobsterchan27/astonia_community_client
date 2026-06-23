/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The native startup adapter is compiled only by the WASM target."
#endif

#include "wasm/native_startup_adapter.h"

#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include "astonia.h"
#include "client/client.h"
#include "game/native_lifecycle.h"
#include "gui/gui.h"
#include "sdl/sdl.h"
#include "sokol_log.h"

#define ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT EMSCRIPTEN_KEEPALIVE
#define ASTONIA_WASM_CONNECT_PACE_FRAMES      4

typedef enum astonia_native_startup_adapter_phase {
	ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_CREATED = 0,
	ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_START_NATIVE,
	ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_INIT_LOOP,
	ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_RUNNING,
	ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_STOPPED,
	ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_CLEANED_UP
} AstoniaNativeStartupAdapterPhase;

extern int want_width;
extern int want_height;
extern char server_url[256];

static int g_argc;
static char **g_argv;
static int g_argv_copy_failed;
static AstoniaNativeStartupAdapterPhase g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_CREATED;
static AstoniaNativeStartupAdapterStatus g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_CREATED;
static int g_startup_result = ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED;
static int g_loop_init_result = ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED;
static int g_frame_count;
static int g_step_count;
static int g_shutdown_count;
static int g_shutdown_done;
static int g_quit_requested;
static int g_connect_pace_frame;

static void adapter_free_args(void)
{
	if (!g_argv) {
		return;
	}

	for (int i = 0; i < g_argc; i++) {
		free(g_argv[i]);
	}
	free(g_argv);
	g_argv = NULL;
	g_argc = 0;
}

static int adapter_copy_args(int argc, char *argv[])
{
	adapter_free_args();
	g_argv_copy_failed = 0;
	g_argc = argc;

	if (argc <= 0) {
		g_argc = 0;
		return 1;
	}

	g_argv = calloc((size_t)argc, sizeof(*g_argv));
	if (!g_argv) {
		g_argc = 0;
		g_argv_copy_failed = 1;
		return 0;
	}

	for (int i = 0; i < argc; i++) {
		const char *arg = argv && argv[i] ? argv[i] : "";
		size_t length = strlen(arg) + 1u;

		g_argv[i] = malloc(length);
		if (!g_argv[i]) {
			adapter_free_args();
			g_argv_copy_failed = 1;
			return 0;
		}
		memcpy(g_argv[i], arg, length);
	}

	return 1;
}

static void adapter_reset_progress(void)
{
	g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_CREATED;
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_CREATED;
	g_startup_result = ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED;
	g_loop_init_result = ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED;
	g_frame_count = 0;
	g_step_count = 0;
	g_shutdown_count = 0;
	g_shutdown_done = 0;
	g_quit_requested = 0;
	g_connect_pace_frame = 0;
}

static void adapter_shutdown_once(void)
{
	if (g_shutdown_done) {
		return;
	}

	astonia_native_client_shutdown();
	g_shutdown_done = 1;
	g_shutdown_count++;
}

static void adapter_request_quit_once(void)
{
	if (g_quit_requested) {
		return;
	}

	sapp_request_quit();
	g_quit_requested = 1;
}

static void adapter_fail_startup(AstoniaNativeStartupAdapterStatus status)
{
	g_status = status;
	g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_STOPPED;
	adapter_free_args();
	adapter_shutdown_once();
	adapter_request_quit_once();
}

static void adapter_init(void)
{
	g_connect_pace_frame = 0;
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_STARTING;
	g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_START_NATIVE;
}

static void adapter_start_native(void)
{
	if (g_argv_copy_failed) {
		g_startup_result = ASTONIA_NATIVE_CLIENT_ARGS_FAILED;
		adapter_fail_startup(ASTONIA_NATIVE_STARTUP_ADAPTER_STARTUP_FAILED);
		return;
	}

	g_startup_result = astonia_native_client_startup(g_argc, g_argv);
	adapter_free_args();
	if (g_startup_result != ASTONIA_NATIVE_CLIENT_OK) {
		adapter_fail_startup(ASTONIA_NATIVE_STARTUP_ADAPTER_STARTUP_FAILED);
		return;
	}

	g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_INIT_LOOP;
}

static void adapter_init_loop(void)
{
	g_loop_init_result = main_loop_init();
	if (g_loop_init_result != 0) {
		adapter_fail_startup(ASTONIA_NATIVE_STARTUP_ADAPTER_LOOP_INIT_FAILED);
		return;
	}

	g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_RUNNING;
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_RUNNING;
}

static int adapter_should_pace_browser_connect(void)
{
	/* Let browser WebSocket open/read callbacks run while the native socket is still handshaking. */
	if (sockstate != 1 && sockstate != 2) {
		g_connect_pace_frame = 0;
		return 0;
	}

	g_connect_pace_frame = (g_connect_pace_frame + 1) % ASTONIA_WASM_CONNECT_PACE_FRAMES;
	return g_connect_pace_frame != 0;
}

static void adapter_frame(void)
{
	if (g_phase == ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_START_NATIVE) {
		adapter_start_native();
		return;
	}

	if (g_phase == ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_INIT_LOOP) {
		adapter_init_loop();
		return;
	}

	if (g_phase != ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_RUNNING ||
	    g_status != ASTONIA_NATIVE_STARTUP_ADAPTER_RUNNING) {
		return;
	}

	g_frame_count++;
	if (adapter_should_pace_browser_connect()) {
		return;
	}

	if (!main_loop_step()) {
		g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_STOPPED;
		g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_STOPPED;
		adapter_shutdown_once();
		adapter_request_quit_once();
		return;
	}
	g_step_count++;
}

static void adapter_cleanup(void)
{
	adapter_free_args();
	adapter_shutdown_once();
	g_phase = ASTONIA_NATIVE_STARTUP_ADAPTER_PHASE_CLEANED_UP;
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_CLEANED_UP;
}

sapp_desc astonia_native_startup_adapter_sokol_main(int argc, char *argv[])
{
	sapp_desc desc = {0};

	adapter_reset_progress();
	(void)adapter_copy_args(argc, argv);
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_STARTING;

	desc.init_cb = adapter_init;
	desc.frame_cb = adapter_frame;
	desc.cleanup_cb = adapter_cleanup;
	desc.width = 1280;
	desc.height = 720;
	desc.sample_count = 1;
	desc.window_title = "Astonia WASM/WebGPU Client";
	desc.logger.func = slog_func;
	desc.html5.canvas_selector = "#canvas";
	desc.html5.canvas_resize = false;
	desc.html5.update_document_title = false;

	return desc;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_status(void)
{
	return (int)g_status;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_startup_result(void)
{
	return g_startup_result;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_loop_init_result(void)
{
	return g_loop_init_result;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_frame_count(void)
{
	return g_frame_count;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_step_count(void)
{
	return g_step_count;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_shutdown_count(void)
{
	return g_shutdown_count;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_has_username(void)
{
	return username[0] != '\0';
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_has_password(void)
{
	return password[0] != '\0';
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_has_server_url(void)
{
	return server_url[0] != '\0';
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_want_width(void)
{
	return want_width;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_want_height(void)
{
	return want_height;
}

ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT int astonia_native_startup_adapter_thread_count(void)
{
	return sdl_multi;
}
