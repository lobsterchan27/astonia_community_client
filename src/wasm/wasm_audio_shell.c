/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * WASM audio capability shell. Browser audio unlock is platform-owned; native
 * code owns sound IDs, timing, volume, pan, and playback decisions.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM audio shell is compiled only by the Emscripten target."
#endif

#include "astonia.h"
#include "sdl/sdl.h"
#include "wasm/wasm_audio_shell.h"

int sound_volume = 128;

static int browser_audio_state = ASTONIA_WASM_AUDIO_LOCKED;

static int normalize_audio_state(int state)
{
	switch (state) {
	case ASTONIA_WASM_AUDIO_UNAVAILABLE:
	case ASTONIA_WASM_AUDIO_LOCKED:
	case ASTONIA_WASM_AUDIO_READY:
		return state;
	default:
		return ASTONIA_WASM_AUDIO_UNAVAILABLE;
	}
}

void astonia_wasm_audio_report_browser_state(int state)
{
	browser_audio_state = normalize_audio_state(state);
	if (browser_audio_state == ASTONIA_WASM_AUDIO_UNAVAILABLE) {
		game_options &= ~GO_SOUND;
	}
}

int astonia_wasm_audio_state(void)
{
	return browser_audio_state;
}

int init_sound(void)
{
	if (!(game_options & GO_SOUND)) {
		return -1;
	}

	if (browser_audio_state == ASTONIA_WASM_AUDIO_UNAVAILABLE) {
		game_options &= ~GO_SOUND;
		return -1;
	}

	return browser_audio_state == ASTONIA_WASM_AUDIO_READY ? 0 : -1;
}

void sound_exit(void)
{
}

void play_sound(unsigned int nr, int vol, int p)
{
	(void)nr;
	(void)vol;
	(void)p;
}

DLL_EXPORT int sound_load(const char *path)
{
	(void)path;
	return 0;
}

DLL_EXPORT void sound_unload(int handle)
{
	(void)handle;
}

DLL_EXPORT int sound_play(int handle, float volume)
{
	(void)handle;
	(void)volume;
	return 0;
}

DLL_EXPORT int sound_play_loop(int handle, float volume)
{
	(void)handle;
	(void)volume;
	return 0;
}

DLL_EXPORT void sound_stop(int channel)
{
	(void)channel;
}

DLL_EXPORT void sound_stop_all(void)
{
}

DLL_EXPORT void sound_set_volume(int channel, float volume)
{
	(void)channel;
	(void)volume;
}

DLL_EXPORT void sound_fade(int channel, float target, int duration)
{
	(void)channel;
	(void)target;
	(void)duration;
}

DLL_EXPORT float sound_get_master_volume(void)
{
	if (!sound_is_enabled()) {
		return 0.0f;
	}

	if (sound_volume < 0) {
		return 0.0f;
	}
	if (sound_volume > 128) {
		return 1.0f;
	}
	return (float)sound_volume / 128.0f;
}

DLL_EXPORT int sound_is_playing(int channel)
{
	(void)channel;
	return 0;
}

DLL_EXPORT int sound_is_enabled(void)
{
	return (game_options & GO_SOUND) && browser_audio_state == ASTONIA_WASM_AUDIO_READY ? 1 : 0;
}

void sound_fade_tick(void)
{
}

void sound_cleanup_mod_sounds(void)
{
}
