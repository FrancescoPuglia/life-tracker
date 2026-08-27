import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/integrity';
import type {
  MetricAvailability,
  ReportChartData,
  ReportChartKind,
  ReportChartPoint,
  ReportChartSeries,
  ScientificMetricBundle,
} from './types';
import { REPORT_CHART_SCHEMA_VERSION } from './types';

function chartId(kind: ReportChartKind, metricHash: string): string {
  return `chart_${createHash('sha256').update(`${kind}\0${metricHash}`).digest('hex').slice(0, 48)}`;
}

function finalizeChart(args: Readonly<{
  kind: ReportChartKind;
  title: string;
  xAxisLabel: string;
  yAxisLabel: string;
  series: readonly ReportChartSeries[];
  points: readonly ReportChartPoint[];
  metricHash: string;
}>): ReportChartData {
  const content = {
    schemaVersion: REPORT_CHART_SCHEMA_VERSION,
    id: chartId(args.kind, args.metricHash),
    kind: args.kind,
    title: args.title,
    xAxisLabel: args.xAxisLabel,
    yAxisLabel: args.yAxisLabel,
    series: args.series,
    points: args.points,
    metricHash: args.metricHash,
  } as const;
  return {
    ...content,
    dataHash: createHash('sha256').update(canonicalJson(content)).digest('hex'),
  };
}

function availabilityForGoalPoint(
  planned: number,
  target: number | null,
  actual: number | null,
  actualAvailability: MetricAvailability,
): MetricAvailability {
  if (planned <= 0 && target === null && actual === null) return 'unavailable';
  return actualAvailability;
}

export function buildReportChartData(metrics: ScientificMetricBundle): readonly ReportChartData[] {
  const daily = finalizeChart({
    kind: 'planned_vs_actual_by_day',
    title: 'Planned vs actual by day',
    xAxisLabel: 'Local date',
    yAxisLabel: 'Minutes',
    metricHash: metrics.metricHash,
    series: [
      { key: 'planned_minutes', label: 'Planned', unit: 'minutes' },
      { key: 'actual_minutes', label: 'Actual', unit: 'minutes' },
    ],
    points: metrics.daily.map((point) => ({
      key: point.localDate,
      label: point.localDate,
      availability: point.actualAvailability,
      sampleSize: point.eligibleBlocks,
      values: [
        { seriesKey: 'planned_minutes', value: point.plannedMinutes },
        { seriesKey: 'actual_minutes', value: point.actualMinutes },
      ],
    })),
  });

  const goals = finalizeChart({
    kind: 'goal_allocation',
    title: 'Goal allocation',
    xAxisLabel: 'Goal',
    yAxisLabel: 'Minutes',
    metricHash: metrics.metricHash,
    series: [
      { key: 'target_minutes', label: 'Target', unit: 'minutes' },
      { key: 'planned_minutes', label: 'Planned', unit: 'minutes' },
      { key: 'actual_minutes', label: 'Actual', unit: 'minutes' },
    ],
    points: metrics.goalAllocation.map((point) => ({
      key: point.goalId ?? '__unassigned__',
      label: point.label,
      availability: availabilityForGoalPoint(
        point.plannedMinutes,
        point.targetMinutes,
        point.actualMinutes,
        point.actualAvailability,
      ),
      sampleSize: (point.actualMinutes ?? 0) > 0 || point.plannedMinutes > 0 ? 1 : 0,
      values: [
        { seriesKey: 'target_minutes', value: point.targetMinutes },
        { seriesKey: 'planned_minutes', value: point.plannedMinutes },
        { seriesKey: 'actual_minutes', value: point.actualMinutes },
      ],
    })),
  });

  const completion = finalizeChart({
    kind: 'completion_by_time_of_day',
    title: 'TimeBlock completion by time of day',
    xAxisLabel: 'Scheduled start window',
    yAxisLabel: 'Completion (%)',
    metricHash: metrics.metricHash,
    series: [{ key: 'completion_percent', label: 'Completion', unit: 'percent' }],
    points: metrics.completionByTimeOfDay.map((point) => ({
      key: point.key,
      label: point.label,
      availability: point.completionPercent === null ? 'unavailable' : metrics.timeBlockCompletionPercent.availability,
      sampleSize: point.eligible,
      values: [{ seriesKey: 'completion_percent', value: point.completionPercent }],
    })),
  });

  const fourWeek = finalizeChart({
    kind: 'four_week_trend',
    title: 'Four-week planned vs actual trend',
    xAxisLabel: 'Week starting',
    yAxisLabel: 'Minutes',
    metricHash: metrics.metricHash,
    series: [
      { key: 'planned_minutes', label: 'Planned', unit: 'minutes' },
      { key: 'actual_minutes', label: 'Actual', unit: 'minutes' },
    ],
    points: metrics.fourWeekTrend.map((point) => ({
      key: point.weekStartDate,
      label: point.weekStartDate,
      availability: point.actualAvailability,
      sampleSize: 7,
      values: [
        { seriesKey: 'planned_minutes', value: point.plannedMinutes },
        { seriesKey: 'actual_minutes', value: point.actualMinutes },
      ],
    })),
  });

  const adherence = finalizeChart({
    kind: 'adherence_trend',
    title: 'Four-week adherence and block completion',
    xAxisLabel: 'Week starting',
    yAxisLabel: 'Percent',
    metricHash: metrics.metricHash,
    series: [
      { key: 'adherence_percent', label: 'Adherence', unit: 'percent' },
      { key: 'block_completion_percent', label: 'Block completion', unit: 'percent' },
    ],
    points: metrics.fourWeekTrend.map((point) => ({
      key: point.weekStartDate,
      label: point.weekStartDate,
      availability: point.actualAvailability,
      sampleSize: 7,
      values: [
        { seriesKey: 'adherence_percent', value: point.adherencePercent },
        { seriesKey: 'block_completion_percent', value: point.blockCompletionPercent },
      ],
    })),
  });

  const estimation = finalizeChart({
    kind: 'estimation_error',
    title: 'Estimation error and measured overrun',
    xAxisLabel: 'Weekly estimation evidence',
    yAxisLabel: 'Minutes',
    metricHash: metrics.metricHash,
    series: [
      { key: 'mean_absolute_error_minutes', label: 'Mean absolute error', unit: 'minutes' },
      { key: 'overrun_minutes', label: 'Measured overrun', unit: 'minutes' },
    ],
    points: [{
      key: 'weekly_estimation',
      label: 'Week',
      availability: metrics.estimationErrorMeanAbsoluteMinutes.availability,
      sampleSize: metrics.estimationErrorMeanAbsoluteMinutes.sampleSize,
      values: [
        {
          seriesKey: 'mean_absolute_error_minutes',
          value: metrics.estimationErrorMeanAbsoluteMinutes.value,
        },
        { seriesKey: 'overrun_minutes', value: metrics.overrunMinutes.value },
      ],
    }],
  });

  return [daily, goals, completion, estimation, adherence, fourWeek];
}
