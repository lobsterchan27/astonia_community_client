import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const smokeArtifactDir = resolve(repoRoot, '.worktree/smoke');
const smokeSamplePrefix = '[live-smoke-native-sample]';
const launchProbePrefix = '[DEBUG-wasm-launch-probe]';

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

test.describe('WASM browser live smoke', () => {
  test.skip(process.env.ASTONIA_LIVE_SMOKE !== '1', 'set ASTONIA_LIVE_SMOKE=1 to run the disposable live server smoke');
  test.skip(!existsSync(distModulePath), 'native WASM module has not been built');

  test('launches generated native client through gateway and observes initial C state', async ({ page }, testInfo) => {
    test.setTimeout(20_000);
    mkdirSync(smokeArtifactDir, { recursive: true });
    const artifactPrefix = resolve(smokeArtifactDir, `live-smoke-${Date.now()}`);
    const consoleMessages = [];
    const pageErrors = [];
    const samples = [];
    const launchEvents = [];
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

    await installMockWebGpu(page);
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

    await page.locator('input[name="gateway"]').fill(process.env.ASTONIA_LIVE_GATEWAY_URL ?? 'ws://127.0.0.1:8787');
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
    } finally {
      const summary = {
        artifactPrefix,
        observedInitialData,
        samples,
        launchEvents,
        consoleMessages,
        pageErrors
      };
      const summaryPath = `${artifactPrefix}.summary.json`;
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      await testInfo.attach('live-smoke-summary', { path: summaryPath, contentType: 'application/json' });
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
  });
});
