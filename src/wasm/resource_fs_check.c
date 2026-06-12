/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * Representative resource filesystem probe for the browser WASM package.
 */

#include <stddef.h>
#include <stdio.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define RESOURCE_FS_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define RESOURCE_FS_EXPORT
#endif

typedef enum ResourceKind {
	RESOURCE_MAGIC,
	RESOURCE_JSON,
} ResourceKind;

typedef struct ResourceProbe {
	const char *path;
	const char *label;
	ResourceKind kind;
	const unsigned char *magic;
	size_t magic_len;
	long min_size;
} ResourceProbe;

static const unsigned char ZIP_MAGIC[] = {'P', 'K', 0x03, 0x04};
static const unsigned char PNG_MAGIC[] = {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};
static const unsigned char CUR_MAGIC[] = {0x00, 0x00, 0x02, 0x00};

static const ResourceProbe RESOURCE_PROBES[] = {
	{"res/gx1.zip", "base graphics archive", RESOURCE_MAGIC, ZIP_MAGIC, sizeof(ZIP_MAGIC), 1024 * 1024},
	{"res/gx1_patch.zip", "graphics patch archive", RESOURCE_MAGIC, ZIP_MAGIC, sizeof(ZIP_MAGIC), 1024},
	{"res/sx.zip", "sound archive", RESOURCE_MAGIC, ZIP_MAGIC, sizeof(ZIP_MAGIC), 1024},
	{"res/font2x.png", "font texture", RESOURCE_MAGIC, PNG_MAGIC, sizeof(PNG_MAGIC), 1024},
	{"res/cursor/c_only.cur", "cursor file", RESOURCE_MAGIC, CUR_MAGIC, sizeof(CUR_MAGIC), 32},
	{"res/config/character_variants.json", "character variant config", RESOURCE_JSON, NULL, 0, 32},
	{"res/config/animated_variants.json", "animated variant config", RESOURCE_JSON, NULL, 0, 32},
	{"res/config/sprite_metadata.json", "sprite metadata config", RESOURCE_JSON, NULL, 0, 32},
	{"res/config/teleport_coords_v35.json", "teleport coordinate config", RESOURCE_JSON, NULL, 0, 32},
	{"res/config/map_poi2_1.json", "map point-of-interest config", RESOURCE_JSON, NULL, 0, 32},
};

static int read_initial_bytes(FILE *file, unsigned char *buffer, size_t len)
{
	if (len == 0) {
		return 1;
	}

	return fread(buffer, 1, len, file) == len;
}

static int file_size_at_least(FILE *file, long min_size)
{
	long size;

	if (fseek(file, 0, SEEK_END) != 0) {
		return 0;
	}

	size = ftell(file);
	if (size < 0) {
		return 0;
	}

	return size >= min_size;
}

static int json_starts_with_container(FILE *file)
{
	int ch;

	if (fseek(file, 0, SEEK_SET) != 0) {
		return 0;
	}

	while ((ch = fgetc(file)) != EOF) {
		if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') {
			continue;
		}

		return ch == '{' || ch == '[';
	}

	return 0;
}

static int check_resource(const ResourceProbe *probe)
{
	unsigned char buffer[sizeof(PNG_MAGIC)];
	FILE *file = fopen(probe->path, "rb");
	int ok = 1;

	if (!file) {
		fprintf(stderr, "resource fs check: missing %s at %s\n", probe->label, probe->path);
		return 0;
	}

	if (!file_size_at_least(file, probe->min_size)) {
		fprintf(stderr, "resource fs check: %s is smaller than expected at %s\n", probe->label, probe->path);
		ok = 0;
	}

	if (probe->kind == RESOURCE_MAGIC) {
		if (fseek(file, 0, SEEK_SET) != 0 || !read_initial_bytes(file, buffer, probe->magic_len) ||
		    memcmp(buffer, probe->magic, probe->magic_len) != 0) {
			fprintf(stderr, "resource fs check: %s has unexpected file signature at %s\n", probe->label, probe->path);
			ok = 0;
		}
	} else if (!json_starts_with_container(file)) {
		fprintf(stderr, "resource fs check: %s is not readable JSON data at %s\n", probe->label, probe->path);
		ok = 0;
	}

	fclose(file);
	return ok;
}

RESOURCE_FS_EXPORT int astonia_resource_fs_expected_count(void)
{
	return (int)(sizeof(RESOURCE_PROBES) / sizeof(RESOURCE_PROBES[0]));
}

RESOURCE_FS_EXPORT int astonia_resource_fs_check(void)
{
	int failures = 0;
	int i;

	for (i = 0; i < astonia_resource_fs_expected_count(); i++) {
		if (!check_resource(&RESOURCE_PROBES[i])) {
			failures++;
		}
	}

	return failures;
}

#ifdef ASTONIA_RESOURCE_FS_CHECK_MAIN
int main(void)
{
	return astonia_resource_fs_check() == 0 ? 0 : 1;
}
#endif
