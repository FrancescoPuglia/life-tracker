import { defineConfig, devices } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:3100';
const FUNCTIONS_ORIGIN = 'http://127.0.0.1:5001/life-tracker-test/europe-west1/lifeTrackerAiApi';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
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
  webServer: [
    {
      command: 'node e2e/fake-openai-server.mjs',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
      url: APP_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'life-tracker-test',
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'life-tracker-test.firebaseapp.com',
        NEXT_PUBLIC_AI_API_BASE_URL: FUNCTIONS_ORIGIN,
      },
    },
  ],
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
