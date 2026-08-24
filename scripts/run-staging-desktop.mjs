import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DESKTOP_PROFILES,
  resolveDesktopBuildProfile,
} from './desktop-build-profile.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const firebaseCli = resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js');

export function extractFirebaseWebManifest(rawJson) {
  let payload;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    throw new Error('Firebase returned an invalid SDK configuration envelope.');
  }

  const sdkConfig = payload?.status === 'success' ? payload?.result?.sdkConfig : undefined;
  if (!sdkConfig || typeof sdkConfig !== 'object' || Array.isArray(sdkConfig)) {
    throw new Error('Firebase did not return the reviewed staging Web configuration.');
  }
  return sdkConfig;
}

export function assertReviewedProjectFields(sdkConfig, expected) {
  for (const key of [
    'projectId',
    'appId',
    'authDomain',
    'storageBucket',
    'messagingSenderId',
  ]) {
    if (sdkConfig[key] !== expected[key]) {
      throw new Error(`Firebase staging Web configuration field is not reviewed: ${key}.`);
    }
  }
}

function queryReviewedStagingProfile() {
  const expected = DESKTOP_PROFILES.staging;
  let rawJson;
  try {
    rawJson = execFileSync(process.execPath, [
      firebaseCli,
      'apps:sdkconfig',
      'WEB',
      expected.appId,
      '--project',
      expected.projectId,
      '--json',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: publicBuildEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    throw new Error('Unable to resolve the reviewed public staging Web configuration.');
  }

  const sdkConfig = extractFirebaseWebManifest(rawJson);
  assertReviewedProjectFields(sdkConfig, expected);
  return resolveDesktopBuildProfile('staging', {
    ...process.env,
    LIFE_TRACKER_DESKTOP_FIREBASE_API_KEY:
      typeof sdkConfig.apiKey === 'string' ? sdkConfig.apiKey : '',
  });
}

function publicBuildEnvironment(environment) {
  return {
    ...environment,
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: '1',
    OPENAI_API_KEY: '',
    NEXT_PUBLIC_OPENAI_API_KEY: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_API_SECRET: '',
    RESEND_API_KEY: '',
  };
}

export function createStagingBuildEnvironment(environment, apiKey) {
  return publicBuildEnvironment({
    ...environment,
    LIFE_TRACKER_DESKTOP_PROFILE: 'staging',
    LIFE_TRACKER_DESKTOP_FIREBASE_API_KEY: apiKey,
  });
}

function run(command, profile) {
  const environment = createStagingBuildEnvironment(process.env, profile.apiKey);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const invocation = command === 'export'
    ? [npmCommand, ['run', 'build:desktop']]
    : [process.execPath, ['scripts/run-tauri.mjs', 'build', 'staging']];
  const result = spawnSync(invocation[0], invocation[1], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw new Error('The staging Desktop build could not start.');
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const command = process.argv[2];
  if (command !== 'export' && command !== 'tauri-build') {
    throw new Error('Staging Desktop command must be exactly export or tauri-build.');
  }
  const profile = queryReviewedStagingProfile();
  console.log(`Reviewed public Firebase Web manifest resolved for ${profile.projectId}.`);
  run(command, profile);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
