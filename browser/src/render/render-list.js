const SCHEMA_VERSION = 1;
const DEFAULT_TILE_WIDTH = 40;
const DEFAULT_TILE_HEIGHT = 20;
const DEFAULT_PADDING = 96;

const LAYER_ORDER = new Map([
  ['ground', 10],
  ['groundOverlay', 20],
  ['floor', 30],
  ['floorOverlay', 40],
  ['item', 50],
  ['character', 60]
]);

const MAP_SPRITE_SLOTS = [
  ['ground', 'groundSpriteId', '#31583d'],
  ['groundOverlay', 'groundOverlaySpriteId', '#496d48'],
  ['floor', 'floorSpriteId', '#6f6354'],
  ['floorOverlay', 'floorOverlaySpriteId', '#8b806d'],
  ['item', 'itemSpriteId', '#b9874f']
];

export function createAstoniaRenderList(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('Astonia render list requires a protocol replay snapshot');
  }

  const visibleWorld = snapshot.visibleWorld;
  if (!visibleWorld || typeof visibleWorld !== 'object') {
    throw new TypeError('Astonia render list requires snapshot.visibleWorld');
  }

  const tileWidth = positiveIntegerOption(options.tileWidth, DEFAULT_TILE_WIDTH, 'tileWidth');
  const tileHeight = positiveIntegerOption(options.tileHeight, DEFAULT_TILE_HEIGHT, 'tileHeight');
  const padding = positiveIntegerOption(options.padding, DEFAULT_PADDING, 'padding');
  const cells = Array.isArray(visibleWorld.cells) ? visibleWorld.cells : [];
  const characters = Array.isArray(visibleWorld.characters) ? visibleWorld.characters : [];
  const projection = createIsoProjection({ cells, characters, tileWidth, tileHeight, padding });
  const commands = [
    ...mapCellSpriteCommands(cells, projection),
    ...characterSpriteCommands(characters, snapshot.playersById ?? {}, projection, snapshot.player)
  ].sort(compareRenderCommands);

  return {
    schemaVersion: SCHEMA_VERSION,
    source: {
      currentTick: snapshot.currentTick ?? null,
      origin: clonePoint(snapshot.origin),
      protocolVersion: snapshot.protocolVersion ?? null
    },
    viewport: {
      width: visibleWorld.width,
      height: visibleWorld.height,
      distance: visibleWorld.distance,
      tileWidth,
      tileHeight,
      canvasWidth: projection.canvasWidth,
      canvasHeight: projection.canvasHeight
    },
    commands
  };
}

function mapCellSpriteCommands(cells, projection) {
  const commands = [];

  for (const cell of cells) {
    for (const [layer, key, fallbackColor] of MAP_SPRITE_SLOTS) {
      const spriteId = normalizeSpriteId(cell[key]);
      if (!spriteId) {
        continue;
      }

      commands.push({
        id: `${layer}:${cell.local.x},${cell.local.y}:${spriteId}`,
        type: 'sprite',
        layer,
        spriteId,
        local: clonePoint(cell.local),
        world: clonePoint(cell.world),
        screen: projection.project(cell.local),
        fallbackColor
      });
    }
  }

  return commands;
}

function characterSpriteCommands(characters, playersById, projection, player) {
  return characters
    .map((character) => {
      const knownPlayer = playersById[String(character.id)] ?? playersById[character.id] ?? null;
      const isPlayer = player?.id !== undefined && player?.id !== null && String(character.id) === String(player.id);

      return {
        id: `character:${character.local.x},${character.local.y}:${character.spriteId}:${character.id}`,
        type: 'sprite',
        layer: 'character',
        spriteId: normalizeSpriteId(character.spriteId),
        animation: {
          action: normalizeAnimationValue(character.action),
          duration: normalizeAnimationValue(character.duration),
          step: normalizeAnimationValue(character.step),
          direction: normalizeAnimationValue(character.direction)
        },
        local: clonePoint(character.local),
        world: clonePoint(character.world),
        screen: projection.project(character.local),
        fallbackColor: characterFallbackColor(),
        entity: {
          id: character.id,
          name: character.name ?? knownPlayer?.name ?? null,
          health: character.health ?? null,
          isPlayer
        }
      };
    })
    .filter((command) => command.spriteId);
}

function createIsoProjection({ cells, characters, tileWidth, tileHeight, padding }) {
  const points = [...cells, ...characters]
    .map((entry) => entry.local)
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  const rawPoints = points.length > 0 ? points.map((point) => rawIsoPoint(point, tileWidth, tileHeight)) : [{ x: 0, y: 0 }];
  const minX = Math.min(...rawPoints.map((point) => point.x));
  const minY = Math.min(...rawPoints.map((point) => point.y));
  const maxX = Math.max(...rawPoints.map((point) => point.x));
  const maxY = Math.max(...rawPoints.map((point) => point.y));
  const contentWidth = maxX - minX + tileWidth;
  const contentHeight = maxY - minY + tileHeight * 5;

  return {
    canvasWidth: Math.ceil(contentWidth + padding * 2),
    canvasHeight: Math.ceil(contentHeight + padding * 2),
    project(point) {
      const raw = rawIsoPoint(point, tileWidth, tileHeight);
      return {
        x: Math.round(raw.x - minX + padding + tileWidth / 2),
        y: Math.round(raw.y - minY + padding)
      };
    }
  };
}

function rawIsoPoint(point, tileWidth, tileHeight) {
  return {
    x: (point.x - point.y) * (tileWidth / 2),
    y: (point.x + point.y) * (tileHeight / 2)
  };
}

function compareRenderCommands(left, right) {
  return (
    layerOrder(left.layer) - layerOrder(right.layer) ||
    left.local.y - right.local.y ||
    left.local.x - right.local.x ||
    left.spriteId - right.spriteId ||
    left.id.localeCompare(right.id)
  );
}

function layerOrder(layer) {
  return LAYER_ORDER.get(layer) ?? Number.MAX_SAFE_INTEGER;
}

function characterFallbackColor() {
  return '#c9b37a';
}

function normalizeSpriteId(spriteId) {
  return Number.isInteger(spriteId) && spriteId > 0 ? spriteId : 0;
}

function normalizeAnimationValue(value) {
  return Number.isInteger(value) ? value : null;
}

function positiveIntegerOption(value, fallback, name) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`Astonia render list ${name} must be a positive integer`);
  }
  return value;
}

function clonePoint(point) {
  return point ? { ...point } : null;
}
