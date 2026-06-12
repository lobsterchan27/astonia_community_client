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
static SDL_Keycode g_last_key_down;
static SDL_Keycode g_last_key_up;
static int g_last_text;

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
	g_last_key_down = SDLK_UNKNOWN;
	g_last_key_up = SDLK_UNKNOWN;
	g_last_text = 0;
	SDL_SetModState(SDL_KMOD_NONE);
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
