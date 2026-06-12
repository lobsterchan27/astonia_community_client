/*
 * Compile-only libzip declarations for the WASM native startup object preflight.
 *
 * Emscripten does not ship a libzip port. The preflight intentionally stops at
 * object compilation so these declarations expose native source portability
 * errors without pretending to solve the final archive backend/link decision.
 */

#ifndef ASTONIA_WASM_ZIP_H
#define ASTONIA_WASM_ZIP_H

#include <stdint.h>

typedef int64_t zip_int64_t;
typedef uint64_t zip_uint64_t;

typedef struct zip zip_t;
typedef struct zip_file zip_file_t;

typedef struct zip_stat {
	zip_uint64_t valid;
	zip_uint64_t size;
} zip_stat_t;

#define ZIP_RDONLY   0
#define ZIP_STAT_SIZE (1u << 2)

zip_t *zip_open(const char *path, int flags, int *errorp);
int zip_close(zip_t *archive);
zip_file_t *zip_fopen(zip_t *archive, const char *filename, int flags);
int zip_fclose(zip_file_t *file);
zip_int64_t zip_fread(zip_file_t *file, void *buffer, zip_uint64_t nbytes);
int zip_stat(zip_t *archive, const char *filename, int flags, zip_stat_t *stat);

#endif // ASTONIA_WASM_ZIP_H
