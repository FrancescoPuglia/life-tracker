import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertReviewedProjectFields,
  createStagingBuildEnvironment,
  extractFirebaseWebManifest,
  resolveTauriBuildInvocation,
} from './run-staging-desktop.mjs';

const REVIEWED_PUBLIC_CONFIG = {
  projectId: 'life-tracker-staging',
  apiKey: 'synthetic-public-web-key',
  authDomain: 'life-tracker-staging.firebaseapp.com',
  storageBucket: 'life-tracker-staging.firebasestorage.app',
  messagingSenderId: '675076431391',
  appId: '1:675076431391:web:d82e711352456218d4ff2a',
};

describe('staging Desktop Firebase resolver', () => {
  it('accepts only a successful Firebase CLI Web manifest envelope', () => {
    const config = extractFirebaseWebManifest(JSON.stringify({
      status: 'success',
      result: { sdkConfig: REVIEWED_PUBLIC_CONFIG },
    }));
    assert.deepEqual(config, REVIEWED_PUBLIC_CONFIG);
    assert.doesNotThrow(() => assertReviewedProjectFields(config, REVIEWED_PUBLIC_CONFIG));
  });

  it('rejects invalid command envelopes without exposing their content', () => {
    assert.throws(
      () => extractFirebaseWebManifest('not-json'),
      /invalid SDK configuration envelope/,
    );
    assert.throws(
      () => extractFirebaseWebManifest(JSON.stringify({ status: 'error' })),
      /did not return the reviewed staging Web configuration/,
    );
  });

  it('rejects a mismatched project-bound field', () => {
    assert.throws(
      () => assertReviewedProjectFields(
        { ...REVIEWED_PUBLIC_CONFIG, projectId: 'attacker-project' },
        REVIEWED_PUBLIC_CONFIG,
      ),
      /field is not reviewed: projectId/,
    );
  });

  it('hands off an explicit staging profile while clearing provider credentials', () => {
    const environment = createStagingBuildEnvironment({
      OPENAI_API_KEY: 'non-secret-test-value',
      TWILIO_AUTH_TOKEN: 'non-secret-test-value',
      RESEND_API_KEY: 'non-secret-test-value',
    }, 'synthetic-public-web-key');

    assert.equal(environment.LIFE_TRACKER_DESKTOP_PROFILE, 'staging');
    assert.equal(environment.LIFE_TRACKER_DESKTOP_FIREBASE_API_KEY, 'synthetic-public-web-key');
    assert.equal(environment.OPENAI_API_KEY, '');
    assert.equal(environment.TWILIO_AUTH_TOKEN, '');
    assert.equal(environment.RESEND_API_KEY, '');
  });

  it('uses the native toolchain on Windows and a fixed no-secret command from WSL', () => {
    assert.deepEqual(resolveTauriBuildInvocation('win32', 'C:\\node.exe'), [
      'C:\\node.exe',
      ['scripts/run-tauri.mjs', 'build', 'staging'],
    ]);
    assert.deepEqual(resolveTauriBuildInvocation('linux', '/usr/bin/node'), [
      'cmd.exe',
      ['/d', '/s', '/c', 'npm run tauri:build:staging:resolved-config'],
    ]);
    assert.throws(
      () => resolveTauriBuildInvocation('darwin', '/usr/bin/node'),
      /only with the Windows toolchain/,
    );
  });
});
