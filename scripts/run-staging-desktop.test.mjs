import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertReviewedProjectFields,
  extractFirebaseWebManifest,
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
});
