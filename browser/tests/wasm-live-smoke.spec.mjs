import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  buildAttributionArtifact,
  installAttributionProbe,
  installMockWebGpuAttribution,
  runAttributionSampling,
  writeAttributionArtifact
} from './helpers/attribution-probe.mjs';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const smokeSamplePrefix = '[live-smoke-native-sample]';
const launchProbePrefix = '[DEBUG-wasm-launch-probe]';
const responsivenessProbePrefix = '[live-smoke-responsiveness-ping]';
const responsivenessDurationMs = Math.max(
  20_000,
  Number.parseInt(process.env.ASTONIA_LIVE_SMOKE_RESPONSIVENESS_MS ?? '25000', 10)
);
const responsivenessPingIntervalMs = 500;
const responsivenessEvalTimeoutMs = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function installMockWebGpu(page) {
  await page.addInitScript(() => {
    const limits = {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxTextureDimension3D: 2048,
      maxTextureArrayLayers: 256,
      maxBindGroups: 4,
      maxBindGroupsPlusVertexBuffers: 24,
      maxBindingsPerBindGroup: 1000,
      maxDynamicUniformBuffersPerPipelineLayout: 8,
      maxDynamicStorageBuffersPerPipelineLayout: 4,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxUniformBuffersPerShaderStage: 12,
      minUniformBufferOffsetAlignment: 256,
      minStorageBufferOffsetAlignment: 256,
      maxUniformBufferBindingSize: 65536,
      maxStorageBufferBindingSize: 134217728,
      maxVertexBuffers: 8,
      maxBufferSize: 268435456,
      maxVertexAttributes: 16,
      maxVertexBufferArrayStride: 2048
    };
    const pass = {
      setPipeline() {},
      setBindGroup() {},
      setVertexBuffer() {},
      setIndexBuffer() {},
      setBlendConstant() {},
      setStencilReference() {},
      draw() {},
      drawIndexed() {},
      end() {}
    };
    const texture = {
      createView() {
        return {};
      },
      destroy() {}
    };
    const commandEncoder = {
      beginRenderPass() {
        return pass;
      },
      beginComputePass() {
        return pass;
      },
      finish() {
        return {};
      }
    };
    const device = {
      features: new Set(),
      limits,
      queue: {
        submit() {},
        writeBuffer() {},
        writeTexture() {}
      },
      lost: new Promise(() => {}),
      createTexture() {
        return texture;
      },
      createShaderModule() {
        return {};
      },
      createBuffer(desc = {}) {
        const size = Number(desc.size ?? 0);
        return {
          getMappedRange() {
            return new ArrayBuffer(size);
          },
          unmap() {},
          destroy() {}
        };
      },
      createSampler() {
        return {};
      },
      createBindGroupLayout() {
        return {};
      },
      createBindGroup() {
        return {};
      },
      createPipelineLayout() {
        return {};
      },
      createRenderPipeline() {
        return {};
      },
      createComputePipeline() {
        return {};
      },
      createCommandEncoder() {
        return commandEncoder;
      },
      destroy() {}
    };
    const adapter = {
      features: new Set(),
      limits,
      async requestDevice() {
        return device;
      }
    };
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === 'webgpu') {
        return {
          canvas: this,
          configure() {},
          getCurrentTexture() {
            return texture;
          }
        };
      }

      return nativeGetContext.call(this, type, ...args);
    };

    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get() {
        return {
          async requestAdapter() {
            return adapter;
          },
          getPreferredCanvasFormat() {
            return 'bgra8unorm';
          }
        };
      }
    });
  });
}

async function installResponsivenessProbe(page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;

    window.astoniaSmokeWebSocketUrls = [];
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        window.astoniaSmokeWebSocketUrls.push(String(args[0]));
        return Reflect.construct(Target, args);
      }
    });

    window.astoniaResponsivenessProbe = {
      intervalMs: 100,
      startedAt: performance.now(),
      timerTickCount: 0,
      timerTicks: [],
      domValues: [],
      nativeSamples: []
    };

    window.astoniaResponsivenessProbe.timer = window.setInterval(() => {
      const probe = window.astoniaResponsivenessProbe;
      const now = performance.now();
      const previous = probe.timerTicks.at(-1);
      probe.timerTickCount++;
      const tick = {
        count: probe.timerTickCount,
        elapsedMs: Number((now - probe.startedAt).toFixed(3)),
        deltaMs: previous ? Number((now - previous.now).toFixed(3)) : 0,
        now
      };
      probe.timerTicks.push(tick);
      if (probe.timerTicks.length > 500) {
        probe.timerTicks.shift();
      }

      const value = String(tick.count);
      document.documentElement.dataset.astoniaResponsivenessTick = value;
      probe.domValues.push({ value, elapsedMs: tick.elapsedMs });
      if (probe.domValues.length > 500) {
        probe.domValues.shift();
      }

      const module = window.astoniaNativeModule;
      if (typeof module?._astonia_native_startup_adapter_frame_count === 'function') {
        probe.nativeSamples.push({
          elapsedMs: tick.elapsedMs,
          frameCount: module._astonia_native_startup_adapter_frame_count(),
          stepCount: module._astonia_native_startup_adapter_step_count?.(),
          adapterStatus: module._astonia_native_startup_adapter_status?.(),
          tick: module._astonia_smoke_tick?.()
        });
        if (probe.nativeSamples.length > 500) {
          probe.nativeSamples.shift();
        }
      }
    }, window.astoniaResponsivenessProbe.intervalMs);
  });
}

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

function sampleHasInitialServerData(sample) {
  return sample.loginDone > 0 || sample.protocolVersion > 0 || sample.tick > 0 || sample.queueSize > 0;
}

function sampleNativeProgress(page) {
  return evaluateWithTimeout(
    page,
    () => {
      const module = window.astoniaNativeModule;
      if (typeof module?._astonia_native_startup_adapter_frame_count !== 'function') {
        return null;
      }

      return {
        elapsedMs: Number(performance.now().toFixed(3)),
        adapterStatus: module._astonia_native_startup_adapter_status(),
        frameCount: module._astonia_native_startup_adapter_frame_count(),
        stepCount: module._astonia_native_startup_adapter_step_count?.(),
        smokeTick: module._astonia_smoke_tick?.(),
        webSocketUrls: window.astoniaSmokeWebSocketUrls ?? []
      };
    },
    undefined,
    responsivenessEvalTimeoutMs,
    'native progress sample'
  );
}

async function evaluateWithTimeout(page, fn, arg, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function proveBrowserResponsiveness(page, durationMs) {
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  const pings = [];
  let lastTimerTickCount = 0;

  while (Date.now() < deadline) {
    const pingStartedAt = Date.now();
    const ping = await evaluateWithTimeout(
      page,
      (sequence) => {
        const probe = window.astoniaResponsivenessProbe;
        const lastTimerTick = probe?.timerTicks.at(-1) ?? null;
        const previousTimerTick = probe?.timerTicks.at(-2) ?? null;
        const marker = `eval-${sequence}`;
        document.body.dataset.astoniaResponsivenessEval = marker;

        return {
          sequence,
          elapsedMs: Number((performance.now() - probe.startedAt).toFixed(3)),
          marker,
          domMarker: document.body.dataset.astoniaResponsivenessEval,
          domTick: document.documentElement.dataset.astoniaResponsivenessTick ?? null,
          timerTickCount: probe.timerTickCount,
          lastTimerDeltaMs: lastTimerTick?.deltaMs ?? null,
          previousTimerDeltaMs: previousTimerTick?.deltaMs ?? null,
          nativeSampleCount: probe.nativeSamples.length,
          latestNativeSample: probe.nativeSamples.at(-1) ?? null
        };
      },
      pings.length + 1,
      responsivenessEvalTimeoutMs,
      'browser responsiveness eval probe'
    );

    pings.push({
      ...ping,
      roundTripMs: Date.now() - pingStartedAt,
      wallElapsedMs: Date.now() - startedAt
    });

    if (ping.domMarker !== ping.marker) {
      throw new Error(`DOM responsiveness marker did not round-trip for ${ping.marker}`);
    }

    if (ping.timerTickCount <= lastTimerTickCount) {
      throw new Error(`browser timer probe did not advance after ping ${ping.sequence}`);
    }
    lastTimerTickCount = ping.timerTickCount;

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await sleep(Math.min(responsivenessPingIntervalMs, remainingMs));
    }
  }

  return pings;
}

test.describe('WASM browser live smoke', () => {
  test.skip(process.env.ASTONIA_LIVE_SMOKE !== '1', 'set ASTONIA_LIVE_SMOKE=1 to run the disposable live server smoke');
  test.skip(!existsSync(distModulePath), 'native WASM module has not been built');

  test('keeps the browser responsive while generated native frames advance through the gateway', async ({ page }, testInfo) => {
    test.setTimeout(responsivenessDurationMs + 25_000);
    const gatewayUrl = process.env.ASTONIA_LIVE_GATEWAY_URL ?? 'ws://127.0.0.1:8787';
    const consoleMessages = [];
    const pageErrors = [];
    const samples = [];
    const launchEvents = [];
    let responsivenessPings = [];
    let progressStart = null;
    let progressEnd = null;
    let webSocketUrls = [];
    let attributionSampling = null;
    let observedInitialData;
    let resolveInitialData;
    const initialDataPromise = new Promise((resolve) => {
      resolveInitialData = resolve;
    });

    page.on('console', (message) => {
      const entry = { type: message.type(), text: message.text() };
      consoleMessages.push(entry);

      const sample = parseConsoleJson(entry.text, smokeSamplePrefix);
      if (sample) {
        samples.push(sample);
        if (!observedInitialData && sampleHasInitialServerData(sample)) {
          observedInitialData = sample;
          resolveInitialData(sample);
        }
      }

      const launchEvent = parseConsoleJson(entry.text, launchProbePrefix);
      if (launchEvent) {
        launchEvents.push(launchEvent);
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error)));

    await installAttributionProbe(page);
    await installMockWebGpuAttribution(page);
    await installResponsivenessProbe(page);
    await page.goto('/?astonia_probe=1');
    await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

    const canvas = await page.locator('[data-testid="wasm-client-canvas"]').evaluate((element) => ({
      width: element.width,
      height: element.height,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight
    }));
    expect(canvas).toMatchObject({ width: 1280, height: 720 });

    await page.evaluate((prefix) => {
      window.astoniaLiveSmokeSamples = [];
      window.astoniaLiveSmokeSampler = window.setInterval(() => {
        const module = window.astoniaNativeModule;
        if (!module || typeof module._astonia_native_startup_adapter_status !== 'function') {
          return;
        }

        const sample = {
          elapsedMs: Number(performance.now().toFixed(3)),
          adapterStatus: module._astonia_native_startup_adapter_status(),
          startupResult: module._astonia_native_startup_adapter_startup_result?.(),
          loopInitResult: module._astonia_native_startup_adapter_loop_init_result?.(),
          frameCount: module._astonia_native_startup_adapter_frame_count?.(),
          stepCount: module._astonia_native_startup_adapter_step_count?.(),
          shutdownCount: module._astonia_native_startup_adapter_shutdown_count?.(),
          hasUsername: module._astonia_native_startup_adapter_has_username?.(),
          hasPassword: module._astonia_native_startup_adapter_has_password?.(),
          hasServerUrl: module._astonia_native_startup_adapter_has_server_url?.(),
          loginDone: module._astonia_smoke_login_done?.(),
          sockstate: module._astonia_smoke_sockstate?.(),
          protocolVersion: module._astonia_smoke_protocol_version?.(),
          tick: module._astonia_smoke_tick?.(),
          queuedTicks: module._astonia_smoke_queued_ticks?.(),
          queueSize: module._astonia_smoke_queue_size?.()
        };
        window.astoniaLiveSmokeSamples.push(sample);
        console.debug(prefix, JSON.stringify(sample));
      }, 100);
    }, smokeSamplePrefix);

    await page.locator('input[name="gateway"]').fill(gatewayUrl);
    await page.locator('input[name="username"]').fill(process.env.ASTONIA_LIVE_USERNAME ?? 'BrowserSmoke');
    await page.locator('input[name="password"]').fill(process.env.ASTONIA_LIVE_PASSWORD ?? 'fixturecapture');
    await page.getByRole('button', { name: 'Launch' }).click();

    try {
      await Promise.race([
        initialDataPromise,
        page.waitForTimeout(10_000).then(() => {
          throw new Error('timed out waiting for native C initial server data');
        })
      ]);

      progressStart = await sampleNativeProgress(page);
      webSocketUrls = progressStart?.webSocketUrls ?? [];
      attributionSampling = await runAttributionSampling(page, {
        durationMs: responsivenessDurationMs,
        pingIntervalMs: responsivenessPingIntervalMs,
        evaluationTimeoutMs: responsivenessEvalTimeoutMs
      });
      responsivenessPings = attributionSampling.pings;
      if (attributionSampling.browserEvaluationTimedOut) {
        throw new Error('browser attribution eval probe timed out before native progress end sample');
      }
      progressEnd = await sampleNativeProgress(page);
      webSocketUrls = await page.evaluate(() => window.astoniaSmokeWebSocketUrls ?? []);
    } finally {
      const artifact = await buildAttributionArtifact(page, {
        mode: 'live_smoke',
        inputs: {
          liveFixtureEnabled: true,
          gatewayUrl,
          durationMs: responsivenessDurationMs,
          evaluationTimeoutMs: responsivenessEvalTimeoutMs,
          username: process.env.ASTONIA_LIVE_USERNAME ?? 'BrowserSmoke'
        },
        pageEvidence: { consoleMessages, pageErrors },
        sampling: attributionSampling,
        outcome: {
          observedInitialData,
          progressStart,
          progressEnd,
          webSocketUrls,
          samples,
          launchEvents
        }
      });
      await writeAttributionArtifact(testInfo, artifact, 'live-smoke-attribution');
    }

    expect(pageErrors).toEqual([]);
    expect(observedInitialData).toBeTruthy();
    expect(observedInitialData).toMatchObject({
      adapterStatus: 2,
      startupResult: 0,
      loopInitResult: 0,
      hasUsername: 1,
      hasPassword: 1,
      hasServerUrl: 1
    });
    expect(sampleHasInitialServerData(observedInitialData)).toBe(true);
    expect(launchEvents.map((event) => event.stage)).toEqual(
      expect.arrayContaining(['create-module-start', 'create-module-resolved', 'running'])
    );
    expect(launchEvents.some((event) => event.detail?.arguments?.includes(gatewayUrl))).toBe(true);
    expect(webSocketUrls.some((url) => url.startsWith(gatewayUrl))).toBe(true);
    expect(progressStart).toBeTruthy();
    expect(progressEnd).toBeTruthy();
    expect(progressEnd.frameCount).toBeGreaterThan(progressStart.frameCount);
    expect(progressEnd.stepCount).toBeGreaterThan(progressStart.stepCount);
    expect(progressEnd.adapterStatus).toBe(2);
    expect(responsivenessPings.length).toBeGreaterThanOrEqual(Math.floor(responsivenessDurationMs / responsivenessPingIntervalMs) - 1);
    expect(responsivenessPings.at(-1).wallElapsedMs).toBeGreaterThanOrEqual(responsivenessDurationMs - responsivenessPingIntervalMs);
    expect(Math.max(...responsivenessPings.map((ping) => ping.roundTripMs))).toBeLessThan(responsivenessEvalTimeoutMs);
    console.info(
      responsivenessProbePrefix,
      JSON.stringify({
        durationMs: responsivenessPings.at(-1)?.wallElapsedMs ?? 0,
        pings: responsivenessPings.length,
        frameDelta: progressEnd.frameCount - progressStart.frameCount,
        stepDelta: progressEnd.stepCount - progressStart.stepCount,
        webSocketUrls
      })
    );
  });
});
