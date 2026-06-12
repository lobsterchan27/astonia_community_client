/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * WASM browser input bridge. Browser code forwards platform key/text/modifier
 * facts here; native GUI code owns all game behavior.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM input bridge is compiled only by the Emscripten target."
#endif

#include <SDL3/SDL.h>
#include <SDL3/SDL_keycode.h>

#include "wasm/wasm_input_bridge.h"

extern int vk_shift, vk_control, vk_alt;
extern int shift_override, control_override;

void gui_sdl_keyproc(SDL_Keycode key);
void context_keyup(SDL_Keycode key);
void cmd_proc(int key);

static int flag(int value)
{
	return value ? 1 : 0;
}

static void apply_modifiers(int shift, int ctrl, int alt)
{
	SDL_Keymod modstate;

	modstate = SDL_GetModState();
	modstate &= (SDL_Keymod)~(SDL_KMOD_SHIFT | SDL_KMOD_CTRL | SDL_KMOD_ALT);
	if (shift) {
		modstate |= SDL_KMOD_LSHIFT;
	}
	if (ctrl) {
		modstate |= SDL_KMOD_LCTRL;
	}
	if (alt) {
		modstate |= SDL_KMOD_LALT;
	}
	SDL_SetModState(modstate);

	vk_shift = flag(shift) || shift_override;
	vk_control = flag(ctrl) || control_override;
	vk_alt = flag(alt);
}

void astonia_wasm_input_set_modifiers(int shift, int ctrl, int alt)
{
	apply_modifiers(shift, ctrl, alt);
}

void astonia_wasm_input_key_down(int keycode, int shift, int ctrl, int alt)
{
	apply_modifiers(shift, ctrl, alt);
	if (keycode != SDLK_UNKNOWN) {
		gui_sdl_keyproc((SDL_Keycode)keycode);
	}
}

void astonia_wasm_input_key_up(int keycode, int shift, int ctrl, int alt)
{
	apply_modifiers(shift, ctrl, alt);
	if (keycode != SDLK_UNKNOWN) {
		context_keyup((SDL_Keycode)keycode);
	}
}

void astonia_wasm_input_text(int codepoint, int shift, int ctrl, int alt)
{
	apply_modifiers(shift, ctrl, alt);
	if (codepoint >= 32 && codepoint <= 126) {
		cmd_proc(codepoint);
	}
}
