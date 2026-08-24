import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalAiApiBaseUrl,
  resolveDesktopBuildProfile,
  toNextDesktopEnvironment,
} from './desktop-build-profile.mjs';

const COMMIT = 'a'.repeat(40);

describe('desktop build profiles', () => {
  it('resolves the exact production manifest and canonical backend', () => {
    const profile = resolveDesktopBuildProfile('production', {});
    assert.equal(profile.projectId, 'life-tracker-12000');
    assert.equal(
      profile.aiApiBaseUrl,
      'https://europe-west1-life-tracker-12000.cloudfunctions.net/lifeTrackerAiApi',
    );
  });

  it('requires the reviewed staging Firebase Web API key', () => {
    assert.throws(
      () => resolveDesktopBuildProfile('staging', {}),
      /LIFE_TRACKER_DESKTOP_FIREBASE_API_KEY/,
    );
    assert.throws(
      () => resolveDesktopBuildProfile('staging', {
        LIFE_TRACKER_DESKTOP_FIREBASE_API_KEY: 'wrong-public-config',
      }),
      /does not match the reviewed staging manifest/,
    );
  });

  it('rejects ambiguous profile names', () => {
    assert.throws(() => resolveDesktopBuildProfile(undefined, {}), /exactly staging or production/);
    assert.throws(() => resolveDesktopBuildProfile('prod', {}), /exactly staging or production/);
  });

  it('emits explicit desktop markers and clears known provider secrets', () => {
    const profile = resolveDesktopBuildProfile('production', {});
    const result = toNextDesktopEnvironment(profile, COMMIT, {
      OPENAI_API_KEY: 'must-not-survive',
      TWILIO_AUTH_TOKEN: 'must-not-survive',
      RESEND_API_KEY: 'must-not-survive',
    });
    assert.equal(result.TAURI_DESKTOP, 'true');
    assert.equal(result.NEXT_PUBLIC_LIFE_TRACKER_RUNTIME, 'desktop');
    assert.equal(result.NEXT_PUBLIC_LIFE_TRACKER_ENVIRONMENT, 'production');
    assert.equal(result.NEXT_PUBLIC_BUILD_COMMIT, COMMIT);
    assert.equal(result.OPENAI_API_KEY, '');
    assert.equal(result.TWILIO_AUTH_TOKEN, '');
    assert.equal(result.RESEND_API_KEY, '');
  });

  it('rejects non-immutable source labels and malformed project IDs', () => {
    const profile = resolveDesktopBuildProfile('production', {});
    assert.throws(() => toNextDesktopEnvironment(profile, 'dirty'), /exact lowercase Git/);
    assert.throws(() => canonicalAiApiBaseUrl('../production'), /project ID is invalid/);
  });
});
