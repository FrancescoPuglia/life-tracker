import { describe, expect, it } from 'vitest';
import { readStagingEnvironment } from '../../../e2e/staging/safety';

const SAFE_ENV = {
  LIFE_TRACKER_STAGING_CONFIRM: 'LIFE_TRACKER_STAGING_ONLY',
  LIFE_TRACKER_HISTORIC_OPENAI_KEY_REVOKED: 'HUMAN_CONFIRMED',
  LIFE_TRACKER_STAGING_FIREBASE_PROJECT_ID: 'life-tracker-staging',
  LIFE_TRACKER_STAGING_FIREBASE_API_KEY: 'AIzaSyAtbRwIXLgVAJhfGjHuOwPkXZWsqa9tH4U',
  LIFE_TRACKER_STAGING_FIREBASE_AUTH_DOMAIN: 'life-tracker-staging.firebaseapp.com',
  LIFE_TRACKER_STAGING_FIREBASE_APP_ID: '1:675076431391:web:d82e711352456218d4ff2a',
  LIFE_TRACKER_STAGING_FIREBASE_MESSAGING_SENDER_ID: '675076431391',
  LIFE_TRACKER_STAGING_FIREBASE_STORAGE_BUCKET: 'life-tracker-staging.firebasestorage.app',
  LIFE_TRACKER_STAGING_AI_API_BASE_URL:
    'https://europe-west1-life-tracker-staging.cloudfunctions.net/lifeTrackerAiApi',
} as const;

describe('live staging safety gate', () => {
  it('accepts one explicit, project-bound non-production configuration', () => {
    expect(readStagingEnvironment(SAFE_ENV)).toMatchObject({
      projectId: 'life-tracker-staging',
      appOrigin: 'http://127.0.0.1:3300',
      aiApiBaseUrl:
        'https://europe-west1-life-tracker-staging.cloudfunctions.net/lifeTrackerAiApi',
    });
  });

  it.each(['life-tracker-12000', 'life-tracker-test', 'some-other-staging'])(
    'refuses every non-exact project including %s',
    (projectId) => {
      expect(() => readStagingEnvironment({
        ...SAFE_ENV,
        LIFE_TRACKER_STAGING_FIREBASE_PROJECT_ID: projectId,
        LIFE_TRACKER_STAGING_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
        LIFE_TRACKER_STAGING_AI_API_BASE_URL:
          `https://europe-west1-${projectId}.cloudfunctions.net/lifeTrackerAiApi`,
      })).toThrow(/not the reviewed dedicated staging project/);
    },
  );

  it.each([
    ['LIFE_TRACKER_STAGING_FIREBASE_API_KEY', 'AIzaSyWrongStagingManifestValue0000000000'],
    ['LIFE_TRACKER_STAGING_FIREBASE_AUTH_DOMAIN', 'other.firebaseapp.com'],
    ['LIFE_TRACKER_STAGING_FIREBASE_APP_ID', '1:999:web:wrong'],
    ['LIFE_TRACKER_STAGING_FIREBASE_MESSAGING_SENDER_ID', '999'],
    ['LIFE_TRACKER_STAGING_FIREBASE_STORAGE_BUCKET', 'other.firebasestorage.app'],
  ] as const)(
    'refuses a mismatched public Firebase field %s before mutation',
    (field, value) => {
      expect(() => readStagingEnvironment({ ...SAFE_ENV, [field]: value })).toThrow(
        /does not match the reviewed staging manifest/,
      );
    },
  );

  it('refuses missing acknowledgement and a backend from another project', () => {
    expect(() => readStagingEnvironment({
      ...SAFE_ENV,
      LIFE_TRACKER_STAGING_CONFIRM: undefined,
    })).toThrow(/Refusing live staging execution/);
    expect(() => readStagingEnvironment({
      ...SAFE_ENV,
      LIFE_TRACKER_STAGING_AI_API_BASE_URL:
        'https://europe-west1-some-other-staging.cloudfunctions.net/lifeTrackerAiApi',
    })).toThrow(/must be exactly/);
  });

  it('refuses live OpenAI execution without explicit human key-revocation confirmation', () => {
    expect(() => readStagingEnvironment({
      ...SAFE_ENV,
      LIFE_TRACKER_HISTORIC_OPENAI_KEY_REVOKED: undefined,
    })).toThrow(/historic key revocation is human-confirmed/);
  });
});
