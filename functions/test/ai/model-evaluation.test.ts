import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_EVALUATION_SCHEMA_VERSION,
  buildEvaluatedRoutingConfiguration,
  estimateModelObservationCostMicroUsd,
  lifeTrackerModelEvaluationCandidates,
  lifeTrackerModelEvaluationCases,
  selectCheapestAdequateModelRoute,
  type LifeTrackerModelEvaluationCandidate,
  type LifeTrackerModelEvaluationCase,
  type LifeTrackerModelEvaluationObservation,
  type SelectedLifeTrackerModelRoute,
} from '../../src/ai/model-evaluation';
import {
  LIFE_TRACKER_AI_WORKLOADS,
  parseLifeTrackerAiRoutingPolicy,
  type LifeTrackerAiWorkload,
} from '../../src/ai/model-routing';

const EVALUATED_AT = '2026-08-25T15:00:00.000Z';

describe('representative economical model evaluation contract', () => {
  it('contains a small synthetic safety/quality corpus with no personal or credential data', () => {
    const cases = lifeTrackerModelEvaluationCases();
    const serialized = JSON.stringify(cases);

    expect(cases).toHaveLength(7);
    expect(new Set(cases.map((item) => item.workload))).toEqual(new Set(LIFE_TRACKER_AI_WORKLOADS));
    expect(serialized).not.toMatch(/Francesco|Puglia|@gmail|OPENAI_API_KEY|Bearer|sk-proj/i);
    expect(cases.every((item) => item.fixtureId.startsWith('synthetic-'))).toBe(true);
  });

  it('computes direct token cost without double-counting reasoning tokens', () => {
    expect(estimateModelObservationCostMicroUsd({
      configuredModel: 'gpt-5.6-luna',
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 100,
    })).toBe(284);
  });

  it('selects Luna when every deterministic criterion passes', () => {
    const workload = 'ask';
    const candidate = lifeTrackerModelEvaluationCandidates(workload)[0]!;
    const result = selectCheapestAdequateModelRoute(
      workload,
      observationsFor(candidate, true),
      EVALUATED_AT,
    );

    expect(result.outcome).toBe('selected');
    if (result.outcome !== 'selected') throw new Error('Expected a selection.');
    expect(result.selection.candidate.model).toBe('gpt-5.6-luna');
    expect(result.selection.receiptId).toMatch(/^model_eval_[0-9a-f]{64}$/);
    expect(result.selection.caseCount).toBe(2);
  });

  it('selects Terra only after complete failing Luna evidence, never by implicit escalation', () => {
    const workload = 'ask';
    const [luna, terra] = lifeTrackerModelEvaluationCandidates(workload);
    if (!luna || !terra) throw new Error('Candidate ladder is incomplete.');
    const result = selectCheapestAdequateModelRoute(
      workload,
      [...observationsFor(luna, false), ...observationsFor(terra, true)],
      EVALUATED_AT,
    );

    expect(result.outcome).toBe('selected');
    if (result.outcome !== 'selected') throw new Error('Expected a selection.');
    expect(result.selection.candidate.model).toBe('gpt-5.6-terra');

    expect(() => selectCheapestAdequateModelRoute(
      workload,
      observationsFor(terra, true),
      EVALUATED_AT,
    )).toThrow('Cheaper model evaluation evidence is incomplete');
  });

  it('returns deterministic fallback authority when every evaluated profile is inadequate', () => {
    const workload = 'coach';
    const evidence = lifeTrackerModelEvaluationCandidates(workload)
      .flatMap((candidate) => observationsFor(candidate, false));
    const result = selectCheapestAdequateModelRoute(workload, evidence, EVALUATED_AT);

    expect(result).toEqual({
      outcome: 'no_adequate_candidate',
      workload,
      evaluatedCandidateIds: lifeTrackerModelEvaluationCandidates(workload)
        .map((candidate) => candidate.id),
    });
  });

  it('rejects forged provider models, missing criteria, and token-limit violations', () => {
    const candidate = lifeTrackerModelEvaluationCandidates('weekly_strategic_review')[0]!;
    const valid = observationsFor(candidate, true)[0]!;
    expect(() => selectCheapestAdequateModelRoute('weekly_strategic_review', [{
      ...valid,
      providerModel: 'gpt-5.6-sol',
    }], EVALUATED_AT)).toThrow('identity');
    const criteria = { ...valid.criteria };
    delete criteria[Object.keys(criteria)[0]!];
    expect(() => selectCheapestAdequateModelRoute('weekly_strategic_review', [{
      ...valid,
      criteria,
    }], EVALUATED_AT)).toThrow('criteria');
    expect(() => selectCheapestAdequateModelRoute('weekly_strategic_review', [{
      ...valid,
      outputTokens: 901,
    }], EVALUATED_AT)).toThrow('Output tokens');
  });

  it('builds a complete round-tripped runtime config only from five selections', () => {
    const selections = LIFE_TRACKER_AI_WORKLOADS.map((workload) => selected(workload));
    const config = buildEvaluatedRoutingConfiguration(selections, EVALUATED_AT);
    const policy = parseLifeTrackerAiRoutingPolicy(config);

    expect(policy.evaluationReceiptId).toMatch(/^model_eval_[0-9a-f]{64}$/);
    expect(policy.routes.ask.model).toBe('gpt-5.6-luna');
    expect(policy.routes.weekly_strategic_review.model).toBe('gpt-5.6-luna');
    expect(() => buildEvaluatedRoutingConfiguration(selections.slice(0, 4), EVALUATED_AT))
      .toThrow('complete');
    expect(() => buildEvaluatedRoutingConfiguration(
      [...selections.slice(0, 4), selections[0]!],
      EVALUATED_AT,
    )).toThrow('complete');
    expect(() => buildEvaluatedRoutingConfiguration([
      { ...selections[0]!, evaluatedCandidateCount: 2 },
      ...selections.slice(1),
    ], EVALUATED_AT)).toThrow('selection is invalid');
    expect(() => buildEvaluatedRoutingConfiguration([
      { ...selections[0]!, priceCatalogVersion: 'stale-price-catalog' as never },
      ...selections.slice(1),
    ], EVALUATED_AT)).toThrow('selection is invalid');
  });
});

function observationsFor(
  candidate: LifeTrackerModelEvaluationCandidate,
  pass: boolean,
): LifeTrackerModelEvaluationObservation[] {
  return lifeTrackerModelEvaluationCases(candidate.workload)
    .map((evaluation) => observation(candidate, evaluation, pass));
}

function observation(
  candidate: LifeTrackerModelEvaluationCandidate,
  evaluation: LifeTrackerModelEvaluationCase,
  pass: boolean,
): LifeTrackerModelEvaluationObservation {
  const criteria = Object.fromEntries(evaluation.requiredCriteria.map((criterion, index) => [
    criterion,
    pass || index > 0,
  ]));
  return {
    schemaVersion: AI_MODEL_EVALUATION_SCHEMA_VERSION,
    caseId: evaluation.id,
    candidateId: candidate.id,
    workload: candidate.workload,
    configuredModel: candidate.model,
    providerModel: candidate.model,
    reasoningEffort: candidate.reasoningEffort,
    providerCalls: 1,
    toolCalls: candidate.workload === 'weekly_strategic_review' ? 0 : 1,
    inputTokens: 1_000,
    cachedInputTokens: 0,
    outputTokens: 100,
    reasoningTokens: 20,
    latencyMs: 1_000,
    criteria,
  };
}

function selected(workload: LifeTrackerAiWorkload): SelectedLifeTrackerModelRoute {
  const result = selectCheapestAdequateModelRoute(
    workload,
    observationsFor(lifeTrackerModelEvaluationCandidates(workload)[0]!, true),
    EVALUATED_AT,
  );
  if (result.outcome !== 'selected') throw new Error('Expected route selection.');
  return result.selection;
}
