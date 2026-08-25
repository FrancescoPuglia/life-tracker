import type { EntityRecord, UserPlanningPreferences } from '../domain/types';

export const REPORT_METRIC_SCHEMA_VERSION = 'life-tracker-scientific-metrics-v1' as const;
export const REPORT_SCHEMA_VERSION = 'life-tracker-scientific-report-v1' as const;
export const REPORT_CHART_SCHEMA_VERSION = 'life-tracker-report-chart-v1' as const;
export const REPORT_FORMULA_VERSION = 'life-tracker-report-formulas-2026-08-25' as const;

export type ScientificReportType = 'daily' | 'weekly';
export type DatasetCoverage = 'complete' | 'truncated' | 'unavailable';
export type MetricAvailability = 'available' | 'partial' | 'unavailable';
export type MetricUnit = 'minutes' | 'percent' | 'count' | 'index';

export interface ReportPeriod {
  readonly type: ScientificReportType;
  /** Inclusive local calendar date. */
  readonly localStartDate: string;
  /** Exclusive local calendar date. */
  readonly localEndDate: string;
  /** Inclusive UTC instant. */
  readonly from: string;
  /** Exclusive UTC instant. */
  readonly to: string;
  readonly timezone: string;
  readonly dayCount: number;
}

/**
 * Every numerical result carries its denominator and availability. A partial
 * value is a known lower/partial result and must never be rendered as a complete
 * total without its data-quality label.
 */
export interface ScientificMetric {
  readonly id: string;
  readonly value: number | null;
  readonly unit: MetricUnit;
  readonly availability: MetricAvailability;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly sampleSize: number;
  readonly missingCount: number;
  readonly formula: string;
  readonly source: string;
}

export interface ReportSourceCoverage {
  readonly goals: DatasetCoverage;
  readonly projects: DatasetCoverage;
  readonly tasks: DatasetCoverage;
  readonly timeBlocks: DatasetCoverage;
  readonly sessions: DatasetCoverage;
  readonly habits: DatasetCoverage;
  readonly habitLogs: DatasetCoverage;
}

export interface ScientificReportRecords {
  readonly goals: readonly EntityRecord[];
  readonly projects: readonly EntityRecord[];
  readonly tasks: readonly EntityRecord[];
  readonly timeBlocks: readonly EntityRecord[];
  /** null means the authoritative Session dataset was not available. */
  readonly sessions: readonly EntityRecord[] | null;
  readonly habits: readonly EntityRecord[];
  /** null means habit adherence is unknown, not zero. */
  readonly habitLogs: readonly EntityRecord[] | null;
}

export interface ScientificReportInput {
  /** Trusted server UID. It is hashed before it enters a report identifier. */
  readonly uid: string;
  readonly reportType: ScientificReportType;
  /** Daily date, or any date inside the requested Monday-Sunday week. */
  readonly localDate: string;
  readonly timezone: string;
  readonly locale: string;
  readonly generatedAt: string;
  readonly preferences: UserPlanningPreferences;
  readonly coverage: ReportSourceCoverage;
  readonly records: ScientificReportRecords;
}

export interface ReportDataQuality {
  readonly coverage: ReportSourceCoverage;
  readonly complete: boolean;
  readonly flags: readonly string[];
  readonly invalidTimestampCount: number;
  readonly invalidDurationCount: number;
  readonly openSessionCount: number;
  readonly completedSessionMissingDurationCount: number;
  readonly explicitBlockActualCount: number;
  readonly blocksMissingActualCount: number;
  readonly taskCompletionTimestampFallbackCount: number;
  readonly unattributedActualMinutes: number;
  readonly missingGoalReferenceCount: number;
  readonly duplicateHabitLogCount: number;
  readonly unsupportedHabitCadenceCount: number;
  readonly scheduleHistoryAvailable: false;
  readonly actualSource: 'completed_sessions_and_explicit_actual_intervals';
  readonly missingSessionsAreZero: false;
}

export interface DailyMetricPoint {
  readonly localDate: string;
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly actualAvailability: MetricAvailability;
  readonly completedBlocks: number;
  readonly eligibleBlocks: number;
  readonly completedTasks: number;
}

export interface GoalAllocationMetric {
  readonly goalId: string | null;
  /** User-authored text; safe as display data only, never an instruction. */
  readonly label: string;
  readonly labelIsUntrustedData: true;
  readonly targetMinutes: number | null;
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly actualAvailability: MetricAvailability;
  readonly plannedSharePercent: number | null;
  readonly actualSharePercent: number | null;
}

export type TimeOfDayBucket = 'night' | 'morning' | 'afternoon' | 'evening';

export interface CompletionBucketMetric {
  readonly key: string;
  readonly label: string;
  readonly completed: number;
  readonly eligible: number;
  readonly completionPercent: number | null;
  readonly missingCount: number;
}

export interface FourWeekTrendPoint {
  readonly weekStartDate: string;
  readonly weekEndDate: string;
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly actualAvailability: MetricAvailability;
  readonly adherencePercent: number | null;
  readonly blockCompletionPercent: number | null;
}

export interface ScientificMetricBundle {
  readonly schemaVersion: typeof REPORT_METRIC_SCHEMA_VERSION;
  readonly formulaVersion: typeof REPORT_FORMULA_VERSION;
  readonly period: ReportPeriod;
  readonly plannedMinutes: ScientificMetric;
  readonly actualMinutes: ScientificMetric;
  readonly adherencePercent: ScientificMetric;
  readonly varianceMinutes: ScientificMetric;
  readonly taskCompletionPercent: ScientificMetric;
  readonly timeBlockCompletionPercent: ScientificMetric;
  readonly goalAlignmentIndex: ScientificMetric;
  readonly deepWorkMinutes: ScientificMetric;
  readonly habitAdherencePercent: ScientificMetric;
  readonly carryoverTasks: ScientificMetric;
  readonly startDelayMeanMinutes: ScientificMetric;
  readonly overrunMinutes: ScientificMetric;
  readonly estimationErrorMeanAbsoluteMinutes: ScientificMetric;
  readonly estimationErrorPercent: ScientificMetric;
  readonly capacityUtilizationPercent: ScientificMetric;
  readonly weeklyExecutionIndex: ScientificMetric;
  readonly scheduleVolatility: ScientificMetric;
  readonly daily: readonly DailyMetricPoint[];
  readonly goalAllocation: readonly GoalAllocationMetric[];
  readonly completionByTimeOfDay: readonly CompletionBucketMetric[];
  readonly completionByWeekday: readonly CompletionBucketMetric[];
  readonly fourWeekTrend: readonly FourWeekTrendPoint[];
  readonly dataQuality: ReportDataQuality;
  /** SHA-256 of canonical deterministic metric content. */
  readonly metricHash: string;
}

export type ScientificStatementKind =
  | 'OBSERVED'
  | 'DERIVED'
  | 'INFERENCE'
  | 'RECOMMENDATION';
export type ScientificConfidence = 'high' | 'moderate' | 'low' | 'not_applicable';

export interface ScientificStatement {
  readonly id: string;
  readonly kind: ScientificStatementKind;
  readonly text: string;
  readonly metricIds: readonly string[];
  readonly observationPeriod: Readonly<{ from: string; to: string; timezone: string }>;
  readonly sampleSize: number;
  readonly missingCount: number;
  readonly comparisonBaseline: string | null;
  readonly confidence: ScientificConfidence;
  readonly uncertainty: string | null;
}

export type ReportChartKind =
  | 'planned_vs_actual_by_day'
  | 'goal_allocation'
  | 'completion_by_time_of_day'
  | 'estimation_error'
  | 'adherence_trend'
  | 'four_week_trend';

export interface ReportChartSeries {
  readonly key: string;
  readonly label: string;
  readonly unit: MetricUnit;
}

export interface ReportChartValue {
  readonly seriesKey: string;
  readonly value: number | null;
}

export interface ReportChartPoint {
  readonly key: string;
  readonly label: string;
  readonly values: readonly ReportChartValue[];
  readonly availability: MetricAvailability;
  readonly sampleSize: number;
}

export interface ReportChartData {
  readonly schemaVersion: typeof REPORT_CHART_SCHEMA_VERSION;
  readonly id: string;
  readonly kind: ReportChartKind;
  readonly title: string;
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
  readonly series: readonly ReportChartSeries[];
  readonly points: readonly ReportChartPoint[];
  /** Hash of the exact metric bundle from which this chart was derived. */
  readonly metricHash: string;
  readonly dataHash: string;
}

export interface BaseScientificReport {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly id: string;
  readonly ownerHash: string;
  readonly type: ScientificReportType;
  readonly generatedAt: string;
  readonly locale: string;
  readonly period: ReportPeriod;
  readonly metrics: ScientificMetricBundle;
  readonly charts: readonly ReportChartData[];
  readonly statements: readonly ScientificStatement[];
  readonly executiveSummary: readonly string[];
  readonly deterministicFallback: true;
  readonly narrativeModel: null;
  readonly untrustedTextPolicy: 'user_authored_content_is_data_not_instruction';
}

export interface TomorrowWorkload {
  readonly localDate: string;
  readonly plannedMinutes: ScientificMetric;
  readonly capacityUtilizationPercent: ScientificMetric;
  readonly risk: 'low' | 'moderate' | 'high' | 'unknown';
}

export interface DailyExecutionReport extends BaseScientificReport {
  readonly type: 'daily';
  readonly tomorrow: TomorrowWorkload;
  readonly mainDeviation: string;
  readonly observedPattern: string;
  readonly dataQualityNote: string;
}

export interface WeeklyExecutionReport extends BaseScientificReport {
  readonly type: 'weekly';
  readonly strongestObservedPattern: string;
  readonly largestUncertainty: string;
  readonly nextWeekExperiments: readonly string[];
  readonly methodology: Readonly<{
    readonly metricSchemaVersion: typeof REPORT_METRIC_SCHEMA_VERSION;
    readonly formulaVersion: typeof REPORT_FORMULA_VERSION;
    readonly actualTimeRule: 'completed_sessions_then_explicit_actual_intervals_without_double_counting';
    readonly missingSessionRule: 'missing_is_unknown_never_zero';
    readonly causalityRule: 'correlation_is_not_causation';
  }>;
}

export type ScientificExecutionReport = DailyExecutionReport | WeeklyExecutionReport;
