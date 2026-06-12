const DEFAULT_MAX_SPRITES = 32;

export async function decodeRenderListSprites(renderList, spriteAssets, options = {}) {
  if (!renderList || !Array.isArray(renderList.commands)) {
    throw new TypeError('Astonia sprite resolution requires a render list with commands');
  }
  if (!spriteAssets || typeof spriteAssets.decodeSprite !== 'function') {
    throw new TypeError('Astonia sprite resolution requires a sprite asset catalog');
  }

  const spriteIds = selectSpriteIds(renderList, options);
  const decoded = [];
  const missing = [];
  const skipped = [];
  const decodedSprites = new Map();

  for (const spriteId of spriteIds.selected) {
    if (typeof spriteAssets.hasSprite === 'function' && !spriteAssets.hasSprite(spriteId)) {
      missing.push({ spriteId, reason: 'not-found' });
      continue;
    }

    try {
      const sprite = await spriteAssets.decodeSprite(spriteId);
      const resolved = {
        spriteId: sprite.spriteId,
        entryName: sprite.entryName,
        archiveName: sprite.archiveName,
        width: sprite.width,
        height: sprite.height,
        pixelByteLength: sprite.pixels.byteLength,
        pixels: sprite.pixels
      };
      decoded.push(resolved);
      decodedSprites.set(spriteId, resolved);
    } catch (error) {
      missing.push({
        spriteId,
        reason: 'decode-failed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const spriteId of spriteIds.skipped) {
    skipped.push({ spriteId, reason: 'decode-budget' });
  }

  return {
    decoded,
    decodedSprites,
    missing,
    skipped
  };
}

function selectSpriteIds(renderList, options) {
  if (Array.isArray(options.spriteIds)) {
    return {
      selected: uniqueSpriteIds(options.spriteIds),
      skipped: []
    };
  }

  const maxSprites = positiveIntegerOption(options.maxSprites, DEFAULT_MAX_SPRITES, 'maxSprites');
  const allSpriteIds = uniqueSpriteIds(renderList.commands.map((command) => command.spriteId));

  return {
    selected: allSpriteIds.slice(0, maxSprites),
    skipped: allSpriteIds.slice(maxSprites)
  };
}

function uniqueSpriteIds(spriteIds) {
  return [...new Set(spriteIds.filter((spriteId) => Number.isInteger(spriteId) && spriteId > 0))];
}

function positiveIntegerOption(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`Astonia sprite resolution ${name} must be a positive integer`);
  }
  return value;
}
