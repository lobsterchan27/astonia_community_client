/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The native startup adapter is compiled only by the WASM target."
#endif

#include "wasm/native_startup_adapter.h"

#include <string.h>

#include <emscripten/emscripten.h>

#include "astonia.h"
#include "client/client.h"
#include "game/native_lifecycle.h"
#include "gui/gui.h"
#include "sdl/sdl.h"
#include "sokol_log.h"

#define ASTONIA_NATIVE_STARTUP_ADAPTER_EXPORT EMSCRIPTEN_KEEPALIVE

extern int want_width;
extern int want_height;
extern char server_url[256];

static int g_argc;
static char **g_argv;
static AstoniaNativeStartupAdapterStatus g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_CREATED;
static int g_startup_result = ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED;
static int g_loop_init_result = ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED;
static int g_frame_count;
static int g_step_count;
static int g_shutdown_count;

static void adapter_shutdown(void)
{
	astonia_native_client_shutdown();
	g_shutdown_count++;
}

static void adapter_fail_startup(AstoniaNativeStartupAdapterStatus status)
{
	g_status = status;
	adapter_shutdown();
	sapp_request_quit();
}

static void adapter_init(void)
{
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_STARTING;
	g_startup_result = astonia_native_client_startup(g_argc, g_argv);
	if (g_startup_result != ASTONIA_NATIVE_CLIENT_OK) {
		adapter_fail_startup(ASTONIA_NATIVE_STARTUP_ADAPTER_STARTUP_FAILED);
		return;
	}

	g_loop_init_result = main_loop_init();
	if (g_loop_init_result != 0) {
		adapter_fail_startup(ASTONIA_NATIVE_STARTUP_ADAPTER_LOOP_INIT_FAILED);
		return;
	}

	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_RUNNING;
}

static void adapter_frame(void)
{
	if (g_status != ASTONIA_NATIVE_STARTUP_ADAPTER_RUNNING) {
		return;
	}

	g_frame_count++;
	if (!main_loop_step()) {
		g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_STOPPED;
		adapter_shutdown();
		sapp_request_quit();
		return;
	}
	g_step_count++;
}

static void adapter_cleanup(void)
{
	adapter_shutdown();
	g_status = ASTONIA_NATIVE_STARTUP_ADAPTER_CLEANED_UP;
}

sapp_desc astonia_native_startup_adapter_sokol_main(int argc, char *argv[])
{
	sapp_desc desc = {0};

	g_argc = argc;
	g_argv = argv;

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
