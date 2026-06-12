/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * WASM audio no-op shell. Browser audio behavior is intentionally deferred.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM audio shell is compiled only by the Emscripten target."
#endif

#include "astonia.h"
#include "sdl/sdl.h"

int sound_volume = 0;

int init_sound(void)
{
	game_options &= ~GO_SOUND;
	return -1;
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
	return 0.0f;
}

DLL_EXPORT int sound_is_playing(int channel)
{
	(void)channel;
	return 0;
}

DLL_EXPORT int sound_is_enabled(void)
{
	return 0;
}

void sound_fade_tick(void)
{
}

void sound_cleanup_mod_sounds(void)
{
}
