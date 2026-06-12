/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 */

#if !defined(__EMSCRIPTEN__)
#error "The Sokol WebGPU harness is compiled only by the WASM target."
#endif

#include "wasm/native_startup_adapter.h"

sapp_desc sokol_main(int argc, char *argv[])
{
	return astonia_native_startup_adapter_sokol_main(argc, argv);
}
