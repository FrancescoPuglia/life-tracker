import { defineConfig, devices } from '@playwright/test';
import { readStagingEnvironment } from './e2e/staging/safety';

const staging = readStagingEnvironment();

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.staging.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 12 * 60_000,
  expect: { timeout: 45_000 },
  outputDir: 'test-results/staging/playwright',
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: staging.appOrigin,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3300',
    url: staging.appOrigin,
    // Sandboxed CI can launch the reviewed staging UI in a separately
    // approved process, then run Playwright without spawning a second server.
    reuseExistingServer: process.env.E2E_REUSE_EXISTING_SERVER === 'true',
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'false',
      NEXT_PUBLIC_FIREBASE_API_KEY: staging.firebaseApiKey,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: staging.firebaseAuthDomain,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: staging.projectId,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: staging.firebaseStorageBucket,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: staging.firebaseMessagingSenderId,
      NEXT_PUBLIC_FIREBASE_APP_ID: staging.firebaseAppId,
      NEXT_PUBLIC_AI_API_BASE_URL: staging.aiApiBaseUrl,
    },
  },
});
