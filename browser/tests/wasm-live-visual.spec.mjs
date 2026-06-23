import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const visualArtifactDir = resolve(repoRoot, '.worktree/smoke');
const screenshotPath = resolve(visualArtifactDir, 'wasm-live-visual-canvas.png');
const statsPath = resolve(visualArtifactDir, 'wasm-live-visual-canvas.stats.json');
const failureScreenshotPath = resolve(visualArtifactDir, 'wasm-live-visual-failure-page.png');
const failureStatsPath = resolve(visualArtifactDir, 'wasm-live-visual-failure.json');
const launchProbePrefix = '[DEBUG-wasm-launch-probe]';
const waitTimeoutMs = Number.parseInt(process.env.ASTONIA_LIVE_VISUAL_WAIT_MS ?? '30000', 10);
const stableWindowMs = Number.parseInt(process.env.ASTONIA_LIVE_VISUAL_STABLE_MS ?? '30000', 10);
const artifactSlackMs = 20000;

test.use({
  launchOptions: {
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=vulkan']
  }
});

function parseConsoleJson(text, prefix) {
  if (!text.includes(prefix)) {
    return null;
  }

  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) {
    return null;
  }

  return JSON.parse(text.slice(jsonStart));
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function bytesPerPixel(colorType) {
  if (colorType === 6) {
    return 4;
  }
  if (colorType === 2) {
    return 3;
  }
  throw new Error(`unsupported PNG color type ${colorType}`);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function unfilterPngScanlines(inflated, width, height, pixelBytes) {
  const stride = width * pixelBytes;
  const rows = Buffer.alloc(stride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[sourceOffset++];
    const rowOffset = y * stride;
    const previousRowOffset = rowOffset - stride;

    for (let x = 0; x < stride; x++) {
      const raw = inflated[sourceOffset++];
      const left = x >= pixelBytes ? rows[rowOffset + x - pixelBytes] : 0;
      const up = y > 0 ? rows[previousRowOffset + x] : 0;
      const upLeft = y > 0 && x >= pixelBytes ? rows[previousRowOffset + x - pixelBytes] : 0;

      if (filter === 0) {
        rows[rowOffset + x] = raw;
      } else if (filter === 1) {
        rows[rowOffset + x] = (raw + left) & 0xff;
      } else if (filter === 2) {
        rows[rowOffset + x] = (raw + up) & 0xff;
      } else if (filter === 3) {
        rows[rowOffset + x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        rows[rowOffset + x] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      } else {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
  }

  return rows;
}

function readPngPixels(pngBuffer) {
  const signature = pngBuffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('not a PNG file');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  let offset = 8;

  while (offset < pngBuffer.length) {
    const length = readUInt32(pngBuffer, offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = pngBuffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  }

  const pixelBytes = bytesPerPixel(colorType);
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = unfilterPngScanlines(inflated, width, height, pixelBytes);
  return { width, height, pixelBytes, pixels };
}

function regionStats(image, bounds) {
  const { width, pixelBytes, pixels } = image;
  const x0 = Math.max(0, Math.floor(bounds.x));
  const y0 = Math.max(0, Math.floor(bounds.y));
  const x1 = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const y1 = Math.min(image.height, Math.ceil(bounds.y + bounds.height));
  const buckets = new Set();
  const exactColors = new Set();
  const counts = new Map();
  let pixelsSeen = 0;
  let nonBlackPixels = 0;
  let lumaSum = 0;
  let lumaMin = 255;
  let lumaMax = 0;
  let edgeTransitions = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * width + x) * pixelBytes;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const bucket = `${r >> 3},${g >> 3},${b >> 3}`;
      const exact = `${r},${g},${b}`;

      pixelsSeen++;
      lumaSum += luma;
      lumaMin = Math.min(lumaMin, luma);
      lumaMax = Math.max(lumaMax, luma);
      if (r > 8 || g > 8 || b > 8) {
        nonBlackPixels++;
      }
      buckets.add(bucket);
      if (exactColors.size < 4096) {
        exactColors.add(exact);
      }
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);

      if (x > x0) {
        const leftOffset = offset - pixelBytes;
        const distance =
          Math.abs(r - pixels[leftOffset]) +
          Math.abs(g - pixels[leftOffset + 1]) +
          Math.abs(b - pixels[leftOffset + 2]);
        if (distance > 30) {
          edgeTransitions++;
        }
      }
      if (y > y0) {
        const upOffset = offset - width * pixelBytes;
        const distance =
          Math.abs(r - pixels[upOffset]) +
          Math.abs(g - pixels[upOffset + 1]) +
          Math.abs(b - pixels[upOffset + 2]);
        if (distance > 30) {
          edgeTransitions++;
        }
      }
    }
  }

  const dominantBucketPixels = Math.max(0, ...counts.values());
  return {
    pixels: pixelsSeen,
    uniqueColorBuckets: buckets.size,
    sampledExactColors: exactColors.size,
    nonBlackRatio: Number((nonBlackPixels / pixelsSeen).toFixed(6)),
    dominantColorRatio: Number((dominantBucketPixels / pixelsSeen).toFixed(6)),
    lumaMin: Number(lumaMin.toFixed(3)),
    lumaMax: Number(lumaMax.toFixed(3)),
    lumaMean: Number((lumaSum / pixelsSeen).toFixed(3)),
    edgeTransitions
  };
}

function analyzeScreenshot(pngBuffer) {
  const image = readPngPixels(pngBuffer);
  const full = regionStats(image, { x: 0, y: 0, width: image.width, height: image.height });
  const world = regionStats(image, {
    x: image.width * 0.18,
    y: image.height * 0.08,
    width: image.width * 0.64,
    height: image.height * 0.58
  });
  const lowerUi = regionStats(image, {
    x: 0,
    y: image.height * 0.68,
    width: image.width,
    height: image.height * 0.32
  });

  return {
    width: image.width,
    height: image.height,
    full,
    world,
    lowerUi
  };
}

function nativeSnapshot() {
  const module = window.astoniaNativeModule;
  if (!module) {
    return null;
  }

  return {
    adapterStatus: module._astonia_native_startup_adapter_status?.(),
    startupResult: module._astonia_native_startup_adapter_startup_result?.(),
    loopInitResult: module._astonia_native_startup_adapter_loop_init_result?.(),
    frameCount: module._astonia_native_startup_adapter_frame_count?.(),
    stepCount: module._astonia_native_startup_adapter_step_count?.(),
    loginDone: module._astonia_smoke_login_done?.(),
    sockstate: module._astonia_smoke_sockstate?.(),
    protocolVersion: module._astonia_smoke_protocol_version?.(),
    tick: module._astonia_smoke_tick?.(),
    renderBeginCount: module._astonia_smoke_render_begin_count?.(),
    renderPresentCount: module._astonia_smoke_render_present_count?.(),
    renderPresentAfterLoginCount: module._astonia_smoke_render_present_after_login_count?.(),
    renderPresentFailureCount: module._astonia_smoke_render_present_failure_count?.(),
    textureCreateCount: module._astonia_smoke_texture_create_count?.(),
    textureUploadCount: module._astonia_smoke_texture_upload_count?.(),
    textureUploadFailureCount: module._astonia_smoke_texture_upload_failure_count?.(),
    textureUploadFirstFailure: {
      code: module._astonia_smoke_texture_upload_first_failure_code?.(),
      sprite: module._astonia_smoke_texture_upload_first_failure_sprite?.(),
      width: module._astonia_smoke_texture_upload_first_failure_width?.(),
      height: module._astonia_smoke_texture_upload_first_failure_height?.(),
      pitch: module._astonia_smoke_texture_upload_first_failure_pitch?.(),
      row: module._astonia_smoke_texture_upload_first_failure_row?.(),
      rect: {
        x: module._astonia_smoke_texture_upload_first_failure_rect_x?.(),
        y: module._astonia_smoke_texture_upload_first_failure_rect_y?.(),
        w: module._astonia_smoke_texture_upload_first_failure_rect_w?.(),
        h: module._astonia_smoke_texture_upload_first_failure_rect_h?.()
      }
    },
    textureUploadSampleCount: module._astonia_smoke_texture_upload_sample_count?.(),
    textureUploadNontransparentSampleCount: module._astonia_smoke_texture_upload_nontransparent_sample_count?.(),
    textureUploadLastSampleCount: module._astonia_smoke_texture_upload_last_sample_count?.(),
    textureUploadLastNontransparentSampleCount: module._astonia_smoke_texture_upload_last_nontransparent_sample_count?.(),
    textureUploadLastWidth: module._astonia_smoke_texture_upload_last_width?.(),
    textureUploadLastHeight: module._astonia_smoke_texture_upload_last_height?.(),
    textureBlitCount: module._astonia_smoke_texture_blit_count?.(),
    textureBlitVisibleCount: module._astonia_smoke_texture_blit_visible_count?.(),
    textureBlitOffscreenCount: module._astonia_smoke_texture_blit_offscreen_count?.(),
    textureBlitZeroAlphaCount: module._astonia_smoke_texture_blit_zero_alpha_count?.(),
    textureBlitAfterLoginCount: module._astonia_smoke_texture_blit_after_login_count?.(),
    textureBlitLastRect: {
      x: module._astonia_smoke_texture_blit_last_x?.(),
      y: module._astonia_smoke_texture_blit_last_y?.(),
      w: module._astonia_smoke_texture_blit_last_w?.(),
      h: module._astonia_smoke_texture_blit_last_h?.()
    },
    textureBlitVisibleBounds: {
      minX: module._astonia_smoke_texture_blit_bounds_min_x?.(),
      minY: module._astonia_smoke_texture_blit_bounds_min_y?.(),
      maxX: module._astonia_smoke_texture_blit_bounds_max_x?.(),
      maxY: module._astonia_smoke_texture_blit_bounds_max_y?.()
    },
    textureJobQueueCount: module._astonia_smoke_texture_job_queue_count?.(),
    textureJobQueuePeak: module._astonia_smoke_texture_job_queue_peak?.(),
    textureJobEnqueueCount: module._astonia_smoke_texture_job_enqueue_count?.(),
    textureJobDropCount: module._astonia_smoke_texture_job_drop_count?.(),
    textureCpuWorkCount: module._astonia_smoke_texture_cpu_work_count?.(),
    backendTextureUpdateCount: module._astonia_smoke_backend_texture_update_count?.(),
    backendTextureUpdateFailureCount: module._astonia_smoke_backend_texture_update_failure_count?.(),
    backendTextureCreateFailureCount: module._astonia_smoke_backend_texture_create_failure_count?.(),
    backendTextureCreateImageFailureCount: module._astonia_smoke_backend_texture_create_image_failure_count?.(),
    backendTextureCreateViewFailureCount: module._astonia_smoke_backend_texture_create_view_failure_count?.(),
    backendImagePoolSize: module._astonia_smoke_backend_image_pool_size?.(),
    backendViewPoolSize: module._astonia_smoke_backend_view_pool_size?.(),
    backendBindgroupsCacheSize: module._astonia_smoke_backend_bindgroups_cache_size?.(),
    backendTexturedDrawCount: module._astonia_smoke_backend_textured_draw_count?.(),
    backendTexturedDrawFailureCount: module._astonia_smoke_backend_textured_draw_failure_count?.(),
    backendPrimitiveDrawCount: module._astonia_smoke_backend_primitive_draw_count?.(),
    backendPrimitiveDrawFailureCount: module._astonia_smoke_backend_primitive_draw_failure_count?.(),
    backendSubmitCount: module._astonia_smoke_backend_submit_count?.(),
    backendSubmitFailureCount: module._astonia_smoke_backend_submit_failure_count?.()
  };
}

async function captureFailureArtifact(page, { gatewayUrl, launchEvents, consoleMessages, error }) {
  mkdirSync(dirname(failureStatsPath), { recursive: true });
  const native = await page.evaluate(nativeSnapshot).catch(() => null);
  const attribution = await page
    .evaluate(() => {
      return window.astoniaVisualFailureContext ?? null;
    })
    .catch(() => null);
  await page.screenshot({ path: failureScreenshotPath, fullPage: true }).catch(() => {});
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'astonia_wasm_live_visual_failure',
    generatedAt: new Date().toISOString(),
    gatewayUrl,
    failureScreenshotPath,
    error: error instanceof Error ? error.message : String(error),
    native,
    attribution,
    launchEvents,
    consoleMessages
  };
  writeFileSync(failureStatsPath, `${JSON.stringify(artifact, null, 2)}\n`);
  return artifact;
}

test.describe('WASM browser live visual smoke', () => {
  test.skip(process.env.ASTONIA_LIVE_VISUAL !== '1', 'set ASTONIA_LIVE_VISUAL=1 to run the real WebGPU visual smoke');
  test.skip(!existsSync(distModulePath), 'native WASM module has not been built');

  test('captures a non-flat native-rendered first scene with real WebGPU', async ({ page }, testInfo) => {
    test.setTimeout(waitTimeoutMs + stableWindowMs + artifactSlackMs);
    const gatewayUrl = process.env.ASTONIA_LIVE_GATEWAY_URL ?? 'ws://127.0.0.1:8787';
    const launchEvents = [];
    const consoleMessages = [];
    const pageErrors = [];

    page.on('console', (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() });
      const launchEvent = parseConsoleJson(message.text(), launchProbePrefix);
      if (launchEvent) {
        launchEvents.push(launchEvent);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));

    await page.addInitScript(() => {
      window.astoniaVisualFailureContext = {
        startedAt: performance.now(),
        webSocketUrls: []
      };
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, args) {
          window.astoniaVisualFailureContext.webSocketUrls.push(String(args[0]));
          return Reflect.construct(Target, args);
        }
      });
    });
    await page.goto('/?astonia_probe=1');
    await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');
    await page.locator('input[name="gateway"]').fill(gatewayUrl);
    await page.locator('input[name="username"]').fill(process.env.ASTONIA_LIVE_USERNAME ?? 'BrowserSmoke');
    await page.locator('input[name="password"]').fill(process.env.ASTONIA_LIVE_PASSWORD ?? 'fixturecapture');
    await page.getByRole('button', { name: 'Launch' }).click();

    await page.waitForFunction(
      () => {
        const module = window.astoniaNativeModule;
        const sample = module
          ? {
              adapterStatus: module._astonia_native_startup_adapter_status?.(),
              startupResult: module._astonia_native_startup_adapter_startup_result?.(),
              loopInitResult: module._astonia_native_startup_adapter_loop_init_result?.(),
              loginDone: module._astonia_smoke_login_done?.(),
              sockstate: module._astonia_smoke_sockstate?.(),
              protocolVersion: module._astonia_smoke_protocol_version?.(),
              tick: module._astonia_smoke_tick?.(),
              renderPresentCount: module._astonia_smoke_render_present_count?.(),
              renderPresentAfterLoginCount: module._astonia_smoke_render_present_after_login_count?.(),
              textureUploadCount: module._astonia_smoke_texture_upload_count?.(),
              textureBlitCount: module._astonia_smoke_texture_blit_count?.(),
              textureBlitAfterLoginCount: module._astonia_smoke_texture_blit_after_login_count?.()
            }
          : null;
        return (
          sample?.adapterStatus === 2 &&
          sample?.startupResult === 0 &&
          sample?.loopInitResult === 0 &&
          sample?.loginDone === 1 &&
          sample?.sockstate === 4 &&
          sample?.protocolVersion > 0 &&
          sample?.tick > 0 &&
          sample?.renderPresentCount > 0 &&
          sample?.renderPresentAfterLoginCount > 0 &&
          sample?.textureUploadCount > 0 &&
          sample?.textureBlitCount >= 4 &&
          sample?.textureBlitAfterLoginCount > 0
        );
      },
      undefined,
      { timeout: waitTimeoutMs }
    ).catch(async (error) => {
      const artifact = await captureFailureArtifact(page, { gatewayUrl, launchEvents, consoleMessages, error });
      throw new Error(
        `${error.message}\nlast native sample: ${JSON.stringify(artifact.native)}\nfailure artifact: ${failureStatsPath}`
      );
    });

    await page.waitForTimeout(500);
    const stableStart = await page.evaluate(nativeSnapshot);
    await page.waitForTimeout(stableWindowMs);
    const native = await page.evaluate(nativeSnapshot);
    mkdirSync(dirname(screenshotPath), { recursive: true });
    const screenshot = await page.locator('[data-testid="wasm-client-canvas"]').screenshot({ path: screenshotPath });
    const visual = analyzeScreenshot(screenshot);
    const artifact = {
      schemaVersion: 1,
      artifactKind: 'astonia_wasm_live_visual',
      generatedAt: new Date().toISOString(),
      gatewayUrl,
      screenshotPath,
      stableWindowMs,
      stableStart,
      native,
      visual,
      launchEvents,
      rendererTextureUploadWarnings: consoleMessages.filter((entry) =>
        entry.text.includes('Renderer texture upload failed')
      )
    };
    writeFileSync(statsPath, `${JSON.stringify(artifact, null, 2)}\n`);
    await testInfo.attach('wasm-live-visual-canvas', {
      path: screenshotPath,
      contentType: 'image/png'
    });
    await testInfo.attach('wasm-live-visual-stats', {
      path: statsPath,
      contentType: 'application/json'
    });

    expect(pageErrors).toEqual([]);
    expect(native).toMatchObject({
      adapterStatus: 2,
      startupResult: 0,
      loopInitResult: 0,
      loginDone: 1,
      sockstate: 4,
      protocolVersion: 2,
      renderPresentFailureCount: 0
    });
    expect(native.renderPresentCount).toBeGreaterThan(0);
    expect(native.renderPresentCount).toBeGreaterThan(stableStart.renderPresentCount);
    expect(native.textureUploadCount).toBeGreaterThan(0);
    expect(native.textureCreateCount).toBeGreaterThan(128);
    expect(native.textureUploadCount).toBeGreaterThan(128);
    expect(native.textureUploadFailureCount).toBe(0);
    expect(native.textureUploadFirstFailure.code).toBe(0);
    expect(native.backendTextureCreateImageFailureCount).toBe(0);
    expect(native.textureBlitCount).toBeGreaterThanOrEqual(4);
    expect(artifact.rendererTextureUploadWarnings).toEqual([]);
    expect(visual.width).toBe(1280);
    expect(visual.height).toBeGreaterThanOrEqual(720);
    expect(visual.height).toBeLessThanOrEqual(722);
    expect(visual.full.nonBlackRatio).toBeGreaterThan(0.08);
    expect(visual.full.dominantColorRatio).toBeLessThan(0.85);
    expect(visual.full.uniqueColorBuckets).toBeGreaterThan(64);
    expect(visual.full.edgeTransitions).toBeGreaterThan(1000);
    expect(visual.world.uniqueColorBuckets + visual.lowerUi.uniqueColorBuckets).toBeGreaterThan(96);
  });
});
