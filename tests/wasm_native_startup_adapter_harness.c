#if !defined(__EMSCRIPTEN__)
#error "The WASM native startup adapter harness is compiled only by Emscripten."
#endif

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten/emscripten.h>
#include <SDL3/SDL.h>

#include "astonia.h"
#include "client/client.h"
#include "game/native_lifecycle.h"
#include "gui/gui.h"
#include "sdl/sdl.h"
#include "sokol_log.h"
#include "wasm/native_startup_adapter.h"

char username[40];
char password[16];
char *target_server;
uint16_t target_port = 5556;
int sockstate;
int frames_per_second = TICKS;
int sdl_multi = 4;
int namesize = 1;
int __yres = YRES0;

char v3_action_row[2][MAXACTIONSLOT];
char v35_action_row[2][MAXACTIONSLOT];
int action_enabled = 1;
int gear_lock;

extern char server_url[256];
extern int want_width;
extern int want_height;

static int g_sdl_init_count;
static int g_sdl_init_width;
static int g_sdl_init_height;
static int g_render_init_count;
static int g_main_init_count;
static int g_help_init_count;
static int g_update_user_keys_count;
static int g_loop_init_count;
static int g_loop_step_count;
static int g_loop_shutdown_count;
static int g_native_shutdown_count;
static int g_sapp_request_quit_count;
static int g_harness_phase;

void slog_func(const char *tag, uint32_t log_level, uint32_t log_item, const char *message, uint32_t line_nr,
    const char *filename, void *user_data)
{
	(void)tag;
	(void)log_level;
	(void)log_item;
	(void)message;
	(void)line_nr;
	(void)filename;
	(void)user_data;
}

void sapp_request_quit(void)
{
	g_sapp_request_quit_count++;
}

void *xmalloc(size_t size, uint8_t ID)
{
	(void)ID;
	g_harness_phase = 20;
	return malloc(size);
}

void *xrealloc(void *ptr, size_t size, uint8_t ID)
{
	(void)ID;
	return realloc(ptr, size);
}

void xfree(void *ptr)
{
	free(ptr);
}

void list_mem(void)
{
	g_harness_phase = 21;
	g_native_shutdown_count++;
}

int render_text_init_done(void)
{
	return 0;
}

void render_add_text(char *ptr)
{
	(void)ptr;
}

void actions_loaded(void)
{
}

void set_v35_inventory(void)
{
}

void set_v35_keytab(void)
{
}

void set_v35_actions(void)
{
}

void set_v35_skilltab(void)
{
}

void teleport_init(void)
{
	g_harness_phase = 22;
}

int amod_init(void)
{
	g_harness_phase = 23;
	return 0;
}

void amod_exit(void)
{
}

void amod_sprite_config(void)
{
}

int sprite_config_init(void)
{
	g_harness_phase = 24;
	return 0;
}

int sdl_init(int width, int height, char *title, int monitor)
{
	(void)title;
	(void)monitor;
	g_harness_phase = 30;
	g_sdl_init_count++;
	g_sdl_init_width = width;
	g_sdl_init_height = height;
	return 1;
}

void sdl_exit(void)
{
}

int render_init(void)
{
	g_harness_phase = 31;
	g_render_init_count++;
	return 0;
}

int render_exit(void)
{
	return 0;
}

int init_sound(void)
{
	return -1;
}

void sound_exit(void)
{
}

void render_set_textfont(int nr)
{
	(void)nr;
}

int main_init(void)
{
	g_harness_phase = 32;
	g_main_init_count++;
	return 0;
}

void main_exit(void)
{
}

void help_init(void)
{
	g_harness_phase = 33;
	g_help_init_count++;
}

void update_user_keys(void)
{
	g_harness_phase = 34;
	g_update_user_keys_count++;
}

int main_loop_init(void)
{
	g_harness_phase = 35;
	g_loop_init_count++;
	return 0;
}

int main_loop_step(void)
{
	g_loop_step_count++;
	return 1;
}

void main_loop_shutdown(void)
{
	g_loop_shutdown_count++;
}

int main_loop(void)
{
	return 0;
}

EMSCRIPTEN_KEEPALIVE int wasm_native_startup_adapter_harness_run(void)
{
	char *argv[] = {
		"moac",
		"-u",
		"BrowserUser",
		"-p",
		"BrowserPass",
		"-d",
		"ws://127.0.0.1:8787/gateway",
		"-w",
		"1024",
		"-h",
		"768",
		"-m",
		"0",
	};
	sapp_desc desc;

	memset(username, 0, sizeof(username));
	memset(password, 0, sizeof(password));
	server_url[0] = '\0';
	sockstate = 0;
	want_width = 0;
	want_height = 0;
	sdl_multi = 4;

	g_sdl_init_count = 0;
	g_sdl_init_width = 0;
	g_sdl_init_height = 0;
	g_render_init_count = 0;
	g_main_init_count = 0;
	g_help_init_count = 0;
	g_update_user_keys_count = 0;
	g_loop_init_count = 0;
	g_loop_step_count = 0;
	g_loop_shutdown_count = 0;
	g_native_shutdown_count = 0;
	g_sapp_request_quit_count = 0;
	g_harness_phase = 1;

	desc = astonia_native_startup_adapter_sokol_main((int)(sizeof(argv) / sizeof(argv[0])), argv);
	g_harness_phase = 2;
	if (!desc.init_cb || !desc.frame_cb || !desc.cleanup_cb) {
		return 1;
	}

	desc.init_cb();
	g_harness_phase = 3;
	desc.frame_cb();
	g_harness_phase = 4;
	desc.frame_cb();
	g_harness_phase = 5;
	desc.cleanup_cb();
	g_harness_phase = 6;

	if (astonia_native_startup_adapter_startup_result() != ASTONIA_NATIVE_CLIENT_OK) {
		return 2;
	}
	if (astonia_native_startup_adapter_loop_init_result() != 0) {
		return 3;
	}
	if (strcmp(username, "BrowserUser") != 0 || strcmp(password, "BrowserPass") != 0 ||
	    strcmp(server_url, "ws://127.0.0.1:8787/gateway") != 0) {
		return 4;
	}
	if (want_width != 1024 || want_height != 768 || sdl_multi != 0) {
		return 5;
	}
	if (g_sdl_init_count != 1 || g_sdl_init_width != 1024 || g_sdl_init_height != 768) {
		return 6;
	}
	if (g_render_init_count != 1 || g_main_init_count != 1 || g_help_init_count != 1 ||
	    g_update_user_keys_count != 1) {
		return 7;
	}
	if (g_loop_init_count != 1 || g_loop_step_count != 2 || g_loop_shutdown_count != 1) {
		return 8;
	}
	if (astonia_native_startup_adapter_frame_count() != 2 || astonia_native_startup_adapter_step_count() != 2) {
		return 9;
	}
	if (astonia_native_startup_adapter_shutdown_count() != 1 || g_native_shutdown_count != 1) {
		return 10;
	}
	if (g_sapp_request_quit_count != 0) {
		return 11;
	}
	if (astonia_native_startup_adapter_status() != ASTONIA_NATIVE_STARTUP_ADAPTER_CLEANED_UP) {
		return 12;
	}

	return 0;
}

EMSCRIPTEN_KEEPALIVE int wasm_native_startup_adapter_harness_network_pacing(void)
{
	char *argv[] = {
		"moac",
		"-u",
		"BrowserUser",
		"-p",
		"BrowserPass",
		"-d",
		"ws://127.0.0.1:8787/gateway",
		"-w",
		"1024",
		"-h",
		"768",
		"-m",
		"0",
	};
	sapp_desc desc;

	memset(username, 0, sizeof(username));
	memset(password, 0, sizeof(password));
	server_url[0] = '\0';
	sockstate = 0;
	want_width = 0;
	want_height = 0;
	sdl_multi = 4;

	g_loop_init_count = 0;
	g_loop_step_count = 0;
	g_loop_shutdown_count = 0;
	g_native_shutdown_count = 0;
	g_sapp_request_quit_count = 0;
	g_harness_phase = 40;

	desc = astonia_native_startup_adapter_sokol_main((int)(sizeof(argv) / sizeof(argv[0])), argv);
	if (!desc.init_cb || !desc.frame_cb || !desc.cleanup_cb) {
		return 1;
	}

	desc.init_cb();
	if (astonia_native_startup_adapter_status() != ASTONIA_NATIVE_STARTUP_ADAPTER_RUNNING) {
		return 2;
	}

	sockstate = 1;
	desc.frame_cb();
	desc.frame_cb();
	desc.frame_cb();
	if (g_loop_step_count != 0 || astonia_native_startup_adapter_frame_count() != 3 ||
	    astonia_native_startup_adapter_step_count() != 0) {
		return 3;
	}

	desc.frame_cb();
	if (g_loop_step_count != 1 || astonia_native_startup_adapter_frame_count() != 4 ||
	    astonia_native_startup_adapter_step_count() != 1) {
		return 4;
	}

	sockstate = 3;
	desc.frame_cb();
	desc.frame_cb();
	if (g_loop_step_count != 3 || astonia_native_startup_adapter_frame_count() != 6 ||
	    astonia_native_startup_adapter_step_count() != 3) {
		return 5;
	}

	desc.cleanup_cb();
	if (g_loop_shutdown_count != 1 || astonia_native_startup_adapter_status() != ASTONIA_NATIVE_STARTUP_ADAPTER_CLEANED_UP) {
		return 6;
	}

	g_harness_phase = 41;
	return 0;
}

EMSCRIPTEN_KEEPALIVE int wasm_native_startup_adapter_harness_phase(void)
{
	return g_harness_phase;
}
