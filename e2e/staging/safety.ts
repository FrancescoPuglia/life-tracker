import { createHash } from 'node:crypto';

const STAGING_ACKNOWLEDGEMENT = 'LIFE_TRACKER_STAGING_ONLY';
const EXPECTED_STAGING_CONFIG = Object.freeze({
  projectId: 'life-tracker-staging',
  firebaseApiKeySha256: '11293b9f69ba0d24f8e36a0e4cda50b9a0b103378116b569eca9a651a284b04b',
  firebaseAuthDomain: 'life-tracker-staging.firebaseapp.com',
  firebaseAppId: '1:675076431391:web:d82e711352456218d4ff2a',
  firebaseMessagingSenderId: '675076431391',
  firebaseStorageBucket: 'life-tracker-staging.firebasestorage.app',
});

export interface StagingEnvironment {
  readonly projectId: string;
  readonly firebaseApiKey: string;
  readonly firebaseAuthDomain: string;
  readonly firebaseAppId: string;
  readonly firebaseMessagingSenderId: string;
  readonly firebaseStorageBucket: string;
  readonly aiApiBaseUrl: string;
  readonly appOrigin: string;
}

/**
 * Fail closed before Playwright, Next.js, Auth, Firestore, or Functions start.
 * The verified production-looking project and the emulator project can never
 * be selected by the live staging command.
 */
export function readStagingEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StagingEnvironment {
  if (environment.LIFE_TRACKER_STAGING_CONFIRM !== STAGING_ACKNOWLEDGEMENT) {
    throw new Error(
      `Refusing live staging execution: set LIFE_TRACKER_STAGING_CONFIRM=${STAGING_ACKNOWLEDGEMENT}.`,
    );
  }
  if (environment.LIFE_TRACKER_HISTORIC_OPENAI_KEY_REVOKED !== 'HUMAN_CONFIRMED') {
    throw new Error('Refusing live OpenAI staging execution until historic key revocation is human-confirmed.');
  }

  const projectId = required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_PROJECT_ID');
  if (projectId !== EXPECTED_STAGING_CONFIG.projectId) {
    throw new Error('Refusing live staging execution: Firebase project is not the reviewed dedicated staging project.');
  }

  const firebaseApiKey = required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_API_KEY');
  const aiApiBaseUrl = validateApiBaseUrl(
    required(environment, 'LIFE_TRACKER_STAGING_AI_API_BASE_URL'),
    projectId,
  );
  const firebaseAuthDomain = required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_AUTH_DOMAIN');
  const firebaseAppId = required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_APP_ID');
  const firebaseMessagingSenderId = required(
    environment,
    'LIFE_TRACKER_STAGING_FIREBASE_MESSAGING_SENDER_ID',
  );
  const firebaseStorageBucket = required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_STORAGE_BUCKET');
  if (
    createHash('sha256').update(firebaseApiKey).digest('hex')
      !== EXPECTED_STAGING_CONFIG.firebaseApiKeySha256
    || firebaseAuthDomain !== EXPECTED_STAGING_CONFIG.firebaseAuthDomain
    || firebaseAppId !== EXPECTED_STAGING_CONFIG.firebaseAppId
    || firebaseMessagingSenderId !== EXPECTED_STAGING_CONFIG.firebaseMessagingSenderId
    || firebaseStorageBucket !== EXPECTED_STAGING_CONFIG.firebaseStorageBucket
  ) {
    throw new Error('Refusing live staging execution: Firebase Web configuration does not match the reviewed staging manifest.');
  }

  return {
    projectId,
    firebaseApiKey,
    firebaseAuthDomain,
    firebaseAppId,
    firebaseMessagingSenderId,
    firebaseStorageBucket,
    aiApiBaseUrl,
    appOrigin: 'http://127.0.0.1:3300',
  };
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required staging setting: ${name}.`);
  if (/\r|\n/.test(value)) throw new Error(`Invalid newline in staging setting: ${name}.`);
  return value;
}

function validateApiBaseUrl(value: string, projectId: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The staging AI API base URL is invalid.');
  }
  const expectedHost = `europe-west1-${projectId}.cloudfunctions.net`;
  if (
    url.protocol !== 'https:'
    || url.hostname !== expectedHost
    || url.port
    || url.pathname.replace(/\/$/, '') !== '/lifeTrackerAiApi'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      `The staging AI API must be exactly the europe-west1 lifeTrackerAiApi function for '${projectId}'.`,
    );
  }
  return url.toString().replace(/\/$/, '');
}
