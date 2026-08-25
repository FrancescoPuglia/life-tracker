import type {
  NormalizedAiResponse,
  ResponsesRunInput,
  ResponsesRunner,
} from './responses-adapter';
import {
  chatWorkload,
  routedExecutionProfile,
  type LifeTrackerAiExecutionProfile,
  type LifeTrackerAiRoutingPolicy,
} from './model-routing';

export type RoutedResponsesAdapterFactory = (
  profile: LifeTrackerAiExecutionProfile,
) => ResponsesRunner;

/**
 * Routes only from the authenticated HTTP schema's fixed mode enum. It never
 * examines prompt/user data and never falls back or escalates after a failure.
 */
export class WorkloadRoutedResponsesAdapter implements ResponsesRunner {
  private readonly adapters = new Map<string, ResponsesRunner>();

  constructor(
    private readonly policy: LifeTrackerAiRoutingPolicy,
    private readonly factory: RoutedResponsesAdapterFactory,
  ) {}

  run(input: ResponsesRunInput): Promise<NormalizedAiResponse> {
    const workload = chatWorkload(input.mode);
    const profile = routedExecutionProfile(this.policy, workload);
    const cacheKey = [
      profile.routingConfigId,
      profile.workload,
      profile.model,
      profile.reasoningEffort,
    ].join('\0');
    let adapter = this.adapters.get(cacheKey);
    if (!adapter) {
      adapter = this.factory(profile);
      this.adapters.set(cacheKey, adapter);
    }
    return adapter.run(input);
  }
}
