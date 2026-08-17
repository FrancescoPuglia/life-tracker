import { firebaseConfig } from '@/config/firebaseConfig';
import { resolveLifeTrackerAiBackendBaseUrl } from '@life-tracker/ai-contract';

export const UNCONFIGURED_AI_BACKEND = 'not-configured';

/**
 * The token destination is derived from the same public Firebase project that
 * owns Auth. Loopback is available only in an explicit development/emulator
 * build and must still use that project's canonical Functions emulator path.
 */
export function getConfiguredAIBackendBaseUrl(): string | null {
  return resolveLifeTrackerAiBackendBaseUrl(
    process.env.NEXT_PUBLIC_AI_API_BASE_URL,
    firebaseConfig.projectId,
    process.env.NODE_ENV === 'development'
      && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true',
  );
}

/** Public, non-secret build attestation. The endpoint already ships in JS. */
export const AI_BACKEND_BUILD_ID = getConfiguredAIBackendBaseUrl()
  ?? UNCONFIGURED_AI_BACKEND;
