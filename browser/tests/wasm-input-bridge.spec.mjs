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
const SDL_MOUM = {
  none: 0,
  leftUp: 1,
  leftDown: 2,
  wheel: 7
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
    _astonia_wasm_input_mouse_focus(focused) {
      window.nativeInputCalls.push({ type: 'mouseFocus', focused });
    },
    _astonia_wasm_input_mouse_capture(captured) {
      window.nativeInputCalls.push({ type: 'mouseCapture', captured });
    },
    _astonia_wasm_input_mouse_move(x, y, movementX, movementY, shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'mouseMove', x, y, movementX, movementY, shift, ctrl, alt });
    },
    _astonia_wasm_input_mouse_button(x, y, button, pressed, shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'mouseButton', x, y, button, pressed, shift, ctrl, alt });
    },
    _astonia_wasm_input_mouse_wheel(x, y, wheelX, wheelY, shift, ctrl, alt) {
      window.nativeInputCalls.push({ type: 'mouseWheel', x, y, wheelX, wheelY, shift, ctrl, alt });
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
    '_wasm_input_bridge_harness_mouse_count',
    '_wasm_input_bridge_harness_last_mouse_x',
    '_wasm_input_bridge_harness_last_mouse_y',
    '_wasm_input_bridge_harness_last_mouse_what',
    '_wasm_input_bridge_harness_vk_shift',
    '_wasm_input_bridge_harness_vk_control',
    '_wasm_input_bridge_harness_vk_alt',
    '_wasm_input_bridge_harness_sdl_mods',
    '_wasm_input_bridge_harness_platform_has_focus',
    '_wasm_input_bridge_harness_platform_check_mouse',
    '_wasm_input_bridge_harness_platform_capture_request',
    '_wasm_input_bridge_harness_platform_cursor_warp_request',
    '_wasm_input_bridge_harness_platform_cursor_request',
    '_wasm_input_bridge_harness_platform_cursor',
    '_astonia_wasm_input_set_modifiers',
    '_astonia_wasm_input_key_down',
    '_astonia_wasm_input_key_up',
    '_astonia_wasm_input_text',
    '_astonia_wasm_input_mouse_focus',
    '_astonia_wasm_input_mouse_capture',
    '_astonia_wasm_input_mouse_move',
    '_astonia_wasm_input_mouse_button',
    '_astonia_wasm_input_mouse_wheel',
    '_astonia_wasm_input_mouse_event_count',
    '_astonia_wasm_input_mouse_move_count',
    '_astonia_wasm_input_mouse_button_down_count',
    '_astonia_wasm_input_mouse_button_up_count',
    '_astonia_wasm_input_mouse_wheel_count',
    '_astonia_wasm_input_mouse_active_buttons',
    '_astonia_wasm_input_mouse_last_x',
    '_astonia_wasm_input_mouse_last_y',
    '_astonia_wasm_input_mouse_last_button',
    '_astonia_wasm_input_mouse_last_pressed',
    '_astonia_wasm_input_mouse_last_what'
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

test('browser host forwards pointer, wheel, focus, and capture facts to native exports', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');

  await page.evaluate(() => {
    window.nativeInputCalls = [];
  });

  const canvas = page.getByTestId('wasm-client-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const x = box.x + 48;
  const y = box.y + 56;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.wheel(0, 120);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });

  const calls = await page.evaluate(() => window.nativeInputCalls);

  expect(calls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'mouseFocus', focused: 1 }),
      expect.objectContaining({ type: 'mouseMove', x: 48, y: 56, shift: 0, ctrl: 0, alt: 0 }),
      expect.objectContaining({ type: 'mouseCapture', captured: 1 }),
      expect.objectContaining({ type: 'mouseButton', x: 48, button: 0, pressed: 1, shift: 0, ctrl: 0, alt: 0 }),
      expect.objectContaining({ type: 'mouseButton', x: 48, button: 0, pressed: 0, shift: 0, ctrl: 0, alt: 0 }),
      expect.objectContaining({ type: 'mouseCapture', captured: 0 }),
      expect.objectContaining({ type: 'mouseWheel', wheelX: 0, wheelY: -1, shift: 0, ctrl: 0, alt: 0 }),
      expect.objectContaining({ type: 'mouseFocus', focused: 0 })
    ])
  );
});

test('browser host releases native buttons on cancel, capture loss, blur, and hidden cleanup', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');

  const scenarios = [
    {
      name: 'pointercancel',
      async run(page, pointerId) {
        await page.evaluate(({ pointerId: id }) => {
          const canvas = document.querySelector('[data-testid="wasm-client-canvas"]');
          const rect = canvas.getBoundingClientRect();
          const eventInit = {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'mouse',
            clientX: rect.left + 64,
            clientY: rect.top + 72
          };

          window.nativeInputCalls = [];
          canvas.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, button: 0, buttons: 1 }));
          canvas.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 0, buttons: 1 }));
          canvas.dispatchEvent(new PointerEvent('pointercancel', { ...eventInit, button: -1, buttons: 0 }));
        }, { pointerId });
      }
    },
    {
      name: 'lostpointercapture',
      async run(page, pointerId) {
        await page.evaluate(({ pointerId: id }) => {
          const canvas = document.querySelector('[data-testid="wasm-client-canvas"]');
          const rect = canvas.getBoundingClientRect();
          const eventInit = {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'mouse',
            clientX: rect.left + 64,
            clientY: rect.top + 72
          };

          window.nativeInputCalls = [];
          canvas.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, button: 0, buttons: 1 }));
          canvas.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 0, buttons: 1 }));
          canvas.dispatchEvent(new PointerEvent('lostpointercapture', { ...eventInit, button: -1, buttons: 0 }));
        }, { pointerId });
      }
    },
    {
      name: 'blur',
      async run(page, pointerId) {
        await page.evaluate(({ pointerId: id }) => {
          const canvas = document.querySelector('[data-testid="wasm-client-canvas"]');
          const rect = canvas.getBoundingClientRect();

          window.nativeInputCalls = [];
          canvas.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: id,
              pointerType: 'mouse',
              clientX: rect.left + 64,
              clientY: rect.top + 72,
              button: 0,
              buttons: 1
            })
          );
          canvas.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 64,
              clientY: rect.top + 72,
              button: 0,
              buttons: 1
            })
          );
          window.dispatchEvent(new Event('blur'));
        }, { pointerId });
      }
    },
    {
      name: 'hidden',
      async run(page, pointerId) {
        await page.evaluate(({ pointerId: id }) => {
          const canvas = document.querySelector('[data-testid="wasm-client-canvas"]');
          const rect = canvas.getBoundingClientRect();

          window.nativeInputCalls = [];
          canvas.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              cancelable: true,
              pointerId: id,
              pointerType: 'mouse',
              clientX: rect.left + 64,
              clientY: rect.top + 72,
              button: 0,
              buttons: 1
            })
          );
          canvas.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 64,
              clientY: rect.top + 72,
              button: 0,
              buttons: 1
            })
          );
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden'
          });
          document.dispatchEvent(new Event('visibilitychange'));
        }, { pointerId });
      }
    },
    {
      name: 'pointerup-before-capture-loss',
      async run(page, pointerId) {
        await page.evaluate(({ pointerId: id }) => {
          const canvas = document.querySelector('[data-testid="wasm-client-canvas"]');
          const rect = canvas.getBoundingClientRect();
          const eventInit = {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'mouse',
            clientX: rect.left + 64,
            clientY: rect.top + 72
          };

          window.nativeInputCalls = [];
          canvas.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, button: 0, buttons: 1 }));
          canvas.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 0, buttons: 1 }));
          canvas.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, button: 0, buttons: 0 }));
          canvas.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, button: 0, buttons: 0 }));
          canvas.dispatchEvent(new PointerEvent('lostpointercapture', { ...eventInit, button: -1, buttons: 0 }));
        }, { pointerId });
      }
    }
  ];

  for (const [index, scenario] of scenarios.entries()) {
    await scenario.run(page, index + 200);
    const buttonCalls = await page.evaluate(() => window.nativeInputCalls.filter((call) => call.type === 'mouseButton'));

    expect(
      buttonCalls.map(({ type, x, button, pressed, shift, ctrl, alt }) => ({ type, x, button, pressed, shift, ctrl, alt })),
      scenario.name
    ).toEqual([
      { type: 'mouseButton', x: 64, button: 0, pressed: 1, shift: 0, ctrl: 0, alt: 0 },
      { type: 'mouseButton', x: 64, button: 0, pressed: 0, shift: 0, ctrl: 0, alt: 0 }
    ]);
  }
});

test('browser host forwards chorded mouse button transitions without pointer double-fire', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');

  const buttonCalls = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="wasm-client-canvas"]');
    const rect = canvas.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      pointerId: 991,
      pointerType: 'mouse',
      clientX: rect.left + 80,
      clientY: rect.top + 88
    };

    window.nativeInputCalls = [];
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, button: 0, buttons: 1 }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 0, buttons: 1 }));
    canvas.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, button: 2, buttons: 3 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, button: 2, buttons: 1 }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, button: 0, buttons: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, button: 0, buttons: 0 }));

    return window.nativeInputCalls.filter((call) => call.type === 'mouseButton');
  });

  expect(buttonCalls.map(({ type, x, button, pressed, shift, ctrl, alt }) => ({ type, x, button, pressed, shift, ctrl, alt }))).toEqual([
    { type: 'mouseButton', x: 80, button: 0, pressed: 1, shift: 0, ctrl: 0, alt: 0 },
    { type: 'mouseButton', x: 80, button: 2, pressed: 1, shift: 0, ctrl: 0, alt: 0 },
    { type: 'mouseButton', x: 80, button: 2, pressed: 0, shift: 0, ctrl: 0, alt: 0 },
    { type: 'mouseButton', x: 80, button: 0, pressed: 0, shift: 0, ctrl: 0, alt: 0 }
  ]);
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

  test('routes native mouse exports into GUI mouse and platform focus paths', async ({ page }) => {
    await loadInputHarness(page);

    const result = await page.evaluate(({ moum }) => {
      const harness = window.inputHarness;
      harness._wasm_input_bridge_harness_reset();

      const initialPlatform = {
        hasFocus: harness._wasm_input_bridge_harness_platform_has_focus(),
        checkMouse: harness._wasm_input_bridge_harness_platform_check_mouse()
      };

      harness._astonia_wasm_input_mouse_focus(1);
      const focusedPlatform = {
        hasFocus: harness._wasm_input_bridge_harness_platform_has_focus(),
        checkMouse: harness._wasm_input_bridge_harness_platform_check_mouse()
      };

      harness._astonia_wasm_input_mouse_move(12, 34, 0, 0, 1, 0, 0);
      const move = {
        count: harness._wasm_input_bridge_harness_mouse_count(),
        x: harness._wasm_input_bridge_harness_last_mouse_x(),
        y: harness._wasm_input_bridge_harness_last_mouse_y(),
        what: harness._wasm_input_bridge_harness_last_mouse_what(),
        vkShift: harness._wasm_input_bridge_harness_vk_shift(),
        sdlMods: harness._wasm_input_bridge_harness_sdl_mods()
      };

      harness._astonia_wasm_input_mouse_button(20, 22, 0, 1, 0, 1, 0);
      const leftDown = {
        count: harness._wasm_input_bridge_harness_mouse_count(),
        x: harness._wasm_input_bridge_harness_last_mouse_x(),
        y: harness._wasm_input_bridge_harness_last_mouse_y(),
        what: harness._wasm_input_bridge_harness_last_mouse_what(),
        vkControl: harness._wasm_input_bridge_harness_vk_control(),
        sdlMods: harness._wasm_input_bridge_harness_sdl_mods()
      };

      harness._astonia_wasm_input_mouse_button(20, 22, 0, 0, 0, 0, 1);
      const leftUp = {
        count: harness._wasm_input_bridge_harness_mouse_count(),
        what: harness._wasm_input_bridge_harness_last_mouse_what(),
        vkAlt: harness._wasm_input_bridge_harness_vk_alt(),
        sdlMods: harness._wasm_input_bridge_harness_sdl_mods()
      };

      harness._astonia_wasm_input_mouse_wheel(20, 22, 0, -1, 0, 0, 0);
      const wheel = {
        count: harness._wasm_input_bridge_harness_mouse_count(),
        x: harness._wasm_input_bridge_harness_last_mouse_x(),
        y: harness._wasm_input_bridge_harness_last_mouse_y(),
        what: harness._wasm_input_bridge_harness_last_mouse_what()
      };
      const bridgeCounters = {
        eventCount: harness._astonia_wasm_input_mouse_event_count(),
        moveCount: harness._astonia_wasm_input_mouse_move_count(),
        downCount: harness._astonia_wasm_input_mouse_button_down_count(),
        upCount: harness._astonia_wasm_input_mouse_button_up_count(),
        wheelCount: harness._astonia_wasm_input_mouse_wheel_count(),
        activeButtons: harness._astonia_wasm_input_mouse_active_buttons(),
        lastX: harness._astonia_wasm_input_mouse_last_x(),
        lastY: harness._astonia_wasm_input_mouse_last_y(),
        lastButton: harness._astonia_wasm_input_mouse_last_button(),
        lastPressed: harness._astonia_wasm_input_mouse_last_pressed(),
        lastWhat: harness._astonia_wasm_input_mouse_last_what()
      };

      harness._wasm_input_bridge_harness_reset();
      harness._astonia_wasm_input_mouse_focus(1);
      harness._wasm_input_bridge_harness_platform_capture_request(1);
      harness._wasm_input_bridge_harness_platform_cursor_warp_request(640, 360);
      harness._astonia_wasm_input_mouse_move(100, 100, 7, -5, 0, 0, 0);
      harness._wasm_input_bridge_harness_platform_cursor_request(12);
      const capturedRecenterMove = {
        count: harness._wasm_input_bridge_harness_mouse_count(),
        x: harness._wasm_input_bridge_harness_last_mouse_x(),
        y: harness._wasm_input_bridge_harness_last_mouse_y(),
        what: harness._wasm_input_bridge_harness_last_mouse_what(),
        hasFocus: harness._wasm_input_bridge_harness_platform_has_focus(),
        cursor: harness._wasm_input_bridge_harness_platform_cursor()
      };

      harness._astonia_wasm_input_mouse_focus(0);
      const blurredPlatform = {
        hasFocus: harness._wasm_input_bridge_harness_platform_has_focus(),
        checkMouse: harness._wasm_input_bridge_harness_platform_check_mouse()
      };

      return {
        initialPlatform,
        focusedPlatform,
        move,
        leftDown,
        leftUp,
        wheel,
        bridgeCounters,
        capturedRecenterMove,
        blurredPlatform
      };
    }, { moum: SDL_MOUM });

    expect(result).toEqual({
      initialPlatform: {
        hasFocus: 0,
        checkMouse: 1
      },
      focusedPlatform: {
        hasFocus: 1,
        checkMouse: 0
      },
      move: {
        count: 1,
        x: 12,
        y: 34,
        what: SDL_MOUM.none,
        vkShift: 1,
        sdlMods: 1
      },
      leftDown: {
        count: 3,
        x: 20,
        y: 22,
        what: SDL_MOUM.leftDown,
        vkControl: 1,
        sdlMods: 2
      },
      leftUp: {
        count: 5,
        what: SDL_MOUM.leftUp,
        vkAlt: 1,
        sdlMods: 4
      },
      wheel: {
        count: 7,
        x: 0,
        y: -1,
        what: SDL_MOUM.wheel
      },
      bridgeCounters: {
        eventCount: 7,
        moveCount: 4,
        downCount: 1,
        upCount: 1,
        wheelCount: 1,
        activeButtons: 0,
        lastX: 0,
        lastY: -1,
        lastButton: 0,
        lastPressed: 0,
        lastWhat: SDL_MOUM.wheel
      },
      capturedRecenterMove: {
        count: 1,
        x: 647,
        y: 355,
        what: SDL_MOUM.none,
        hasFocus: 1,
        cursor: 12
      },
      blurredPlatform: {
        hasFocus: 0,
        checkMouse: 1
      }
    });
  });
});

test('production WASM export list contains the input bridge exports', () => {
  const makefile = readFileSync(resolve(repoRoot, 'build/make/Makefile.wasm'), 'utf8');

  expect(makefile).toContain('_astonia_wasm_input_set_modifiers');
  expect(makefile).toContain('_astonia_wasm_input_key_down');
  expect(makefile).toContain('_astonia_wasm_input_key_up');
  expect(makefile).toContain('_astonia_wasm_input_text');
  expect(makefile).toContain('_astonia_wasm_input_mouse_focus');
  expect(makefile).toContain('_astonia_wasm_input_mouse_capture');
  expect(makefile).toContain('_astonia_wasm_input_mouse_move');
  expect(makefile).toContain('_astonia_wasm_input_mouse_button');
  expect(makefile).toContain('_astonia_wasm_input_mouse_wheel');
  expect(makefile).toContain('_astonia_wasm_input_mouse_event_count');
  expect(makefile).toContain('_astonia_wasm_input_mouse_move_count');
  expect(makefile).toContain('_astonia_wasm_input_mouse_button_down_count');
  expect(makefile).toContain('_astonia_wasm_input_mouse_button_up_count');
  expect(makefile).toContain('_astonia_wasm_input_mouse_wheel_count');
  expect(makefile).toContain('_astonia_wasm_input_mouse_active_buttons');
  expect(makefile).toContain('_astonia_wasm_input_mouse_last_x');
  expect(makefile).toContain('_astonia_wasm_input_mouse_last_y');
  expect(makefile).toContain('_astonia_wasm_input_mouse_last_button');
  expect(makefile).toContain('_astonia_wasm_input_mouse_last_pressed');
  expect(makefile).toContain('_astonia_wasm_input_mouse_last_what');
});

test('generated native module records native input counters from a canvas pointer action', async ({ page }) => {
  if (!existsSync(distModulePath)) {
    test.skip(true, 'native WASM module has not been built');
  }

  await page.goto('/');

  const loadResult = await page.evaluate(async () => {
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
      '_astonia_wasm_input_text',
      '_astonia_wasm_input_mouse_focus',
      '_astonia_wasm_input_mouse_capture',
      '_astonia_wasm_input_mouse_move',
      '_astonia_wasm_input_mouse_button',
      '_astonia_wasm_input_mouse_wheel',
      '_astonia_wasm_input_mouse_event_count',
      '_astonia_wasm_input_mouse_move_count',
      '_astonia_wasm_input_mouse_button_down_count',
      '_astonia_wasm_input_mouse_button_up_count',
      '_astonia_wasm_input_mouse_wheel_count',
      '_astonia_wasm_input_mouse_active_buttons',
      '_astonia_wasm_input_mouse_last_x',
      '_astonia_wasm_input_mouse_last_y',
      '_astonia_wasm_input_mouse_last_button',
      '_astonia_wasm_input_mouse_last_pressed',
      '_astonia_wasm_input_mouse_last_what'
    ];

    const missing = exports.filter((name) => typeof module[name] !== 'function');
    window.astoniaNativeModule = module;

    return {
      missing,
      before: {
        eventCount: module._astonia_wasm_input_mouse_event_count?.(),
        moveCount: module._astonia_wasm_input_mouse_move_count?.(),
        activeButtons: module._astonia_wasm_input_mouse_active_buttons?.()
      }
    };
  });

  expect(loadResult.missing).toEqual([]);

  const canvas = page.getByTestId('wasm-client-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box.x + 90, box.y + 104);

  const after = await page.evaluate(() => {
    const module = window.astoniaNativeModule;

    return {
      eventCount: module._astonia_wasm_input_mouse_event_count(),
      moveCount: module._astonia_wasm_input_mouse_move_count(),
      activeButtons: module._astonia_wasm_input_mouse_active_buttons(),
      lastX: module._astonia_wasm_input_mouse_last_x(),
      lastY: module._astonia_wasm_input_mouse_last_y(),
      lastWhat: module._astonia_wasm_input_mouse_last_what()
    };
  });

  expect(after).toEqual({
    eventCount: loadResult.before.eventCount + 1,
    moveCount: loadResult.before.moveCount + 1,
    activeButtons: 0,
    lastX: 90,
    lastY: 104,
    lastWhat: SDL_MOUM.none
  });
});
