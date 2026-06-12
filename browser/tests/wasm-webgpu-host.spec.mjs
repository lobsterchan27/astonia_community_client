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
    window.resolveNativeLaunch = () => resolve({ launched: true });
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
  expect(moduleText).toMatch(/(Build Required|Native Module Ready)/);
  if (moduleText.includes('Build Required')) {
    expect(moduleText).toContain('browser/dist/astonia-client.js');
    expect(moduleText).toContain('browser/dist/astonia-client.wasm');
    expect(moduleText).toContain('browser/dist/astonia-client.data');
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
  await expect(page.getByRole('button', { name: 'Launch' })).toBeDisabled();

  await page.evaluate(() => document.querySelector('[data-testid="wasm-launch-form"]').requestSubmit());
  expect(await page.evaluate(() => window.nativeLaunchCalls.length)).toBe(1);
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
