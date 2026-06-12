import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const distDataPath = resolve(browserRoot, 'dist/astonia-client.data');
const artifactPattern = /\/dist\/astonia-client\.(js|wasm|data)(?:\?.*)?$/;

const launchCaptureModuleSource = `
window.nativeLaunchCalls = window.nativeLaunchCalls || [];

export default function createAstoniaClientModule(config) {
  const call = {
    arguments: Array.from(config.arguments ?? []),
    canvasMatches: config.canvas === document.querySelector('[data-testid="wasm-client-canvas"]'),
    locatedData: config.locateFile('astonia-client.data'),
    locatedWasm: config.locateFile('astonia-client.wasm')
  };
  window.nativeLaunchCalls.push(call);
  config.setStatus?.('Downloading native module');
  config.monitorRunDependencies?.(2);
  return new Promise((resolve) => {
    window.resolveNativeLaunch = () =>
      resolve({
        launched: true,
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
  });
}
`;

const abortingModuleSource = `
window.nativeLaunchCalls = window.nativeLaunchCalls || [];

export default function createAstoniaClientModule(config) {
  window.nativeLaunchCalls.push({
    arguments: Array.from(config.arguments ?? []),
    canvasMatches: config.canvas === document.querySelector('[data-testid="wasm-client-canvas"]')
  });
  config.onAbort('native abort: missing packaged resource');
  throw new Error('factory rejected after abort');
}
`;

const lateLoadingStatusModuleSource = `
export default function createAstoniaClientModule(config) {
  config.setStatus?.('Running...');
  return Promise.resolve({
    _astonia_native_startup_adapter_status() {
      return 2;
    },
    _astonia_native_startup_adapter_startup_result() {
      return 0;
    },
    _astonia_native_startup_adapter_loop_init_result() {
      return 0;
    }
  }).then((module) => {
    setTimeout(() => config.setStatus?.('Preparing native runtime.'), 0);
    return module;
  });
}
`;

function collectBrowserFailures(page) {
  const failures = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(`console.error: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

  return failures;
}

function sourceFilesUnder(relativePath) {
	const dir = resolve(browserRoot, relativePath);
	if (!existsSync(dir)) {
		return [];
	}

	const files = [];
	const visit = (currentDir, currentRelativePath) => {
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			const nextRelativePath = `${currentRelativePath}/${entry.name}`;
			const nextPath = resolve(currentDir, entry.name);
			if (entry.isDirectory()) {
				visit(nextPath, nextRelativePath);
			} else if (entry.isFile()) {
				files.push(nextRelativePath);
			}
		}
	};

	visit(dir, relativePath);
	return files.sort();
}

function browserHostSourceFiles() {
  return ['server.mjs', ...sourceFilesUnder('src')];
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

async function routeNativeArtifacts(page, { missing = [], moduleSource = launchCaptureModuleSource } = {}) {
  const missingArtifacts = new Set(missing);

  await page.route(artifactPattern, async (route) => {
    const request = route.request();
    const artifactName = new URL(request.url()).pathname.split('/').pop();
    const extension = artifactName.split('.').pop();

    if (missingArtifacts.has(artifactName)) {
      await route.fulfill({
        status: request.method() === 'HEAD' ? 204 : 404,
        headers: {
          'Cache-Control': 'no-store',
          'X-Astonia-Artifact-Missing': '1'
        }
      });
      return;
    }

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

test('browser host loads as the WASM/WebGPU native target', async ({ page }) => {
  const failures = collectBrowserFailures(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Astonia WASM/WebGPU Client' })).toBeVisible();
  await expect(page.getByTestId('webgpu-status')).toBeVisible();
  await expect(page.getByTestId('wasm-module-status')).toBeVisible();

  const bodyText = await page.locator('body').textContent();
  expect(bodyText).toContain('Astonia WASM/WebGPU Client');
  expect(failures).toEqual([]);
});

test('host defaults launch arguments for the native module', async ({ page }) => {
  await page.goto('/');

  const expectedGateway = await page.evaluate(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.hostname}:8787`;
  });

  await expect(page.locator('input[name="gateway"]')).toHaveValue(expectedGateway);
  await expect(page.locator('input[name="username"]')).toHaveValue('BrowserSmoke');
  await expect(page.locator('input[name="password"]')).toHaveValue('fixturecapture');
});

test('host reports WebGPU and native module status', async ({ page }) => {
  const failures = collectBrowserFailures(page);

  await page.goto('/');

  await expect(page.getByTestId('webgpu-status')).not.toContainText('Checking WebGPU');
  await expect(page.getByTestId('wasm-module-status')).not.toContainText('Checking Native Module');

	const moduleText = await page.getByTestId('wasm-module-status').textContent();
	expect(moduleText).toMatch(/(Build Required|Incomplete Native Artifacts|Native Module Ready)/);
	if (moduleText.includes('Build Required')) {
		expect(moduleText).toContain('browser/dist/astonia-client.js');
		expect(moduleText).toContain('browser/dist/astonia-client.wasm');
		expect(moduleText).toContain('browser/dist/astonia-client.data');
	}
	if (moduleText.includes('Incomplete Native Artifacts')) {
		expect(moduleText).toContain('browser/dist/astonia-client.');
	}

  expect(failures).toEqual([]);
});

test('host reports an incomplete artifact set and keeps launch disabled', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page, { missing: ['astonia-client.wasm'] });

  await page.goto('/');

  await expect(page.getByTestId('webgpu-status')).toHaveAttribute('data-webgpu-state', 'available');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'build-required');
  await expect(page.getByTestId('wasm-module-status')).toContainText('Incomplete Native Artifacts');
  await expect(page.getByTestId('wasm-module-status')).toContainText('browser/dist/astonia-client.wasm');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled();
});

test('host launches one native module owner with canvas and CLI arguments', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeEnabled();

  const gateway = 'ws://127.0.0.1:8787/gateway';
  await page.locator('input[name="gateway"]').fill(gateway);
  await page.locator('input[name="username"]').fill('SmokeUser');
  await page.locator('input[name="password"]').fill('SmokePass');

  await page.evaluate(() => {
    const form = document.querySelector('[data-testid="wasm-launch-form"]');
    form.requestSubmit();
    form.requestSubmit();
  });

  await page.waitForFunction(() => window.nativeLaunchCalls?.length === 1);
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'loading');
  await expect(page.getByTestId('wasm-module-status')).toContainText('2 run dependencies remaining');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled();

  const call = await page.evaluate(() => window.nativeLaunchCalls[0]);
  expect(call).toEqual({
    arguments: ['-u', 'SmokeUser', '-p', 'SmokePass', '-d', gateway, '-w', '1280', '-h', '720', '-m', '0'],
    canvasMatches: true,
    locatedData: '/dist/astonia-client.data',
    locatedWasm: '/dist/astonia-client.wasm'
  });

  await page.evaluate(() => window.resolveNativeLaunch());
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');
  await expect(page.getByTestId('wasm-module-status')).toContainText('Native lifecycle running; startup 0; loop 0.');
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled();

  await page.evaluate(() => document.querySelector('[data-testid="wasm-launch-form"]').requestSubmit());
  expect(await page.evaluate(() => window.nativeLaunchCalls.length)).toBe(1);
});

test('host records structured launch probe events with redacted credentials', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page);

  await page.goto('/?astonia_probe=1');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

  await page.locator('input[name="password"]').fill('ProbeSecret');
  await page.getByRole('button', { name: 'Launch' }).click();

  await page.waitForFunction(() =>
    window.astoniaWasmLaunchProbe?.events?.some((event) => event.stage === 'callback:monitorRunDependencies')
  );

  await page.evaluate(() => window.resolveNativeLaunch());
  await page.waitForFunction(() =>
    window.astoniaWasmLaunchProbe?.events?.some((event) => event.stage === 'running')
  );

  const probe = await page.evaluate(() => ({
    enabled: window.astoniaWasmLaunchProbe.enabled,
    events: window.astoniaWasmLaunchProbe.events
  }));
  const stages = probe.events.map((event) => event.stage);

  expect(probe.enabled).toBe(true);
  expect(stages).toEqual(
    expect.arrayContaining([
      'submit',
      'owner-created',
      'import-start',
      'import-resolved',
      'create-module-start',
      'callback:monitorRunDependencies',
      'create-module-resolved',
      'running',
      'finally'
    ])
  );
  expect(JSON.stringify(probe.events)).not.toContain('ProbeSecret');
  expect(JSON.stringify(probe.events)).toContain('<redacted>');
});

test('host keeps running state when the module emits a stale loading status after resolve', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page, { moduleSource: lateLoadingStatusModuleSource });

  await page.goto('/?astonia_probe=1');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');
  await page.waitForFunction(() =>
    window.astoniaWasmLaunchProbe?.events?.some((event) => event.stage === 'loading-detail-ignored')
  );

  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');
  await expect(page.getByTestId('wasm-module-status')).toContainText('Native lifecycle running; startup 0; loop 0.');
});

test('host preserves native abort reason instead of replacing it with factory failure', async ({ page }) => {
  await installMockWebGpu(page);
  await routeNativeArtifacts(page, { moduleSource: abortingModuleSource });

  await page.goto('/');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

  await page.getByRole('button', { name: 'Launch' }).click();

  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'aborted');
  await expect(page.getByTestId('wasm-module-status')).toContainText('native abort: missing packaged resource');
  await expect(page.getByTestId('wasm-module-status')).not.toContainText('factory rejected after abort');
  expect(await page.evaluate(() => window.nativeLaunchCalls.length)).toBe(1);
});

test('generated native module can read packaged resource filesystem', async ({ page }) => {
	if (!existsSync(distModulePath)) {
		test.skip(true, 'native WASM module has not been built');
	}

	expect(existsSync(distDataPath)).toBe(true);

	const failures = collectBrowserFailures(page);
	await page.goto('/');

	const result = await page.evaluate(async () => {
		const imported = await import(`/dist/astonia-client.js?t=${Date.now()}`);
		const createModule = imported.default ?? imported.createAstoniaClientModule;
		const logs = [];
		const module = await createModule({
			noInitialRun: true,
			canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
			locateFile(path) {
				return `/dist/${path}`;
			},
			print(message) {
				logs.push(String(message));
			},
			printErr(message) {
				logs.push(String(message));
			}
		});

		if (typeof module._astonia_resource_fs_check !== 'function') {
			return { failures: -1, expected: 0, logs: ['resource filesystem export missing'] };
		}

		return {
			failures: module._astonia_resource_fs_check(),
			expected: module._astonia_resource_fs_expected_count(),
			logs
		};
	});

	expect(result.expected).toBeGreaterThanOrEqual(10);
	expect(result.failures, result.logs.join('\n')).toBe(0);
	expect(failures).toEqual([]);
});

test('generated native module exposes smoke observability getters', async ({ page }) => {
	if (!existsSync(distModulePath)) {
		test.skip(true, 'native WASM module has not been built');
	}

	const failures = collectBrowserFailures(page);
	await page.goto('/');

	const result = await page.evaluate(async () => {
		const imported = await import(`/dist/astonia-client.js?t=${Date.now()}`);
		const createModule = imported.default ?? imported.createAstoniaClientModule;
		const module = await createModule({
			noInitialRun: true,
			canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
			locateFile(path) {
				return `/dist/${path}`;
			}
		});

		const getters = [
			'_astonia_smoke_login_done',
			'_astonia_smoke_sockstate',
			'_astonia_smoke_protocol_version',
			'_astonia_smoke_tick',
			'_astonia_smoke_queued_ticks',
			'_astonia_smoke_queue_size'
		];
		const missing = getters.filter((name) => typeof module[name] !== 'function');

		return {
			missing,
			values: missing.length
				? null
				: {
						loginDone: module._astonia_smoke_login_done(),
						sockstate: module._astonia_smoke_sockstate(),
						protocolVersion: module._astonia_smoke_protocol_version(),
						tick: module._astonia_smoke_tick(),
						queuedTicks: module._astonia_smoke_queued_ticks(),
						queueSize: module._astonia_smoke_queue_size()
					}
		};
	});

	expect(result.missing).toEqual([]);
	expect(result.values).toEqual({
		loginDone: 0,
		sockstate: 0,
		protocolVersion: 0,
		tick: 0,
		queuedTicks: 0,
		queueSize: 0
	});
	expect(failures).toEqual([]);
});

test('generated native module exports native lifecycle entry points', async ({ page }) => {
	if (!existsSync(distModulePath)) {
		test.skip(true, 'native WASM module has not been built');
	}

	const failures = collectBrowserFailures(page);
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

		const lifecycleExports = [
			'_astonia_native_client_startup',
			'_astonia_native_client_run',
			'_astonia_native_client_shutdown',
			'_main_loop_init',
			'_main_loop_step',
			'_main_loop_shutdown'
		];

		return lifecycleExports.filter((name) => typeof module[name] !== 'function');
	});

	expect(missing).toEqual([]);
	expect(failures).toEqual([]);
});

test('generated native module exposes native startup adapter probes', async ({ page }) => {
	if (!existsSync(distModulePath)) {
		test.skip(true, 'native WASM module has not been built');
	}

	const failures = collectBrowserFailures(page);
	await page.goto('/');

	const result = await page.evaluate(async () => {
		const imported = await import(`/dist/astonia-client.js?t=${Date.now()}`);
		const createModule = imported.default ?? imported.createAstoniaClientModule;
		const module = await createModule({
			noInitialRun: true,
			canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
			locateFile(path) {
				return `/dist/${path}`;
			}
		});

		const probes = [
			'_astonia_native_startup_adapter_status',
			'_astonia_native_startup_adapter_startup_result',
			'_astonia_native_startup_adapter_loop_init_result',
			'_astonia_native_startup_adapter_frame_count',
			'_astonia_native_startup_adapter_step_count',
			'_astonia_native_startup_adapter_shutdown_count',
			'_astonia_native_startup_adapter_has_username',
			'_astonia_native_startup_adapter_has_password',
			'_astonia_native_startup_adapter_has_server_url',
			'_astonia_native_startup_adapter_want_width',
			'_astonia_native_startup_adapter_want_height',
			'_astonia_native_startup_adapter_thread_count'
		];
		const missing = probes.filter((name) => typeof module[name] !== 'function');

		return {
			missing,
			values: missing.length
				? null
				: {
						status: module._astonia_native_startup_adapter_status(),
						startupResult: module._astonia_native_startup_adapter_startup_result(),
						loopInitResult: module._astonia_native_startup_adapter_loop_init_result(),
						frameCount: module._astonia_native_startup_adapter_frame_count(),
						stepCount: module._astonia_native_startup_adapter_step_count(),
						shutdownCount: module._astonia_native_startup_adapter_shutdown_count(),
						hasUsername: module._astonia_native_startup_adapter_has_username(),
						hasPassword: module._astonia_native_startup_adapter_has_password(),
						hasServerUrl: module._astonia_native_startup_adapter_has_server_url(),
						wantWidth: module._astonia_native_startup_adapter_want_width(),
						wantHeight: module._astonia_native_startup_adapter_want_height(),
						threadCount: module._astonia_native_startup_adapter_thread_count()
					}
		};
	});

	expect(result.missing).toEqual([]);
	expect(result.values).toEqual({
		status: 0,
		startupResult: -5,
		loopInitResult: -5,
		frameCount: 0,
		stepCount: 0,
		shutdownCount: 0,
		hasUsername: 0,
		hasPassword: 0,
		hasServerUrl: 0,
		wantWidth: 0,
		wantHeight: 0,
		threadCount: 0
	});
	expect(failures).toEqual([]);
});

test('browser package only contains the WASM/WebGPU host source', () => {
	expect(sourceFilesUnder('src')).toEqual(['src/main.js', 'src/styles.css']);
});

test('browser host source stays inside platform-launch boundaries', () => {
  const forbiddenPatterns = [
    {
      name: 'protocol decoding',
      pattern: /\b(decodePacket|parsePacket|packetOpcode|protocolOpcode|tickReplay|replayTick)\b/i
    },
    {
      name: 'movement prediction',
      pattern: /\b(predictMovement|movementPrediction|clientPrediction|reconcileMovement)\b/i
    },
    {
      name: 'sprite or archive decoding',
      pattern: /\b(decodeSprite|spriteSheet|spriteArchive|archiveDecoder|pakDecoder)\b/i
    },
    {
      name: 'render lists or canvas rendering',
      pattern: /\b(renderList|worldRenderer|drawImage|putImageData|getContext\s*\(|requestAnimationFrame)\b/i
    }
  ];

  for (const relativePath of browserHostSourceFiles()) {
    const source = readFileSync(resolve(browserRoot, relativePath), 'utf8');
    for (const { name, pattern } of forbiddenPatterns) {
      expect(pattern.test(source), `${relativePath} must not implement ${name}`).toBe(false);
    }
  }
});
