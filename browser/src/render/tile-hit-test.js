const TILE_LAYERS = new Set(['ground', 'groundOverlay', 'floor', 'floorOverlay', 'item']);
const LAYER_PRIORITY = new Map([
  ['ground', 10],
  ['groundOverlay', 20],
  ['floor', 30],
  ['floorOverlay', 40],
  ['item', 50]
]);

export function hitTestAstoniaRenderListTile(renderList, point) {
  if (!renderList || !Array.isArray(renderList.commands)) {
    return null;
  }

  const tileWidth = positiveNumber(renderList.viewport?.tileWidth, 40);
  const tileHeight = positiveNumber(renderList.viewport?.tileHeight, 20);
  const candidates = [];

  for (const command of renderList.commands) {
    if (!TILE_LAYERS.has(command.layer) || !isPoint(command.screen) || !isPoint(command.world)) {
      continue;
    }

    const hit = diamondHit(command.screen, point, tileWidth, tileHeight);
    if (hit) {
      candidates.push({
        command,
        distance: hit.distance
      });
    }
  }

  candidates.sort(compareHitCandidates);
  const best = candidates[0]?.command;
  if (!best) {
    return null;
  }

  return {
    id: best.id,
    layer: best.layer,
    local: { ...best.local },
    world: { ...best.world },
    screen: { ...best.screen },
    spriteId: best.spriteId
  };
}

function diamondHit(screen, point, tileWidth, tileHeight) {
  if (!isPoint(point)) {
    return null;
  }

  const halfWidth = tileWidth / 2;
  const halfHeight = tileHeight / 2;
  const center = {
    x: screen.x,
    y: screen.y + halfHeight
  };
  const normalizedX = Math.abs(point.x - center.x) / halfWidth;
  const normalizedY = Math.abs(point.y - center.y) / halfHeight;
  const distance = normalizedX + normalizedY;

  return distance <= 1.000001 ? { distance } : null;
}

function compareHitCandidates(left, right) {
  return (
    right.command.screen.y - left.command.screen.y ||
    layerPriority(right.command.layer) - layerPriority(left.command.layer) ||
    left.distance - right.distance ||
    left.command.id.localeCompare(right.command.id)
  );
}

function layerPriority(layer) {
  return LAYER_PRIORITY.get(layer) ?? 0;
}

function isPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
