import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const harnessOutput = resolve(browserRoot, 'dist/wasm-sokol-webgpu-async-harness.mjs');

const INIT_REQUEST_ADAPTER = 1;
const INIT_WAIT_ADAPTER = 2;
const INIT_REQUEST_DEVICE = 3;
const INIT_WAIT_DEVICE = 4;
const INIT_CREATE_SURFACE = 5;
const INIT_DONE = 6;

function findEmcc() {
  const candidates = [];
  if (process.env.ASTONIA_EMSDK_ROOT) {
    candidates.push(resolve(process.env.ASTONIA_EMSDK_ROOT, 'upstream/emscripten/emcc'));
  }
  candidates.push(resolve(repoRoot, '.deps/emsdk/upstream/emscripten/emcc'));
  candidates.push('emcc');

  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) {
      continue;
    }

    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function buildHarness(emcc) {
  mkdirSync(dirname(harnessOutput), { recursive: true });

  const args = [
    '-std=gnu11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    '-Wno-error=experimental',
    '-DSOKOL_WGPU',
    '-Ithird_party/sokol',
    'tests/wasm_sokol_webgpu_async_harness.c',
    '--use-port=emdawnwebgpu',
    '--no-entry',
    '-sENVIRONMENT=web',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createWasmSokolWebGpuAsyncHarness',
    '-sASSERTIONS=1',
    '-sNO_EXIT_RUNTIME=1',
    "-sEXPORTED_FUNCTIONS=['_wasm_sokol_webgpu_async_harness_start','_wasm_sokol_webgpu_async_harness_request_quit','_wasm_sokol_webgpu_async_harness_inject_destroyed_device_lost','_wasm_sokol_webgpu_async_harness_set_teardown_for_test','_wasm_sokol_webgpu_async_harness_init_state','_wasm_sokol_webgpu_async_harness_init_done','_wasm_sokol_webgpu_async_harness_request_adapter_count','_wasm_sokol_webgpu_async_harness_request_device_count','_wasm_sokol_webgpu_async_harness_surface_create_count','_wasm_sokol_webgpu_async_harness_init_count','_wasm_sokol_webgpu_async_harness_frame_count','_wasm_sokol_webgpu_async_harness_cleanup_count','_wasm_sokol_webgpu_async_harness_device_lost_errors']",
    '-o',
    harnessOutput
  ];

  const result = spawnSync(emcc, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: emcc.includes('/')
      ? { ...process.env, ASTONIA_EMSDK_ROOT: dirname(dirname(dirname(emcc))) }
      : process.env
  });

  if (result.status !== 0) {
    throw new Error(`emcc failed\n${result.stdout}\n${result.stderr}`);
  }
}

async function installControlledBrowser(page) {
  await page.route('**/sokol-webgpu-async-harness.html', async (route) => {
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><canvas id="canvas" width="320" height="180"></canvas></body></html>'
    });
  });

  await page.addInitScript(() => {
    const rafQueue = [];
    let nextRafId = 1;

    window.astoniaRafQueue = rafQueue;
    window.requestAnimationFrame = (callback) => {
      const id = nextRafId++;
      rafQueue.push({ id, callback });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const index = rafQueue.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        rafQueue.splice(index, 1);
      }
    };
    window.astoniaStepFrame = async () => {
      const entry = rafQueue.shift();
      if (!entry) {
        return false;
      }
      entry.callback(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 0));
      return true;
    };

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
    const texture = {
      createView() {
        return {};
      },
      destroy() {}
    };

    let adapterResolver = null;
    let deviceResolver = null;
    let deviceLostResolver = null;

    const device = {
      features: new Set(),
      limits,
      queue: {
        submit() {},
        writeBuffer() {},
        writeTexture() {}
      },
      lost: new Promise((resolve) => {
        deviceLostResolver = resolve;
      }),
      createTexture() {
        return texture;
      },
      destroy() {
        deviceLostResolver?.({ reason: 'destroyed', message: 'Device was destroyed' });
      }
    };
    const adapter = {
      features: new Set(),
      limits,
      requestDevice() {
        window.astoniaWebGpuMock.deviceRequests++;
        return new Promise((resolve) => {
          deviceResolver = resolve;
        });
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

    window.astoniaWebGpuMock = {
      adapterRequests: 0,
      deviceRequests: 0,
      resolveAdapter() {
        const resolve = adapterResolver;
        adapterResolver = null;
        resolve?.(adapter);
      },
      resolveDevice() {
        const resolve = deviceResolver;
        deviceResolver = null;
        resolve?.(device);
      }
    };

    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get() {
        return {
          requestAdapter() {
            window.astoniaWebGpuMock.adapterRequests++;
            return new Promise((resolve) => {
              adapterResolver = resolve;
            });
          },
          getPreferredCanvasFormat() {
            return 'bgra8unorm';
          }
        };
      }
    });
  });
}

async function loadHarness(page) {
  await page.goto('/sokol-webgpu-async-harness.html');
  await page.evaluate(async () => {
    const imported = await import(`/dist/wasm-sokol-webgpu-async-harness.mjs?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createWasmSokolWebGpuAsyncHarness;
    window.sokolWebGpuHarness = await createModule({
      locateFile(path) {
        return `/dist/${path}`;
      }
    });
    window.sokolWebGpuHarness._wasm_sokol_webgpu_async_harness_start();
  });
}

async function stepFrame(page) {
  await page.evaluate(() => window.astoniaStepFrame());
}

async function resolveAdapter(page) {
  await page.evaluate(async () => {
    window.astoniaWebGpuMock.resolveAdapter();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function resolveDevice(page) {
  await page.evaluate(async () => {
    window.astoniaWebGpuMock.resolveDevice();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function probe(page) {
  return page.evaluate(() => {
    const module = window.sokolWebGpuHarness;
    return {
      state: module._wasm_sokol_webgpu_async_harness_init_state(),
      initDone: module._wasm_sokol_webgpu_async_harness_init_done(),
      adapterRequests: module._wasm_sokol_webgpu_async_harness_request_adapter_count(),
      deviceRequests: module._wasm_sokol_webgpu_async_harness_request_device_count(),
      surfaceCreates: module._wasm_sokol_webgpu_async_harness_surface_create_count(),
      initCount: module._wasm_sokol_webgpu_async_harness_init_count(),
      frameCount: module._wasm_sokol_webgpu_async_harness_frame_count(),
      cleanupCount: module._wasm_sokol_webgpu_async_harness_cleanup_count(),
      deviceLostErrors: module._wasm_sokol_webgpu_async_harness_device_lost_errors(),
      mockAdapterRequests: window.astoniaWebGpuMock.adapterRequests,
      mockDeviceRequests: window.astoniaWebGpuMock.deviceRequests,
      queuedFrames: window.astoniaRafQueue.length
    };
  });
}

const emcc = findEmcc();

test.describe('Sokol Emscripten WebGPU async startup harness', () => {
  test.skip(!emcc, 'Emscripten is required for the focused Sokol WebGPU async harness');

  test.beforeAll(() => {
    buildHarness(emcc);
  });

  test('drives adapter, device, and surface setup from explicit browser frames', async ({ page }) => {
    await installControlledBrowser(page);
    await loadHarness(page);

    expect(await probe(page)).toMatchObject({
      state: INIT_REQUEST_ADAPTER,
      initDone: 0,
      adapterRequests: 0,
      deviceRequests: 0,
      surfaceCreates: 0,
      initCount: 0,
      frameCount: 0,
      cleanupCount: 0,
      queuedFrames: 1
    });

    await stepFrame(page);
    expect(await probe(page)).toMatchObject({
      state: INIT_WAIT_ADAPTER,
      adapterRequests: 1,
      deviceRequests: 0,
      surfaceCreates: 0,
      initCount: 0,
      frameCount: 0,
      mockAdapterRequests: 1
    });

    await resolveAdapter(page);
    await stepFrame(page);
    expect(await probe(page)).toMatchObject({
      state: INIT_REQUEST_DEVICE,
      adapterRequests: 1,
      deviceRequests: 0,
      surfaceCreates: 0,
      initCount: 0,
      frameCount: 0
    });

    await stepFrame(page);
    expect(await probe(page)).toMatchObject({
      state: INIT_WAIT_DEVICE,
      adapterRequests: 1,
      deviceRequests: 1,
      surfaceCreates: 0,
      initCount: 0,
      frameCount: 0,
      mockDeviceRequests: 1
    });

    await resolveDevice(page);
    await stepFrame(page);
    expect(await probe(page)).toMatchObject({
      state: INIT_CREATE_SURFACE,
      adapterRequests: 1,
      deviceRequests: 1,
      surfaceCreates: 0,
      initCount: 0,
      frameCount: 0
    });

    await stepFrame(page);
    expect(await probe(page)).toMatchObject({
      state: INIT_DONE,
      initDone: 1,
      adapterRequests: 1,
      deviceRequests: 1,
      surfaceCreates: 1,
      initCount: 1,
      frameCount: 1,
      cleanupCount: 0
    });

    const unexpectedLoss = await page.evaluate(() => {
      const module = window.sokolWebGpuHarness;
      module._wasm_sokol_webgpu_async_harness_inject_destroyed_device_lost();
      return module._wasm_sokol_webgpu_async_harness_device_lost_errors();
    });
    expect(unexpectedLoss).toBe(1);

    const teardownLoss = await page.evaluate(() => {
      const module = window.sokolWebGpuHarness;
      module._wasm_sokol_webgpu_async_harness_set_teardown_for_test(1);
      module._wasm_sokol_webgpu_async_harness_inject_destroyed_device_lost();
      module._wasm_sokol_webgpu_async_harness_set_teardown_for_test(0);
      return module._wasm_sokol_webgpu_async_harness_device_lost_errors();
    });
    expect(teardownLoss).toBe(1);

    await page.evaluate(() => window.sokolWebGpuHarness._wasm_sokol_webgpu_async_harness_request_quit());
    await stepFrame(page);
    expect(await probe(page)).toMatchObject({
      cleanupCount: 1
    });
  });
});
