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

#endif // ASTONIA_WASM_INPUT_BRIDGE_H
