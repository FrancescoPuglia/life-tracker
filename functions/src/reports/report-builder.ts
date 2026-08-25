import { createHash } from 'node:crypto';
import { buildReportChartData } from './charts';
import { computeScientificMetricBundle } from './metrics';
import { instantEpochMilliseconds, nextDailyPeriod, resolveReportPeriod } from './period';
import { buildScientificStatements } from './statements';
import type {
  BaseScientificReport,
  DailyExecutionReport,
  ScientificExecutionReport,
  ScientificMetric,
  ScientificMetricBundle,
  ScientificReportInput,
  ScientificStatement,
  TomorrowWorkload,
  WeeklyExecutionReport,
} from './types';
import {
  REPORT_FORMULA_VERSION,
  REPORT_METRIC_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
} from './types';

const REPORT_DATASET_LIMITS = Object.freeze({
  goals: 1_000,
  projects: 2_000,
  tasks: 5_000,
  timeBlocks: 5_000,
  sessions: 5_000,
  habits: 1_000,
  habitLogs: 5_000,
});

function assertUid(uid: string): void {
  if (uid.length < 1 || uid.length > 128 || /[\u0000-\u001f\u007f]/.test(uid)) {
    throw new Error('Invalid authenticated report owner.');
  }
}

function assertInputBounds(input: ScientificReportInput): void {
  const sizes = {
    goals: input.records.goals.length,
    projects: input.records.projects.length,
    tasks: input.records.tasks.length,
    timeBlocks: input.records.timeBlocks.length,
    sessions: input.records.sessions?.length ?? 0,
    habits: input.records.habits.length,
    habitLogs: input.records.habitLogs?.length ?? 0,
  } as const;
  for (const name of Object.keys(REPORT_DATASET_LIMITS) as Array<keyof typeof REPORT_DATASET_LIMITS>) {
    if (sizes[name] > REPORT_DATASET_LIMITS[name]) {
      throw new Error(`Report dataset limit exceeded for ${name}.`);
    }
  }
}

function normalizedGeneratedAt(value: string): string {
  const epoch = instantEpochMilliseconds(value);
  if (epoch === null) throw new Error('Invalid report generation instant.');
  return new Date(epoch).toISOString();
}

function normalizeLocale(value: string): string {
  try {
    return new Intl.DateTimeFormat(value).resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

function ownerHash(uid: string): string {
  return createHash('sha256').update(`life-tracker-report-owner-v1\0${uid}`).digest('hex');
}

export function reportIdempotencyKey(
  uid: string,
  reportType: ScientificReportInput['reportType'],
  localStartDate: string,
): string {
  assertUid(uid);
  const digest = createHash('sha256')
    .update(`${REPORT_SCHEMA_VERSION}\0${uid}\0${reportType}\0${localStartDate}`)
    .digest('hex');
  return `report_${digest.slice(0, 56)}`;
}

function actualDescription(metrics: ScientificMetricBundle): string {
  const actual = metrics.actualMinutes;
  if (actual.value === null) {
    return 'Actual execution is unavailable; missing Sessions are unknown, never zero.';
  }
  const prefix = actual.availability === 'partial' ? 'Known actual execution' : 'Actual execution';
  return `${prefix}: ${actual.value} minutes.`;
}

function executiveSummary(metrics: ScientificMetricBundle): readonly string[] {
  const lines = [
    `Planned time: ${metrics.plannedMinutes.value === null ? 'unavailable' : `${metrics.plannedMinutes.value} minutes`}.`,
    actualDescription(metrics),
    metrics.adherencePercent.value === null
      ? 'Adherence is undefined because planned or actual data lacks a defensible denominator.'
      : `Planned-versus-actual adherence: ${metrics.adherencePercent.value}%.`,
    metrics.timeBlockCompletionPercent.value === null
      ? 'TimeBlock completion has no eligible denominator.'
      : `TimeBlock completion: ${metrics.timeBlockCompletionPercent.numerator}/${metrics.timeBlockCompletionPercent.denominator} (${metrics.timeBlockCompletionPercent.value}%).`,
  ];
  if (metrics.weeklyExecutionIndex.value !== null) {
    lines.push(`Weekly Execution Index: ${metrics.weeklyExecutionIndex.value}/100.`);
  }
  return lines;
}

function deviationText(metrics: ScientificMetricBundle): string {
  const value = metrics.varianceMinutes.value;
  if (value === null) return 'The planned-versus-actual deviation is unavailable.';
  if (value === 0) return 'Known actual time matched planned time exactly.';
  const direction = value > 0 ? 'above' : 'below';
  const qualifier = metrics.varianceMinutes.availability === 'partial' ? 'Known actual time was' : 'Actual time was';
  return `${qualifier} ${Math.abs(value)} minutes ${direction} plan.`;
}

function patternText(statements: readonly ScientificStatement[]): string {
  return statements.find((item) => item.kind === 'INFERENCE')?.text
    ?? 'No completion pattern met the minimum sample and effect-size thresholds.';
}

function dataQualityText(metrics: ScientificMetricBundle): string {
  const quality = metrics.dataQuality;
  if (quality.complete) {
    return 'Required datasets were complete and valid for the selected horizon. Schedule volatility remains unavailable because reschedule history is not persisted.';
  }
  return `Report values carry explicit partial/unavailable labels. Flags: ${quality.flags.join(', ') || 'unspecified data gap'}. Missing Sessions were not converted to zero execution.`;
}

function largestUncertainty(metrics: ScientificMetricBundle): string {
  if (metrics.actualMinutes.availability !== 'available') {
    return 'Actual execution is incomplete because Session and/or TimeBlock actual coverage is unavailable or truncated.';
  }
  if (metrics.dataQuality.blocksMissingActualCount > 0) {
    return `${metrics.dataQuality.blocksMissingActualCount} completed block(s) lacked a completed Session or explicit actual interval and were excluded from actual time.`;
  }
  if (metrics.dataQuality.taskCompletionTimestampFallbackCount > 0) {
    return `${metrics.dataQuality.taskCompletionTimestampFallbackCount} legacy task completion timestamp(s) used updatedAt as an explicitly flagged approximation.`;
  }
  return 'Schedule volatility cannot be estimated because Life Tracker does not yet persist a reschedule/version history.';
}

function tomorrowRisk(utilization: ScientificMetric): TomorrowWorkload['risk'] {
  if (utilization.value === null || utilization.availability === 'unavailable') return 'unknown';
  if (utilization.value >= 100) return 'high';
  if (utilization.value >= 80) return 'moderate';
  return 'low';
}

function buildTomorrow(
  input: ScientificReportInput,
  currentMetrics: ScientificMetricBundle,
): TomorrowWorkload {
  const period = nextDailyPeriod(currentMetrics.period);
  const metrics = computeScientificMetricBundle(input, period);
  return {
    localDate: period.localStartDate,
    plannedMinutes: metrics.plannedMinutes,
    capacityUtilizationPercent: metrics.capacityUtilizationPercent,
    risk: tomorrowRisk(metrics.capacityUtilizationPercent),
  };
}

function commonReport(
  input: ScientificReportInput,
  metrics: ScientificMetricBundle,
): Omit<BaseScientificReport, 'type'> {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    id: reportIdempotencyKey(input.uid, input.reportType, metrics.period.localStartDate),
    ownerHash: ownerHash(input.uid),
    generatedAt: normalizedGeneratedAt(input.generatedAt),
    locale: normalizeLocale(input.locale),
    period: metrics.period,
    metrics,
    charts: buildReportChartData(metrics),
    statements: buildScientificStatements(metrics),
    executiveSummary: executiveSummary(metrics),
    deterministicFallback: true,
    narrativeModel: null,
    untrustedTextPolicy: 'user_authored_content_is_data_not_instruction',
  };
}

export function buildScientificExecutionReport(
  input: ScientificReportInput,
): ScientificExecutionReport {
  assertUid(input.uid);
  assertInputBounds(input);
  // The persisted planning timezone is authoritative. `input.timezone` is
  // retained only so a mismatch/fallback can be surfaced as a quality flag.
  const period = resolveReportPeriod(input.reportType, input.localDate, input.preferences.timezone);
  const metrics = computeScientificMetricBundle(input, period);
  const common = commonReport(input, metrics);
  const statements = common.statements;
  if (input.reportType === 'daily') {
    const report: DailyExecutionReport = {
      ...common,
      type: 'daily',
      tomorrow: buildTomorrow(input, metrics),
      mainDeviation: deviationText(metrics),
      observedPattern: patternText(statements),
      dataQualityNote: dataQualityText(metrics),
    };
    return report;
  }

  const recommendations = statements
    .filter((item) => item.kind === 'RECOMMENDATION')
    .map((item) => item.text);
  const report: WeeklyExecutionReport = {
    ...common,
    type: 'weekly',
    strongestObservedPattern: patternText(statements),
    largestUncertainty: largestUncertainty(metrics),
    nextWeekExperiments: recommendations.length
      ? recommendations
      : [metrics.actualMinutes.availability === 'available'
          ? 'Keep one scheduling variable stable for another week to increase the sample before changing the plan.'
          : 'Restore complete Session capture for one week before interpreting productivity trends.'],
    methodology: {
      metricSchemaVersion: REPORT_METRIC_SCHEMA_VERSION,
      formulaVersion: REPORT_FORMULA_VERSION,
      actualTimeRule: 'completed_sessions_then_explicit_actual_intervals_without_double_counting',
      missingSessionRule: 'missing_is_unknown_never_zero',
      causalityRule: 'correlation_is_not_causation',
    },
  };
  return report;
}
