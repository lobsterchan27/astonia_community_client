/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef ASTONIA_WASM_AUDIO_SHELL_H
#define ASTONIA_WASM_AUDIO_SHELL_H

#include "dll.h"

enum AstoniaWasmAudioState {
	ASTONIA_WASM_AUDIO_UNAVAILABLE = 0,
	ASTONIA_WASM_AUDIO_LOCKED = 1,
	ASTONIA_WASM_AUDIO_READY = 2,
};

DLL_EXPORT void astonia_wasm_audio_report_browser_state(int state);
DLL_EXPORT int astonia_wasm_audio_state(void);

#endif // ASTONIA_WASM_AUDIO_SHELL_H
