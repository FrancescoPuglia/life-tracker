const STAGING_ACKNOWLEDGEMENT = 'LIFE_TRACKER_STAGING_ONLY';
const FORBIDDEN_PROJECT_IDS = new Set(['life-tracker-12000', 'life-tracker-test']);
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

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
  if (!PROJECT_ID_PATTERN.test(projectId) || FORBIDDEN_PROJECT_IDS.has(projectId)) {
    throw new Error(`Refusing Firebase project '${projectId}': it is not an eligible dedicated staging project.`);
  }

  const aiApiBaseUrl = validateApiBaseUrl(
    required(environment, 'LIFE_TRACKER_STAGING_AI_API_BASE_URL'),
    projectId,
  );
  const firebaseAuthDomain = required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_AUTH_DOMAIN');
  if (!isSafeAuthDomain(firebaseAuthDomain, projectId)) {
    throw new Error('The staging Firebase auth domain does not belong to the selected staging project.');
  }

  return {
    projectId,
    firebaseApiKey: required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_API_KEY'),
    firebaseAuthDomain,
    firebaseAppId: required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_APP_ID'),
    firebaseMessagingSenderId: required(environment, 'LIFE_TRACKER_STAGING_FIREBASE_MESSAGING_SENDER_ID'),
    firebaseStorageBucket: environment.LIFE_TRACKER_STAGING_FIREBASE_STORAGE_BUCKET?.trim()
      || `${projectId}.firebasestorage.app`,
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

function isSafeAuthDomain(value: string, projectId: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === `${projectId}.firebaseapp.com`
    || normalized === `${projectId}.web.app`;
}
