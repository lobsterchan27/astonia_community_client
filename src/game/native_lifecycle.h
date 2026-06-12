/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * Native client startup and shutdown lifecycle.
 */

#ifndef ASTONIA_NATIVE_LIFECYCLE_H
#define ASTONIA_NATIVE_LIFECYCLE_H

#include "dll.h"

#define ASTONIA_NATIVE_CLIENT_OK                  0
#define ASTONIA_NATIVE_CLIENT_SHOW_USAGE         1
#define ASTONIA_NATIVE_CLIENT_ARGS_FAILED       -1
#define ASTONIA_NATIVE_CLIENT_SDL_FAILED        -2
#define ASTONIA_NATIVE_CLIENT_RENDER_FAILED     -3
#define ASTONIA_NATIVE_CLIENT_MAIN_INIT_FAILED  -4
#define ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED   -5
#define ASTONIA_NATIVE_CLIENT_ALREADY_STARTED   -6

/*
 * Starts the native client through the same initialization path used by the
 * desktop executable. Returns one of the ASTONIA_NATIVE_CLIENT_* codes above.
 */
DLL_EXPORT int astonia_native_client_startup(int argc, char **argv);

/*
 * Runs the blocking desktop main loop after successful startup. Browser hosts
 * should use main_loop_init/main_loop_step/main_loop_shutdown instead.
 */
DLL_EXPORT int astonia_native_client_run(void);

/*
 * Shuts down initialized native client subsystems. Safe to call more than once
 * and safe after partial startup failure.
 */
DLL_EXPORT void astonia_native_client_shutdown(void);

#endif
