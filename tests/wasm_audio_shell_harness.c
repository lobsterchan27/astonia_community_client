/*
 * Focused WASM audio capability harness.
 *
 * Validates browser capability state plumbing without browser-owned sound
 * selection, assets, volume, pan, fades, or timing.
 */

#include <stdint.h>

#include "astonia.h"
#include "sdl/sdl.h"
#include "wasm/wasm_audio_shell.h"

uint64_t game_options = 0;

int wasm_audio_harness_reset(int options)
{
	game_options = (uint64_t)options;
	sound_volume = 128;
	astonia_wasm_audio_report_browser_state(ASTONIA_WASM_AUDIO_LOCKED);
	return astonia_wasm_audio_state();
}

int wasm_audio_harness_game_options(void)
{
	return (int)game_options;
}
