import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const harnessOutput = resolve(browserRoot, 'dist/wasm-audio-shell-harness.mjs');
const artifactPattern = /\/dist\/astonia-client\.(js|wasm|data)(?:\?.*)?$/;
const GO_SOUND = 64;
const AUDIO_STATE = {
  unavailable: 0,
  locked: 1,
  ready: 2
};

const audioReportModuleSource = `
window.nativeAudioReports = [];

export default function createAstoniaClientModule(config) {
  const moduleExports = {
    _astonia_wasm_audio_report_browser_state(state) {
      window.nativeAudioReports.push(state);
    },
    _astonia_wasm_audio_state() {
      return window.nativeAudioReports.at(-1) ?? 0;
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
  };

  Object.assign(config, moduleExports);
  for (const hook of config.preRun ?? []) {
    hook();
  }

  return Promise.resolve(moduleExports);
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
    '_wasm_audio_harness_reset',
    '_wasm_audio_harness_game_options',
    '_astonia_wasm_audio_report_browser_state',
    '_astonia_wasm_audio_state',
    '_init_sound',
    '_sound_is_enabled',
    '_sound_get_master_volume',
    '_sound_load',
    '_sound_play',
    '_sound_play_loop'
  ];
  const args = [
    '-std=gnu11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    '-Iinclude',
    '-Isrc',
    '-Isrc/wasm',
    'tests/wasm_audio_shell_harness.c',
    'src/wasm/wasm_audio_shell.c',
    '--no-entry',
    '-sENVIRONMENT=web',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createWasmAudioShellHarness',
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

async function installMockAudioContext(page) {
  await page.addInitScript(() => {
    window.audioMock = {
      constructed: 0,
      resumed: 0
    };

    class MockAudioContext extends EventTarget {
      constructor() {
        super();
        this.state = 'suspended';
        window.audioMock.constructed++;
      }

      async resume() {
        window.audioMock.resumed++;
        this.state = 'running';
        this.dispatchEvent(new Event('statechange'));
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      get() {
        return MockAudioContext;
      }
    });
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      get() {
        return undefined;
      }
    });
  });
}

async function installMissingAudioContext(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      get() {
        return undefined;
      }
    });
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      get() {
        return undefined;
      }
    });
  });
}

async function routeNativeArtifacts(page, moduleSource = audioReportModuleSource) {
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

async function loadAudioHarness(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const imported = await import(`/dist/wasm-audio-shell-harness.mjs?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createWasmAudioShellHarness;
    window.audioHarness = await createModule({
      locateFile(path) {
        return `/dist/${path}`;
      }
    });
  });
}

test('audio status reports unavailable when Web Audio is absent', async ({ page }) => {
  await installMissingAudioContext(page);

  await page.goto('/');

  await expect(page.getByTestId('audio-status')).toHaveAttribute('data-audio-state', 'unavailable');
  await expect(page.getByTestId('audio-status')).toContainText('Audio Unavailable');
  await expect(page.getByTestId('audio-unlock-button')).toBeDisabled();
});

test('audio status stays locked until an explicit browser gesture unlocks Web Audio', async ({ page }) => {
  await installMockAudioContext(page);

  await page.goto('/');

  await expect(page.getByTestId('audio-status')).toHaveAttribute('data-audio-state', 'locked');
  await expect(page.getByTestId('audio-status')).toContainText('Audio Locked');
  expect(await page.evaluate(() => window.audioMock)).toEqual({ constructed: 0, resumed: 0 });

  await page.getByTestId('audio-unlock-button').click();

  await expect(page.getByTestId('audio-status')).toHaveAttribute('data-audio-state', 'ready');
  await expect(page.getByTestId('audio-status')).toContainText('Audio Ready');
  expect(await page.evaluate(() => window.audioMock)).toEqual({ constructed: 1, resumed: 1 });
});

test('launch reports ready audio capability to native before and after module startup', async ({ page }) => {
  await installMockWebGpu(page);
  await installMockAudioContext(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();

  await page.getByRole('button', { name: 'Launch' }).click();

  await expect(page.getByTestId('audio-status')).toHaveAttribute('data-audio-state', 'ready');
  await page.waitForFunction(() => window.nativeAudioReports?.length === 2);
  expect(await page.evaluate(() => window.nativeAudioReports)).toEqual([
    AUDIO_STATE.ready,
    AUDIO_STATE.ready
  ]);
});

test('post-launch audio unlock reports ready to the running native module', async ({ page }) => {
  await installMockWebGpu(page);
  await installMockAudioContext(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();

  await page.evaluate(() => {
    document.querySelector('[data-testid="wasm-launch-form"]').requestSubmit();
  });

  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');
  await expect(page.getByTestId('audio-status')).toHaveAttribute('data-audio-state', 'locked');
  await page.waitForFunction(() => window.nativeAudioReports?.length === 2);
  expect(await page.evaluate(() => window.nativeAudioReports)).toEqual([
    AUDIO_STATE.locked,
    AUDIO_STATE.locked
  ]);

  await page.getByTestId('audio-unlock-button').click();

  await expect(page.getByTestId('audio-status')).toHaveAttribute('data-audio-state', 'ready');
  await page.waitForFunction((readyState) => window.nativeAudioReports?.at(-1) === readyState, AUDIO_STATE.ready);
  expect(await page.evaluate(() => window.nativeAudioReports)).toEqual([
    AUDIO_STATE.locked,
    AUDIO_STATE.locked,
    AUDIO_STATE.ready
  ]);
});

const emcc = findEmcc();

test.describe('WASM audio capability shell harness', () => {
  test.skip(!emcc, 'Emscripten is required for the focused WASM audio shell harness');

  test.beforeAll(() => {
    buildHarness(emcc);
  });

  test('keeps native sound disabled until browser capability is ready', async ({ page }) => {
    await loadAudioHarness(page);

    const result = await page.evaluate(
      ({ goSound, audioState }) => {
        const harness = window.audioHarness;

        const lockedState = harness._wasm_audio_harness_reset(goSound);
        const lockedInit = harness._init_sound();
        const lockedEnabled = harness._sound_is_enabled();
        const lockedMasterVolume = harness._sound_get_master_volume();
        const loadBeforeUnlock = harness._sound_load(0);
        const playBeforeUnlock = harness._sound_play(1, 1.0);
        const loopBeforeUnlock = harness._sound_play_loop(1, 1.0);

        harness._astonia_wasm_audio_report_browser_state(audioState.ready);
        const readyState = harness._astonia_wasm_audio_state();
        const readyInit = harness._init_sound();
        const readyEnabled = harness._sound_is_enabled();
        const readyMasterVolume = harness._sound_get_master_volume();

        harness._wasm_audio_harness_reset(0);
        harness._astonia_wasm_audio_report_browser_state(audioState.ready);
        const optionDisabledInit = harness._init_sound();
        const optionDisabledEnabled = harness._sound_is_enabled();

        harness._wasm_audio_harness_reset(goSound);
        harness._astonia_wasm_audio_report_browser_state(audioState.unavailable);
        const unavailableState = harness._astonia_wasm_audio_state();
        const unavailableInit = harness._init_sound();
        const unavailableEnabled = harness._sound_is_enabled();
        const unavailableOptions = harness._wasm_audio_harness_game_options();

        harness._wasm_audio_harness_reset(goSound);
        harness._astonia_wasm_audio_report_browser_state(99);
        const invalidState = harness._astonia_wasm_audio_state();
        const invalidOptions = harness._wasm_audio_harness_game_options();

        return {
          lockedState,
          lockedInit,
          lockedEnabled,
          lockedMasterVolume,
          loadBeforeUnlock,
          playBeforeUnlock,
          loopBeforeUnlock,
          readyState,
          readyInit,
          readyEnabled,
          readyMasterVolume,
          optionDisabledInit,
          optionDisabledEnabled,
          unavailableState,
          unavailableInit,
          unavailableEnabled,
          unavailableOptions,
          invalidState,
          invalidOptions
        };
      },
      { goSound: GO_SOUND, audioState: AUDIO_STATE }
    );

    expect(result).toEqual({
      lockedState: AUDIO_STATE.locked,
      lockedInit: -1,
      lockedEnabled: 0,
      lockedMasterVolume: 0,
      loadBeforeUnlock: 0,
      playBeforeUnlock: 0,
      loopBeforeUnlock: 0,
      readyState: AUDIO_STATE.ready,
      readyInit: 0,
      readyEnabled: 1,
      readyMasterVolume: 1,
      optionDisabledInit: -1,
      optionDisabledEnabled: 0,
      unavailableState: AUDIO_STATE.unavailable,
      unavailableInit: -1,
      unavailableEnabled: 0,
      unavailableOptions: 0,
      invalidState: AUDIO_STATE.unavailable,
      invalidOptions: 0
    });
  });
});

test('generated native module exposes and accepts the audio capability bridge before startup', async ({ page }) => {
  if (!existsSync(distModulePath)) {
    test.skip(true, 'native WASM module has not been built');
  }

  await page.goto('/');

  const result = await page.evaluate(async (readyState) => {
    const imported = await import(`/dist/astonia-client.js?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createAstoniaClientModule;
    const moduleConfig = {
      noInitialRun: true,
      canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
      preRun: [
        () => {
          moduleConfig._astonia_wasm_audio_report_browser_state?.(readyState);
        }
      ],
      locateFile(path) {
        return `/dist/${path}`;
      }
    };
    const module = await createModule(moduleConfig);

    return {
      hasReport: typeof module._astonia_wasm_audio_report_browser_state,
      hasState: typeof module._astonia_wasm_audio_state,
      state: module._astonia_wasm_audio_state()
    };
  }, AUDIO_STATE.ready);

  expect(result).toEqual({
    hasReport: 'function',
    hasState: 'function',
    state: AUDIO_STATE.ready
  });
});

test('production WASM export list contains only narrow audio capability exports', () => {
  const makefile = readFileSync(resolve(repoRoot, 'build/make/Makefile.wasm'), 'utf8');

  expect(makefile).toContain('_astonia_wasm_audio_report_browser_state');
  expect(makefile).toContain('_astonia_wasm_audio_state');
  expect(makefile).not.toMatch(/_sound_(?:load|play|play_loop|set_volume|fade|stop|stop_all)\b/);
});

test('browser audio source stays capability-only', () => {
  const source = readFileSync(resolve(repoRoot, 'browser/src/main.js'), 'utf8');
  const forbidden = [
    ['sound IDs', /\b(?:soundId|sound_id|soundNr|sound_nr)\b/i],
    ['audio asset paths', /\b(?:sounds\.json|\.ogg|\.wav|sx(?:_mod|_patch)?\.zip)\b/i],
    ['playback volume or pan', /\b(?:volume|pan|panning|attenuation|fade|gain)\b/i],
    ['gameplay timing', /\b(?:soundTick|audioTick|playAt|scheduleSound)\b/i]
  ];
  const failures = [];

  for (const [label, pattern] of forbidden) {
    const match = source.match(pattern);
    if (match) {
      failures.push(`${label} matched ${match[0]}`);
    }
  }

  expect(failures).toEqual([]);
});
