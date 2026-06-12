import { expect, test } from '@playwright/test';

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

test('browser entrypoint loads without console or runtime errors', async ({ page }) => {
  const failures = collectBrowserFailures(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Astonia Browser Shell' })).toBeVisible();
  await expect(page.getByTestId('webgpu-status')).toBeVisible();
  expect(failures).toEqual([]);
});

test('browser login form defaults to the current host gateway and smoke account', async ({ page }) => {
  await page.goto('/');

  const expectedGateway = await page.evaluate(() => `ws://${window.location.hostname}:8787`);
  await expect(page.locator('input[name="gateway"]')).toHaveValue(expectedGateway);
  await expect(page.locator('input[name="username"]')).toHaveValue('BrowserSmoke');
  await expect(page.locator('input[name="password"]')).toHaveValue('fixturecapture');
});

test('browser shell reports WebGPU capability or fallback status', async ({ page }) => {
  const failures = collectBrowserFailures(page);
  const status = page.getByTestId('webgpu-status');

  await page.goto('/');

  await expect(status).not.toContainText('Checking WebGPU');

  const statusText = await status.textContent();
  expect(statusText).toMatch(/WebGPU (available|unavailable|probe failed)/);

  if (!statusText.includes('WebGPU available')) {
    expect(statusText).toContain('without the GPU renderer');
  }

  expect(failures).toEqual([]);
});
