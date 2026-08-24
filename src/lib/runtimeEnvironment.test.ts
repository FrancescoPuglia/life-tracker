import { describe, expect, it } from 'vitest';
import {
  resolveDeploymentEnvironment,
  resolveRuntimeTarget,
} from './runtimeEnvironment';

describe('runtime build identity', () => {
  it('recognizes only the explicit desktop target', () => {
    expect(resolveRuntimeTarget('desktop')).toBe('desktop');
    expect(resolveRuntimeTarget('web')).toBe('web');
    expect(resolveRuntimeTarget('Desktop')).toBe('web');
    expect(resolveRuntimeTarget(undefined)).toBe('web');
  });

  it('recognizes only the explicit staging environment', () => {
    expect(resolveDeploymentEnvironment('staging')).toBe('staging');
    expect(resolveDeploymentEnvironment('production')).toBe('production');
    expect(resolveDeploymentEnvironment('preview')).toBe('production');
    expect(resolveDeploymentEnvironment(undefined)).toBe('production');
  });
});
