/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef ASTONIA_WASM_INPUT_BRIDGE_H
#define ASTONIA_WASM_INPUT_BRIDGE_H

#include "dll.h"

DLL_EXPORT void astonia_wasm_input_set_modifiers(int shift, int ctrl, int alt);
DLL_EXPORT void astonia_wasm_input_key_down(int keycode, int shift, int ctrl, int alt);
DLL_EXPORT void astonia_wasm_input_key_up(int keycode, int shift, int ctrl, int alt);
DLL_EXPORT void astonia_wasm_input_text(int codepoint, int shift, int ctrl, int alt);
DLL_EXPORT void astonia_wasm_input_mouse_focus(int focused);
DLL_EXPORT void astonia_wasm_input_mouse_capture(int captured);
DLL_EXPORT void astonia_wasm_input_mouse_move(int x, int y, int movement_x, int movement_y, int shift, int ctrl, int alt);
DLL_EXPORT void astonia_wasm_input_mouse_button(int x, int y, int button, int pressed, int shift, int ctrl, int alt);
DLL_EXPORT void astonia_wasm_input_mouse_wheel(int x, int y, int wheel_x, int wheel_y, int shift, int ctrl, int alt);
DLL_EXPORT int astonia_wasm_input_mouse_event_count(void);
DLL_EXPORT int astonia_wasm_input_mouse_move_count(void);
DLL_EXPORT int astonia_wasm_input_mouse_button_down_count(void);
DLL_EXPORT int astonia_wasm_input_mouse_button_up_count(void);
DLL_EXPORT int astonia_wasm_input_mouse_wheel_count(void);
DLL_EXPORT int astonia_wasm_input_mouse_active_buttons(void);
DLL_EXPORT int astonia_wasm_input_mouse_last_x(void);
DLL_EXPORT int astonia_wasm_input_mouse_last_y(void);
DLL_EXPORT int astonia_wasm_input_mouse_last_button(void);
DLL_EXPORT int astonia_wasm_input_mouse_last_pressed(void);
DLL_EXPORT int astonia_wasm_input_mouse_last_what(void);

int astonia_wasm_input_platform_has_focus(void);
int astonia_wasm_input_platform_check_mouse(void);
void astonia_wasm_input_platform_capture_request(int captured);
void astonia_wasm_input_platform_cursor_warp_request(int x, int y);
void astonia_wasm_input_platform_cursor_request(int cursor);
int astonia_wasm_input_platform_cursor(void);

#endif // ASTONIA_WASM_INPUT_BRIDGE_H
