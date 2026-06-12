#include "game/native_lifecycle.h"

#if ASTONIA_NATIVE_CLIENT_OK != 0
#error ASTONIA_NATIVE_CLIENT_OK must remain zero for C callers.
#endif

int native_lifecycle_api_compile_check(void)
{
	int (*startup)(int argc, char **argv) = astonia_native_client_startup;
	int (*run)(void) = astonia_native_client_run;
	void (*shutdown)(void) = astonia_native_client_shutdown;

	return startup != 0 && run != 0 && shutdown != 0 &&
	    ASTONIA_NATIVE_CLIENT_SHOW_USAGE > ASTONIA_NATIVE_CLIENT_OK &&
	    ASTONIA_NATIVE_CLIENT_ARGS_FAILED < ASTONIA_NATIVE_CLIENT_OK &&
	    ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED < ASTONIA_NATIVE_CLIENT_OK;
}
