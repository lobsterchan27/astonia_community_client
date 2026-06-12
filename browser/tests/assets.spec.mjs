import { expect, test } from '@playwright/test';

test('browser asset loader enumerates real gx1.zip sprite entries', async ({ page }) => {
  await page.goto('/');

  const summary = await page.evaluate(async () => {
    const { loadSpriteAssets } = await import('/src/assets/sprite-assets.js');
    const assets = await loadSpriteAssets({
      baseArchives: ['gx1.zip'],
      optionalArchives: []
    });
    const entries = assets.listEntries('gx1.zip');

    return {
      archiveNames: assets.archiveNames,
      entryCount: entries.length,
      firstEntryNames: entries.slice(0, 8).map((entry) => entry.name),
      hasSprite0: assets.hasSprite(0),
      hasSprite7: assets.hasSprite(7)
    };
  });

  expect(summary.archiveNames).toEqual(['gx1.zip']);
  expect(summary.entryCount).toBeGreaterThan(100);
  expect(summary.firstEntryNames).toContain('00000000.png');
  expect(summary.hasSprite0).toBe(true);
  expect(summary.hasSprite7).toBe(true);
});

test('browser asset loader decodes selected gx1.zip PNG sprites to RGBA pixels', async ({ page }) => {
  await page.goto('/');

  const decodedSprites = await page.evaluate(async () => {
    const { loadSpriteAssets } = await import('/src/assets/sprite-assets.js');
    const assets = await loadSpriteAssets({
      baseArchives: ['gx1.zip'],
      optionalArchives: []
    });

    return Promise.all(
      [0, 7].map(async (spriteId) => {
        const sprite = await assets.decodeSprite(spriteId);

        return {
          spriteId: sprite.spriteId,
          entryName: sprite.entryName,
          archiveName: sprite.archiveName,
          width: sprite.width,
          height: sprite.height,
          pixelByteLength: sprite.pixels.byteLength
        };
      })
    );
  });

  expect(decodedSprites).toEqual([
    {
      spriteId: 0,
      entryName: '00000000.png',
      archiveName: 'gx1.zip',
      width: 40,
      height: 19,
      pixelByteLength: 40 * 19 * 4
    },
    {
      spriteId: 7,
      entryName: '00000007.png',
      archiveName: 'gx1.zip',
      width: 120,
      height: 600,
      pixelByteLength: 120 * 600 * 4
    }
  ]);
});

test('browser asset loader caches decoded sprite pixels', async ({ page }) => {
  await page.goto('/');

  const cacheResult = await page.evaluate(async () => {
    const { loadSpriteAssets } = await import('/src/assets/sprite-assets.js');
    const assets = await loadSpriteAssets({
      baseArchives: ['gx1.zip'],
      optionalArchives: []
    });
    const [first, second] = await Promise.all([assets.decodeSprite(0), assets.decodeSprite(0)]);
    const third = await assets.decodeSprite(0);

    return {
      sameConcurrentObject: first === second,
      sameLaterObject: first === third,
      samePixelBuffer: first.pixels === third.pixels,
      spriteId: third.spriteId,
      pixelByteLength: third.pixels.byteLength
    };
  });

  expect(cacheResult).toEqual({
    sameConcurrentObject: true,
    sameLaterObject: true,
    samePixelBuffer: true,
    spriteId: 0,
    pixelByteLength: 40 * 19 * 4
  });
});

test('browser asset loader treats missing patch and mod zips as optional overlays', async ({ page }) => {
  await page.goto('/');

  const overlaySummary = await page.evaluate(async () => {
    const { loadSpriteAssets } = await import('/src/assets/sprite-assets.js');
    const assets = await loadSpriteAssets({
      baseArchives: ['gx1.zip'],
      optionalArchives: ['gx1_patch.zip', 'missing_mod.zip']
    });
    const sprite = await assets.decodeSprite(800);

    return {
      archiveNames: assets.archiveNames,
      missingOptionalArchives: assets.missingOptionalArchives,
      hasPatchSprite: assets.hasSprite(800),
      decodedSprite: {
        spriteId: sprite.spriteId,
        entryName: sprite.entryName,
        archiveName: sprite.archiveName,
        width: sprite.width,
        height: sprite.height,
        pixelByteLength: sprite.pixels.byteLength
      }
    };
  });

  expect(overlaySummary).toEqual({
    archiveNames: ['gx1.zip', 'gx1_patch.zip'],
    missingOptionalArchives: ['missing_mod.zip'],
    hasPatchSprite: true,
    decodedSprite: {
      spriteId: 800,
      entryName: '00000800.png',
      archiveName: 'gx1_patch.zip',
      width: 32,
      height: 32,
      pixelByteLength: 32 * 32 * 4
    }
  });
});
