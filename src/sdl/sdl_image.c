/*
 * Part of Astonia Client (c) Daniel Brockhaus. Please read license.txt.
 *
 * SDL - Image Module
 *
 * PNG loading, image processing, smoothing and the sdl_make function
 * that transforms sprite data into textures with applied effects.
 */

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <SDL3/SDL.h>
#include <png.h>
#include <zip.h>

#include "dll.h"
#include "astonia.h"
#include "sdl/sdl.h"
#include "sdl/sdl_private.h"
#include "game/sprite_config.h"

// libpng custom allocator functions - use our MALLOC/FREE macros which switch between mimalloc and malloc
static png_voidp png_malloc_fn(png_structp png_ptr __attribute__((unused)), png_alloc_size_t size)
{
	return MALLOC(size);
}

static void png_free_fn(png_structp png_ptr __attribute__((unused)), png_voidp ptr)
{
	if (ptr) {
		FREE(ptr);
	}
}

uint32_t mix_argb(uint32_t c1, uint32_t c2, float w1, float w2)
{
	int r1, r2, g1, g2, b1, b2, a1, a2;
	uint32_t r, g, b, a;

	a1 = IGET_A(c1);
	a2 = IGET_A(c2);
	if (!a1 && !a2) {
		return 0; // save some work
	}

	r1 = IGET_R(c1);
	g1 = IGET_G(c1);
	b1 = IGET_B(c1);

	r2 = IGET_R(c2);
	g2 = IGET_G(c2);
	b2 = IGET_B(c2);

	a = (uint32_t)((float)a1 * w1 + (float)a2 * w2);
	r = (uint32_t)((float)r1 * w1 + (float)r2 * w2);
	g = (uint32_t)((float)g1 * w1 + (float)g2 * w2);
	b = (uint32_t)((float)b1 * w1 + (float)b2 * w2);

	if (a > 255U) {
		a = 255U;
	}
	if (r > 255U) {
		r = 255U;
	}
	if (g > 255U) {
		g = 255U;
	}
	if (b > 255U) {
		b = 255U;
	}

	return IRGBA(r, g, b, a);
}

void sdl_smoothify(uint32_t *pixel, int xres, int yres, int scale __attribute__((unused)))
{
	int x, y;
	uint32_t c1, c2, c3, c4;

	switch (scale) {
	case 2:
		for (x = 0; x < xres - 2; x += 2) {
			for (y = 0; y < yres - 2; y += 2) {
				c1 = pixel[x + y * xres]; // top left
				c2 = pixel[x + y * xres + 2]; // top right
				c3 = pixel[x + y * xres + xres * 2]; // bottom left
				c4 = pixel[x + y * xres + 2 + xres * 2]; // bottom right
#if 0 // we really only want this for wall tiles
      // don't interpolate with very transparent pixels
				if (IGET_A(c1) < 64 || IGET_A(c2) < 64 || IGET_A(c3) < 64 || IGET_A(c4) < 64) {
					continue;
				}
#endif
				pixel[x + y * xres + 1] = mix_argb(c1, c2, 0.5f, 0.5f);
				pixel[x + y * xres + xres] = mix_argb(c1, c3, 0.5f, 0.5f);
				pixel[x + y * xres + 1 + xres] =
				    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.5f, 0.5f);
			}
		}
		break;
	case 3:
		for (x = 0; x < xres - 3; x += 3) {
			for (y = 0; y < yres - 3; y += 3) {
				c1 = pixel[x + y * xres]; // top left
				c2 = pixel[x + y * xres + 3]; // top right
				c3 = pixel[x + y * xres + xres * 3]; // bottom left
				c4 = pixel[x + y * xres + 3 + xres * 3]; // bottom right
#if 0 // we really only want this for wall tiles
      // don't interpolate with very transparent pixels
				if (IGET_A(c1) < 64 || IGET_A(c2) < 64 || IGET_A(c3) < 64 || IGET_A(c4) < 64) {
					continue;
				}
#endif
				pixel[x + y * xres + 1] = mix_argb(c1, c2, 0.667f, 0.333f);
				pixel[x + y * xres + 2] = mix_argb(c1, c2, 0.333f, 0.667f);

				pixel[x + y * xres + xres * 1] = mix_argb(c1, c3, 0.667f, 0.333f);
				pixel[x + y * xres + xres * 2] = mix_argb(c1, c3, 0.333f, 0.667f);

				pixel[x + y * xres + 1 + xres * 1] =
				    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.5f, 0.5f);
				pixel[x + y * xres + 2 + xres * 1] =
				    mix_argb(mix_argb(c1, c2, 0.333f, 0.667f), mix_argb(c3, c4, 0.333f, 0.667f), 0.667f, 0.333f);
				pixel[x + y * xres + 1 + xres * 2] =
				    mix_argb(mix_argb(c1, c2, 0.667f, 0.333f), mix_argb(c3, c4, 0.667f, 0.333f), 0.333f, 0.667f);
				pixel[x + y * xres + 2 + xres * 2] =
				    mix_argb(mix_argb(c1, c2, 0.333f, 0.667f), mix_argb(c3, c4, 0.333f, 0.667f), 0.333f, 0.667f);
			}
		}
		break;

	case 4:
		for (x = 0; x < xres - 4; x += 4) {
			for (y = 0; y < yres - 4; y += 4) {
				c1 = pixel[x + y * xres]; // top left
				c2 = pixel[x + y * xres + 4]; // top right
				c3 = pixel[x + y * xres + xres * 4]; // bottom left
				c4 = pixel[x + y * xres + 4 + xres * 4]; // bottom right
#if 0 // we really only want this for wall tiles
      // don't interpolate with very transparent pixels
				if (IGET_A(c1) < 64 || IGET_A(c2) < 64 || IGET_A(c3) < 64 || IGET_A(c4) < 64) {
					continue;
				}
#endif
				pixel[x + y * xres + 1] = mix_argb(c1, c2, 0.75f, 0.25f);
				pixel[x + y * xres + 2] = mix_argb(c1, c2, 0.5f, 0.5f);
				pixel[x + y * xres + 3] = mix_argb(c1, c2, 0.25f, 0.75f);

				pixel[x + y * xres + xres * 1] = mix_argb(c1, c3, 0.75f, 0.25f);
				pixel[x + y * xres + xres * 2] = mix_argb(c1, c3, 0.5f, 0.5f);
				pixel[x + y * xres + xres * 3] = mix_argb(c1, c3, 0.25f, 0.75f);

				pixel[x + y * xres + 1 + xres * 1] =
				    mix_argb(mix_argb(c1, c2, 0.75f, 0.25f), mix_argb(c3, c4, 0.75f, 0.25f), 0.75f, 0.25f);
				pixel[x + y * xres + 1 + xres * 2] =
				    mix_argb(mix_argb(c1, c2, 0.75f, 0.25f), mix_argb(c3, c4, 0.75f, 0.25f), 0.5f, 0.5f);
				pixel[x + y * xres + 1 + xres * 3] =
				    mix_argb(mix_argb(c1, c2, 0.75f, 0.25f), mix_argb(c3, c4, 0.75f, 0.25f), 0.25f, 0.75f);

				pixel[x + y * xres + 2 + xres * 1] =
				    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.75f, 0.25f);
				pixel[x + y * xres + 2 + xres * 2] =
				    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.5f, 0.5f);
				pixel[x + y * xres + 2 + xres * 3] =
				    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.25f, 0.75f);

				pixel[x + y * xres + 3 + xres * 1] =
				    mix_argb(mix_argb(c1, c2, 0.25f, 0.75f), mix_argb(c3, c4, 0.25f, 0.75f), 0.75f, 0.25f);
				pixel[x + y * xres + 3 + xres * 2] =
				    mix_argb(mix_argb(c1, c2, 0.25f, 0.75f), mix_argb(c3, c4, 0.25f, 0.75f), 0.5f, 0.5f);
				pixel[x + y * xres + 3 + xres * 3] =
				    mix_argb(mix_argb(c1, c2, 0.25f, 0.75f), mix_argb(c3, c4, 0.25f, 0.75f), 0.25f, 0.75f);
			}
		}
		break;
	default:
		warn("Unsupported scale %d in sdl_load_image_png()", sdl_scale);
		break;
	}
}

static int sdl_budget_allows_more(uint64_t deadline_ticks, int did_work)
{
	if (deadline_ticks == 0 || !did_work) {
		return 1;
	}
	return SDL_GetTicks() < deadline_ticks;
}

struct png_helper {
	char *filename;
	zip_t *zip;
	unsigned char **row;
	int xres;
	int yres;
	int bpp;

	png_structp png_ptr;
	png_infop info_ptr;
};

void png_helper_read(png_structp ps, png_bytep buf, png_size_t len)
{
	zip_fread(png_get_io_ptr(ps), buf, len);
}

int png_load_helper(struct png_helper *p)
{
	FILE *fp = NULL;
	zip_file_t *zp = NULL;
	int tmp;

	if (p->zip) {
		zp = zip_fopen(p->zip, p->filename, 0);
		if (!zp) {
			return -1;
		}
	} else {
		fp = fopen(p->filename, "rb");
		if (!fp) {
			return -1;
		}
	}

	p->png_ptr = png_create_read_struct_2(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL, NULL, png_malloc_fn, png_free_fn);
	if (!p->png_ptr) {
		if (zp) {
			zip_fclose(zp);
		}
		if (fp) {
			fclose(fp);
		}
		warn("create read\n");
		return -1;
	}

	p->info_ptr = png_create_info_struct(p->png_ptr);
	if (!p->info_ptr) {
		if (zp) {
			zip_fclose(zp);
		}
		if (fp) {
			fclose(fp);
		}
		png_destroy_read_struct(&p->png_ptr, (png_infopp)NULL, (png_infopp)NULL);
		warn("create info1\n");
		return -1;
	}

	if (p->zip) {
		png_set_read_fn(p->png_ptr, zp, png_helper_read);
	} else {
		png_init_io(p->png_ptr, fp);
	}
	png_set_strip_16(p->png_ptr);
	png_read_png(p->png_ptr, p->info_ptr, PNG_TRANSFORM_PACKING, NULL);

	p->row = png_get_rows(p->png_ptr, p->info_ptr);
	if (!p->row) {
		if (zp) {
			zip_fclose(zp);
		}
		if (fp) {
			fclose(fp);
		}
		png_destroy_read_struct(&p->png_ptr, &p->info_ptr, (png_infopp)NULL);
		warn("read row\n");
		return -1;
	}

	p->xres = (int)png_get_image_width(p->png_ptr, p->info_ptr);
	p->yres = (int)png_get_image_height(p->png_ptr, p->info_ptr);

	tmp = (int)png_get_rowbytes(p->png_ptr, p->info_ptr);

	if (tmp == p->xres * 3) {
		p->bpp = 24;
	} else if (tmp == p->xres * 4) {
		p->bpp = 32;
	} else {
		if (zp) {
			zip_fclose(zp);
		}
		if (fp) {
			fclose(fp);
		}
		png_destroy_read_struct(&p->png_ptr, &p->info_ptr, (png_infopp)NULL);
		warn("rowbytes!=xres*4 (%d, %d, %s)", tmp, p->xres, p->filename);
		return -1;
	}

	if (png_get_bit_depth(p->png_ptr, p->info_ptr) != 8) {
		if (zp) {
			zip_fclose(zp);
		}
		if (fp) {
			fclose(fp);
		}
		png_destroy_read_struct(&p->png_ptr, &p->info_ptr, (png_infopp)NULL);
		warn("bit depth!=8\n");
		return -1;
	}
	if (png_get_channels(p->png_ptr, p->info_ptr) != p->bpp / 8) {
		if (zp) {
			zip_fclose(zp);
		}
		if (fp) {
			fclose(fp);
		}
		png_destroy_read_struct(&p->png_ptr, &p->info_ptr, (png_infopp)NULL);
		warn("channels!=format\n");
		return -1;
	}

	if (p->zip) {
		zip_fclose(zp);
	} else {
		fclose(fp);
	}

	return 0;
}

void png_load_helper_exit(struct png_helper *p)
{
	png_destroy_read_struct(&p->png_ptr, &p->info_ptr, (png_infopp)NULL);
}

// Load high res PNG
int sdl_load_image_png_(struct sdl_image *si, char *filename, zip_t *zip)
{
	int x, y, r, g, b, a, sx, sy, ex, ey;
	uint32_t c;
	struct png_helper p;

	p.zip = zip;
	p.filename = filename;
	if (png_load_helper(&p)) {
		return -1;
	}

	// prescan
	sx = p.xres;
	sy = p.yres;
	ex = 0;
	ey = 0;

	for (y = 0; y < p.yres; y++) {
		for (x = 0; x < p.xres; x++) {
			if (p.bpp == 32 && (p.row[y][x * 4 + 3] == 0 || (p.row[y][x * 4 + 0] == 255 && p.row[y][x * 4 + 1] == 0 &&
			                                                    p.row[y][x * 4 + 2] == 255))) {
				continue;
			}
			if (p.bpp == 24 && (p.row[y][x * 3 + 0] == 255 && p.row[y][x * 3 + 1] == 0 && p.row[y][x * 3 + 2] == 255)) {
				continue;
			}
			if (x < sx) {
				sx = x;
			}
			if (x > ex) {
				ex = x;
			}
			if (y < sy) {
				sy = y;
			}
			if (y > ey) {
				ey = y;
			}
		}
	}

	// Make sure the new found borders of the image are on multiples
	// of sd_scale. And never shrink the visible portion to do that.
	sx = (sx / sdl_scale) * sdl_scale;
	sy = (sy / sdl_scale) * sdl_scale;
	ex = ((ex + sdl_scale) / sdl_scale) * sdl_scale;
	ey = ((ey + sdl_scale) / sdl_scale) * sdl_scale;

	if (ex < sx) {
		ex = sx - 1;
	}
	if (ey < sy) {
		ey = sy - 1;
	}

	// write
	si->flags = 1;
	si->xres = (uint16_t)(ex - sx);
	si->yres = (uint16_t)(ey - sy);
	si->xoff = (int16_t)(-(p.xres / 2) + sx);
	si->yoff = (int16_t)(-(p.yres / 2) + sy);

#ifdef SDL_FAST_MALLOC
	si->pixel = MALLOC((size_t)si->xres * si->yres * sizeof(uint32_t));
#else
	si->pixel = xmalloc((size_t)si->xres * si->yres * sizeof(uint32_t), MEM_SDL_PNG);
#endif
	extern long long mem_png;
	__atomic_add_fetch(&mem_png, (long long)((size_t)si->xres * si->yres * sizeof(uint32_t)), __ATOMIC_RELAXED);

	for (y = 0; y < si->yres; y++) {
		for (x = 0; x < si->xres; x++) {
			if (p.bpp == 32) {
				if (sx + x >= p.xres || sy + y >= p.yres) {
					r = g = b = a = 0;
				} else {
					r = p.row[(sy + y)][(sx + x) * 4 + 0];
					g = p.row[(sy + y)][(sx + x) * 4 + 1];
					b = p.row[(sy + y)][(sx + x) * 4 + 2];
					a = p.row[(sy + y)][(sx + x) * 4 + 3];
				}
			} else {
				if (sx + x >= p.xres || sy + y >= p.yres) {
					r = g = b = a = 0;
				} else {
					r = p.row[(sy + y)][(sx + x) * 3 + 0];
					g = p.row[(sy + y)][(sx + x) * 3 + 1];
					b = p.row[(sy + y)][(sx + x) * 3 + 2];
					if (r == 255 && g == 0 && b == 255) {
						a = 0;
					} else {
						a = 255;
					}
				}
			}

			if (r == 255 && g == 0 && b == 255) {
				a = 0;
			}

			if (!a) {
				r = g = b = 0;
			}

			c = IRGBA(r, g, b, a);

			si->pixel[x + y * si->xres] = c;
		}
	}

	png_load_helper_exit(&p);

	si->xres /= sdl_scale;
	si->yres /= sdl_scale;
	si->xoff /= sdl_scale;
	si->yoff /= sdl_scale;

	return 0;
}

// Load and up-scale low res PNG
// TODO: add support for using a 2X image as a base for 4X
// and possibly the other way around too
int sdl_load_image_png(struct sdl_image *si, char *filename, zip_t *zip, int smoothify)
{
	int x, y, r, g, b, a, sx, sy, ex, ey;
	uint32_t c;
	struct png_helper p;

	p.zip = zip;
	p.filename = filename;
	if (png_load_helper(&p)) {
		return -1;
	}

	// prescan
	sx = p.xres;
	sy = p.yres;
	ex = 0;
	ey = 0;

	for (y = 0; y < p.yres; y++) {
		for (x = 0; x < p.xres; x++) {
			if (p.bpp == 32 && (p.row[y][x * 4 + 3] == 0 || (p.row[y][x * 4 + 0] == 255 && p.row[y][x * 4 + 1] == 0 &&
			                                                    p.row[y][x * 4 + 2] == 255))) {
				continue;
			}
			if (p.bpp == 24 && (p.row[y][x * 3 + 0] == 255 && p.row[y][x * 3 + 1] == 0 && p.row[y][x * 3 + 2] == 255)) {
				continue;
			}
			if (x < sx) {
				sx = x;
			}
			if (x > ex) {
				ex = x;
			}
			if (y < sy) {
				sy = y;
			}
			if (y > ey) {
				ey = y;
			}
		}
	}

	if (ex < sx) {
		ex = sx - 1;
	}
	if (ey < sy) {
		ey = sy - 1;
	}

	// write
	si->flags = 1;
	si->xres = (uint16_t)(ex - sx + 1);
	si->yres = (uint16_t)(ey - sy + 1);
	si->xoff = (int16_t)(-(p.xres / 2) + sx);
	si->yoff = (int16_t)(-(p.yres / 2) + sy);

#ifdef SDL_FAST_MALLOC
	si->pixel = MALLOC((size_t)si->xres * si->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale);
#else
	si->pixel =
	    xmalloc((size_t)si->xres * si->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale, MEM_SDL_PNG);
#endif
	extern long long mem_png;
	__atomic_add_fetch(&mem_png,
	    (long long)((size_t)si->xres * (size_t)si->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale),
	    __ATOMIC_RELAXED);

	for (y = 0; y < si->yres; y++) {
		for (x = 0; x < si->xres; x++) {
			if (p.bpp == 32) {
				r = p.row[(sy + y)][(sx + x) * 4 + 0];
				g = p.row[(sy + y)][(sx + x) * 4 + 1];
				b = p.row[(sy + y)][(sx + x) * 4 + 2];
				a = p.row[(sy + y)][(sx + x) * 4 + 3];
			} else {
				r = p.row[(sy + y)][(sx + x) * 3 + 0];
				g = p.row[(sy + y)][(sx + x) * 3 + 1];
				b = p.row[(sy + y)][(sx + x) * 3 + 2];
				if (r == 255 && g == 0 && b == 255) {
					a = 0;
				} else {
					a = 255;
				}
			}

			if (r == 255 && g == 0 && b == 255) {
				a = 0;
			}

			if (!a) {
				r = g = b = 0;
			}

			c = IRGBA(r, g, b, a);

			switch (sdl_scale) {
			case 1:
				si->pixel[x + y * si->xres] = c;
				break;
			case 2:
				si->pixel[x * 2 + y * si->xres * 4] = c;
				si->pixel[x * 2 + y * si->xres * 4 + 1] = c;
				si->pixel[x * 2 + y * si->xres * 4 + si->xres * 2] = c;
				si->pixel[x * 2 + y * si->xres * 4 + 1 + si->xres * 2] = c;
				break;
			case 3:
				si->pixel[x * 3 + y * si->xres * 9 + 0] = c;
				si->pixel[x * 3 + y * si->xres * 9 + 0 + si->xres * 3] = c;
				si->pixel[x * 3 + y * si->xres * 9 + 0 + si->xres * 6] = c;

				si->pixel[x * 3 + y * si->xres * 9 + 1] = c;
				si->pixel[x * 3 + y * si->xres * 9 + 1 + si->xres * 3] = c;
				si->pixel[x * 3 + y * si->xres * 9 + 1 + si->xres * 6] = c;

				si->pixel[x * 3 + y * si->xres * 9 + 2] = c;
				si->pixel[x * 3 + y * si->xres * 9 + 2 + si->xres * 3] = c;
				si->pixel[x * 3 + y * si->xres * 9 + 2 + si->xres * 6] = c;
				break;
			case 4:
				si->pixel[x * 4 + y * si->xres * 16 + 0] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 0 + si->xres * 4] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 0 + si->xres * 8] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 0 + si->xres * 12] = c;

				si->pixel[x * 4 + y * si->xres * 16 + 1] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 1 + si->xres * 4] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 1 + si->xres * 8] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 1 + si->xres * 12] = c;

				si->pixel[x * 4 + y * si->xres * 16 + 2] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 2 + si->xres * 4] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 2 + si->xres * 8] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 2 + si->xres * 12] = c;

				si->pixel[x * 4 + y * si->xres * 16 + 3] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 3 + si->xres * 4] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 3 + si->xres * 8] = c;
				si->pixel[x * 4 + y * si->xres * 16 + 3 + si->xres * 12] = c;
				break;
			default:
				warn("Unsupported scale %d in sdl_load_image_png()", sdl_scale);
				break;
			}
		}
	}

	if (sdl_scale > 1 && smoothify) {
		sdl_smoothify(si->pixel, si->xres * sdl_scale, si->yres * sdl_scale, sdl_scale);
	}

	png_load_helper_exit(&p);
	return 0;
}

int do_smoothify(int sprite)
{
	if (sprite <= 0) {
		return 0;
	}

	int result = sprite_config_do_smoothify((unsigned int)sprite);
	if (result >= 0) {
		return result;
	}

	return 0; /* Default: no smoothing */
}

int sdl_load_image(struct sdl_image *si, int sprite, struct zip_handles *zips)
{
	char filename[1024];
	zip_t *zip1, *zip1p, *zip1m, *zip2, *zip2p, *zip2m;

	if (zips) {
		zip1 = zips->zip1;
		zip1p = zips->zip1p;
		zip1m = zips->zip1m;
		zip2 = zips->zip2;
		zip2p = zips->zip2p;
		zip2m = zips->zip2m;
	} else {
		extern zip_t *sdl_zip1, *sdl_zip2, *sdl_zip1p, *sdl_zip2p, *sdl_zip1m, *sdl_zip2m;
		zip1 = sdl_zip1;
		zip1p = sdl_zip1p;
		zip1m = sdl_zip1m;
		zip2 = sdl_zip2;
		zip2p = sdl_zip2p;
		zip2m = sdl_zip2m;
	}

	if (sprite >= MAXSPRITE || sprite < 0) {
		note("sdl_load_image: illegal sprite %d wanted", sprite);
		return -1;
	}

#if 0
	// get patch png
	sprintf(filename,"../gfxp/x%d/%08d/%08d.png",sdl_scale,(sprite/1000)*1000,sprite);
	if (sdl_load_image_png_(si,filename,NULL)==0) return 0;
#endif

	// get high res from archive
	if (zip2 || zip2p || zip2m) {
		sprintf(filename, "%08d.png", sprite);
		if (zip2m && sdl_load_image_png_(si, filename, zip2m) == 0) {
			return 0; // check mod archive first
		}
		if (zip2p && sdl_load_image_png_(si, filename, zip2p) == 0) {
			return 0; // check patch archive second
		}
		if (zip2 && sdl_load_image_png_(si, filename, zip2) == 0) {
			return 0; // check base archive third
		}
	}

#if 0
	// get high res from base png folder
	sprintf(filename,"../gfx/x%d/%08d/%08d.png",sdl_scale,(sprite/1000)*1000,sprite);
	if (sdl_load_image_png_(si,filename,NULL)==0) return 0;
#endif

	// get standard from archive
	if (zip1 || zip1p || zip1m) {
		sprintf(filename, "%08d.png", sprite);
		if (zip1m && sdl_load_image_png(si, filename, zip1m, do_smoothify(sprite)) == 0) {
			return 0;
		}
		if (zip1p && sdl_load_image_png(si, filename, zip1p, do_smoothify(sprite)) == 0) {
			return 0;
		}
		if (zip1 && sdl_load_image_png(si, filename, zip1, do_smoothify(sprite)) == 0) {
			return 0;
		}
	}

#if 0
	// get standard from base png folder
	sprintf(filename,"../gfx/x1/%08d/%08d.png",(sprite/1000)*1000,sprite);
	if (sdl_load_image_png(si,filename,NULL,do_smoothify(sprite))==0) return 0;
	sprintf(filename,"../gfxp/x1/%08d/%08d.png",(sprite/1000)*1000,sprite);
	if (sdl_load_image_png(si,filename,NULL,do_smoothify(sprite))==0) return 0;
#endif

	sprintf(filename, "%08d.png", sprite);
	warn("%s not found", filename);

	// get unknown sprite image
	sprintf(filename, "%08d.png", 2);
	if (zip1 && sdl_load_image_png(si, filename, zip1, do_smoothify(sprite)) == 0) {
		return 0;
	}

	char *txt = "The client could not locate the graphics file gx1.zip. "
	            "Please make sure you start the client from the main folder, "
	            "not from within the bin-folder.\n\n"
	            "You can create a shortcut with the working directory set to the main folder.";
	display_messagebox("Graphics Not Found", txt);
	exit(105);
	return -1;
}

typedef enum sdl_async_png_phase {
	SDL_ASYNC_PNG_IDLE = 0,
	SDL_ASYNC_PNG_READ_ROWS,
	SDL_ASYNC_PNG_COPY_ROWS,
	SDL_ASYNC_PNG_SMOOTHIFY,
	SDL_ASYNC_PNG_DONE,
	SDL_ASYNC_PNG_FAILED,
} SdlAsyncPngPhase;

typedef struct sdl_async_png_work {
	SdlAsyncPngPhase phase;
	unsigned int sprite;
	int attempt;
	int high_res;
	int smoothify;
	int xres;
	int yres;
	int bpp;
	int rowbytes;
	int sx;
	int sy;
	int ex;
	int ey;
	int row_y;
	int smooth_x;
	int smooth_y;
	char filename[64];
	zip_t *zip;
	zip_file_t *zp;
	png_structp png_ptr;
	png_infop info_ptr;
	png_bytep row_buf;
	uint32_t *full_pixel;
	struct sdl_image *si;
} SdlAsyncPngWork;

static SdlAsyncPngWork g_async_png_work;

static void sdl_async_png_cleanup(SdlAsyncPngWork *work)
{
	if (work->png_ptr || work->info_ptr) {
		png_destroy_read_struct(&work->png_ptr, &work->info_ptr, (png_infopp)NULL);
	}
	if (work->zp) {
		zip_fclose(work->zp);
	}
	if (work->row_buf) {
		FREE(work->row_buf);
	}
	if (work->full_pixel) {
		FREE(work->full_pixel);
	}
	memset(work, 0, sizeof(*work));
}

static int sdl_async_png_source_pixel(const SdlAsyncPngWork *work, int x, int y, int *r, int *g, int *b, int *a)
{
	uint32_t c;

	if (x < 0 || y < 0 || x >= work->xres || y >= work->yres) {
		*r = 0;
		*g = 0;
		*b = 0;
		*a = 0;
		return 0;
	}

	c = work->full_pixel[x + y * work->xres];
	*r = (int)IGET_R(c);
	*g = (int)IGET_G(c);
	*b = (int)IGET_B(c);
	*a = (int)IGET_A(c);
	return 1;
}

static void sdl_async_png_decode_row(SdlAsyncPngWork *work)
{
	for (int x = 0; x < work->xres; x++) {
		int r, g, b, a;
		uint32_t c;

		if (work->bpp == 32) {
			r = work->row_buf[x * 4 + 0];
			g = work->row_buf[x * 4 + 1];
			b = work->row_buf[x * 4 + 2];
			a = work->row_buf[x * 4 + 3];
		} else {
			r = work->row_buf[x * 3 + 0];
			g = work->row_buf[x * 3 + 1];
			b = work->row_buf[x * 3 + 2];
			a = (r == 255 && g == 0 && b == 255) ? 0 : 255;
		}

		if (r == 255 && g == 0 && b == 255) {
			a = 0;
		}
		if (!a) {
			r = 0;
			g = 0;
			b = 0;
		}

		c = IRGBA(r, g, b, a);
		work->full_pixel[x + work->row_y * work->xres] = c;
		if (a) {
			if (x < work->sx) {
				work->sx = x;
			}
			if (x > work->ex) {
				work->ex = x;
			}
			if (work->row_y < work->sy) {
				work->sy = work->row_y;
			}
			if (work->row_y > work->ey) {
				work->ey = work->row_y;
			}
		}
	}
}

static int sdl_async_png_start(SdlAsyncPngWork *work, struct sdl_image *si, unsigned int sprite, const char *filename,
    zip_t *zip, int high_res, int smoothify)
{
	int tmp;

	memset(work, 0, sizeof(*work));
	work->phase = SDL_ASYNC_PNG_READ_ROWS;
	work->sprite = sprite;
	work->zip = zip;
	work->high_res = high_res;
	work->smoothify = smoothify;
	work->si = si;
	snprintf(work->filename, sizeof(work->filename), "%s", filename);

	work->zp = zip_fopen(zip, work->filename, 0);
	if (!work->zp) {
		sdl_async_png_cleanup(work);
		return -1;
	}

	work->png_ptr = png_create_read_struct_2(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL, NULL, png_malloc_fn, png_free_fn);
	if (!work->png_ptr) {
		sdl_async_png_cleanup(work);
		return -1;
	}
	work->info_ptr = png_create_info_struct(work->png_ptr);
	if (!work->info_ptr) {
		sdl_async_png_cleanup(work);
		return -1;
	}
	if (setjmp(png_jmpbuf(work->png_ptr))) {
		sdl_async_png_cleanup(work);
		return -1;
	}

	png_set_read_fn(work->png_ptr, work->zp, png_helper_read);
	png_set_strip_16(work->png_ptr);
	png_set_packing(work->png_ptr);
	png_read_info(work->png_ptr, work->info_ptr);
	png_read_update_info(work->png_ptr, work->info_ptr);

	work->xres = (int)png_get_image_width(work->png_ptr, work->info_ptr);
	work->yres = (int)png_get_image_height(work->png_ptr, work->info_ptr);
	tmp = (int)png_get_rowbytes(work->png_ptr, work->info_ptr);
	if (tmp == work->xres * 3) {
		work->bpp = 24;
	} else if (tmp == work->xres * 4) {
		work->bpp = 32;
	} else {
		warn("rowbytes!=xres*4 (%d, %d, %s)", tmp, work->xres, work->filename);
		sdl_async_png_cleanup(work);
		return -1;
	}
	if (png_get_bit_depth(work->png_ptr, work->info_ptr) != 8 ||
	    png_get_channels(work->png_ptr, work->info_ptr) != work->bpp / 8) {
		warn("unsupported PNG format in %s", work->filename);
		sdl_async_png_cleanup(work);
		return -1;
	}

	work->rowbytes = tmp;
	work->row_buf = MALLOC((size_t)work->rowbytes);
	work->full_pixel = MALLOC((size_t)work->xres * (size_t)work->yres * sizeof(uint32_t));
	if (!work->row_buf || !work->full_pixel) {
		sdl_async_png_cleanup(work);
		return -1;
	}
	work->sx = work->xres;
	work->sy = work->yres;
	work->ex = 0;
	work->ey = 0;
	work->row_y = 0;
	return 0;
}

static void sdl_async_png_finalize_bounds(SdlAsyncPngWork *work)
{
	struct sdl_image *si = work->si;

	if (work->high_res) {
		work->sx = (work->sx / sdl_scale) * sdl_scale;
		work->sy = (work->sy / sdl_scale) * sdl_scale;
		work->ex = ((work->ex + sdl_scale) / sdl_scale) * sdl_scale;
		work->ey = ((work->ey + sdl_scale) / sdl_scale) * sdl_scale;
		if (work->ex < work->sx) {
			work->ex = work->sx - 1;
		}
		if (work->ey < work->sy) {
			work->ey = work->sy - 1;
		}

		si->xres = (uint16_t)(work->ex - work->sx);
		si->yres = (uint16_t)(work->ey - work->sy);
	} else {
		if (work->ex < work->sx) {
			work->ex = work->sx - 1;
		}
		if (work->ey < work->sy) {
			work->ey = work->sy - 1;
		}
		si->xres = (uint16_t)(work->ex - work->sx + 1);
		si->yres = (uint16_t)(work->ey - work->sy + 1);
	}

	si->flags = 1;
	si->xoff = (int16_t)(-(work->xres / 2) + work->sx);
	si->yoff = (int16_t)(-(work->yres / 2) + work->sy);

#ifdef SDL_FAST_MALLOC
	si->pixel = MALLOC((size_t)si->xres * (size_t)si->yres * sizeof(uint32_t) *
	                   (work->high_res ? 1u : (size_t)sdl_scale * (size_t)sdl_scale));
#else
	si->pixel = xmalloc((size_t)si->xres * (size_t)si->yres * sizeof(uint32_t) *
	                        (work->high_res ? 1u : (size_t)sdl_scale * (size_t)sdl_scale),
	    MEM_SDL_PNG);
#endif
	extern long long mem_png;
	__atomic_add_fetch(&mem_png,
	    (long long)((size_t)si->xres * (size_t)si->yres * sizeof(uint32_t) *
	                (work->high_res ? 1u : (size_t)sdl_scale * (size_t)sdl_scale)),
	    __ATOMIC_RELAXED);
	work->row_y = 0;
}

static void sdl_async_png_copy_row(SdlAsyncPngWork *work)
{
	struct sdl_image *si = work->si;
	int r, g, b, a;
	uint32_t c;

	if (work->high_res) {
		for (int x = 0; x < si->xres; x++) {
			(void)sdl_async_png_source_pixel(work, work->sx + x, work->sy + work->row_y, &r, &g, &b, &a);
			c = IRGBA(r, g, b, a);
			si->pixel[x + work->row_y * si->xres] = c;
		}
		return;
	}

	for (int x = 0; x < si->xres; x++) {
		(void)sdl_async_png_source_pixel(work, work->sx + x, work->sy + work->row_y, &r, &g, &b, &a);
		c = IRGBA(r, g, b, a);

		switch (sdl_scale) {
		case 1:
			si->pixel[x + work->row_y * si->xres] = c;
			break;
		case 2:
			si->pixel[x * 2 + work->row_y * si->xres * 4] = c;
			si->pixel[x * 2 + work->row_y * si->xres * 4 + 1] = c;
			si->pixel[x * 2 + work->row_y * si->xres * 4 + si->xres * 2] = c;
			si->pixel[x * 2 + work->row_y * si->xres * 4 + 1 + si->xres * 2] = c;
			break;
		case 3:
			for (int yy = 0; yy < 3; yy++) {
				for (int xx = 0; xx < 3; xx++) {
					si->pixel[x * 3 + xx + work->row_y * si->xres * 9 + yy * si->xres * 3] = c;
				}
			}
			break;
		case 4:
			for (int yy = 0; yy < 4; yy++) {
				for (int xx = 0; xx < 4; xx++) {
					si->pixel[x * 4 + xx + work->row_y * si->xres * 16 + yy * si->xres * 4] = c;
				}
			}
			break;
		default:
			warn("Unsupported scale %d in sdl_load_image_png()", sdl_scale);
			break;
		}
	}
}

static void sdl_async_smoothify_block(uint32_t *pixel, int xres, int yres, int scale, int x, int y)
{
	uint32_t c1, c2, c3, c4;

	if (x >= xres - scale || y >= yres - scale) {
		return;
	}

	c1 = pixel[x + y * xres];
	c2 = pixel[x + y * xres + scale];
	c3 = pixel[x + y * xres + xres * scale];
	c4 = pixel[x + y * xres + scale + xres * scale];
	switch (scale) {
	case 2:
		pixel[x + y * xres + 1] = mix_argb(c1, c2, 0.5f, 0.5f);
		pixel[x + y * xres + xres] = mix_argb(c1, c3, 0.5f, 0.5f);
		pixel[x + y * xres + 1 + xres] =
		    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.5f, 0.5f);
		break;
	case 3:
		pixel[x + y * xres + 1] = mix_argb(c1, c2, 0.667f, 0.333f);
		pixel[x + y * xres + 2] = mix_argb(c1, c2, 0.333f, 0.667f);
		pixel[x + y * xres + xres * 1] = mix_argb(c1, c3, 0.667f, 0.333f);
		pixel[x + y * xres + xres * 2] = mix_argb(c1, c3, 0.333f, 0.667f);
		pixel[x + y * xres + 1 + xres * 1] =
		    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.5f, 0.5f);
		pixel[x + y * xres + 2 + xres * 1] =
		    mix_argb(mix_argb(c1, c2, 0.333f, 0.667f), mix_argb(c3, c4, 0.333f, 0.667f), 0.667f, 0.333f);
		pixel[x + y * xres + 1 + xres * 2] =
		    mix_argb(mix_argb(c1, c2, 0.667f, 0.333f), mix_argb(c3, c4, 0.667f, 0.333f), 0.333f, 0.667f);
		pixel[x + y * xres + 2 + xres * 2] =
		    mix_argb(mix_argb(c1, c2, 0.333f, 0.667f), mix_argb(c3, c4, 0.333f, 0.667f), 0.333f, 0.667f);
		break;
	case 4:
		pixel[x + y * xres + 1] = mix_argb(c1, c2, 0.75f, 0.25f);
		pixel[x + y * xres + 2] = mix_argb(c1, c2, 0.5f, 0.5f);
		pixel[x + y * xres + 3] = mix_argb(c1, c2, 0.25f, 0.75f);
		pixel[x + y * xres + xres * 1] = mix_argb(c1, c3, 0.75f, 0.25f);
		pixel[x + y * xres + xres * 2] = mix_argb(c1, c3, 0.5f, 0.5f);
		pixel[x + y * xres + xres * 3] = mix_argb(c1, c3, 0.25f, 0.75f);
		pixel[x + y * xres + 1 + xres * 1] =
		    mix_argb(mix_argb(c1, c2, 0.75f, 0.25f), mix_argb(c3, c4, 0.75f, 0.25f), 0.75f, 0.25f);
		pixel[x + y * xres + 1 + xres * 2] =
		    mix_argb(mix_argb(c1, c2, 0.75f, 0.25f), mix_argb(c3, c4, 0.75f, 0.25f), 0.5f, 0.5f);
		pixel[x + y * xres + 1 + xres * 3] =
		    mix_argb(mix_argb(c1, c2, 0.75f, 0.25f), mix_argb(c3, c4, 0.75f, 0.25f), 0.25f, 0.75f);
		pixel[x + y * xres + 2 + xres * 1] =
		    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.75f, 0.25f);
		pixel[x + y * xres + 2 + xres * 2] =
		    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.5f, 0.5f);
		pixel[x + y * xres + 2 + xres * 3] =
		    mix_argb(mix_argb(c1, c2, 0.5f, 0.5f), mix_argb(c3, c4, 0.5f, 0.5f), 0.25f, 0.75f);
		pixel[x + y * xres + 3 + xres * 1] =
		    mix_argb(mix_argb(c1, c2, 0.25f, 0.75f), mix_argb(c3, c4, 0.25f, 0.75f), 0.75f, 0.25f);
		pixel[x + y * xres + 3 + xres * 2] =
		    mix_argb(mix_argb(c1, c2, 0.25f, 0.75f), mix_argb(c3, c4, 0.25f, 0.75f), 0.5f, 0.5f);
		pixel[x + y * xres + 3 + xres * 3] =
		    mix_argb(mix_argb(c1, c2, 0.25f, 0.75f), mix_argb(c3, c4, 0.25f, 0.75f), 0.25f, 0.75f);
		break;
	default:
		break;
	}
}

static int sdl_async_png_step(SdlAsyncPngWork *work, uint64_t deadline_ticks)
{
	int did_work = 0;

	if (work->phase == SDL_ASYNC_PNG_READ_ROWS && work->png_ptr && setjmp(png_jmpbuf(work->png_ptr))) {
		work->phase = SDL_ASYNC_PNG_FAILED;
		return -1;
	}

	while (sdl_budget_allows_more(deadline_ticks, did_work)) {
		if (work->phase == SDL_ASYNC_PNG_READ_ROWS) {
			if (work->row_y < work->yres) {
				png_read_row(work->png_ptr, work->row_buf, NULL);
				sdl_async_png_decode_row(work);
				work->row_y++;
				did_work = 1;
				continue;
			}
			png_read_end(work->png_ptr, work->info_ptr);
			png_destroy_read_struct(&work->png_ptr, &work->info_ptr, (png_infopp)NULL);
			if (work->zp) {
				zip_fclose(work->zp);
				work->zp = NULL;
			}
			if (work->row_buf) {
				FREE(work->row_buf);
				work->row_buf = NULL;
			}
			sdl_async_png_finalize_bounds(work);
			work->phase = SDL_ASYNC_PNG_COPY_ROWS;
			did_work = 1;
			continue;
		}

		if (work->phase == SDL_ASYNC_PNG_COPY_ROWS) {
			if (work->row_y < work->si->yres) {
				sdl_async_png_copy_row(work);
				work->row_y++;
				did_work = 1;
				continue;
			}
			if (work->high_res) {
				work->si->xres /= sdl_scale;
				work->si->yres /= sdl_scale;
				work->si->xoff /= sdl_scale;
				work->si->yoff /= sdl_scale;
			}
			if (work->full_pixel) {
				FREE(work->full_pixel);
				work->full_pixel = NULL;
			}
			work->smooth_x = 0;
			work->smooth_y = 0;
			work->phase = (!work->high_res && sdl_scale > 1 && work->smoothify) ? SDL_ASYNC_PNG_SMOOTHIFY : SDL_ASYNC_PNG_DONE;
			did_work = 1;
			continue;
		}

		if (work->phase == SDL_ASYNC_PNG_SMOOTHIFY) {
			int scaled_xres = work->si->xres * sdl_scale;
			int scaled_yres = work->si->yres * sdl_scale;
			if (work->smooth_x < scaled_xres - sdl_scale && work->smooth_y < scaled_yres - sdl_scale) {
				sdl_async_smoothify_block(
				    work->si->pixel, scaled_xres, scaled_yres, sdl_scale, work->smooth_x, work->smooth_y);
				work->smooth_y += sdl_scale;
				if (work->smooth_y >= scaled_yres - sdl_scale) {
					work->smooth_y = 0;
					work->smooth_x += sdl_scale;
				}
				did_work = 1;
				continue;
			}
			work->phase = SDL_ASYNC_PNG_DONE;
			did_work = 1;
			continue;
		}

		break;
	}

	return work->phase == SDL_ASYNC_PNG_DONE ? 1 : 0;
}

static zip_t *sdl_async_attempt_zip(const struct zip_handles *zips, int attempt)
{
	switch (attempt) {
	case 0:
		return zips->zip2m;
	case 1:
		return zips->zip2p;
	case 2:
		return zips->zip2;
	case 3:
		return zips->zip1m;
	case 4:
		return zips->zip1p;
	case 5:
	case 6:
		return zips->zip1;
	default:
		return NULL;
	}
}

static int sdl_async_attempt_high_res(int attempt)
{
	return attempt >= 0 && attempt <= 2;
}

static unsigned int sdl_async_attempt_sprite(unsigned int sprite, int attempt)
{
	return attempt == 6 ? 2u : sprite;
}

int sdl_ic_load_frame_budget_step(unsigned int sprite, struct zip_handles *zips, uint64_t deadline_ticks)
{
	struct zip_handles globals;
	struct sdl_image *si;
	int state;

	if (sprite >= MAXSPRITE) {
		note("illegal sprite %d wanted in sdl_ic_load_frame_budget_step", sprite);
		return -1;
	}

	if (!zips) {
		extern zip_t *sdl_zip1, *sdl_zip2, *sdl_zip1p, *sdl_zip2p, *sdl_zip1m, *sdl_zip2m;
		globals.zip1 = sdl_zip1;
		globals.zip1p = sdl_zip1p;
		globals.zip1m = sdl_zip1m;
		globals.zip2 = sdl_zip2;
		globals.zip2p = sdl_zip2p;
		globals.zip2m = sdl_zip2m;
		zips = &globals;
	}

	enum {
		IMG_UNLOADED = 0,
		IMG_LOADING = 1,
		IMG_READY = 2,
		IMG_FAILED = 3,
	};

	state = __atomic_load_n((int *)&sdli_state[sprite], __ATOMIC_ACQUIRE);
	if (state == IMG_READY) {
		return (int)sprite;
	}
	if (state == IMG_FAILED) {
		return -1;
	}
	if (state == IMG_LOADING && g_async_png_work.phase != SDL_ASYNC_PNG_IDLE && g_async_png_work.sprite != sprite) {
		return SDL_IMAGE_LOAD_BUSY;
	}
	if (state == IMG_UNLOADED) {
		int expected = IMG_UNLOADED;
		if (!__atomic_compare_exchange_n(
		        (int *)&sdli_state[sprite], &expected, IMG_LOADING, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
			return SDL_IMAGE_LOAD_BUSY;
		}
	}

	si = sdli + sprite;
	if (g_async_png_work.phase == SDL_ASYNC_PNG_IDLE) {
		memset(&g_async_png_work, 0, sizeof(g_async_png_work));
		g_async_png_work.phase = SDL_ASYNC_PNG_FAILED;
		g_async_png_work.sprite = sprite;
		g_async_png_work.attempt = 0;
	}

	while (g_async_png_work.attempt <= 6) {
		zip_t *zip;
		unsigned int attempt_sprite;
		char filename[64];
		int high_res;

		if (g_async_png_work.phase == SDL_ASYNC_PNG_READ_ROWS || g_async_png_work.phase == SDL_ASYNC_PNG_COPY_ROWS ||
		    g_async_png_work.phase == SDL_ASYNC_PNG_SMOOTHIFY) {
			int failed_attempt = g_async_png_work.attempt;
			int step = sdl_async_png_step(&g_async_png_work, deadline_ticks);
			if (step > 0) {
				__atomic_store_n((int *)&sdli_state[sprite], IMG_READY, __ATOMIC_RELEASE);
				memset(&g_async_png_work, 0, sizeof(g_async_png_work));
				return (int)sprite;
			}
			if (step < 0) {
				sdl_async_png_cleanup(&g_async_png_work);
				g_async_png_work.phase = SDL_ASYNC_PNG_FAILED;
				g_async_png_work.sprite = sprite;
				g_async_png_work.attempt = failed_attempt + 1;
			} else {
				return SDL_IMAGE_LOAD_BUSY;
			}
		}

		int attempt = g_async_png_work.attempt;
		zip = sdl_async_attempt_zip(zips, attempt);
		if (!zip) {
			g_async_png_work.attempt++;
			continue;
		}

		attempt_sprite = sdl_async_attempt_sprite(sprite, attempt);
		snprintf(filename, sizeof(filename), "%08u.png", attempt_sprite);
		high_res = sdl_async_attempt_high_res(attempt);
		if (attempt == 6) {
			warn("%08u.png not found", sprite);
		}
		if (sdl_async_png_start(&g_async_png_work, si, sprite, filename, zip, high_res,
		        high_res ? 0 : do_smoothify((int)sprite)) == 0) {
			g_async_png_work.attempt = attempt;
			return SDL_IMAGE_LOAD_BUSY;
		}
		g_async_png_work.phase = SDL_ASYNC_PNG_FAILED;
		g_async_png_work.sprite = sprite;
		g_async_png_work.attempt = attempt + 1;
	}

	sdl_async_png_cleanup(&g_async_png_work);
	__atomic_store_n((int *)&sdli_state[sprite], IMG_FAILED, __ATOMIC_RELEASE);
	return -1;
}

int sdl_ic_load(unsigned int sprite, struct zip_handles *zips)
{
#ifdef DEVELOPER
	uint64_t start = SDL_GetTicks();
#endif

	if (sprite >= MAXSPRITE) {
		note("illegal sprite %d wanted in sdl_ic_load", sprite);
		return -1;
	}

	// sdli_state is in sdl_core.c, we need to access it
	// For now, we'll use a helper function or make it extern
	extern int *sdli_state; // declared in sdl_core.c

	enum {
		IMG_UNLOADED = 0,
		IMG_LOADING = 1,
		IMG_READY = 2,
		IMG_FAILED = 3,
	};

	int state;
retry:
	state = __atomic_load_n((int *)&sdli_state[sprite], __ATOMIC_ACQUIRE);

	if (state == IMG_READY) {
#ifdef DEVELOPER
		extern long long sdl_time_load;
		sdl_time_load += SDL_GetTicks() - start;
#endif
		return (int)sprite;
	}

	if (state == IMG_FAILED) {
		return -1;
	}

	if (state == IMG_LOADING) {
#ifdef __EMSCRIPTEN__
		return SDL_IMAGE_LOAD_BUSY;
#else
		// Someone else is loading; wait for them
		SDL_Delay(1);
		goto retry;
#endif
	}

	// state == IMG_UNLOADED, try to become the loader
	int expected = IMG_UNLOADED;
	if (!__atomic_compare_exchange_n(
	        (int *)&sdli_state[sprite], &expected, IMG_LOADING, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) {
		// Lost the race, someone else started loading; wait
		goto retry;
	}

	// We are the loader now
	extern struct sdl_image *sdli;
	if (sdl_load_image(sdli + sprite, (int)sprite, zips) == 0) {
		__atomic_store_n((int *)&sdli_state[sprite], IMG_READY, __ATOMIC_RELEASE);
#ifdef DEVELOPER
		extern long long sdl_time_load;
		sdl_time_load += SDL_GetTicks() - start;
#endif
		return (int)sprite;
	} else {
		__atomic_store_n((int *)&sdli_state[sprite], IMG_FAILED, __ATOMIC_RELEASE);
		return -1;
	}
}

static uint32_t sdl_make_frame_budget_pixel(
    struct sdl_texture *st, struct sdl_image *si, int x, int y, int scale, int sink, int dropalpha)
{
	double ix, iy, low_x, low_y, high_x, high_y, dbr, dbg, dbb, dba;
	uint32_t irgb;

	if (scale != 100) {
		ix = x * 100.0 / scale;
		iy = y * 100.0 / scale;

		if (ceil(ix) >= si->xres * sdl_scale) {
			ix = si->xres * sdl_scale - 1.001;
		}

		if (ceil(iy) >= si->yres * sdl_scale) {
			iy = si->yres * sdl_scale - 1.001;
		}

		high_x = ix - floor(ix);
		high_y = iy - floor(iy);
		low_x = 1 - high_x;
		low_y = 1 - high_y;

		irgb = si->pixel[(int)(floor(ix) + floor(iy) * si->xres * sdl_scale)];

		if (st->c1 || st->c2 || st->c3) {
			irgb = sdl_colorize_pix2(
			    irgb, st->c1, st->c2, st->c3, (int)floor(ix), (int)floor(iy), si->xres, si->yres, si->pixel, (int)st->sprite);
		}
		dba = IGET_A(irgb) * low_x * low_y;
		dbr = IGET_R(irgb) * low_x * low_y;
		dbg = IGET_G(irgb) * low_x * low_y;
		dbb = IGET_B(irgb) * low_x * low_y;

		irgb = si->pixel[(int)(ceil(ix) + floor(iy) * si->xres * sdl_scale)];
		if (st->c1 || st->c2 || st->c3) {
			irgb = sdl_colorize_pix2(
			    irgb, st->c1, st->c2, st->c3, (int)ceil(ix), (int)floor(iy), si->xres, si->yres, si->pixel, (int)st->sprite);
		}
		dba += IGET_A(irgb) * high_x * low_y;
		dbr += IGET_R(irgb) * high_x * low_y;
		dbg += IGET_G(irgb) * high_x * low_y;
		dbb += IGET_B(irgb) * high_x * low_y;

		irgb = si->pixel[(int)(floor(ix) + ceil(iy) * si->xres * sdl_scale)];
		if (st->c1 || st->c2 || st->c3) {
			irgb = sdl_colorize_pix2(
			    irgb, st->c1, st->c2, st->c3, (int)floor(ix), (int)ceil(iy), si->xres, si->yres, si->pixel, (int)st->sprite);
		}
		dba += IGET_A(irgb) * low_x * high_y;
		dbr += IGET_R(irgb) * low_x * high_y;
		dbg += IGET_G(irgb) * low_x * high_y;
		dbb += IGET_B(irgb) * low_x * high_y;

		irgb = si->pixel[(int)(ceil(ix) + ceil(iy) * si->xres * sdl_scale)];
		if (st->c1 || st->c2 || st->c3) {
			irgb = sdl_colorize_pix2(
			    irgb, st->c1, st->c2, st->c3, (int)ceil(ix), (int)ceil(iy), si->xres, si->yres, si->pixel, (int)st->sprite);
		}
		dba += IGET_A(irgb) * high_x * high_y;
		dbr += IGET_R(irgb) * high_x * high_y;
		dbg += IGET_G(irgb) * high_x * high_y;
		dbb += IGET_B(irgb) * high_x * high_y;

		irgb = IRGBA((int)dbr, (int)dbg, (int)dbb, (int)dba);

	} else {
		irgb = si->pixel[x + y * si->xres * sdl_scale];
		if (st->c1 || st->c2 || st->c3) {
			irgb = sdl_colorize_pix2(irgb, st->c1, st->c2, st->c3, x, y, si->xres, si->yres, si->pixel, (int)st->sprite);
		}
	}

	if (st->cr || st->cg || st->cb || st->light || st->sat) {
		irgb = sdl_colorbalance(irgb, (char)st->cr, (char)st->cg, (char)st->cb, (char)st->light, (char)st->sat);
	}
	if (st->shine) {
		irgb = sdl_shine_pix(irgb, st->shine);
	}

	if (dropalpha && IGET_A(irgb) < 255) {
		irgb = 0;
	}

	if (st->ll != st->ml || st->rl != st->ml || st->ul != st->ml || st->dl != st->ml) {
		int r, g, b, a;
		int r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0;
		int g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0;
		int b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
		int v1, v2, v3, v4, v5 = 0;
		int div;

		if (y < 10 * sdl_scale + (20 * sdl_scale - abs(20 * sdl_scale - x)) / 2) {
			if (x / 2 < 20 * sdl_scale - y) {
				v2 = -(x / 2 - (20 * sdl_scale - y));
				r2 = IGET_R(sdl_light(st->ll, irgb));
				g2 = IGET_G(sdl_light(st->ll, irgb));
				b2 = IGET_B(sdl_light(st->ll, irgb));
			} else {
				v2 = 0;
			}
			if (x / 2 > 20 * sdl_scale - y) {
				v3 = (x / 2 - (20 * sdl_scale - y));
				r3 = IGET_R(sdl_light(st->rl, irgb));
				g3 = IGET_G(sdl_light(st->rl, irgb));
				b3 = IGET_B(sdl_light(st->rl, irgb));
			} else {
				v3 = 0;
			}
			if (x / 2 > y) {
				v4 = (x / 2 - y);
				r4 = IGET_R(sdl_light(st->ul, irgb));
				g4 = IGET_G(sdl_light(st->ul, irgb));
				b4 = IGET_B(sdl_light(st->ul, irgb));
			} else {
				v4 = 0;
			}
			if (x / 2 < y) {
				v5 = -(x / 2 - y);
				r5 = IGET_R(sdl_light(st->dl, irgb));
				g5 = IGET_G(sdl_light(st->dl, irgb));
				b5 = IGET_B(sdl_light(st->dl, irgb));
			} else {
				v5 = 0;
			}

			v1 = 20 * sdl_scale - (v2 + v3 + v4 + v5);
			r1 = IGET_R(sdl_light(st->ml, irgb));
			g1 = IGET_G(sdl_light(st->ml, irgb));
			b1 = IGET_B(sdl_light(st->ml, irgb));
		} else {
			if (x < 10 * sdl_scale) {
				v2 = 10 * sdl_scale - x;
				r2 = IGET_R(sdl_light(st->ll, irgb));
				g2 = IGET_G(sdl_light(st->ll, irgb));
				b2 = IGET_B(sdl_light(st->ll, irgb));
			} else {
				v2 = 0;
			}

			if (x > 10 * sdl_scale && x < 20 * sdl_scale) {
				v3 = x - 10 * sdl_scale;
				r3 = IGET_R(sdl_light(st->rl, irgb));
				g3 = IGET_G(sdl_light(st->rl, irgb));
				b3 = IGET_B(sdl_light(st->rl, irgb));
			} else {
				v3 = 0;
			}

			if (x >= 20 * sdl_scale && x < 30 * sdl_scale) {
				v5 = 30 * sdl_scale - x;
				r5 = IGET_R(sdl_light(st->dl, irgb));
				g5 = IGET_G(sdl_light(st->dl, irgb));
				b5 = IGET_B(sdl_light(st->dl, irgb));
			} else {
				v5 = 0;
			}

			if (x > 30 * sdl_scale && x < 40 * sdl_scale) {
				v4 = x - 30 * sdl_scale;
				r4 = IGET_R(sdl_light(st->ul, irgb));
				g4 = IGET_G(sdl_light(st->ul, irgb));
				b4 = IGET_B(sdl_light(st->ul, irgb));
			} else {
				v4 = 0;
			}

			v1 = 20 * sdl_scale - v2 - v3 - v4 - v5;
			r1 = IGET_R(sdl_light(st->ml, irgb));
			g1 = IGET_G(sdl_light(st->ml, irgb));
			b1 = IGET_B(sdl_light(st->ml, irgb));
		}

		div = v1 + v2 + v3 + v4 + v5;
		if (div == 0) {
			a = 0;
			r = g = b = 0;
		} else {
			a = IGET_A(irgb);
			r = (r1 * v1 + r2 * v2 + r3 * v3 + r4 * v4 + r5 * v5) / div;
			g = (g1 * v1 + g2 * v2 + g3 * v3 + g4 * v4 + g5 * v5) / div;
			b = (b1 * v1 + b2 * v2 + b3 * v3 + b4 * v4 + b5 * v5) / div;
		}

		irgb = IRGBA(r, g, b, a);
	} else {
		irgb = sdl_light(st->ml, irgb);
	}

	if (sink && st->yres * sdl_scale - sink * sdl_scale < y) {
		irgb &= 0xffffff;
	}

	if (st->freeze) {
		irgb = sdl_freeze(st->freeze, irgb);
	}

	return irgb;
}

static void sdl_make_set_dimensions(struct sdl_texture *st, struct sdl_image *si, int *out_scale, int *out_sink)
{
	int scale;

	if (si->xres == 0 || si->yres == 0) {
		scale = 100;
	} else {
		scale = st->scale;
	}

	if (scale != 100) {
		st->xres = (uint16_t)ceil((si->xres - 1) * (double)scale / 100.0);
		st->yres = (uint16_t)ceil((si->yres - 1) * (double)scale / 100.0);
		st->xoff = (int16_t)floor(si->xoff * (double)scale / 100.0 + 0.5);
		st->yoff = (int16_t)floor(si->yoff * (double)scale / 100.0 + 0.5);
	} else {
		st->xres = (uint16_t)si->xres;
		st->yres = (uint16_t)si->yres;
		st->xoff = si->xoff;
		st->yoff = si->yoff;
	}

	*out_scale = scale;
	if (st->sink) {
		*out_sink = min(st->sink, max(0, st->yres - 4));
	} else {
		*out_sink = 0;
	}
}

int sdl_make_stage12_frame_budget_step(
    struct sdl_texture *st, struct sdl_image *si, SdlTextureMakeState *state, uint64_t deadline_ticks)
{
	int scale, sink, dropalpha;
	int total_x, total_y;
	int did_work = 0;

	if (!st || !si || !state) {
		return -1;
	}
	if (flags_load(st) & SF_DIDMAKE) {
		return 1;
	}

	sdl_make_set_dimensions(st, si, &scale, &sink);
	dropalpha = sprite_config_drop_alpha((unsigned int)st->sprite);

	if (!(flags_load(st) & SF_DIDALLOC)) {
#ifdef SDL_FAST_MALLOC
		st->pixel = MALLOC((size_t)st->xres * st->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale);
#else
		st->pixel =
		    xmalloc((size_t)st->xres * st->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale, MEM_SDL_PIXEL);
#endif
		uint16_t *flags_ptr = (uint16_t *)&st->flags;
		__atomic_fetch_or(flags_ptr, SF_DIDALLOC, __ATOMIC_RELEASE);
		state->next_y = 0;
		did_work = 1;
		if (!sdl_budget_allows_more(deadline_ticks, did_work)) {
			return 0;
		}
	}

	if (!st->pixel) {
		fail("cannot make: pixel=NULL for sprite %d (%p)", st->sprite, (void *)st);
		return -1;
	}

	total_x = st->xres * sdl_scale;
	total_y = st->yres * sdl_scale;
	while (state->next_y < total_y && sdl_budget_allows_more(deadline_ticks, did_work)) {
		int y = state->next_y;
		for (int x = 0; x < total_x; x++) {
			st->pixel[x + y * total_x] = sdl_make_frame_budget_pixel(st, si, x, y, scale, sink, dropalpha);
		}
		state->next_y++;
		did_work = 1;
	}

	if (state->next_y >= total_y) {
		uint16_t *flags_ptr = (uint16_t *)&st->flags;
		__atomic_fetch_or(flags_ptr, SF_DIDMAKE, __ATOMIC_RELEASE);
		state->next_y = 0;
		return 1;
	}

	return 0;
}

void sdl_make(struct sdl_texture *st, struct sdl_image *si, int preload)
{
	SDL_Texture *texture = NULL;
	int x, y, scale, sink, dropalpha;
	double ix, iy, low_x, low_y, high_x, high_y, dbr, dbg, dbb, dba;
	uint32_t irgb;
#ifdef DEVELOPER
	Uint64 start = SDL_GetTicks();
#endif

	if (si->xres == 0 || si->yres == 0) {
		scale = 100; // !!! needs better handling !!!
	} else {
		scale = st->scale;
	}

	// Check JSON config for drop_alpha
	dropalpha = sprite_config_drop_alpha((unsigned int)st->sprite);

	if (scale != 100) {
		st->xres = (uint16_t)ceil((si->xres - 1) * (double)scale / 100.0);
		st->yres = (uint16_t)ceil((si->yres - 1) * (double)scale / 100.0);

		st->xoff = (int16_t)floor(si->xoff * (double)scale / 100.0 + 0.5);
		st->yoff = (int16_t)floor(si->yoff * (double)scale / 100.0 + 0.5);
	} else {
		st->xres = (uint16_t)si->xres;
		st->yres = (uint16_t)si->yres;
		st->xoff = si->xoff;
		st->yoff = si->yoff;
	}

	if (st->sink) {
		sink = min(st->sink, max(0, st->yres - 4));
	} else {
		sink = 0;
	}

	if (!preload || preload == 1) {
		if (!(flags_load(st) & SF_DIDALLOC)) {
			// Only allocate if not already allocated (may be set by caller with mutex protection in multi-threaded
			// mode)
#ifdef SDL_FAST_MALLOC
			st->pixel = MALLOC((size_t)st->xres * st->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale);
#else
			st->pixel = xmalloc(
			    (size_t)st->xres * st->yres * sizeof(uint32_t) * (size_t)sdl_scale * (size_t)sdl_scale, MEM_SDL_PIXEL);
#endif
			uint16_t *flags_ptr = (uint16_t *)&st->flags;
			__atomic_fetch_or(flags_ptr, SF_DIDALLOC, __ATOMIC_RELEASE);
		}
	}

	if (!preload || preload == 2) {
		if (!(flags_load(st) & SF_DIDALLOC)) {
			fail("cannot make without alloc for sprite %d (%p)", st->sprite, (void *)st);
			note("... sprite=%d (%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d)", st->sprite, st->sink, st->freeze,
			    st->scale, st->cr, st->cg, st->cb, st->light, st->sat, st->c1, st->c2, st->c3, st->shine, st->ml,
			    st->ll, st->rl, st->ul, st->dl);
			return;
		}
		if (!(st->pixel)) {
			fail("cannot make: pixel=NULL for sprite %d (%p)", st->sprite, (void *)st);
			note("... sprite=%d (%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d)", st->sprite, st->sink, st->freeze,
			    st->scale, st->cr, st->cg, st->cb, st->light, st->sat, st->c1, st->c2, st->c3, st->shine, st->ml,
			    st->ll, st->rl, st->ul, st->dl);
			return;
		}
		if (flags_load(st) & SF_DIDMAKE) {
			fail("double make for sprite %d (%d)", st->sprite, preload);
			note("... sprite=%d (%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d)", st->sprite, st->sink, st->freeze,
			    st->scale, st->cr, st->cg, st->cb, st->light, st->sat, st->c1, st->c2, st->c3, st->shine, st->ml,
			    st->ll, st->rl, st->ul, st->dl);
			return;
		}

#ifdef DEVELOPER
		start = SDL_GetTicks();
#endif

		for (y = 0; y < st->yres * sdl_scale; y++) {
			for (x = 0; x < st->xres * sdl_scale; x++) {
				if (scale != 100) {
					ix = x * 100.0 / scale;
					iy = y * 100.0 / scale;

					if (ceil(ix) >= si->xres * sdl_scale) {
						ix = si->xres * sdl_scale - 1.001;
					}

					if (ceil(iy) >= si->yres * sdl_scale) {
						iy = si->yres * sdl_scale - 1.001;
					}

					high_x = ix - floor(ix);
					high_y = iy - floor(iy);
					low_x = 1 - high_x;
					low_y = 1 - high_y;

					irgb = si->pixel[(int)(floor(ix) + floor(iy) * si->xres * sdl_scale)];

					if (st->c1 || st->c2 || st->c3) {
						irgb = sdl_colorize_pix2(irgb, st->c1, st->c2, st->c3, (int)floor(ix), (int)floor(iy), si->xres,
						    si->yres, si->pixel, (int)st->sprite);
					}
					dba = IGET_A(irgb) * low_x * low_y;
					dbr = IGET_R(irgb) * low_x * low_y;
					dbg = IGET_G(irgb) * low_x * low_y;
					dbb = IGET_B(irgb) * low_x * low_y;

					irgb = si->pixel[(int)(ceil(ix) + floor(iy) * si->xres * sdl_scale)];

					if (st->c1 || st->c2 || st->c3) {
						irgb = sdl_colorize_pix2(irgb, st->c1, st->c2, st->c3, (int)ceil(ix), (int)floor(iy), si->xres,
						    si->yres, si->pixel, (int)st->sprite);
					}
					dba += IGET_A(irgb) * high_x * low_y;
					dbr += IGET_R(irgb) * high_x * low_y;
					dbg += IGET_G(irgb) * high_x * low_y;
					dbb += IGET_B(irgb) * high_x * low_y;

					irgb = si->pixel[(int)(floor(ix) + ceil(iy) * si->xres * sdl_scale)];

					if (st->c1 || st->c2 || st->c3) {
						irgb = sdl_colorize_pix2(irgb, st->c1, st->c2, st->c3, (int)floor(ix), (int)ceil(iy), si->xres,
						    si->yres, si->pixel, (int)st->sprite);
					}
					dba += IGET_A(irgb) * low_x * high_y;
					dbr += IGET_R(irgb) * low_x * high_y;
					dbg += IGET_G(irgb) * low_x * high_y;
					dbb += IGET_B(irgb) * low_x * high_y;

					irgb = si->pixel[(int)(ceil(ix) + ceil(iy) * si->xres * sdl_scale)];

					if (st->c1 || st->c2 || st->c3) {
						irgb = sdl_colorize_pix2(irgb, st->c1, st->c2, st->c3, (int)ceil(ix), (int)ceil(iy), si->xres,
						    si->yres, si->pixel, (int)st->sprite);
					}
					dba += IGET_A(irgb) * high_x * high_y;
					dbr += IGET_R(irgb) * high_x * high_y;
					dbg += IGET_G(irgb) * high_x * high_y;
					dbb += IGET_B(irgb) * high_x * high_y;

					irgb = IRGBA((int)dbr, (int)dbg, (int)dbb, (int)dba);

				} else {
					irgb = si->pixel[x + y * si->xres * sdl_scale];
					if (st->c1 || st->c2 || st->c3) {
						irgb = sdl_colorize_pix2(
						    irgb, st->c1, st->c2, st->c3, x, y, si->xres, si->yres, si->pixel, (int)st->sprite);
					}
				}

				if (st->cr || st->cg || st->cb || st->light || st->sat) {
					irgb = sdl_colorbalance(
					    irgb, (char)st->cr, (char)st->cg, (char)st->cb, (char)st->light, (char)st->sat);
				}
				if (st->shine) {
					irgb = sdl_shine_pix(irgb, st->shine);
				}

				if (dropalpha) {
					if (IGET_A(irgb) < 255) {
						irgb = 0;
					}
				}

				if (st->ll != st->ml || st->rl != st->ml || st->ul != st->ml || st->dl != st->ml) {
					int r, g, b, a;
					int r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0;
					int g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0;
					int b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
					int v1, v2, v3, v4, v5 = 0;
					int div;


					if (y < 10 * sdl_scale + (20 * sdl_scale - abs(20 * sdl_scale - x)) / 2) {
						// This part calculates a floor tile, or the top of a wall tile
						if (x / 2 < 20 * sdl_scale - y) {
							v2 = -(x / 2 - (20 * sdl_scale - y));
							r2 = IGET_R(sdl_light(st->ll, irgb));
							g2 = IGET_G(sdl_light(st->ll, irgb));
							b2 = IGET_B(sdl_light(st->ll, irgb));
						} else {
							v2 = 0;
						}
						if (x / 2 > 20 * sdl_scale - y) {
							v3 = (x / 2 - (20 * sdl_scale - y));
							r3 = IGET_R(sdl_light(st->rl, irgb));
							g3 = IGET_G(sdl_light(st->rl, irgb));
							b3 = IGET_B(sdl_light(st->rl, irgb));
						} else {
							v3 = 0;
						}
						if (x / 2 > y) {
							v4 = (x / 2 - y);
							r4 = IGET_R(sdl_light(st->ul, irgb));
							g4 = IGET_G(sdl_light(st->ul, irgb));
							b4 = IGET_B(sdl_light(st->ul, irgb));
						} else {
							v4 = 0;
						}
						if (x / 2 < y) {
							v5 = -(x / 2 - y);
							r5 = IGET_R(sdl_light(st->dl, irgb));
							g5 = IGET_G(sdl_light(st->dl, irgb));
							b5 = IGET_B(sdl_light(st->dl, irgb));
						} else {
							v5 = 0;
						}

						v1 = 20 * sdl_scale - (v2 + v3 + v4 + v5);
						r1 = IGET_R(sdl_light(st->ml, irgb));
						g1 = IGET_G(sdl_light(st->ml, irgb));
						b1 = IGET_B(sdl_light(st->ml, irgb));
					} else {
						// This is for the lower part (left side and front as seen on the screen)
						if (x < 10 * sdl_scale) {
							v2 = 10 * sdl_scale - x;
							r2 = IGET_R(sdl_light(st->ll, irgb));
							g2 = IGET_G(sdl_light(st->ll, irgb));
							b2 = IGET_B(sdl_light(st->ll, irgb));
						} else {
							v2 = 0;
						}

						if (x > 10 * sdl_scale && x < 20 * sdl_scale) {
							v3 = x - 10 * sdl_scale;
							r3 = IGET_R(sdl_light(st->rl, irgb));
							g3 = IGET_G(sdl_light(st->rl, irgb));
							b3 = IGET_B(sdl_light(st->rl, irgb));
						} else {
							v3 = 0;
						}

						if (x >= 20 * sdl_scale && x < 30 * sdl_scale) {
							v5 = 30 * sdl_scale - x;
							r5 = IGET_R(sdl_light(st->dl, irgb));
							g5 = IGET_G(sdl_light(st->dl, irgb));
							b5 = IGET_B(sdl_light(st->dl, irgb));
						} else {
							v5 = 0;
						}

						if (x > 30 * sdl_scale && x < 40 * sdl_scale) {
							v4 = x - 30 * sdl_scale;
							r4 = IGET_R(sdl_light(st->ul, irgb));
							g4 = IGET_G(sdl_light(st->ul, irgb));
							b4 = IGET_B(sdl_light(st->ul, irgb));
						} else {
							v4 = 0;
						}

						v1 = 20 * sdl_scale - v2 - v3 - v4 - v5;

						r1 = IGET_R(sdl_light(st->ml, irgb));
						g1 = IGET_G(sdl_light(st->ml, irgb));
						b1 = IGET_B(sdl_light(st->ml, irgb));
					}

					div = v1 + v2 + v3 + v4 + v5;

					if (div == 0) {
						a = 0;
						r = g = b = 0;
					} else {
						a = IGET_A(irgb);
						r = (r1 * v1 + r2 * v2 + r3 * v3 + r4 * v4 + r5 * v5) / div;
						g = (g1 * v1 + g2 * v2 + g3 * v3 + g4 * v4 + g5 * v5) / div;
						b = (b1 * v1 + b2 * v2 + b3 * v3 + b4 * v4 + b5 * v5) / div;
					}

					irgb = IRGBA(r, g, b, a);

				} else {
					irgb = sdl_light(st->ml, irgb);
				}

				if (sink) {
					if (st->yres * sdl_scale - sink * sdl_scale < y) {
						irgb &= 0xffffff; // zero alpha to make it transparent
					}
				}

				if (st->freeze) {
					irgb = sdl_freeze(st->freeze, irgb);
				}

				st->pixel[x + y * st->xres * sdl_scale] = irgb;
			}
		}
		uint16_t *flags_ptr = (uint16_t *)&st->flags;
		__atomic_fetch_or(flags_ptr, SF_DIDMAKE, __ATOMIC_RELEASE);

#ifdef DEVELOPER
		if (preload) {
			extern long long sdl_time_preload;
			sdl_time_preload += (long long)(SDL_GetTicks() - start);
		} else {
			extern long long sdl_time_make;
			sdl_time_make += (long long)(SDL_GetTicks() - start);
		}
#endif
	}

	if (!preload || preload == 3) {
		if (!(flags_load(st) & SF_DIDMAKE)) {
			fail("cannot texture without make for sprite %d (%d)", st->sprite, preload);
			// note("... sprite=%d
			// (%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d)",st->sprite,st->sink,st->freeze,st->scale,st->cr,st->cg,st->cb,st->light,st->sat,st->c1,st->c2,st->c3,st->shine,st->ml,st->ll,st->rl,st->ul,st->dl);
			return;
		}
		if (flags_load(st) & SF_DIDTEX) {
			fail("double texture for sprite %d (%d)", st->sprite, preload);
			// note("... sprite=%d
			// (%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d)",st->sprite,st->sink,st->freeze,st->scale,st->cr,st->cg,st->cb,st->light,st->sat,st->c1,st->c2,st->c3,st->shine,st->ml,st->ll,st->rl,st->ul,st->dl);
			return;
		}

#ifdef DEVELOPER
		start = SDL_GetTicks();
#endif

		if (st->xres > 0 && st->yres > 0) {
#ifdef SDL_USE_RENDER_BACKEND_TEXTURES
			texture = sdl_backend_create_texture_from_argb8888(
			    st->xres * sdl_scale, st->yres * sdl_scale, st->pixel,
			    (size_t)st->xres * sizeof(uint32_t) * (size_t)sdl_scale);
			if (!texture) {
				warn("Renderer texture upload failed in sprite %d (%s, %d,%d) preload=%d", st->sprite, st->text,
				    st->xres, st->yres, preload);
				return;
			}
#else
			texture = SDL_CreateTexture(
			    sdlren, SDL_PIXELFORMAT_ARGB8888, SDL_TEXTUREACCESS_STATIC, st->xres * sdl_scale, st->yres * sdl_scale);
			if (!texture) {
				warn("SDL_texture Error: %s in sprite %d (%s, %d,%d) preload=%d", SDL_GetError(), st->sprite, st->text,
				    st->xres, st->yres, preload);
				return;
			}
			SDL_UpdateTexture(texture, NULL, st->pixel, (int)(st->xres * sizeof(uint32_t) * (size_t)sdl_scale));
			SDL_SetTextureBlendMode(texture, SDL_BLENDMODE_BLEND);
#endif
			// Update memory accounting when texture is actually created
			extern long long mem_tex;
			__atomic_add_fetch(&mem_tex, st->xres * st->yres * sizeof(uint32_t), __ATOMIC_RELAXED);
		} else {
			texture = NULL;
		}
#ifdef SDL_FAST_MALLOC
		FREE(st->pixel);
#else
		xfree(st->pixel);
#endif
		st->pixel = NULL;
		st->tex = texture;

		// Only set SF_DIDTEX if we actually created a texture
		if (texture) {
			uint16_t *flags_ptr = (uint16_t *)&st->flags;
			__atomic_fetch_or(flags_ptr, SF_DIDTEX, __ATOMIC_RELEASE);
		}

#ifdef DEVELOPER
		extern long long sdl_time_tex;
		sdl_time_tex += SDL_GetTicks() - start;
#endif
	}
}

DLL_EXPORT uint32_t *sdl_load_png(char *filename, int *dx, int *dy)
{
	int x, y, xres, yres, tmp, r, g, b, a;
	int format;
	unsigned char **row;
	uint32_t *pixel;
	FILE *fp;
	png_structp png_ptr;
	png_infop info_ptr;

	fp = fopen(filename, "rb");
	if (!fp) {
		return NULL;
	}

	png_ptr = png_create_read_struct_2(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL, NULL, png_malloc_fn, png_free_fn);
	if (!png_ptr) {
		fclose(fp);
		warn("create read\n");
		return NULL;
	}

	info_ptr = png_create_info_struct(png_ptr);
	if (!info_ptr) {
		fclose(fp);
		png_destroy_read_struct(&png_ptr, (png_infopp)NULL, (png_infopp)NULL);
		warn("create info1\n");
		return NULL;
	}

	png_init_io(png_ptr, fp);
	png_set_strip_16(png_ptr);
	png_read_png(png_ptr, info_ptr, PNG_TRANSFORM_PACKING, NULL);

	row = png_get_rows(png_ptr, info_ptr);
	if (!row) {
		fclose(fp);
		png_destroy_read_struct(&png_ptr, &info_ptr, (png_infopp)NULL);
		warn("read row\n");
		return NULL;
	}

	xres = (int)png_get_image_width(png_ptr, info_ptr);
	yres = (int)png_get_image_height(png_ptr, info_ptr);

	tmp = (int)png_get_rowbytes(png_ptr, info_ptr);

	if (tmp == xres * 3) {
		format = 3;
	} else if (tmp == xres * 4) {
		format = 4;
	} else {
		fclose(fp);
		png_destroy_read_struct(&png_ptr, &info_ptr, (png_infopp)NULL);
		warn("rowbytes!=xres*4 (%d)", tmp);
		return NULL;
	}

	if (png_get_bit_depth(png_ptr, info_ptr) != 8) {
		fclose(fp);
		png_destroy_read_struct(&png_ptr, &info_ptr, (png_infopp)NULL);
		warn("bit depth!=8\n");
		return NULL;
	}
	if (png_get_channels(png_ptr, info_ptr) != format) {
		fclose(fp);
		png_destroy_read_struct(&png_ptr, &info_ptr, (png_infopp)NULL);
		warn("channels!=format\n");
		return NULL;
	}

	// prescan
	if (dx) {
		*dx = xres;
	}
	if (dy) {
		*dy = yres;
	}

#ifdef SDL_FAST_MALLOC
	pixel = MALLOC((size_t)xres * (size_t)yres * sizeof(uint32_t));
#else
	pixel = xmalloc((size_t)xres * (size_t)yres * sizeof(uint32_t), MEM_TEMP8);
#endif

	if (!pixel) {
		fclose(fp);
		png_destroy_read_struct(&png_ptr, &info_ptr, (png_infopp)NULL);
		warn("failed to allocate memory for pixel buffer\n");
		return NULL;
	}

	if (format == 4) {
		for (y = 0; y < yres; y++) {
			for (x = 0; x < xres; x++) {
				r = row[y][x * 4 + 0];
				g = row[y][x * 4 + 1];
				b = row[y][x * 4 + 2];
				a = row[y][x * 4 + 3];

				if (a) {
					r = min(255, r * 255 / a);
					g = min(255, g * 255 / a);
					b = min(255, b * 255 / a);
				} else {
					r = g = b = 0;
				}

				pixel[x + y * xres] = IRGBA(r, g, b, a);
			}
		}
	} else {
		for (y = 0; y < yres; y++) {
			for (x = 0; x < xres; x++) {
				r = row[y][x * 3 + 0];
				g = row[y][x * 3 + 1];
				b = row[y][x * 3 + 2];
				a = 255;

				pixel[x + y * xres] = IRGBA(r, g, b, a);
			}
		}
	}

	png_destroy_read_struct(&png_ptr, &info_ptr, (png_infopp)NULL);
	fclose(fp);

	return pixel;
}
