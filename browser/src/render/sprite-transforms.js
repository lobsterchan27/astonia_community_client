const CHARACTER_CONFIG_URL = '/config/character_variants.json';
const ANIMATED_CONFIG_URL = '/config/animated_variants.json';

const IDLE_ANIMATED_CHARACTER_SPRITES_16 = new Set([
  45, 63, 64, 68, 69, 73, 74, 78, 79, 83, 84, 88, 89, 93, 94, 98, 99, 103, 104, 108, 109, 113,
  114, 118, 119, 360
]);
const IDLE_ANIMATED_CHARACTER_SPRITES_32 = new Set([120, 121, 122]);

let defaultConfigPromise = null;

export async function loadAstoniaSpriteTransformConfig(options = {}) {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('Sprite transform config loading requires fetch');
  }

  const characterUrl = options.characterUrl ?? CHARACTER_CONFIG_URL;
  const animatedUrl = options.animatedUrl ?? ANIMATED_CONFIG_URL;
  const useDefaultCache =
    fetchFn === globalThis.fetch && characterUrl === CHARACTER_CONFIG_URL && animatedUrl === ANIMATED_CONFIG_URL;

  if (useDefaultCache) {
    defaultConfigPromise ??= fetchSpriteTransformConfig(fetchFn, characterUrl, animatedUrl);
    return defaultConfigPromise;
  }

  return fetchSpriteTransformConfig(fetchFn, characterUrl, animatedUrl);
}

export async function resolveAstoniaRenderListSprites(renderList, options = {}) {
  if (!renderList || !Array.isArray(renderList.commands)) {
    return renderList;
  }

  const config = options.config ?? (await loadAstoniaSpriteTransformConfig(options));
  const currentTick = normalizeTick(renderList.source?.currentTick);

  return {
    ...renderList,
    commands: renderList.commands.map((command) => resolveAstoniaRenderCommandSprite(command, config, currentTick))
  };
}

export function resolveAstoniaRenderCommandSprite(command, config, currentTick = 0) {
  const sourceSpriteId = normalizePositiveInteger(command.spriteId);
  if (!sourceSpriteId) {
    return command;
  }

  const resolution =
    command.layer === 'character'
      ? resolveCharacterSprite(command, config, currentTick)
      : resolveAnimatedSprite(sourceSpriteId, command, config, currentTick);

  if (!resolution || resolution.spriteId === sourceSpriteId) {
    return command;
  }

  return {
    ...command,
    spriteId: resolution.spriteId,
    sourceSpriteId,
    spriteTransform: resolution.transform
  };
}

export function resolveCharacterSprite(command, config, currentTick = 0) {
  const sourceSpriteId = normalizePositiveInteger(command.spriteId);
  if (!sourceSpriteId) {
    return null;
  }

  const baseSpriteId = resolveCharacterBaseSprite(sourceSpriteId, config);
  const animation = command.animation ?? {};
  const spriteId = getPlayerSprite(
    baseSpriteId,
    normalizeDirection(animation.direction) - 1,
    normalizeAction(animation.action),
    normalizeNonNegativeInteger(animation.step),
    normalizeDuration(animation.duration),
    normalizeTick(currentTick)
  );

  return {
    spriteId,
    transform: {
      type: 'character',
      baseSpriteId,
      action: normalizeAction(animation.action),
      direction: normalizeDirection(animation.direction)
    }
  };
}

export function resolveAnimatedSprite(sourceSpriteId, command, config, currentTick = 0) {
  const variant = config.animatedVariants.get(sourceSpriteId);
  if (!variant) {
    return null;
  }

  let spriteId = applyAnimatedVariant(variant, command, normalizeTick(currentTick));
  if (spriteId >= 100_000) {
    const charNo = Math.trunc((spriteId - 100_000) / 1_000);
    const offset = spriteId % 1_000;
    spriteId = 100_000 + resolveCharacterBaseSprite(charNo, config) * 1_000 + offset;
  }

  return {
    spriteId,
    transform: {
      type: 'animated',
      baseSpriteId: variant.base_sprite ?? sourceSpriteId,
      animationType: variant.animation?.type ?? null
    }
  };
}

export function resolveCharacterBaseSprite(spriteId, config) {
  return normalizePositiveInteger(config.characterVariants.get(spriteId)?.base_sprite) || spriteId;
}

export function getPlayerSprite(spriteId, zdir, action, step, duration, currentTick = 0) {
  let effectiveAction = action;
  let effectiveStep = step;
  let effectiveDuration = duration;
  const base = 100_000 + spriteId * 1_000;
  const safeZdir = clampInteger(zdir, 0, 7);

  if (effectiveAction === 0) {
    if (IDLE_ANIMATED_CHARACTER_SPRITES_16.has(spriteId)) {
      effectiveAction = 60;
      effectiveStep = currentTick % 16;
      effectiveDuration = 16;
    } else if (IDLE_ANIMATED_CHARACTER_SPRITES_32.has(spriteId)) {
      effectiveAction = 60;
      effectiveStep = currentTick % 32;
      effectiveDuration = 32;
    }
  }

  if (
    spriteId === 21 &&
    (effectiveAction === 2 ||
      effectiveAction === 3 ||
      (effectiveAction >= 6 && effectiveAction <= 49) ||
      effectiveAction > 60)
  ) {
    effectiveAction = 4;
  }

  switch (effectiveAction) {
    case 0:
      return base + safeZdir;
    case 1:
      return base + 8 + safeZdir * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 2:
    case 3:
      return base + 104 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 4:
      return base + 136 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 5:
      return base + 168 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 6:
      return base + 200 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 7:
      return base + 72 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 10:
    case 12:
    case 17:
    case 20:
      return base + 232 + safeZdir * 8 + frameIndex(effectiveStep, 4, effectiveDuration);
    case 11:
    case 13:
    case 18:
    case 21:
      return base + 236 + safeZdir * 8 + frameIndex(effectiveStep, 4, effectiveDuration);
    case 14:
    case 15:
    case 16:
    case 19:
    case 22:
    case 23:
    case 25:
    case 26:
    case 27:
    case 28:
      return base + 296 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 24:
      return base + 72 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 50:
      return base + 328 + intDiv(safeZdir, 2) * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    case 60:
      return base + 800 + safeZdir * 8 + frameIndex(effectiveStep, 8, effectiveDuration);
    default:
      return base;
  }
}

async function fetchSpriteTransformConfig(fetchFn, characterUrl, animatedUrl) {
  const [characterRoot, animatedRoot] = await Promise.all([
    fetchJson(fetchFn, characterUrl),
    fetchJson(fetchFn, animatedUrl)
  ]);

  return {
    characterVariants: indexVariants(characterRoot.character_variants),
    animatedVariants: indexVariants(animatedRoot.animated_variants)
  };
}

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Sprite transform config fetch failed for ${url}: ${response.status}`);
  }

  return response.json();
}

function indexVariants(variants) {
  const indexed = new Map();
  if (!Array.isArray(variants)) {
    return indexed;
  }

  for (const variant of variants) {
    const id = normalizePositiveInteger(variant?.id);
    if (id) {
      indexed.set(id, variant);
    }
  }
  return indexed;
}

function applyAnimatedVariant(variant, command, currentTick) {
  const baseSprite = normalizePositiveInteger(variant.base_sprite) || normalizePositiveInteger(variant.id);
  const animation = variant.animation;
  if (!animation) {
    return baseSprite;
  }

  const frames = normalizeDuration(animation.frames ?? 8);
  const divisor = normalizeDuration(animation.divisor ?? 1);
  const positionOffset = renderPositionOffset(command);
  const tickFrame = intDiv(currentTick, divisor);

  switch (animation.type) {
    case 'cycle':
    case 'simple':
      return baseSprite + positiveModulo(tickFrame, frames);
    case 'position_cycle':
    case 'location_aware':
      return baseSprite + positiveModulo(positionOffset + tickFrame, frames);
    case 'bidirectional':
    case 'pingpong': {
      const cycleLength = Math.max(frames * 2 - 2, 1);
      const cycle = positiveModulo(tickFrame, cycleLength);
      return baseSprite + (cycle >= frames ? cycleLength - cycle : cycle);
    }
    case 'pulse': {
      const cycleLength = Math.max(frames * 2, 1);
      const cycle = positiveModulo(tickFrame, cycleLength);
      return baseSprite + (cycle >= frames ? cycleLength - cycle - 1 : cycle);
    }
    case 'multi_branch':
      return baseSprite + multiBranchFrame(animation, positionOffset, currentTick, divisor, frames);
    case 'flicker':
    case 'random_offset':
      return baseSprite + positiveModulo(positionOffset + tickFrame, frames);
    default:
      return baseSprite;
  }
}

function multiBranchFrame(animation, positionOffset, currentTick, divisor, frames) {
  const branches = Array.isArray(animation.branches) ? animation.branches : [];
  const help = positionOffset + intDiv(currentTick, divisor);

  for (const branch of branches) {
    const divisorForBranch = normalizeDuration(branch.divisor ?? divisor);
    const framesForBranch = normalizeDuration(branch.frames ?? frames);
    const parsed = parseBranchCondition(branch.condition);

    if (!parsed || (parsed.modulo > 0 && positiveModulo(help, parsed.modulo) < parsed.threshold)) {
      return positiveModulo(positionOffset + intDiv(currentTick, divisorForBranch), framesForBranch);
    }
  }

  return positiveModulo(positionOffset + intDiv(currentTick, divisor), frames);
}

function parseBranchCondition(condition) {
  if (condition === 'default') {
    return null;
  }

  const match = /^mod(\d+)\s*<\s*(\d+)$/.exec(String(condition ?? ''));
  if (!match) {
    return null;
  }

  return {
    modulo: Number.parseInt(match[1], 10),
    threshold: Number.parseInt(match[2], 10)
  };
}

function renderPositionOffset(command) {
  const point = command.world ?? command.local;
  if (!point) {
    return 0;
  }

  return normalizeNonNegativeInteger(point.x) + normalizeNonNegativeInteger(point.y) * 256;
}

function frameIndex(step, frameCount, duration) {
  return intDiv(step * frameCount, Math.max(duration, 1));
}

function intDiv(left, right) {
  return Math.trunc(left / Math.max(right, 1));
}

function normalizeDirection(direction) {
  return clampInteger(direction ?? 1, 1, 8);
}

function normalizeAction(action) {
  return normalizeNonNegativeInteger(action);
}

function normalizeDuration(duration) {
  return Math.max(normalizeNonNegativeInteger(duration), 1);
}

function normalizeTick(tick) {
  return normalizeNonNegativeInteger(tick);
}

function normalizePositiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function normalizeNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function clampInteger(value, min, max) {
  if (!Number.isInteger(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
