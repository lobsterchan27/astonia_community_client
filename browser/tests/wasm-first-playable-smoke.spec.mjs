import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAttributionArtifact,
  installAttributionProbe,
  runAttributionSampling,
  writeAttributionArtifact
} from './helpers/attribution-probe.mjs';
import { analyzeScreenshot } from './helpers/png-stats.mjs';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const artifactDir = resolve(repoRoot, '.worktree/first-playable-smoke');
const screenshotPath = resolve(artifactDir, 'wasm-first-playable-canvas.png');
const evidencePath = resolve(artifactDir, 'wasm-first-playable-evidence.json');
const failureScreenshotPath = resolve(artifactDir, 'wasm-first-playable-failure-page.png');
const failureEvidencePath = resolve(artifactDir, 'wasm-first-playable-failure.json');
const launchProbePrefix = '[DEBUG-wasm-launch-probe]';
const waitTimeoutMs = Number.parseInt(process.env.ASTONIA_FIRST_PLAYABLE_WAIT_MS ?? '45000', 10);
const stableSceneMs = Number.parseInt(process.env.ASTONIA_FIRST_PLAYABLE_STABLE_MS ?? '3000', 10);
const responsivenessDurationMs = Math.max(
  5_000,
  Number.parseInt(process.env.ASTONIA_FIRST_PLAYABLE_RESPONSIVENESS_MS ?? '10000', 10)
);
const responsivenessPingIntervalMs = 500;
const responsivenessEvalTimeoutMs = 2_000;

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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function installFirstPlayableProbe(page) {
  await page.addInitScript(() => {
    window.astoniaFirstPlayableReadNative = (stage = 'sample') => {
      const module = window.astoniaNativeModule;
      if (!module) {
        return null;
      }

      const read = (exportName) => {
        const fn = module[exportName];
        if (typeof fn !== 'function') {
          return null;
        }
        try {
          const value = fn();
          return typeof value === 'bigint' ? Number(value) : Number(value);
        } catch {
          return null;
        }
      };

      return {
        stage,
        elapsedMs: Number(performance.now().toFixed(3)),
        startup: {
          adapterStatus: read('_astonia_native_startup_adapter_status'),
          startupResult: read('_astonia_native_startup_adapter_startup_result'),
          loopInitResult: read('_astonia_native_startup_adapter_loop_init_result'),
          frameCount: read('_astonia_native_startup_adapter_frame_count'),
          stepCount: read('_astonia_native_startup_adapter_step_count'),
          shutdownCount: read('_astonia_native_startup_adapter_shutdown_count'),
          hasUsername: read('_astonia_native_startup_adapter_has_username'),
          hasPassword: read('_astonia_native_startup_adapter_has_password'),
          hasServerUrl: read('_astonia_native_startup_adapter_has_server_url')
        },
        gateway: {
          loginDone: read('_astonia_smoke_login_done'),
          sockstate: read('_astonia_smoke_sockstate'),
          protocolVersion: read('_astonia_smoke_protocol_version'),
          tick: read('_astonia_smoke_tick'),
          queuedTicks: read('_astonia_smoke_queued_ticks'),
          queueSize: read('_astonia_smoke_queue_size')
        },
        render: {
          renderBeginCount: read('_astonia_smoke_render_begin_count'),
          renderPresentCount: read('_astonia_smoke_render_present_count'),
          renderPresentAfterLoginCount: read('_astonia_smoke_render_present_after_login_count'),
          renderPresentFailureCount: read('_astonia_smoke_render_present_failure_count'),
          textureCreateCount: read('_astonia_smoke_texture_create_count'),
          textureUploadCount: read('_astonia_smoke_texture_upload_count'),
          textureUploadFailureCount: read('_astonia_smoke_texture_upload_failure_count'),
          textureUploadFirstFailureCode: read('_astonia_smoke_texture_upload_first_failure_code'),
          textureUploadNontransparentSampleCount: read('_astonia_smoke_texture_upload_nontransparent_sample_count'),
          textureBlitCount: read('_astonia_smoke_texture_blit_count'),
          textureBlitVisibleCount: read('_astonia_smoke_texture_blit_visible_count'),
          textureBlitAfterLoginCount: read('_astonia_smoke_texture_blit_after_login_count'),
          textureBlitBounds: {
            minX: read('_astonia_smoke_texture_blit_bounds_min_x'),
            minY: read('_astonia_smoke_texture_blit_bounds_min_y'),
            maxX: read('_astonia_smoke_texture_blit_bounds_max_x'),
            maxY: read('_astonia_smoke_texture_blit_bounds_max_y')
          },
          textureJobQueueCount: read('_astonia_smoke_texture_job_queue_count'),
          textureJobDropCount: read('_astonia_smoke_texture_job_drop_count'),
          backendTextureUpdateFailureCount: read('_astonia_smoke_backend_texture_update_failure_count'),
          backendTexturedDrawCount: read('_astonia_smoke_backend_textured_draw_count'),
          backendTexturedDrawFailureCount: read('_astonia_smoke_backend_textured_draw_failure_count'),
          backendSubmitCount: read('_astonia_smoke_backend_submit_count'),
          backendSubmitFailureCount: read('_astonia_smoke_backend_submit_failure_count')
        },
        input: {
          mouseEventCount: read('_astonia_wasm_input_mouse_event_count'),
          mouseMoveCount: read('_astonia_wasm_input_mouse_move_count'),
          mouseButtonDownCount: read('_astonia_wasm_input_mouse_button_down_count'),
          mouseButtonUpCount: read('_astonia_wasm_input_mouse_button_up_count'),
          mouseWheelCount: read('_astonia_wasm_input_mouse_wheel_count'),
          mouseActiveButtons: read('_astonia_wasm_input_mouse_active_buttons'),
          mouseLastX: read('_astonia_wasm_input_mouse_last_x'),
          mouseLastY: read('_astonia_wasm_input_mouse_last_y'),
          mouseLastButton: read('_astonia_wasm_input_mouse_last_button'),
          mouseLastPressed: read('_astonia_wasm_input_mouse_last_pressed'),
          mouseLastWhat: read('_astonia_wasm_input_mouse_last_what')
        }
      };
    };
  });
}

async function readNativeSnapshot(page, stage) {
  return page.evaluate((sampleStage) => window.astoniaFirstPlayableReadNative?.(sampleStage) ?? null, stage);
}

async function readGatewayProbe(page) {
  return page.evaluate(() => window.astoniaAttributionProbe?.gateway ?? null).catch(() => null);
}

async function captureFailureArtifact(page, context) {
  const native = await readNativeSnapshot(page, 'failure').catch(() => null);
  const gateway = await readGatewayProbe(page);
  await page.screenshot({ path: failureScreenshotPath, fullPage: true }).catch(() => {});
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'astonia_wasm_first_playable_failure',
    generatedAt: new Date().toISOString(),
    failureScreenshotPath,
    native,
    gateway,
    ...context
  };
  writeJson(failureEvidencePath, artifact);
  return artifact;
}

function expectRecognizableVisualScene(visual) {
  expect(visual.width).toBe(1280);
  expect(visual.height).toBeGreaterThanOrEqual(720);
  expect(visual.height).toBeLessThanOrEqual(722);
  expect(visual.full.nonBlackRatio).toBeGreaterThan(0.08);
  expect(visual.full.dominantColorRatio).toBeLessThan(0.85);
  expect(visual.full.uniqueColorBuckets).toBeGreaterThan(64);
  expect(visual.full.edgeTransitions).toBeGreaterThan(1000);
  expect(visual.world.uniqueColorBuckets + visual.lowerUi.uniqueColorBuckets).toBeGreaterThan(96);
}

test('first playable production boundary stays native-only', () => {
  const productionSources = [
    'browser/src/main.js',
    'src/wasm/astonia_net_jslib.js',
    'gateway/src/lib.rs',
    'gateway/src/main.rs'
  ];
  const forbidden = [
    ['server opcode constants', /\bSV_[A-Z0-9_]+\b/],
    ['client opcode constants', /\bCL_[A-Z0-9_]+\b/],
    ['native command packet construction', /\b(?:build|encode|construct)(?:Client|Native|Protocol)?(?:Command|Packet)\b/i],
    ['binary protocol readers', /\b(?:DataView|getUint(?:8|16|32)|readUInt(?:8|16|32)|net_read16|load_u(?:16|32))\b/],
    ['movement prediction', /\b(?:predictMovement|movementPrediction|clientPrediction|reconcileMovement)\b/i],
    ['sprite decoding', /\b(?:decodeSprite|spriteSheet|spriteArchive|archiveDecoder|pakDecoder)\b/i],
    ['browser canvas renderer', /\b(?:drawImage|putImageData|renderList|worldRenderer)\b/i],
    ['server image stream', /\b(?:imageStream|serverRenderedImage|jpegStream|pngStream)\b/i]
  ];
  const failures = [];

  for (const source of productionSources) {
    const text = readFileSync(resolve(repoRoot, source), 'utf8');
    for (const [label, pattern] of forbidden) {
      const match = text.match(pattern);
      if (match) {
        failures.push(`${source}: ${label} matched ${match[0]}`);
      }
    }
  }

  expect(failures).toEqual([]);
});

test.describe('WASM first playable browser smoke', () => {
  test.skip(
    process.env.ASTONIA_FIRST_PLAYABLE_SMOKE !== '1',
    'set ASTONIA_FIRST_PLAYABLE_SMOKE=1 to run the disposable first-playable live smoke'
  );
  test.skip(!existsSync(distModulePath), 'native WASM module has not been built');

  test('launches, renders, accepts native pointer input, and stays responsive', async ({ page }, testInfo) => {
    test.setTimeout(waitTimeoutMs + stableSceneMs + responsivenessDurationMs + 30_000);
    const gatewayUrl = process.env.ASTONIA_LIVE_GATEWAY_URL ?? 'ws://127.0.0.1:8787';
    const username = process.env.ASTONIA_LIVE_USERNAME ?? 'BrowserSmoke';
    const consoleMessages = [];
    const pageErrors = [];
    const launchEvents = [];
    let liveReady = null;
    let beforeInteraction = null;
    let afterInteraction = null;
    let afterResponsiveness = null;
    let visual = null;
    let attributionArtifact = null;
    let attributionPath = null;
    let responsivenessSampling = null;
    let interaction = null;

    page.on('console', (message) => {
      const entry = { type: message.type(), text: message.text() };
      consoleMessages.push(entry);
      const launchEvent = parseConsoleJson(entry.text, launchProbePrefix);
      if (launchEvent) {
        launchEvents.push(launchEvent);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));

    try {
      await installAttributionProbe(page, { wrapWebGpu: false });
      await installFirstPlayableProbe(page);
      await page.goto('/?astonia_probe=1');
      await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');
      await page.locator('input[name="gateway"]').fill(gatewayUrl);
      await page.locator('input[name="username"]').fill(username);
      await page.locator('input[name="password"]').fill(process.env.ASTONIA_LIVE_PASSWORD ?? 'fixturecapture');
      await page.getByRole('button', { name: 'Launch' }).click();

      await page.waitForFunction(
        () => {
          const sample = window.astoniaFirstPlayableReadNative?.('live-ready-check');
          return (
            sample?.startup.adapterStatus === 2 &&
            sample?.startup.startupResult === 0 &&
            sample?.startup.loopInitResult === 0 &&
            sample?.startup.hasUsername === 1 &&
            sample?.startup.hasPassword === 1 &&
            sample?.startup.hasServerUrl === 1 &&
            sample?.gateway.loginDone === 1 &&
            sample?.gateway.sockstate === 4 &&
            sample?.gateway.protocolVersion > 0 &&
            sample?.gateway.tick > 0 &&
            sample?.render.renderPresentAfterLoginCount > 0 &&
            sample?.render.textureUploadCount > 128 &&
            sample?.render.textureBlitAfterLoginCount > 0 &&
            sample?.render.renderPresentFailureCount === 0 &&
            sample?.render.textureUploadFailureCount === 0
          );
        },
        undefined,
        { timeout: waitTimeoutMs }
      );

      liveReady = await readNativeSnapshot(page, 'live-ready');
      await page.waitForTimeout(stableSceneMs);
      beforeInteraction = await readNativeSnapshot(page, 'before-interaction');

      mkdirSync(artifactDir, { recursive: true });
      const screenshot = await page.locator('[data-testid="wasm-client-canvas"]').screenshot({ path: screenshotPath });
      visual = analyzeScreenshot(screenshot);

      const box = await page.locator('[data-testid="wasm-client-canvas"]').boundingBox();
      expect(box).not.toBeNull();
      interaction = {
        button: 0,
        canvasX: 640,
        canvasY: 360,
        pageX: Math.round(box.x + box.width * 0.5),
        pageY: Math.round(box.y + box.height * 0.5),
        beforeInput: beforeInteraction.input
      };
      await page.mouse.move(interaction.pageX, interaction.pageY);
      await page.mouse.down({ button: 'left' });
      await page.mouse.up({ button: 'left' });
      await page.waitForFunction(
        ({ downBefore, upBefore }) => {
          const sample = window.astoniaFirstPlayableReadNative?.('after-pointer-check');
          return (
            sample?.input.mouseButtonDownCount > downBefore &&
            sample?.input.mouseButtonUpCount > upBefore &&
            sample?.input.mouseActiveButtons === 0
          );
        },
        {
          downBefore: beforeInteraction.input.mouseButtonDownCount,
          upBefore: beforeInteraction.input.mouseButtonUpCount
        },
        { timeout: 5_000 }
      );
      afterInteraction = await readNativeSnapshot(page, 'after-interaction');

      responsivenessSampling = await runAttributionSampling(page, {
        durationMs: responsivenessDurationMs,
        pingIntervalMs: responsivenessPingIntervalMs,
        evaluationTimeoutMs: responsivenessEvalTimeoutMs
      });
      afterResponsiveness = await readNativeSnapshot(page, 'after-responsiveness');

      attributionArtifact = await buildAttributionArtifact(page, {
        mode: 'first_playable_smoke',
        inputs: {
          liveFixtureEnabled: true,
          gatewayUrl,
          durationMs: responsivenessDurationMs,
          evaluationTimeoutMs: responsivenessEvalTimeoutMs,
          username
        },
        pageEvidence: { consoleMessages, pageErrors },
        sampling: responsivenessSampling,
        outcome: {
          liveReady,
          beforeInteraction,
          afterInteraction,
          afterResponsiveness,
          visual,
          interaction,
          screenshotPath,
          launchEvents
        }
      });
      attributionPath = await writeAttributionArtifact(testInfo, attributionArtifact, 'first-playable-smoke-attribution');

      const evidence = {
        schemaVersion: 1,
        artifactKind: 'astonia_wasm_first_playable',
        generatedAt: new Date().toISOString(),
        gatewayUrl,
        screenshotPath,
        attributionPath,
        liveReady,
        nativeBeforeInteraction: beforeInteraction,
        nativeAfterInteraction: afterInteraction,
        nativeAfterResponsiveness: afterResponsiveness,
        visual,
        interaction,
        responsiveness: attributionArtifact.host.responsiveness,
        gateway: attributionArtifact.gateway,
        classification: attributionArtifact.classification,
        launchEvents
      };
      writeJson(evidencePath, evidence);
      await testInfo.attach('wasm-first-playable-canvas', { path: screenshotPath, contentType: 'image/png' });
      await testInfo.attach('wasm-first-playable-evidence', { path: evidencePath, contentType: 'application/json' });

      expect(pageErrors).toEqual([]);
      expect(launchEvents.map((event) => event.stage)).toEqual(
        expect.arrayContaining(['create-module-start', 'create-module-resolved', 'running'])
      );
      expect(launchEvents.some((event) => event.detail?.arguments?.includes(gatewayUrl))).toBe(true);
      expect(liveReady).toMatchObject({
        startup: {
          adapterStatus: 2,
          startupResult: 0,
          loopInitResult: 0,
          hasUsername: 1,
          hasPassword: 1,
          hasServerUrl: 1
        },
        gateway: {
          loginDone: 1,
          sockstate: 4
        }
      });
      expect(liveReady.gateway.protocolVersion).toBeGreaterThan(0);
      expect(liveReady.gateway.tick).toBeGreaterThan(0);
      expect(liveReady.render.renderPresentAfterLoginCount).toBeGreaterThan(0);
      expect(liveReady.render.textureUploadCount).toBeGreaterThan(128);
      expect(liveReady.render.textureUploadFailureCount).toBe(0);
      expect(liveReady.render.textureUploadFirstFailureCode).toBe(0);
      expect(liveReady.render.textureBlitAfterLoginCount).toBeGreaterThan(0);
      expect(liveReady.render.backendTextureUpdateFailureCount).toBe(0);
      expectRecognizableVisualScene(visual);

      expect(afterInteraction.input.mouseButtonDownCount).toBeGreaterThan(beforeInteraction.input.mouseButtonDownCount);
      expect(afterInteraction.input.mouseButtonUpCount).toBeGreaterThan(beforeInteraction.input.mouseButtonUpCount);
      expect(afterInteraction.input.mouseEventCount).toBeGreaterThan(beforeInteraction.input.mouseEventCount);
      expect(afterInteraction.input.mouseActiveButtons).toBe(0);
      expect(Math.abs(afterInteraction.input.mouseLastX - interaction.canvasX)).toBeLessThanOrEqual(1);
      expect(Math.abs(afterInteraction.input.mouseLastY - interaction.canvasY)).toBeLessThanOrEqual(1);
      expect(afterInteraction.input.mouseLastButton).toBe(0);
      expect(afterInteraction.input.mouseLastPressed).toBe(0);

      expect(responsivenessSampling.browserEvaluationTimedOut).toBe(false);
      expect(responsivenessSampling.pings.length).toBeGreaterThanOrEqual(
        Math.floor(responsivenessDurationMs / responsivenessPingIntervalMs) - 1
      );
      expect(Math.max(...responsivenessSampling.pings.map((ping) => ping.roundTripMs))).toBeLessThan(
        responsivenessEvalTimeoutMs
      );
      expect(afterResponsiveness.startup.frameCount).toBeGreaterThan(afterInteraction.startup.frameCount);
      expect(afterResponsiveness.startup.stepCount).toBeGreaterThan(afterInteraction.startup.stepCount);
      expect(afterResponsiveness.render.renderPresentCount).toBeGreaterThan(afterInteraction.render.renderPresentCount);
      expect(attributionArtifact.classification.bucket).toBe('no_freeze_observed');
      expect(attributionArtifact.gateway.connections.some((connection) => connection.url.startsWith(gatewayUrl))).toBe(true);
      expect(attributionArtifact.gateway.counts.constructed).toBeGreaterThan(0);
      expect(attributionArtifact.gateway.counts.open).toBeGreaterThan(0);
      expect(attributionArtifact.gateway.counts.read).toBeGreaterThan(0);
      expect(attributionArtifact.gateway.counts.send).toBeGreaterThan(0);
      expect(attributionArtifact.gateway.counts.bytesRead).toBeGreaterThan(0);
      expect(attributionArtifact.gateway.counts.bytesSent).toBeGreaterThan(0);
    } catch (error) {
      const failure = await captureFailureArtifact(page, {
        gatewayUrl,
        consoleMessages,
        pageErrors,
        launchEvents,
        liveReady,
        beforeInteraction,
        afterInteraction,
        afterResponsiveness,
        visual,
        responsivenessSampling,
        attributionPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nfirst playable failure artifact: ${failureEvidencePath}\nnative failure sample: ${JSON.stringify(failure.native)}`);
    }
  });
});
