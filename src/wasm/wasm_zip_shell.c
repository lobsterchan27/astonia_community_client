/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * Link-safe libzip shell for the current WASM native-client link. Real archive
 * loading remains a separate resource backend decision.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM zip shell is compiled only by the Emscripten target."
#endif

#include <stddef.h>

#include "zip.h"

struct zip {
	int unused;
};

struct zip_file {
	int unused;
};

zip_t *zip_open(const char *path, int flags, int *errorp)
{
	(void)path;
	(void)flags;
	if (errorp) {
		*errorp = 1;
	}
	return NULL;
}

int zip_close(zip_t *archive)
{
	(void)archive;
	return 0;
}

zip_file_t *zip_fopen(zip_t *archive, const char *filename, int flags)
{
	(void)archive;
	(void)filename;
	(void)flags;
	return NULL;
}

int zip_fclose(zip_file_t *file)
{
	(void)file;
	return 0;
}

zip_int64_t zip_fread(zip_file_t *file, void *buffer, zip_uint64_t nbytes)
{
	(void)file;
	(void)buffer;
	(void)nbytes;
	return -1;
}

int zip_stat(zip_t *archive, const char *filename, int flags, zip_stat_t *stat)
{
	(void)archive;
	(void)filename;
	(void)flags;
	if (stat) {
		stat->valid = 0;
		stat->size = 0;
	}
	return -1;
}
