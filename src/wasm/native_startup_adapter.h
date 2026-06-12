/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#ifndef ASTONIA_WASM_NATIVE_STARTUP_ADAPTER_H
#define ASTONIA_WASM_NATIVE_STARTUP_ADAPTER_H

#include "sokol_app.h"

typedef enum astonia_native_startup_adapter_status {
	ASTONIA_NATIVE_STARTUP_ADAPTER_CREATED = 0,
	ASTONIA_NATIVE_STARTUP_ADAPTER_STARTING = 1,
	ASTONIA_NATIVE_STARTUP_ADAPTER_RUNNING = 2,
	ASTONIA_NATIVE_STARTUP_ADAPTER_STOPPED = 3,
	ASTONIA_NATIVE_STARTUP_ADAPTER_STARTUP_FAILED = 4,
	ASTONIA_NATIVE_STARTUP_ADAPTER_LOOP_INIT_FAILED = 5,
	ASTONIA_NATIVE_STARTUP_ADAPTER_CLEANED_UP = 6
} AstoniaNativeStartupAdapterStatus;

sapp_desc astonia_native_startup_adapter_sokol_main(int argc, char *argv[]);

int astonia_native_startup_adapter_status(void);
int astonia_native_startup_adapter_startup_result(void);
int astonia_native_startup_adapter_loop_init_result(void);
int astonia_native_startup_adapter_frame_count(void);
int astonia_native_startup_adapter_step_count(void);
int astonia_native_startup_adapter_shutdown_count(void);
int astonia_native_startup_adapter_has_username(void);
int astonia_native_startup_adapter_has_password(void);
int astonia_native_startup_adapter_has_server_url(void);
int astonia_native_startup_adapter_want_width(void);
int astonia_native_startup_adapter_want_height(void);
int astonia_native_startup_adapter_thread_count(void);

#endif
