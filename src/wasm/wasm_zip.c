/*
 * Narrow WASM ZIP reader for native sprite PNG loading.
 *
 * This implements only the libzip subset used by src/sdl/sdl_image.c:
 * open/close/stat/fopen/fread/fclose by entry name. It exists so the native C
 * sprite path can keep reading packaged gx*.zip archives inside Emscripten's
 * filesystem without moving archive parsing into browser JavaScript.
 */

#if !defined(__EMSCRIPTEN__)
#error "The WASM ZIP reader is compiled only by the WASM target."
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

#include "zip.h"

#define ZIP_LOCAL_FILE_HEADER_SIGNATURE   0x04034b50u
#define ZIP_CENTRAL_DIRECTORY_SIGNATURE  0x02014b50u
#define ZIP_END_OF_CENTRAL_DIR_SIGNATURE 0x06054b50u
#define ZIP_COMPRESSION_STORED           0u
#define ZIP_COMPRESSION_DEFLATED         8u
#define ZIP_EOCD_MIN_SIZE                22u
#define ZIP_EOCD_SEARCH_SIZE             66000u

typedef struct wasm_zip_entry {
	char *name;
	zip_uint64_t compressed_size;
	zip_uint64_t uncompressed_size;
	unsigned long local_header_offset;
	unsigned int compression_method;
} WasmZipEntry;

struct zip {
	FILE *file;
	WasmZipEntry *entries;
	size_t entry_count;
};

struct zip_file {
	unsigned char *data;
	zip_uint64_t size;
	zip_uint64_t pos;
};

static unsigned int read_le16(const unsigned char *buffer)
{
	return (unsigned int)buffer[0] | ((unsigned int)buffer[1] << 8);
}

static unsigned long read_le32(const unsigned char *buffer)
{
	return (unsigned long)buffer[0] | ((unsigned long)buffer[1] << 8) | ((unsigned long)buffer[2] << 16) |
	       ((unsigned long)buffer[3] << 24);
}

static int read_exact_at(FILE *file, unsigned long offset, void *buffer, size_t size)
{
	return fseek(file, (long)offset, SEEK_SET) == 0 && fread(buffer, 1, size, file) == size;
}

static unsigned char *find_eocd(FILE *file, unsigned char **out_tail)
{
	long file_size;
	size_t tail_size;
	unsigned char *tail;

	if (fseek(file, 0, SEEK_END) != 0) {
		return NULL;
	}

	file_size = ftell(file);
	if (file_size < (long)ZIP_EOCD_MIN_SIZE) {
		return NULL;
	}

	tail_size = (size_t)(file_size < (long)ZIP_EOCD_SEARCH_SIZE ? file_size : (long)ZIP_EOCD_SEARCH_SIZE);
	tail = malloc(tail_size);
	if (!tail) {
		return NULL;
	}

	if (fseek(file, file_size - (long)tail_size, SEEK_SET) != 0 || fread(tail, 1, tail_size, file) != tail_size) {
		free(tail);
		return NULL;
	}

	for (size_t i = tail_size - ZIP_EOCD_MIN_SIZE;; i--) {
		if (read_le32(tail + i) == ZIP_END_OF_CENTRAL_DIR_SIGNATURE) {
			*out_tail = tail;
			return tail + i;
		}
		if (i == 0u) {
			break;
		}
	}

	free(tail);
	return NULL;
}

static void free_entries(WasmZipEntry *entries, size_t count)
{
	if (!entries) {
		return;
	}

	for (size_t i = 0; i < count; i++) {
		free(entries[i].name);
	}
	free(entries);
}

static int parse_central_directory(zip_t *archive)
{
	unsigned char *tail = NULL;
	unsigned char *eocd;
	unsigned char header[46];
	unsigned int total_entries;
	unsigned long central_directory_offset;

	eocd = find_eocd(archive->file, &tail);
	if (!eocd) {
		return 0;
	}

	total_entries = read_le16(eocd + 10);
	central_directory_offset = read_le32(eocd + 16);
	free(tail);

	archive->entries = calloc(total_entries ? total_entries : 1u, sizeof(archive->entries[0]));
	if (!archive->entries) {
		return 0;
	}

	if (fseek(archive->file, (long)central_directory_offset, SEEK_SET) != 0) {
		return 0;
	}

	for (unsigned int i = 0; i < total_entries; i++) {
		unsigned int name_len;
		unsigned int extra_len;
		unsigned int comment_len;
		char *name;

		if (fread(header, 1, sizeof(header), archive->file) != sizeof(header) ||
		    read_le32(header) != ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
			return 0;
		}

		name_len = read_le16(header + 28);
		extra_len = read_le16(header + 30);
		comment_len = read_le16(header + 32);
		name = malloc((size_t)name_len + 1u);
		if (!name) {
			return 0;
		}
		if (fread(name, 1, name_len, archive->file) != name_len) {
			free(name);
			return 0;
		}
		name[name_len] = '\0';

		archive->entries[i].name = name;
		archive->entries[i].compression_method = read_le16(header + 10);
		archive->entries[i].compressed_size = read_le32(header + 20);
		archive->entries[i].uncompressed_size = read_le32(header + 24);
		archive->entries[i].local_header_offset = read_le32(header + 42);
		archive->entry_count++;

		if (fseek(archive->file, (long)(extra_len + comment_len), SEEK_CUR) != 0) {
			return 0;
		}
	}

	return 1;
}

static const WasmZipEntry *find_entry(zip_t *archive, const char *filename)
{
	if (!archive || !filename) {
		return NULL;
	}

	for (size_t i = 0; i < archive->entry_count; i++) {
		if (archive->entries[i].name && strcmp(archive->entries[i].name, filename) == 0) {
			return &archive->entries[i];
		}
	}

	return NULL;
}

static unsigned char *read_entry_payload(zip_t *archive, const WasmZipEntry *entry, zip_uint64_t *out_size)
{
	unsigned char local_header[30];
	unsigned int name_len;
	unsigned int extra_len;
	unsigned long data_offset;
	unsigned char *compressed = NULL;
	unsigned char *output = NULL;

	*out_size = 0u;
	if (!read_exact_at(archive->file, entry->local_header_offset, local_header, sizeof(local_header)) ||
	    read_le32(local_header) != ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
		return NULL;
	}

	name_len = read_le16(local_header + 26);
	extra_len = read_le16(local_header + 28);
	data_offset = entry->local_header_offset + sizeof(local_header) + name_len + extra_len;

	compressed = malloc((size_t)entry->compressed_size);
	if (!compressed) {
		return NULL;
	}
	if (!read_exact_at(archive->file, data_offset, compressed, (size_t)entry->compressed_size)) {
		free(compressed);
		return NULL;
	}

	output = malloc((size_t)entry->uncompressed_size);
	if (!output) {
		free(compressed);
		return NULL;
	}

	if (entry->compression_method == ZIP_COMPRESSION_STORED) {
		if (entry->compressed_size != entry->uncompressed_size) {
			free(compressed);
			free(output);
			return NULL;
		}
		memcpy(output, compressed, (size_t)entry->uncompressed_size);
	} else if (entry->compression_method == ZIP_COMPRESSION_DEFLATED) {
		z_stream stream;
		memset(&stream, 0, sizeof(stream));
		stream.next_in = compressed;
		stream.avail_in = (uInt)entry->compressed_size;
		stream.next_out = output;
		stream.avail_out = (uInt)entry->uncompressed_size;

		if (inflateInit2(&stream, -MAX_WBITS) != Z_OK) {
			free(compressed);
			free(output);
			return NULL;
		}
		if (inflate(&stream, Z_FINISH) != Z_STREAM_END || stream.total_out != entry->uncompressed_size) {
			inflateEnd(&stream);
			free(compressed);
			free(output);
			return NULL;
		}
		inflateEnd(&stream);
	} else {
		free(compressed);
		free(output);
		return NULL;
	}

	free(compressed);
	*out_size = entry->uncompressed_size;
	return output;
}

zip_t *zip_open(const char *path, int flags, int *errorp)
{
	zip_t *archive;

	(void)flags;
	if (errorp) {
		*errorp = 0;
	}

	archive = calloc(1, sizeof(*archive));
	if (!archive) {
		return NULL;
	}

	archive->file = fopen(path, "rb");
	if (!archive->file) {
		free(archive);
		return NULL;
	}

	if (!parse_central_directory(archive)) {
		zip_close(archive);
		return NULL;
	}

	return archive;
}

int zip_close(zip_t *archive)
{
	if (!archive) {
		return 0;
	}

	if (archive->file) {
		fclose(archive->file);
	}
	free_entries(archive->entries, archive->entry_count);
	free(archive);
	return 0;
}

zip_file_t *zip_fopen(zip_t *archive, const char *filename, int flags)
{
	const WasmZipEntry *entry;
	zip_file_t *file;

	(void)flags;
	entry = find_entry(archive, filename);
	if (!entry) {
		return NULL;
	}

	file = calloc(1, sizeof(*file));
	if (!file) {
		return NULL;
	}

	file->data = read_entry_payload(archive, entry, &file->size);
	if (!file->data) {
		free(file);
		return NULL;
	}

	return file;
}

int zip_fclose(zip_file_t *file)
{
	if (!file) {
		return 0;
	}

	free(file->data);
	free(file);
	return 0;
}

zip_int64_t zip_fread(zip_file_t *file, void *buffer, zip_uint64_t nbytes)
{
	zip_uint64_t remaining;
	zip_uint64_t count;

	if (!file || !buffer) {
		return -1;
	}

	remaining = file->size - file->pos;
	count = nbytes < remaining ? nbytes : remaining;
	if (count > 0u) {
		memcpy(buffer, file->data + file->pos, (size_t)count);
		file->pos += count;
	}

	return (zip_int64_t)count;
}

int zip_stat(zip_t *archive, const char *filename, int flags, zip_stat_t *stat)
{
	const WasmZipEntry *entry;

	(void)flags;
	if (!stat) {
		return -1;
	}

	memset(stat, 0, sizeof(*stat));
	entry = find_entry(archive, filename);
	if (!entry) {
		return -1;
	}

	stat->valid = ZIP_STAT_SIZE;
	stat->size = entry->uncompressed_size;
	return 0;
}
