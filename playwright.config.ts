import { defineConfig, devices } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/playwright',
  reporter: [['line']],
  use: {
    baseURL: APP_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: APP_ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
      NEXT_PUBLIC_AI_API_BASE_URL: 'http://127.0.0.1:8787',
    },
  },
  projects: [
    {
      name: 'desktop-chromium',
      grep: /desktop covers/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-chromium',
      grep: /mobile preserves/,
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
});
