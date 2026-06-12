import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const harnessOutput = resolve(browserRoot, 'dist/wasm-smoke-observability-harness.mjs');
const smokeGetters = [
  ['loginDone', '_astonia_smoke_login_done'],
  ['sockstate', '_astonia_smoke_sockstate'],
  ['protocolVersion', '_astonia_smoke_protocol_version'],
  ['tick', '_astonia_smoke_tick'],
  ['queuedTicks', '_astonia_smoke_queued_ticks'],
  ['queueSize', '_astonia_smoke_queue_size']
];

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
    '_wasm_smoke_harness_seed',
    ...smokeGetters.map(([, exportName]) => exportName)
  ];
  const args = [
    '-std=c99',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    '-DASTONIA_SMOKE_OBSERVABILITY_EXTERNAL_STATE',
    '-Iinclude',
    '-Isrc',
    'tests/wasm_smoke_observability_harness.c',
    'src/wasm/astonia_smoke_observability.c',
    '--no-entry',
    '-sENVIRONMENT=web',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createWasmSmokeObservabilityHarness',
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

async function loadHarness(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const imported = await import(`/dist/wasm-smoke-observability-harness.mjs?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createWasmSmokeObservabilityHarness;
    window.smokeHarness = await createModule({
      locateFile(path) {
        return `/dist/${path}`;
      }
    });
  });
}

async function readSmokeState(page) {
  return page.evaluate((getters) => {
    const entries = getters.map(([key, exportName]) => [key, window.smokeHarness[exportName]()]);
    return Object.fromEntries(entries);
  }, smokeGetters);
}

const emcc = findEmcc();

test.describe('WASM smoke observability harness', () => {
  test.skip(!emcc, 'Emscripten is required for the focused WASM smoke observability harness');

  test.beforeAll(() => {
    buildHarness(emcc);
  });

  test('exports live read-only native smoke getters', async ({ page }) => {
    await loadHarness(page);

    const exportedSmokeNames = await page.evaluate(() =>
      Object.keys(window.smokeHarness)
        .filter((key) => key.includes('astonia_smoke'))
        .sort()
    );
    expect(exportedSmokeNames).toEqual(smokeGetters.map(([, exportName]) => exportName).sort());

    expect(await readSmokeState(page)).toEqual({
      loginDone: 0,
      sockstate: 0,
      protocolVersion: 0,
      tick: 0,
      queuedTicks: 0,
      queueSize: 0
    });

    await page.evaluate(() => window.smokeHarness._wasm_smoke_harness_seed(1, 4, 3, 123456, 2, 1));
    const observed = await readSmokeState(page);
    expect(observed).toEqual({
      loginDone: 1,
      sockstate: 4,
      protocolVersion: 3,
      tick: 123456,
      queuedTicks: 2,
      queueSize: 1
    });
    expect(await readSmokeState(page)).toEqual(observed);
  });
});

test('production WASM export list contains smoke getters without smoke mutators', () => {
  const makefile = readFileSync(resolve(repoRoot, 'build/make/Makefile.wasm'), 'utf8');

  for (const [, exportName] of smokeGetters) {
    expect(makefile).toContain(exportName);
  }

  expect(makefile).not.toMatch(/_astonia_smoke_(?:set|seed|connect|poll|send|recv|close|drive)\b/);
});

test('browser and gateway code stay byte-pipe only', () => {
  const sources = [
    'browser/src/main.js',
    'src/wasm/astonia_net_jslib.js',
    'gateway/src/lib.rs',
    'gateway/src/main.rs'
  ];
  const forbidden = [
    ['server opcode constants', /\bSV_[A-Z0-9_]+\b/],
    ['client opcode constants', /\bCL_[A-Z0-9_]+\b/],
    ['login/protocol state names', /\b(?:login_done|sockstate|protocol_version|SV_LOGINDONE|SV_PROTOCOL)\b/],
    ['binary protocol readers', /\b(?:DataView|getUint(?:8|16|32)|readUInt(?:8|16|32)|net_read16|load_u(?:16|32))\b/],
    ['native login magic', /\b0x8fd46100\b/i]
  ];
  const failures = [];

  for (const source of sources) {
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
