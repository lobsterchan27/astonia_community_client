import { expect, test } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));

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

  expect(failures).toEqual([]);
});

test('browser package only contains the WASM/WebGPU host source', () => {
	expect(sourceFilesUnder('src')).toEqual(['src/main.js', 'src/styles.css']);
});
