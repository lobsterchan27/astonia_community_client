/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * Minimal WASM platform shell boundary.
 */

#ifndef ASTONIA_WASM_PLATFORM_SHELL_H
#define ASTONIA_WASM_PLATFORM_SHELL_H

int astonia_wasm_platform_shell_init(int width, int height);
void astonia_wasm_platform_shell_shutdown(void);

#endif
