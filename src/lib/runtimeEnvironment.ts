export type LifeTrackerRuntime = 'web' | 'desktop';
export type LifeTrackerEnvironment = 'staging' | 'production';

export function resolveRuntimeTarget(value: string | undefined): LifeTrackerRuntime {
  return value === 'desktop' ? 'desktop' : 'web';
}

export function resolveDeploymentEnvironment(
  value: string | undefined,
): LifeTrackerEnvironment {
  return value === 'staging' ? 'staging' : 'production';
}

/** Public build metadata only; neither field may ever contain credentials. */
export const RUNTIME_TARGET = resolveRuntimeTarget(
  process.env.NEXT_PUBLIC_LIFE_TRACKER_RUNTIME,
);
export const DEPLOYMENT_ENVIRONMENT = resolveDeploymentEnvironment(
  process.env.NEXT_PUBLIC_LIFE_TRACKER_ENVIRONMENT,
);
