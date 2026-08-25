import type {
  CompletionBucketMetric,
  ScientificConfidence,
  ScientificMetricBundle,
  ScientificStatement,
  ScientificStatementKind,
} from './types';

function statement(
  metrics: ScientificMetricBundle,
  args: Readonly<{
    id: string;
    kind: ScientificStatementKind;
    text: string;
    metricIds: readonly string[];
    sampleSize: number;
    missingCount: number;
    baseline: string | null;
    confidence: ScientificConfidence;
    uncertainty: string | null;
  }>,
): ScientificStatement {
  return {
    id: args.id,
    kind: args.kind,
    text: args.text,
    metricIds: args.metricIds,
    observationPeriod: {
      from: metrics.period.from,
      to: metrics.period.to,
      timezone: metrics.period.timezone,
    },
    sampleSize: args.sampleSize,
    missingCount: args.missingCount,
    comparisonBaseline: args.baseline,
    confidence: args.confidence,
    uncertainty: args.uncertainty,
  };
}

function strongestCompletionPattern(
  buckets: readonly CompletionBucketMetric[],
): Readonly<{
  best: CompletionBucketMetric;
  worst: CompletionBucketMetric;
  difference: number;
  sampleSize: number;
}> | null {
  const eligible = buckets
    .filter((item) => item.eligible >= 3 && item.completionPercent !== null)
    .sort((left, right) => (right.completionPercent ?? 0) - (left.completionPercent ?? 0));
  const best = eligible[0];
  const worst = eligible[eligible.length - 1];
  if (!best || !worst || best.key === worst.key) return null;
  const difference = (best.completionPercent ?? 0) - (worst.completionPercent ?? 0);
  const sampleSize = eligible.reduce((sum, item) => sum + item.eligible, 0);
  if (sampleSize < 8 || difference < 20) return null;
  return { best, worst, difference, sampleSize };
}

export function buildScientificStatements(
  metrics: ScientificMetricBundle,
): readonly ScientificStatement[] {
  const output: ScientificStatement[] = [];
  const actual = metrics.actualMinutes;
  const actualPrefix = actual.availability === 'partial' ? 'Known actual execution' : 'Actual execution';
  output.push(statement(metrics, {
    id: 'observed_execution_time',
    kind: 'OBSERVED',
    text: actual.value === null
      ? 'Actual execution could not be measured from the available Session and explicit-actual records.'
      : `${actualPrefix} was ${actual.value} minutes from ${actual.sampleSize} persisted execution record(s).`,
    metricIds: [actual.id],
    sampleSize: actual.sampleSize,
    missingCount: actual.missingCount,
    baseline: null,
    confidence: actual.availability === 'available' ? 'high' : actual.availability === 'partial' ? 'low' : 'not_applicable',
    uncertainty: actual.availability === 'available'
      ? null
      : 'The actual total is incomplete because one or more authoritative datasets are unavailable or truncated.',
  }));

  if (metrics.adherencePercent.value !== null) {
    output.push(statement(metrics, {
      id: 'derived_adherence',
      kind: 'DERIVED',
      text: `Planned-versus-actual adherence was ${metrics.adherencePercent.value}%.`,
      metricIds: [metrics.plannedMinutes.id, metrics.actualMinutes.id, metrics.adherencePercent.id],
      sampleSize: metrics.adherencePercent.sampleSize,
      missingCount: metrics.adherencePercent.missingCount,
      baseline: 'Actual minutes divided by planned minutes in the same half-open local period.',
      confidence: metrics.adherencePercent.availability === 'available' ? 'high' : 'low',
      uncertainty: metrics.adherencePercent.availability === 'available'
        ? null
        : 'The percentage uses a partial known actual total.',
    }));
  }

  if (metrics.weeklyExecutionIndex.value !== null) {
    output.push(statement(metrics, {
      id: 'derived_weekly_execution_index',
      kind: 'DERIVED',
      text: `The versioned Weekly Execution Index was ${metrics.weeklyExecutionIndex.value}/100.`,
      metricIds: [metrics.weeklyExecutionIndex.id],
      sampleSize: metrics.weeklyExecutionIndex.sampleSize,
      missingCount: metrics.weeklyExecutionIndex.missingCount,
      baseline: 'Versioned weighted weekly execution components, renormalized over available denominators.',
      confidence: metrics.weeklyExecutionIndex.availability === 'available' ? 'high' : 'low',
      uncertainty: metrics.weeklyExecutionIndex.availability === 'available'
        ? null
        : 'At least one included component is partial.',
    }));
  }

  const pattern = strongestCompletionPattern(metrics.completionByTimeOfDay);
  if (pattern) {
    const confidence: ScientificConfidence = pattern.sampleSize >= 20 ? 'moderate' : 'low';
    output.push(statement(metrics, {
      id: 'inference_time_of_day_reliability',
      kind: 'INFERENCE',
      text: `${pattern.best.label} scheduling was associated with ${pattern.difference.toFixed(1)} percentage points higher TimeBlock completion than ${pattern.worst.label} scheduling. This is an association, not a causal claim.`,
      metricIds: [metrics.timeBlockCompletionPercent.id],
      sampleSize: pattern.sampleSize,
      missingCount: pattern.best.missingCount + pattern.worst.missingCount,
      baseline: `${pattern.best.label} versus ${pattern.worst.label} blocks in the same observation period.`,
      confidence,
      uncertainty: 'Block type, difficulty, weekday, and selection effects are not controlled.',
    }));
    output.push(statement(metrics, {
      id: 'recommendation_time_of_day_experiment',
      kind: 'RECOMMENDATION',
      text: `For the next two weeks, move one comparable flexible block from ${pattern.worst.label.toLowerCase()} to ${pattern.best.label.toLowerCase()} and compare completion rates; keep the activity type and planned duration similar.`,
      metricIds: [metrics.timeBlockCompletionPercent.id],
      sampleSize: pattern.sampleSize,
      missingCount: pattern.best.missingCount + pattern.worst.missingCount,
      baseline: 'Two-week within-person scheduling experiment.',
      confidence,
      uncertainty: 'One experiment cannot establish a general causal effect.',
    }));
  }

  if (!metrics.dataQuality.complete) {
    output.push(statement(metrics, {
      id: 'observed_data_quality_limits',
      kind: 'OBSERVED',
      text: `Data quality is incomplete. ${metrics.dataQuality.flags.length} explicit flag(s) are attached to this report; missing Sessions are not interpreted as zero execution.`,
      metricIds: [metrics.actualMinutes.id],
      sampleSize: actual.sampleSize,
      missingCount: actual.missingCount
        + metrics.dataQuality.invalidTimestampCount
        + metrics.dataQuality.invalidDurationCount,
      baseline: null,
      confidence: 'high',
      uncertainty: metrics.dataQuality.flags.join(', '),
    }));
  }
  return output;
}
