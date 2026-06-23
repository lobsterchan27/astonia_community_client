/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * WASM browser input bridge. Browser code forwards platform input/focus/capture
 * facts here; native GUI code owns all game behavior.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM input bridge is compiled only by the Emscripten target."
#endif

#include <SDL3/SDL.h>
#include <SDL3/SDL_keycode.h>

#include "sdl/sdl.h"
#include "wasm/wasm_input_bridge.h"

extern int vk_shift, vk_control, vk_alt;
extern int shift_override, control_override;

void gui_sdl_keyproc(SDL_Keycode key);
void gui_sdl_mouseproc(float x, float y, int what);
void context_keyup(SDL_Keycode key);
void cmd_proc(int key);

static int mouse_focus;
static int mouse_capture;
static int native_capture_requested;
static int native_cursor_warp_pending;
static int native_cursor_warp_x;
static int native_cursor_warp_y;
static int native_cursor;
static int mouse_event_count;
static int mouse_move_count;
static int mouse_button_down_count;
static int mouse_button_up_count;
static int mouse_wheel_count;
static int mouse_active_buttons;
static int mouse_last_x;
static int mouse_last_y;
static int mouse_last_button = -1;
static int mouse_last_pressed;
static int mouse_last_what;

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

static int mouse_button_event(int button, int pressed)
{
	switch (button) {
	case 0:
		return pressed ? SDL_MOUM_LDOWN : SDL_MOUM_LUP;
	case 1:
		return pressed ? SDL_MOUM_MDOWN : SDL_MOUM_MUP;
	case 2:
		return pressed ? SDL_MOUM_RDOWN : SDL_MOUM_RUP;
	default:
		return SDL_MOUM_NONE;
	}
}

static void record_mouse_event(int x, int y, int what)
{
	mouse_event_count++;
	mouse_last_x = x;
	mouse_last_y = y;
	mouse_last_what = what;
}

static void record_mouse_button(int x, int y, int button, int pressed, int what)
{
	record_mouse_event(x, y, what);
	mouse_last_button = button;
	mouse_last_pressed = flag(pressed);

	if (pressed) {
		mouse_button_down_count++;
		if (button >= 0 && button < 31) {
			mouse_active_buttons |= 1 << button;
		}
	} else {
		mouse_button_up_count++;
		if (button >= 0 && button < 31) {
			mouse_active_buttons &= ~(1 << button);
		}
	}
}

static void dispatch_mouse_motion(int x, int y, int movement_x, int movement_y)
{
	if (native_capture_requested && native_cursor_warp_pending) {
		int captured_x = native_cursor_warp_x + movement_x;
		int captured_y = native_cursor_warp_y + movement_y;

		mouse_move_count++;
		record_mouse_event(captured_x, captured_y, SDL_MOUM_NONE);
		gui_sdl_mouseproc((float)captured_x, (float)captured_y, SDL_MOUM_NONE);
		return;
	}

	mouse_move_count++;
	record_mouse_event(x, y, SDL_MOUM_NONE);
	gui_sdl_mouseproc((float)x, (float)y, SDL_MOUM_NONE);
}

void astonia_wasm_input_mouse_focus(int focused)
{
	mouse_focus = flag(focused);
	if (!mouse_focus) {
		mouse_capture = 0;
		native_capture_requested = 0;
	}
}

void astonia_wasm_input_mouse_capture(int captured)
{
	mouse_capture = flag(captured);
	if (!mouse_capture) {
		native_capture_requested = 0;
		native_cursor_warp_pending = 0;
	}
}

void astonia_wasm_input_mouse_move(int x, int y, int movement_x, int movement_y, int shift, int ctrl, int alt)
{
	apply_modifiers(shift, ctrl, alt);
	dispatch_mouse_motion(x, y, movement_x, movement_y);
}

void astonia_wasm_input_mouse_button(int x, int y, int button, int pressed, int shift, int ctrl, int alt)
{
	int what = mouse_button_event(button, pressed);

	apply_modifiers(shift, ctrl, alt);
	if (what == SDL_MOUM_NONE) {
		return;
	}

	dispatch_mouse_motion(x, y, 0, 0);
	record_mouse_button(x, y, button, pressed, what);
	gui_sdl_mouseproc((float)x, (float)y, what);
}

void astonia_wasm_input_mouse_wheel(int x, int y, int wheel_x, int wheel_y, int shift, int ctrl, int alt)
{
	int delta;

	(void)wheel_x;
	apply_modifiers(shift, ctrl, alt);
	if (wheel_y == 0) {
		return;
	}

	delta = wheel_y > 0 ? 1 : -1;
	dispatch_mouse_motion(x, y, 0, 0);
	mouse_wheel_count++;
	record_mouse_event(0, delta, SDL_MOUM_WHEEL);
	gui_sdl_mouseproc(0.0f, (float)delta, SDL_MOUM_WHEEL);
}

int astonia_wasm_input_mouse_event_count(void)
{
	return mouse_event_count;
}

int astonia_wasm_input_mouse_move_count(void)
{
	return mouse_move_count;
}

int astonia_wasm_input_mouse_button_down_count(void)
{
	return mouse_button_down_count;
}

int astonia_wasm_input_mouse_button_up_count(void)
{
	return mouse_button_up_count;
}

int astonia_wasm_input_mouse_wheel_count(void)
{
	return mouse_wheel_count;
}

int astonia_wasm_input_mouse_active_buttons(void)
{
	return mouse_active_buttons;
}

int astonia_wasm_input_mouse_last_x(void)
{
	return mouse_last_x;
}

int astonia_wasm_input_mouse_last_y(void)
{
	return mouse_last_y;
}

int astonia_wasm_input_mouse_last_button(void)
{
	return mouse_last_button;
}

int astonia_wasm_input_mouse_last_pressed(void)
{
	return mouse_last_pressed;
}

int astonia_wasm_input_mouse_last_what(void)
{
	return mouse_last_what;
}

int astonia_wasm_input_platform_has_focus(void)
{
	return mouse_focus || mouse_capture || native_capture_requested;
}

int astonia_wasm_input_platform_check_mouse(void)
{
	return astonia_wasm_input_platform_has_focus() ? 0 : 1;
}

void astonia_wasm_input_platform_capture_request(int captured)
{
	native_capture_requested = flag(captured);
	if (!native_capture_requested) {
		native_cursor_warp_pending = 0;
	}
}

void astonia_wasm_input_platform_cursor_warp_request(int x, int y)
{
	native_cursor_warp_pending = 1;
	native_cursor_warp_x = x;
	native_cursor_warp_y = y;
}

void astonia_wasm_input_platform_cursor_request(int cursor)
{
	native_cursor = cursor;
}

int astonia_wasm_input_platform_cursor(void)
{
	return native_cursor;
}
