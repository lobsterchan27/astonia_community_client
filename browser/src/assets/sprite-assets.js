import { openHttpZip, ZipArchiveNotFoundError } from './http-zip.js';

export const DEFAULT_BASE_ARCHIVES = ['gx1.zip', 'gx2.zip', 'gx3.zip', 'gx4.zip'];
export const DEFAULT_OPTIONAL_ARCHIVES = [
  'gx1_patch.zip',
  'gx2_patch.zip',
  'gx3_patch.zip',
  'gx4_patch.zip'
];

export function spriteEntryName(spriteId) {
  if (!Number.isInteger(spriteId) || spriteId < 0 || spriteId > 99_999_999) {
    throw new RangeError(`Invalid sprite id: ${spriteId}`);
  }

  return `${spriteId.toString().padStart(8, '0')}.png`;
}

export async function loadSpriteAssets(options = {}) {
  const baseUrl = options.baseUrl ?? '/assets/';
  const baseArchives = options.baseArchives ?? DEFAULT_BASE_ARCHIVES;
  const optionalArchives = options.optionalArchives ?? DEFAULT_OPTIONAL_ARCHIVES;
  const fetchFn = options.fetchFn ?? fetch;
  const archives = [];
  const missingOptionalArchives = [];

  for (const name of baseArchives) {
    archives.push(await loadArchive({ baseUrl, fetchFn, name, optional: false }));
  }

  for (const name of optionalArchives) {
    const archive = await loadArchive({ baseUrl, fetchFn, name, optional: true });
    if (archive) {
      archives.push(archive);
    } else {
      missingOptionalArchives.push(name);
    }
  }

  return new SpriteAssetCatalog({ archives, missingOptionalArchives });
}

class SpriteAssetCatalog {
  constructor({ archives, missingOptionalArchives }) {
    this.#archives = archives;
    this.#archivesByName = new Map(archives.map((archive) => [archive.name, archive]));
    this.#decodedSprites = new Map();
    this.archiveNames = Object.freeze(archives.map((archive) => archive.name));
    this.missingOptionalArchives = Object.freeze(missingOptionalArchives.slice());
  }

  #archives;
  #archivesByName;
  #decodedSprites;

  listEntries(archiveName) {
    if (archiveName) {
      return this.#getArchive(archiveName).zip.listEntries();
    }

    return this.#archives.flatMap((archive) => archive.zip.listEntries());
  }

  hasSprite(spriteId) {
    const entryName = spriteEntryName(spriteId);
    return this.#archives.some((archive) => archive.zip.hasEntry(entryName));
  }

  async readSprite(spriteId) {
    const entryName = spriteEntryName(spriteId);
    const archive = this.#findArchiveForEntry(entryName);

    if (!archive) {
      throw new Error(`Sprite ${spriteId} (${entryName}) was not found in loaded graphics archives`);
    }

    return {
      spriteId,
      entryName,
      archiveName: archive.name,
      bytes: await archive.zip.readEntry(entryName)
    };
  }

  async decodeSprite(spriteId) {
    const entryName = spriteEntryName(spriteId);
    const cached = this.#decodedSprites.get(entryName);
    if (cached) {
      return cached;
    }

    const pending = this.#decodeSprite(spriteId);
    this.#decodedSprites.set(entryName, pending);

    try {
      return await pending;
    } catch (error) {
      this.#decodedSprites.delete(entryName);
      throw error;
    }
  }

  #getArchive(name) {
    const archive = this.#archivesByName.get(name);
    if (!archive) {
      throw new Error(`Graphics archive is not loaded: ${name}`);
    }

    return archive;
  }

  #findArchiveForEntry(entryName) {
    for (let index = this.#archives.length - 1; index >= 0; index -= 1) {
      const archive = this.#archives[index];
      if (archive.zip.hasEntry(entryName)) {
        return archive;
      }
    }

    return null;
  }

  async #decodeSprite(spriteId) {
    const sprite = await this.readSprite(spriteId);
    const decoded = await decodePngToRgba(sprite.bytes);

    return {
      spriteId: sprite.spriteId,
      entryName: sprite.entryName,
      archiveName: sprite.archiveName,
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.pixels
    };
  }
}

async function loadArchive({ baseUrl, fetchFn, name, optional }) {
  try {
    return {
      name,
      zip: await openHttpZip(resolveAssetUrl(baseUrl, name), { fetchFn })
    };
  } catch (error) {
    if (optional && error instanceof ZipArchiveNotFoundError) {
      return null;
    }

    throw error;
  }
}

function resolveAssetUrl(baseUrl, archiveName) {
  return new URL(archiveName, new URL(baseUrl, globalThis.location.href)).toString();
}

async function decodePngToRgba(bytes) {
  const blob = new Blob([bytes], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);

  try {
    const canvas = createDecodeCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Could not create a 2D canvas context for PNG decode');
    }

    context.clearRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);

    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data
    };
  } finally {
    bitmap.close?.();
  }
}

function createDecodeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
