import { createHash } from 'node:crypto';

const FUNCTION_NAME = 'lifeTrackerAiApi';
const FUNCTION_REGION = 'europe-west1';

export const DESKTOP_PROFILES = Object.freeze({
  staging: Object.freeze({
    productName: 'Life Tracker Beta',
    projectId: 'life-tracker-staging',
    apiKeySha256: '11293b9f69ba0d24f8e36a0e4cda50b9a0b103378116b569eca9a651a284b04b',
    authDomain: 'life-tracker-staging.firebaseapp.com',
    storageBucket: 'life-tracker-staging.firebasestorage.app',
    messagingSenderId: '675076431391',
    appId: '1:675076431391:web:d82e711352456218d4ff2a',
  }),
  production: Object.freeze({
    productName: 'Life Tracker',
    projectId: 'life-tracker-12000',
    apiKey: 'AIzaSyD92k6Hg84gh6YC5xmUSsF7yWpZUWuYp24',
    apiKeySha256: '00887e4ba692083552f3c9b60dd3a0bc9d03a4c363ba49e1b73b09a28165689a',
    authDomain: 'life-tracker-12000.firebaseapp.com',
    storageBucket: 'life-tracker-12000.firebasestorage.app',
    messagingSenderId: '970402762590',
    appId: '1:970402762590:web:e5bc0162003ac224c449cf',
    measurementId: 'G-9JKPQL8CG4',
  }),
});

export function resolveDesktopBuildProfile(profileName, environment = process.env) {
  if (profileName !== 'staging' && profileName !== 'production') {
    throw new Error('Desktop build profile must be exactly staging or production.');
  }

  const profile = DESKTOP_PROFILES[profileName];
  const apiKey = profile.apiKey
    ?? required(environment, 'LIFE_TRACKER_DESKTOP_FIREBASE_API_KEY');
  if (sha256(apiKey) !== profile.apiKeySha256) {
    throw new Error(`Firebase Web configuration does not match the reviewed ${profileName} manifest.`);
  }

  const aiApiBaseUrl = canonicalAiApiBaseUrl(profile.projectId);
  return Object.freeze({
    ...profile,
    profileName,
    apiKey,
    aiApiBaseUrl,
  });
}

export function toNextDesktopEnvironment(profile, sourceCommit, baseEnvironment = process.env) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('Desktop export requires an exact lowercase Git source commit.');
  }

  return {
    ...baseEnvironment,
    GITHUB_PAGES: 'false',
    TAURI_DESKTOP: 'true',
    NEXT_PUBLIC_BUILD_COMMIT: sourceCommit,
    NEXT_PUBLIC_LIFE_TRACKER_RUNTIME: 'desktop',
    NEXT_PUBLIC_LIFE_TRACKER_ENVIRONMENT: profile.profileName,
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'false',
    NEXT_PUBLIC_FIREBASE_API_KEY: profile.apiKey,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: profile.authDomain,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: profile.projectId,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: profile.storageBucket,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: profile.messagingSenderId,
    NEXT_PUBLIC_FIREBASE_APP_ID: profile.appId,
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: profile.measurementId ?? '',
    NEXT_PUBLIC_AI_API_BASE_URL: profile.aiApiBaseUrl,
    OPENAI_API_KEY: '',
    NEXT_PUBLIC_OPENAI_API_KEY: '',
    NEXT_PUBLIC_OPENAI_MODEL: '',
    TWILIO_AUTH_TOKEN: '',
    RESEND_API_KEY: '',
  };
}

export function canonicalAiApiBaseUrl(projectId) {
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
    throw new Error('Desktop Firebase project ID is invalid.');
  }
  return `https://${FUNCTION_REGION}-${projectId}.cloudfunctions.net/${FUNCTION_NAME}`;
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value || /\r|\n/.test(value)) {
    throw new Error(`Missing or invalid desktop build setting: ${name}.`);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
