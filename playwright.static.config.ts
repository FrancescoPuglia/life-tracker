import { defineConfig, devices } from '@playwright/test';

const STATIC_ORIGIN = 'http://127.0.0.1:3200';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'static-export.e2e.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/playwright-static',
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: STATIC_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/serve-static-export.mjs',
    url: `${STATIC_ORIGIN}/life-tracker/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
