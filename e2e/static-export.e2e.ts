import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const EXPECTED_BUILD_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

test('GitHub Pages export loads from the real /life-tracker base path', async ({ page }) => {
  const pageErrors: string[] = [];
  const failedStaticRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('http://127.0.0.1:3200/')) {
      failedStaticRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  const response = await page.goto('/life-tracker/');
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Welcome Back')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-life-tracker-build', EXPECTED_BUILD_COMMIT);
  expect(await page.locator('script[src^="/life-tracker/_next/"]').count()).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(failedStaticRequests).toEqual([]);
});
