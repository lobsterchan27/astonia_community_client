import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const distDataPath = resolve(browserRoot, 'dist/astonia-client.data');
const artifactPattern = /\/dist\/astonia-client\.(js|wasm|data)(?:\?.*)?$/;
const ASTONIA_NATIVE_CLIENT_SHOW_USAGE = 1;
const ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED = -5;

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

const smokeObservableModuleSource = `
window.nativeSmokeGetterCalls = window.nativeSmokeGetterCalls || [];

function recordSmokeGetter(name) {
  window.nativeSmokeGetterCalls.push(name);
  return 0;
}

export default function createAstoniaClientModule() {
  return Promise.resolve({
    _astonia_native_startup_adapter_status() {
      return 2;
    },
    _astonia_native_startup_adapter_startup_result() {
      return 0;
    },
    _astonia_native_startup_adapter_loop_init_result() {
      return 0;
    },
    _astonia_smoke_login_done() {
      return recordSmokeGetter('loginDone');
    },
    _astonia_smoke_sockstate() {
      return recordSmokeGetter('sockstate');
    },
    _astonia_smoke_protocol_version() {
      return recordSmokeGetter('protocolVersion');
    },
    _astonia_smoke_tick() {
      return recordSmokeGetter('tick');
    },
    _astonia_smoke_queued_ticks() {
      return recordSmokeGetter('queuedTicks');
    },
    _astonia_smoke_queue_size() {
      return recordSmokeGetter('queueSize');
    }
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
  return ['index.html', 'server.mjs', ...sourceFilesUnder('src')];
}

function sourceWithDocumentedPlatformOnlyVocabulary(relativePath, source) {
  const allowlist = [
    {
      relativePath: 'src/main.js',
      snippet: 'window.location.protocol',
      reason: 'URL scheme selection for the platform gateway default, not gameplay protocol handling.'
    }
  ];

  let scrubbed = source;
  for (const entry of allowlist) {
    if (entry.relativePath !== relativePath) {
      continue;
    }

    expect(source, `${relativePath} platform-only allowlist missing: ${entry.reason}`).toContain(entry.snippet);
    scrubbed = scrubbed.split(entry.snippet).join('');
  }

  return scrubbed;
}

async function installIntervalSpy(page) {
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.astoniaIntervalCalls = [];
    window.setInterval = (callback, delay, ...args) => {
      window.astoniaIntervalCalls.push({
        delay: Number(delay),
        callbackText: String(callback).slice(0, 500)
      });
      return nativeSetInterval(callback, delay, ...args);
    };
  });
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

test('default host launch does not start recurring diagnostic sampling', async ({ page }) => {
  await installMockWebGpu(page);
  await installIntervalSpy(page);
  await routeNativeArtifacts(page, { moduleSource: smokeObservableModuleSource });

  await page.goto('/');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');
  await page.waitForTimeout(250);

  const observed = await page.evaluate(() => ({
    probeEnabled: window.astoniaWasmLaunchProbe.enabled,
    intervalCalls: window.astoniaIntervalCalls,
    liveSmokeSamplerType: typeof window.astoniaLiveSmokeSampler,
    smokeGetterCalls: window.nativeSmokeGetterCalls
  }));

  expect(observed.probeEnabled).toBe(false);
  expect(observed.intervalCalls).toEqual([]);
  expect(observed.liveSmokeSamplerType).toBe('undefined');
  expect(observed.smokeGetterCalls).toEqual([]);
});

test('debug launch probe may start the pending platform watchdog when requested', async ({ page }) => {
  await installMockWebGpu(page);
  await installIntervalSpy(page);
  await routeNativeArtifacts(page);

  await page.goto('/?astonia_probe=1');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

  await page.getByRole('button', { name: 'Launch' }).click();
  await page.waitForFunction(() => window.nativeLaunchCalls?.length === 1);

  expect(await page.evaluate(() => window.astoniaWasmLaunchProbe.enabled)).toBe(true);
  expect(await page.evaluate(() => window.astoniaIntervalCalls)).toEqual([
    expect.objectContaining({ delay: 5000 })
  ]);

  await page.evaluate(() => window.resolveNativeLaunch());
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'running');
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
			'_astonia_smoke_queue_size',
			'_astonia_smoke_render_begin_count',
			'_astonia_smoke_render_present_count',
			'_astonia_smoke_render_present_failure_count',
			'_astonia_smoke_texture_create_count',
			'_astonia_smoke_texture_upload_count',
			'_astonia_smoke_texture_blit_count',
			'_astonia_smoke_texture_job_queue_count',
			'_astonia_smoke_texture_job_queue_peak',
			'_astonia_smoke_texture_job_enqueue_count',
			'_astonia_smoke_texture_job_drop_count',
			'_astonia_smoke_texture_cpu_work_count'
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
						queueSize: module._astonia_smoke_queue_size(),
						renderBeginCount: module._astonia_smoke_render_begin_count(),
						renderPresentCount: module._astonia_smoke_render_present_count(),
						renderPresentFailureCount: module._astonia_smoke_render_present_failure_count(),
						textureCreateCount: module._astonia_smoke_texture_create_count(),
						textureUploadCount: module._astonia_smoke_texture_upload_count(),
						textureBlitCount: module._astonia_smoke_texture_blit_count(),
						textureJobQueueCount: module._astonia_smoke_texture_job_queue_count(),
						textureJobQueuePeak: module._astonia_smoke_texture_job_queue_peak(),
						textureJobEnqueueCount: module._astonia_smoke_texture_job_enqueue_count(),
						textureJobDropCount: module._astonia_smoke_texture_job_drop_count(),
						textureCpuWorkCount: module._astonia_smoke_texture_cpu_work_count()
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
		queueSize: 0,
		renderBeginCount: 0,
		renderPresentCount: 0,
		renderPresentFailureCount: 0,
		textureCreateCount: 0,
		textureUploadCount: 0,
		textureBlitCount: 0,
		textureJobQueueCount: 0,
		textureJobQueuePeak: 0,
		textureJobEnqueueCount: 0,
		textureJobDropCount: 0,
		textureCpuWorkCount: 0
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

test('generated native module contains an invoked Sokol main path', () => {
	if (!existsSync(distModulePath)) {
		test.skip(true, 'native WASM module has not been built');
	}

	const source = readFileSync(distModulePath, 'utf8');

	expect(source).toMatch(/\bcallMain\b/);
	expect(source).toMatch(/Module\["_main"\]|wasmExports\["main"\]/);
	expect(source).toMatch(/Module\["noInitialRun"\]/);
});

test('generated native module exposes native startup adapter probes without initial run', async ({ page }) => {
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

test('host launch with the generated native module invokes the startup adapter entrypoint', async ({ page }) => {
	if (!existsSync(distModulePath)) {
		test.skip(true, 'native WASM module has not been built');
	}

	const failures = collectBrowserFailures(page);
	await installMockWebGpu(page);
	await page.goto('/?astonia_probe=1');

	await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');
	await page.locator('input[name="username"]').fill('');
	await page.locator('input[name="password"]').fill('');
	await page.getByRole('button', { name: 'Launch' }).click();
	await page.waitForFunction((runNotStarted) => {
		const module = window.astoniaNativeModule;
		return (
			typeof module?._astonia_native_startup_adapter_status === 'function' &&
			module._astonia_native_startup_adapter_startup_result() !== runNotStarted
		);
	}, ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED);

	const result = await page.evaluate(() => {
		const module = window.astoniaNativeModule;
		return {
			status: module._astonia_native_startup_adapter_status(),
			startupResult: module._astonia_native_startup_adapter_startup_result(),
			loopInitResult: module._astonia_native_startup_adapter_loop_init_result(),
			shutdownCount: module._astonia_native_startup_adapter_shutdown_count(),
			probeStages: window.astoniaWasmLaunchProbe.events.map((event) => event.stage)
		};
	});

	expect(result.startupResult).toBe(ASTONIA_NATIVE_CLIENT_SHOW_USAGE);
	expect(result.loopInitResult).toBe(ASTONIA_NATIVE_CLIENT_RUN_NOT_STARTED);
	expect(result.status).not.toBe(0);
	expect(result.shutdownCount).toBeGreaterThan(0);
	expect(result.probeStages).toEqual(expect.arrayContaining(['create-module-start', 'create-module-resolved', 'running']));
	expect(failures).toEqual([]);
});

test('browser package only contains the WASM/WebGPU host source', () => {
	expect(sourceFilesUnder('src')).toEqual(['src/main.js', 'src/styles.css']);
});

test('browser host source stays inside platform-launch boundaries', () => {
  const forbiddenPatterns = [
    {
      name: 'undocumented protocol vocabulary',
      pattern: /\bprotocol\b/i
    },
    {
      name: 'login vocabulary',
      pattern: /\blogin\b/i
    },
    {
      name: 'tick vocabulary',
      pattern: /\btick\b/i
    },
    {
      name: 'gameplay vocabulary',
      pattern: /\bgameplay\b/i
    },
    {
      name: 'render vocabulary',
      pattern: /\brender\b/i
    },
    {
      name: 'recurring diagnostic sampling vocabulary',
      pattern: /\b(?:diagnostic|sample|poll(?:ing)?)\b/i
    },
    {
      name: 'native smoke observability exports',
      pattern: /\b_astonia_smoke_[a-z0-9_]+\b/i
    },
    {
      name: 'native protocol command constants',
      pattern: /\bCMD_[A-Z0-9_]+\b/
    },
    {
      name: 'native client send calls',
      pattern: /\bclient_send\b/
    },
    {
      name: 'client command packet construction',
      pattern: /\b(?:build|encode|write|construct)(?:Client|Native|Protocol)?(?:Command|Packet)\b/i
    },
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
    const source = sourceWithDocumentedPlatformOnlyVocabulary(
      relativePath,
      readFileSync(resolve(browserRoot, relativePath), 'utf8')
    );
    for (const { name, pattern } of forbiddenPatterns) {
      expect(pattern.test(source), `${relativePath} must not implement ${name}`).toBe(false);
    }
  }
});
