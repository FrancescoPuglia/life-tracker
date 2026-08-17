export const LOCAL_BUILD_ID = 'local-development';

export function resolveBuildId(value: string | undefined): string {
  return value && /^[a-f0-9]{40}$/.test(value) ? value : LOCAL_BUILD_ID;
}

/** Public build provenance only; this value must never contain a secret. */
export const BUILD_ID = resolveBuildId(process.env.NEXT_PUBLIC_BUILD_COMMIT);
