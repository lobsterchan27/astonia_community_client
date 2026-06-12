import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const harnessOutput = resolve(browserRoot, 'dist/wasm-input-bridge-harness.mjs');
const artifactPattern = /\/dist\/astonia-client\.(js|wasm|data)(?:\?.*)?$/;
const SDL_KEYCODE = {
  m: 109,
  arrowUp: 0x40000052
};

const inputCaptureModuleSource = `
window.nativeInputCalls = [];

export default function createAstoniaClientModule() {
  return Promise.resolve({
    _astonia_wasm_input_set_modifiers(shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'modifiers', shift, ctrl, alt });
    },
    _astonia_wasm_input_key_down(keycode, shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'keyDown', keycode, shift, ctrl, alt });
    },
    _astonia_wasm_input_key_up(keycode, shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'keyUp', keycode, shift, ctrl, alt });
    },
    _astonia_wasm_input_text(codepoint, shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'text', codepoint, shift, ctrl, alt });
    },
    _astonia_native_startup_adapter_status() {
      return 2;
    },
    _astonia_native_startup_adapter_startup_result() {
      return 0;
    },
    _astonia_native_startup_adapter_loop_init_result() {
      return 0;
    }
  });
}
`;

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
  const exportedFunctions = [
    '_wasm_input_bridge_harness_reset',
    '_wasm_input_bridge_harness_key_down_count',
    '_wasm_input_bridge_harness_key_up_count',
    '_wasm_input_bridge_harness_text_count',
    '_wasm_input_bridge_harness_last_key_down',
    '_wasm_input_bridge_harness_last_key_up',
    '_wasm_input_bridge_harness_last_text',
    '_wasm_input_bridge_harness_vk_shift',
    '_wasm_input_bridge_harness_vk_control',
    '_wasm_input_bridge_harness_vk_alt',
    '_wasm_input_bridge_harness_sdl_mods',
    '_astonia_wasm_input_set_modifiers',
    '_astonia_wasm_input_key_down',
    '_astonia_wasm_input_key_up',
    '_astonia_wasm_input_text'
  ];
  const args = [
    '-std=gnu11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    '-Wno-error=experimental',
    '-Iinclude',
    '-Isrc',
    '-Isrc/wasm',
    'tests/wasm_input_bridge_harness.c',
    'src/wasm/wasm_input_bridge.c',
    '--use-port=sdl3',
    '--no-entry',
    '-sENVIRONMENT=web',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createWasmInputBridgeHarness',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sNO_EXIT_RUNTIME=1',
    `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFunctions)}`,
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

async function installMockWebGpu(page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get() {
        return {
          async requestAdapter() {
            return {};
          }
        };
      }
    });
  });
}

async function routeNativeArtifacts(page, moduleSource = inputCaptureModuleSource) {
  await page.route(artifactPattern, async (route) => {
    const request = route.request();
    const artifactName = new URL(request.url()).pathname.split('/').pop();
    const extension = artifactName.split('.').pop();
    const contentTypes = {
      data: 'application/octet-stream',
      js: 'text/javascript; charset=utf-8',
      wasm: 'application/wasm'
    };

    if (request.method() === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Length': '1',
          'Content-Type': contentTypes[extension]
        }
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: contentTypes[extension],
      body: extension === 'js' ? moduleSource : ''
    });
  });
}

async function loadInputHarness(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const imported = await import(`/dist/wasm-input-bridge-harness.mjs?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createWasmInputBridgeHarness;
    window.inputHarness = await createModule({
      locateFile(path) {
        return `/dist/${path}`;
      }
    });
  });
}

test('browser host forwards keyboard, text, and modifier facts to native exports', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');

  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'M',
        code: 'KeyM',
        shiftKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    window.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'M',
        code: 'KeyM',
        shiftKey: true,
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );
    window.dispatchEvent(
      new KeyboardEvent('keypress', {
        key: 'a',
        code: 'KeyA',
        bubbles: true,
        cancelable: true
      })
    );
  });

  const calls = await page.evaluate(() => window.nativeInputCalls);

  expect(calls).toEqual(
    expect.arrayContaining([
      { type: 'keyDown', keycode: SDL_KEYCODE.m, shift: 1, ctrl: 1, alt: 0 },
      { type: 'keyUp', keycode: SDL_KEYCODE.m, shift: 1, ctrl: 1, alt: 0 },
      { type: 'text', codepoint: 'a'.codePointAt(0), shift: 0, ctrl: 0, alt: 0 }
    ])
  );
  expect(calls.filter((call) => call.type === 'modifiers')).toEqual(
    expect.arrayContaining([
      { type: 'modifiers', shift: 1, ctrl: 1, alt: 0 },
      { type: 'modifiers', shift: 0, ctrl: 0, alt: 0 }
    ])
  );
});

test('browser host does not forward launch form text as native input', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');

  await page.locator('input[name="username"]').focus();
  await page.keyboard.type('abc');

  expect(await page.evaluate(() => window.nativeInputCalls)).toEqual([]);
});

const emcc = findEmcc();

test.describe('WASM input bridge harness', () => {
  test.skip(!emcc, 'Emscripten is required for the focused WASM input bridge harness');

  test.beforeAll(() => {
    buildHarness(emcc);
  });

  test('routes native exports into GUI key, key-up, text, and modifier paths', async ({ page }) => {
    await loadInputHarness(page);

    const result = await page.evaluate(({ keycode }) => {
      const harness = window.inputHarness;
      harness._wasm_input_bridge_harness_reset();

      harness._astonia_wasm_input_set_modifiers(1, 0, 1);
      const shiftedAlt = {
        vkShift: harness._wasm_input_bridge_harness_vk_shift(),
        vkControl: harness._wasm_input_bridge_harness_vk_control(),
        vkAlt: harness._wasm_input_bridge_harness_vk_alt(),
        sdlMods: harness._wasm_input_bridge_harness_sdl_mods()
      };

      harness._astonia_wasm_input_key_down(keycode.m, 1, 1, 0);
      const keyDown = {
        count: harness._wasm_input_bridge_harness_key_down_count(),
        last: harness._wasm_input_bridge_harness_last_key_down(),
        vkShift: harness._wasm_input_bridge_harness_vk_shift(),
        vkControl: harness._wasm_input_bridge_harness_vk_control(),
        vkAlt: harness._wasm_input_bridge_harness_vk_alt(),
        sdlMods: harness._wasm_input_bridge_harness_sdl_mods()
      };

      harness._astonia_wasm_input_key_up(keycode.arrowUp, 0, 1, 0);
      const keyUp = {
        count: harness._wasm_input_bridge_harness_key_up_count(),
        last: harness._wasm_input_bridge_harness_last_key_up(),
        sdlMods: harness._wasm_input_bridge_harness_sdl_mods()
      };

      harness._astonia_wasm_input_text('x'.codePointAt(0), 0, 0, 0);
      harness._astonia_wasm_input_text(0x1f600, 0, 0, 0);
      harness._astonia_wasm_input_key_down(0, 0, 0, 0);

      return {
        shiftedAlt,
        keyDown,
        keyUp,
        textCount: harness._wasm_input_bridge_harness_text_count(),
        lastText: harness._wasm_input_bridge_harness_last_text(),
        finalKeyDownCount: harness._wasm_input_bridge_harness_key_down_count()
      };
    }, { keycode: SDL_KEYCODE });

    expect(result).toEqual({
      shiftedAlt: {
        vkShift: 1,
        vkControl: 0,
        vkAlt: 1,
        sdlMods: 5
      },
      keyDown: {
        count: 1,
        last: SDL_KEYCODE.m,
        vkShift: 1,
        vkControl: 1,
        vkAlt: 0,
        sdlMods: 3
      },
      keyUp: {
        count: 1,
        last: SDL_KEYCODE.arrowUp,
        sdlMods: 2
      },
      textCount: 1,
      lastText: 'x'.codePointAt(0),
      finalKeyDownCount: 1
    });
  });
});

test('production WASM export list contains the input bridge exports', () => {
  const makefile = readFileSync(resolve(repoRoot, 'build/make/Makefile.wasm'), 'utf8');

  expect(makefile).toContain('_astonia_wasm_input_set_modifiers');
  expect(makefile).toContain('_astonia_wasm_input_key_down');
  expect(makefile).toContain('_astonia_wasm_input_key_up');
  expect(makefile).toContain('_astonia_wasm_input_text');
});

test('generated native module exposes input bridge exports', async ({ page }) => {
  if (!existsSync(distModulePath)) {
    test.skip(true, 'native WASM module has not been built');
  }

  await page.goto('/');

  const missing = await page.evaluate(async () => {
    const imported = await import(`/dist/astonia-client.js?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createAstoniaClientModule;
    const module = await createModule({
      noInitialRun: true,
      canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
      locateFile(path) {
        return `/dist/${path}`;
      }
    });

    const exports = [
      '_astonia_wasm_input_set_modifiers',
      '_astonia_wasm_input_key_down',
      '_astonia_wasm_input_key_up',
      '_astonia_wasm_input_text'
    ];

    return exports.filter((name) => typeof module[name] !== 'function');
  });

  expect(missing).toEqual([]);
});
