const DEFAULT_MAX_SPRITES = 192;
const LAYER_DECODE_PRIORITY = new Map([
  ['character', 0],
  ['item', 1],
  ['floorOverlay', 2],
  ['floor', 3],
  ['groundOverlay', 4],
  ['ground', 5]
]);
const DEFAULT_DECODE_CONCURRENCY = 8;

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

  const decodeConcurrency = positiveIntegerOption(
    options.decodeConcurrency,
    DEFAULT_DECODE_CONCURRENCY,
    'decodeConcurrency'
  );
  const results = await mapWithConcurrency(spriteIds.selected, decodeConcurrency, async (spriteId) => {
    if (typeof spriteAssets.hasSprite === 'function' && !spriteAssets.hasSprite(spriteId)) {
      return { status: 'missing', spriteId, reason: 'not-found' };
    }

    try {
      const sprite = await spriteAssets.decodeSprite(spriteId);
      return {
        status: 'decoded',
        sprite: {
          spriteId: sprite.spriteId,
          entryName: sprite.entryName,
          archiveName: sprite.archiveName,
          width: sprite.width,
          height: sprite.height,
          pixelByteLength: sprite.pixels.byteLength,
          pixels: sprite.pixels
        }
      };
    } catch (error) {
      return {
        status: 'missing',
        spriteId,
        reason: 'decode-failed',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  });

  for (const result of results) {
    if (result.status === 'decoded') {
      decoded.push(result.sprite);
      decodedSprites.set(result.sprite.spriteId, result.sprite);
    } else {
      missing.push({
        spriteId: result.spriteId,
        reason: result.reason,
        ...(result.message ? { message: result.message } : {})
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
  const allSpriteIds = orderedRenderListSpriteIds(renderList.commands);

  return {
    selected: allSpriteIds.slice(0, maxSprites),
    skipped: allSpriteIds.slice(maxSprites)
  };
}

function orderedRenderListSpriteIds(commands) {
  const commandsBySpriteId = new Map();
  for (const command of commands) {
    if (!Number.isInteger(command.spriteId) || command.spriteId <= 0) {
      continue;
    }
    if (!commandsBySpriteId.has(command.spriteId)) {
      commandsBySpriteId.set(command.spriteId, command);
    }
  }

  return [...commandsBySpriteId.entries()]
    .sort(compareDecodePriority)
    .map(([spriteId]) => spriteId);
}

function compareDecodePriority([leftSpriteId, left], [rightSpriteId, right]) {
  return (
    layerDecodePriority(left.layer) - layerDecodePriority(right.layer) ||
    (left.screen?.y ?? 0) - (right.screen?.y ?? 0) ||
    (left.screen?.x ?? 0) - (right.screen?.x ?? 0) ||
    leftSpriteId - rightSpriteId
  );
}

function layerDecodePriority(layer) {
  return LAYER_DECODE_PRIORITY.get(layer) ?? Number.MAX_SAFE_INTEGER;
}

function uniqueSpriteIds(spriteIds) {
  return [...new Set(spriteIds.filter((spriteId) => Number.isInteger(spriteId) && spriteId > 0))];
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
