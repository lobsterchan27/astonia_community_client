import { decodeRenderListSprites } from './sprite-resolver.js';

const MAX_DECODED_SPRITES = 48;

export async function renderAstoniaRenderListToCanvas(canvas, renderList, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('Astonia canvas rendering requires a canvas');
  }
  if (!renderList || !Array.isArray(renderList.commands)) {
    clearCanvas(canvas);
    return { status: 'empty', decodedSprites: 0, missingSprites: 0 };
  }

  const width = positiveInteger(renderList.viewport?.canvasWidth, 1);
  const height = positiveInteger(renderList.viewport?.canvasHeight, 1);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return { status: 'skipped', reason: '2d-context-unavailable' };
  }

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#111416';
  context.fillRect(0, 0, width, height);

  const spriteResolution = options.spriteAssets
    ? await decodeRenderListSprites(renderList, options.spriteAssets, {
        maxSprites: options.maxDecodedSprites ?? MAX_DECODED_SPRITES
      })
    : emptySpriteResolution();
  const imageCache = new Map();

  for (const command of renderList.commands) {
    drawFallback(context, command);
    const sprite = spriteResolution.decodedSprites.get(command.spriteId);
    if (sprite) {
      const bitmap = imageCache.get(sprite.spriteId) ?? spriteToImageBitmap(sprite);
      imageCache.set(sprite.spriteId, bitmap);
      context.drawImage(bitmap, Math.round(command.screen.x - bitmap.width / 2), Math.round(command.screen.y - bitmap.height + 10));
    }
  }

  for (const bitmap of imageCache.values()) {
    bitmap.close?.();
  }

  return {
    status: 'rendered',
    decodedSprites: spriteResolution.decoded.length,
    missingSprites: spriteResolution.missing.length,
    skippedSprites: spriteResolution.skipped.length
  };
}

function drawFallback(context, command) {
  const { x, y } = command.screen;
  context.fillStyle = command.fallbackColor ?? '#6f6354';

  if (command.layer === 'character') {
    context.beginPath();
    context.arc(x, y - 12, 10, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + 20, y + 10);
  context.lineTo(x, y + 20);
  context.lineTo(x - 20, y + 10);
  context.closePath();
  context.fill();
}

function spriteToImageBitmap(sprite) {
  const imageData = new ImageData(new Uint8ClampedArray(sprite.pixels), sprite.width, sprite.height);
  const canvas = new OffscreenCanvas(sprite.width, sprite.height);
  const context = canvas.getContext('2d');
  context.putImageData(imageData, 0, 0);
  return canvas.transferToImageBitmap();
}

function emptySpriteResolution() {
  return {
    decoded: [],
    decodedSprites: new Map(),
    missing: [],
    skipped: []
  };
}

function clearCanvas(canvas) {
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
