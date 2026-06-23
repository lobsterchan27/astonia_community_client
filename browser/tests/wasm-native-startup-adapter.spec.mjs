import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const harnessOutput = resolve(browserRoot, 'dist/wasm-native-startup-adapter-harness.mjs');

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
  const args = [
    '-std=gnu11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    '-Wno-error=experimental',
    '-DSOKOL_WGPU',
    '-DASTONIA_NO_DESKTOP_MAIN',
    '-DUSE_MIMALLOC=0',
    '-DSDL_FUNCTION_POINTER_IS_VOID_POINTER',
    '-DSDL_MAIN_HANDLED',
    '-Iinclude',
    '-Isrc',
    '-Isrc/wasm',
    '-isystem',
    'third_party/sokol',
    'tests/wasm_native_startup_adapter_harness.c',
    'src/wasm/native_startup_adapter.c',
    'src/game/main.c',
    '--use-port=sdl3',
    '--no-entry',
    '-sENVIRONMENT=web',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createWasmNativeStartupAdapterHarness',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sASSERTIONS=1',
    '-sNO_EXIT_RUNTIME=1',
    "-sEXPORTED_FUNCTIONS=['_wasm_native_startup_adapter_harness_run','_wasm_native_startup_adapter_harness_network_pacing','_wasm_native_startup_adapter_harness_startup_failure_requests_quit','_wasm_native_startup_adapter_harness_terminal_stop_requests_quit_once','_wasm_native_startup_adapter_harness_phase']",
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

const emcc = findEmcc();

test.describe('WASM native startup adapter harness', () => {
  test.skip(!emcc, 'Emscripten is required for the focused native startup adapter harness');

  test.beforeAll(() => {
    buildHarness(emcc);
  });

  test('defers native startup from Sokol init into frame-driven progress', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const imported = await import(`/dist/wasm-native-startup-adapter-harness.mjs?t=${Date.now()}`);
      const createModule = imported.default ?? imported.createWasmNativeStartupAdapterHarness;
      const module = await createModule({
        locateFile(path) {
          return `/dist/${path}`;
        }
      });

      try {
        return { result: module._wasm_native_startup_adapter_harness_run(), phase: module._wasm_native_startup_adapter_harness_phase() };
      } catch (error) {
        return { error: String(error), phase: module._wasm_native_startup_adapter_harness_phase() };
      }
    });

    expect(result).toEqual({ result: 0, phase: 8 });
  });

  test('paces pre-login WebSocket states without stopping native frames', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const imported = await import(`/dist/wasm-native-startup-adapter-harness.mjs?t=${Date.now()}`);
      const createModule = imported.default ?? imported.createWasmNativeStartupAdapterHarness;
      const module = await createModule({
        locateFile(path) {
          return `/dist/${path}`;
        }
      });

      try {
        return {
          result: module._wasm_native_startup_adapter_harness_network_pacing(),
          phase: module._wasm_native_startup_adapter_harness_phase()
        };
      } catch (error) {
        return { error: String(error), phase: module._wasm_native_startup_adapter_harness_phase() };
      }
    });

    expect(result).toEqual({ result: 0, phase: 41 });
  });

  test('requests Sokol quit once for startup failure and terminal native stop', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const imported = await import(`/dist/wasm-native-startup-adapter-harness.mjs?t=${Date.now()}`);
      const createModule = imported.default ?? imported.createWasmNativeStartupAdapterHarness;
      const module = await createModule({
        locateFile(path) {
          return `/dist/${path}`;
        }
      });

      return {
        startupFailure: module._wasm_native_startup_adapter_harness_startup_failure_requests_quit(),
        startupFailurePhase: module._wasm_native_startup_adapter_harness_phase(),
        terminalStop: module._wasm_native_startup_adapter_harness_terminal_stop_requests_quit_once(),
        terminalStopPhase: module._wasm_native_startup_adapter_harness_phase()
      };
    });

    expect(result).toEqual({
      startupFailure: 0,
      startupFailurePhase: 51,
      terminalStop: 0,
      terminalStopPhase: 61
    });
  });
});
