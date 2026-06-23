#if !defined(__EMSCRIPTEN__)
#error "The WASM input bridge harness is compiled only by Emscripten."
#endif

#include <stdint.h>

#include <emscripten/emscripten.h>
#include <SDL3/SDL.h>
#include <SDL3/SDL_keycode.h>

#include "wasm/wasm_input_bridge.h"

int vk_shift, vk_control, vk_alt;
int shift_override, control_override;

static int g_key_down_count;
static int g_key_up_count;
static int g_text_count;
static int g_mouse_count;
static SDL_Keycode g_last_key_down;
static SDL_Keycode g_last_key_up;
static int g_last_text;
static int g_last_mouse_x;
static int g_last_mouse_y;
static int g_last_mouse_what;

void gui_sdl_keyproc(SDL_Keycode key)
{
	g_key_down_count++;
	g_last_key_down = key;
}

void context_keyup(SDL_Keycode key)
{
	g_key_up_count++;
	g_last_key_up = key;
}

void cmd_proc(int key)
{
	g_text_count++;
	g_last_text = key;
}

void gui_sdl_mouseproc(float x, float y, int what)
{
	g_mouse_count++;
	g_last_mouse_x = (int)x;
	g_last_mouse_y = (int)y;
	g_last_mouse_what = what;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_reset(void)
{
	vk_shift = 0;
	vk_control = 0;
	vk_alt = 0;
	shift_override = 0;
	control_override = 0;
	g_key_down_count = 0;
	g_key_up_count = 0;
	g_text_count = 0;
	g_mouse_count = 0;
	g_last_key_down = SDLK_UNKNOWN;
	g_last_key_up = SDLK_UNKNOWN;
	g_last_text = 0;
	g_last_mouse_x = 0;
	g_last_mouse_y = 0;
	g_last_mouse_what = 0;
	SDL_SetModState(SDL_KMOD_NONE);
	astonia_wasm_input_mouse_focus(0);
	astonia_wasm_input_mouse_capture(0);
	return 0;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_key_down_count(void)
{
	return g_key_down_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_key_up_count(void)
{
	return g_key_up_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_text_count(void)
{
	return g_text_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_last_key_down(void)
{
	return (int)g_last_key_down;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_last_key_up(void)
{
	return (int)g_last_key_up;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_last_text(void)
{
	return g_last_text;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_mouse_count(void)
{
	return g_mouse_count;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_last_mouse_x(void)
{
	return g_last_mouse_x;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_last_mouse_y(void)
{
	return g_last_mouse_y;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_last_mouse_what(void)
{
	return g_last_mouse_what;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_vk_shift(void)
{
	return vk_shift;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_vk_control(void)
{
	return vk_control;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_vk_alt(void)
{
	return vk_alt;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_sdl_mods(void)
{
	SDL_Keymod modstate = SDL_GetModState();
	int result = 0;

	if (modstate & SDL_KMOD_SHIFT) {
		result |= 1;
	}
	if (modstate & SDL_KMOD_CTRL) {
		result |= 2;
	}
	if (modstate & SDL_KMOD_ALT) {
		result |= 4;
	}
	return result;
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_platform_has_focus(void)
{
	return astonia_wasm_input_platform_has_focus();
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_platform_check_mouse(void)
{
	return astonia_wasm_input_platform_check_mouse();
}

EMSCRIPTEN_KEEPALIVE void wasm_input_bridge_harness_platform_capture_request(int captured)
{
	astonia_wasm_input_platform_capture_request(captured);
}

EMSCRIPTEN_KEEPALIVE void wasm_input_bridge_harness_platform_cursor_warp_request(int x, int y)
{
	astonia_wasm_input_platform_cursor_warp_request(x, y);
}

EMSCRIPTEN_KEEPALIVE void wasm_input_bridge_harness_platform_cursor_request(int cursor)
{
	astonia_wasm_input_platform_cursor_request(cursor);
}

EMSCRIPTEN_KEEPALIVE int wasm_input_bridge_harness_platform_cursor(void)
{
	return astonia_wasm_input_platform_cursor();
}
