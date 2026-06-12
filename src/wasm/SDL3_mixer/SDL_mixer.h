/*
 * Compile-only SDL3_mixer declarations for the WASM native startup object
 * preflight. Emscripten currently provides SDL3 but not SDL3_mixer.
 */

#ifndef ASTONIA_WASM_SDL3_MIXER_H
#define ASTONIA_WASM_SDL3_MIXER_H

#include <stdbool.h>

#include <SDL3/SDL.h>

typedef struct MIX_Mixer MIX_Mixer;
typedef struct MIX_Track MIX_Track;
typedef struct MIX_Audio MIX_Audio;

typedef struct MIX_Point3D {
	float x;
	float y;
	float z;
} MIX_Point3D;

bool MIX_Init(void);
void MIX_Quit(void);
MIX_Mixer *MIX_CreateMixerDevice(SDL_AudioDeviceID devid, const SDL_AudioSpec *spec);
MIX_Track *MIX_CreateTrack(MIX_Mixer *mixer);
MIX_Audio *MIX_LoadAudio_IO(MIX_Mixer *mixer, SDL_IOStream *io, bool predecode, bool closeio);
void MIX_DestroyAudio(MIX_Audio *audio);
void MIX_SetTrack3DPosition(MIX_Track *track, const MIX_Point3D *position);
void MIX_SetTrackGain(MIX_Track *track, float gain);
void MIX_SetTrackAudio(MIX_Track *track, MIX_Audio *audio);
void MIX_SetTrackLoops(MIX_Track *track, int loops);
void MIX_PlayTrack(MIX_Track *track, SDL_PropertiesID props);
void MIX_StopTrack(MIX_Track *track, int fade_ms);
bool MIX_TrackPlaying(MIX_Track *track);

#endif // ASTONIA_WASM_SDL3_MIXER_H
