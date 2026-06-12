import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function readNdjson(relativePath) {
  const text = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function fixtureRenderListSummary(page) {
  const ticks = await readNdjson('fixtures/protocol/docker-login-tick/ticks.ndjson');

  return page.evaluate(async (serializedTicks) => {
    const { AstoniaProtocolStateReplay } = await import('/src/protocol/state-replay.js');
    const { createAstoniaRenderList } = await import('/src/render/render-list.js');
    const replay = new AstoniaProtocolStateReplay();

    function base64ToBytes(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    for (const tick of serializedTicks) {
      replay.replayTickPayload(base64ToBytes(tick.data), { tickIndex: tick.index });
    }

    const renderList = createAstoniaRenderList(replay.snapshot());
    const byLayer = {};
    for (const command of renderList.commands) {
      byLayer[command.layer] = (byLayer[command.layer] ?? 0) + 1;
    }

    return {
      schemaVersion: renderList.schemaVersion,
      source: renderList.source,
      viewport: renderList.viewport,
      commandCount: renderList.commands.length,
      byLayer,
      firstCommand: renderList.commands[0],
      fixtureCharacterCommands: renderList.commands
        .filter((command) => command.layer === 'character')
        .map((command) => ({
          spriteId: command.spriteId,
          local: command.local,
          world: command.world,
          entity: command.entity,
          fallbackColor: command.fallbackColor
        }))
    };
  }, ticks);
}

async function fixtureRenderAssetSummary(page) {
  const ticks = await readNdjson('fixtures/protocol/docker-login-tick/ticks.ndjson');

  return page.evaluate(async (serializedTicks) => {
    const { loadSpriteAssets } = await import('/src/assets/sprite-assets.js');
    const { AstoniaProtocolStateReplay } = await import('/src/protocol/state-replay.js');
    const { createAstoniaRenderList } = await import('/src/render/render-list.js');
    const { decodeRenderListSprites } = await import('/src/render/sprite-resolver.js');
    const replay = new AstoniaProtocolStateReplay();

    function base64ToBytes(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    for (const tick of serializedTicks) {
      replay.replayTickPayload(base64ToBytes(tick.data), { tickIndex: tick.index });
    }

    const renderList = createAstoniaRenderList(replay.snapshot());
    const assets = await loadSpriteAssets({
      baseArchives: ['gx1.zip'],
      optionalArchives: []
    });
    const decoded = await decodeRenderListSprites(renderList, assets, {
      spriteIds: [2, 12_008, 147, 99_999_999]
    });

    return {
      decoded: decoded.decoded.map((sprite) => ({
        spriteId: sprite.spriteId,
        entryName: sprite.entryName,
        archiveName: sprite.archiveName,
        width: sprite.width,
        height: sprite.height,
        pixelByteLength: sprite.pixelByteLength
      })),
      missing: decoded.missing
    };
  }, ticks);
}

async function fixtureWebGpuRenderResult(page) {
  const ticks = await readNdjson('fixtures/protocol/docker-login-tick/ticks.ndjson');

  return page.evaluate(async (serializedTicks) => {
    const { loadSpriteAssets } = await import('/src/assets/sprite-assets.js');
    const { AstoniaProtocolStateReplay } = await import('/src/protocol/state-replay.js');
    const { createAstoniaRenderList } = await import('/src/render/render-list.js');
    const { renderAstoniaRenderListWithWebGpu } = await import('/src/render/webgpu-renderer.js');
    const replay = new AstoniaProtocolStateReplay();

    function base64ToBytes(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    for (const tick of serializedTicks) {
      replay.replayTickPayload(base64ToBytes(tick.data), { tickIndex: tick.index });
    }

    const renderList = createAstoniaRenderList(replay.snapshot());
    const assets = await loadSpriteAssets({
      baseArchives: ['gx1.zip'],
      optionalArchives: []
    });
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'webgpu-render-trace';
    document.body.append(canvas);

    return renderAstoniaRenderListWithWebGpu(canvas, renderList, {
      spriteAssets: assets,
      spriteIds: [2, 12_008],
      samplePixels: true
    });
  }, ticks);
}

test('replayed fixture snapshot converts to a stable neutral sprite render list', async ({ page }) => {
  await page.goto('/');

  const summary = await fixtureRenderListSummary(page);

  expect(summary.schemaVersion).toBe(1);
  expect(summary.source).toEqual({
    currentTick: 59471,
    origin: { x: 126, y: 179 },
    protocolVersion: 2
  });
  expect(summary.viewport).toMatchObject({
    width: 51,
    height: 51,
    distance: 25,
    tileWidth: 40,
    tileHeight: 20
  });
  expect(summary.viewport.canvasWidth).toBeGreaterThan(900);
  expect(summary.viewport.canvasHeight).toBeGreaterThan(500);
  expect(summary.commandCount).toBeGreaterThan(700);
  expect(summary.byLayer).toMatchObject({
    ground: 697,
    groundOverlay: 63,
    floor: 173,
    floorOverlay: 9,
    item: 9,
    character: 2
  });
  expect(summary.firstCommand).toEqual({
    id: 'ground:24,1:12008',
    type: 'sprite',
    layer: 'ground',
    spriteId: 12008,
    local: { x: 24, y: 1 },
    world: { x: 125, y: 155 },
    screen: expect.any(Object),
    fallbackColor: '#31583d'
  });
  expect(summary.fixtureCharacterCommands).toEqual([
    {
      spriteId: 2,
      local: { x: 25, y: 25 },
      world: { x: 126, y: 179 },
      entity: {
        id: 219,
        name: 'FixtureCapture',
        health: 100
      },
      fallbackColor: '#c9b37a'
    },
    {
      spriteId: 147,
      local: { x: 21, y: 29 },
      world: { x: 122, y: 183 },
      entity: {
        id: 351,
        name: 'James',
        health: 100
      },
      fallbackColor: '#c9b37a'
    }
  ]);
});

test('render list sprites decode through the existing asset catalog where available', async ({ page }) => {
  await page.goto('/');

  const summary = await fixtureRenderAssetSummary(page);

  expect(summary.decoded).toEqual([
    {
      spriteId: 2,
      entryName: '00000002.png',
      archiveName: 'gx1.zip',
      width: expect.any(Number),
      height: expect.any(Number),
      pixelByteLength: expect.any(Number)
    },
    {
      spriteId: 12_008,
      entryName: '00012008.png',
      archiveName: 'gx1.zip',
      width: expect.any(Number),
      height: expect.any(Number),
      pixelByteLength: expect.any(Number)
    }
  ]);
  expect(summary.decoded[0].pixelByteLength).toBe(summary.decoded[0].width * summary.decoded[0].height * 4);
  expect(summary.decoded[1].pixelByteLength).toBe(summary.decoded[1].width * summary.decoded[1].height * 4);
  expect(summary.missing).toEqual([
    {
      spriteId: 147,
      reason: 'not-found'
    },
    {
      spriteId: 99_999_999,
      reason: 'not-found'
    }
  ]);
});

test('2d canvas renderer keeps fallback pixels visible while sprite decode is pending', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { renderAstoniaRenderListToCanvas } = await import('/src/render/canvas-renderer.js');
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    let releaseSprite;
    const pendingSprite = new Promise((resolve) => {
      releaseSprite = resolve;
    });
    const renderList = {
      schemaVersion: 1,
      viewport: {
        canvasWidth: 96,
        canvasHeight: 96,
        tileWidth: 40,
        tileHeight: 20
      },
      commands: [
        {
          id: 'ground:0,0:12008',
          type: 'sprite',
          layer: 'ground',
          spriteId: 12_008,
          local: { x: 0, y: 0 },
          world: { x: 126, y: 179 },
          screen: { x: 48, y: 48 },
          fallbackColor: '#31583d'
        }
      ]
    };
    const renderPromise = renderAstoniaRenderListToCanvas(canvas, renderList, {
      spriteAssets: {
        hasSprite: () => true,
        decodeSprite: () => pendingSprite
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const pendingPixels = sampleCanvas(canvas);

    releaseSprite({
      spriteId: 12_008,
      entryName: '00012008.png',
      archiveName: 'test.zip',
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([255, 0, 0, 255])
    });
    const renderResult = await renderPromise;
    const finalPixels = sampleCanvas(canvas);

    return {
      pendingPixels,
      finalPixels,
      renderResult
    };

    function sampleCanvas(target) {
      const context = target.getContext('2d');
      const data = context.getImageData(0, 0, target.width, target.height).data;
      let background = 0;
      let fallback = 0;
      let red = 0;

      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];
        if (r === 17 && g === 20 && b === 22 && a === 255) {
          background += 1;
        }
        if (r === 49 && g === 88 && b === 61 && a === 255) {
          fallback += 1;
        }
        if (r === 255 && g === 0 && b === 0 && a === 255) {
          red += 1;
        }
      }

      return { background, fallback, red };
    }
  });

  expect(result.pendingPixels.fallback).toBeGreaterThan(100);
  expect(result.pendingPixels.background).toBeGreaterThan(100);
  expect(result.pendingPixels.red).toBe(0);
  expect(result.finalPixels.fallback).toBeGreaterThan(100);
  expect(result.finalPixels.red).toBe(1);
  expect(result.renderResult).toMatchObject({
    status: 'rendered',
    decodedSprites: 1,
    missingSprites: 0
  });
});

test('WebGPU render tracer reports an explicit skip when GPU access is unavailable', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { renderAstoniaRenderListWithWebGpu } = await import('/src/render/webgpu-renderer.js');
    const canvas = document.createElement('canvas');

    return renderAstoniaRenderListWithWebGpu(
      canvas,
      {
        schemaVersion: 1,
        viewport: {
          canvasWidth: 64,
          canvasHeight: 64,
          tileWidth: 40,
          tileHeight: 20
        },
        commands: [
          {
            id: 'ground:0,0:2',
            type: 'sprite',
            layer: 'ground',
            spriteId: 2,
            local: { x: 0, y: 0 },
            world: null,
            screen: { x: 32, y: 32 },
            fallbackColor: '#31583d'
          }
        ]
      },
      { gpu: null }
    );
  });

  expect(result).toEqual({
    status: 'skipped',
    reason: 'navigator-gpu-unavailable',
    detail: 'navigator.gpu is not available'
  });
});

test('WebGPU render tracer renders fixture commands to nonblank pixels when GPU is granted', async ({ page }) => {
  await page.goto('/');

  const result = await fixtureWebGpuRenderResult(page);

  if (result.status === 'skipped') {
    expect([
      'navigator-gpu-unavailable',
      'adapter-unavailable',
      'webgpu-context-unavailable',
      'device-request-failed'
    ]).toContain(result.reason);
    expect(result.detail).toEqual(expect.any(String));
    return;
  }

  expect(result).toMatchObject({
    status: 'rendered',
    canvas: {
      width: expect.any(Number),
      height: expect.any(Number)
    },
    draw: {
      fallbackCommands: 953,
      texturedCommands: expect.any(Number)
    },
    sprites: {
      decoded: expect.arrayContaining([
        expect.objectContaining({ spriteId: 2, archiveName: 'gx1.zip' }),
        expect.objectContaining({ spriteId: 12_008, archiveName: 'gx1.zip' })
      ]),
      missing: []
    },
    pixelSample: {
      checkedPixels: expect.any(Number),
      nonZeroColorPixels: expect.any(Number)
    }
  });
  expect(result.canvas.width).toBeGreaterThan(900);
  expect(result.canvas.height).toBeGreaterThan(500);
  expect(result.draw.texturedCommands).toBeGreaterThan(0);
  expect(result.pixelSample.checkedPixels).toBeGreaterThan(0);
  expect(result.pixelSample.nonZeroColorPixels).toBeGreaterThan(0);
});
