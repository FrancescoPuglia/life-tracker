import { createHash } from 'node:crypto';
import { render } from '@react-email/render';
import {
  createElement,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  REPORT_ARCHIVE_SCHEMA_VERSION,
  scientificReportArtifactHash,
  validateScientificExecutionReport,
  validateStoredReportDeliveryState,
  type StoredScientificReportArchive,
} from './archive';
import {
  REPORT_EMAIL_SCHEMA_VERSION,
  REPORT_EMAIL_TEMPLATE_VERSION,
  reportEmailContentHash,
  validateComposedScientificReportEmail,
  type ComposedScientificReportEmail,
  type ReportEmailAttachment,
} from './email-provider';
import {
  renderReportChartSvg,
  type RenderedReportChartSvg,
} from './svg-chart-renderer';
import {
  renderReportCharts,
  verifyRenderedReportChartPng,
  type RenderedReportChart,
} from './png-chart-renderer';
import type {
  ScientificExecutionReport,
  ScientificMetric,
  WeeklyExecutionReport,
} from './types';
import {
  REPORT_FORMULA_VERSION,
  REPORT_METRIC_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
} from './types';

export const REPORT_EMAIL_RENDERER_SCHEMA_VERSION = 'report-email-renderer-v1' as const;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const REACT_EMAIL_XHTML_DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
const CHART_FILENAMES = Object.freeze({
  planned_vs_actual_by_day: 'chart-planned-vs-actual-by-day.png',
  goal_allocation: 'chart-goal-allocation.png',
  completion_by_time_of_day: 'chart-completion-by-time-of-day.png',
  estimation_error: 'chart-estimation-error.png',
  adherence_trend: 'chart-adherence-trend.png',
  four_week_trend: 'chart-four-week-trend.png',
} as const);

export type ScientificReportChartRenderer = (
  charts: ScientificExecutionReport['charts'],
) => Promise<readonly RenderedReportChart[]>;

export interface ComposeScientificReportEmailInput {
  /** Verified Firebase UID. It is used only to revalidate archive ownership. */
  readonly uid: string;
  readonly archive: StoredScientificReportArchive;
}

export class ReportEmailCompositionError extends Error {
  readonly code = 'REPORT_EMAIL_COMPOSITION_FAILED';

  constructor(message = 'Scientific report email composition failed.') {
    super(message);
    this.name = 'ReportEmailCompositionError';
  }
}

const PAGE_STYLE: CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: '#f1f5f9',
  color: '#0f172a',
  fontFamily: 'Arial, Helvetica, sans-serif',
};
const CONTAINER_STYLE: CSSProperties = {
  width: '100%',
  maxWidth: '760px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderCollapse: 'collapse',
};
const CONTENT_STYLE: CSSProperties = { padding: '28px 32px' };
const HEADING_STYLE: CSSProperties = {
  margin: '0 0 12px',
  color: '#0f172a',
  fontSize: '20px',
  lineHeight: '28px',
};
const TEXT_STYLE: CSSProperties = {
  margin: '0 0 10px',
  color: '#334155',
  fontSize: '14px',
  lineHeight: '21px',
};
const MUTED_STYLE: CSSProperties = {
  margin: '0 0 8px',
  color: '#64748b',
  fontSize: '12px',
  lineHeight: '18px',
};
const RESPONSIVE_EMAIL_CSS = `
@media only screen and (max-width: 600px) {
  .email-outer { padding: 0 !important; }
  .email-shell { width: 100% !important; }
  .email-header { padding: 22px 18px !important; }
  .email-content { padding: 20px 16px !important; }
  .email-footer { padding: 18px 16px !important; }
  .metric-cell { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 6px 0 !important; }
  .report-chart { width: 100% !important; height: auto !important; }
}`;

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(): never {
  throw new ReportEmailCompositionError();
}

function normalizedInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch).toISOString();
}

function validateArchiveAuthority(
  uid: string,
  archive: StoredScientificReportArchive,
): ScientificExecutionReport {
  if (!UID_PATTERN.test(uid) || !archive || typeof archive !== 'object') fail();
  const report = validateScientificExecutionReport(uid, archive.report, 'INTERNAL');
  const generatedAt = normalizedInstant(archive.generatedAt);
  const createdAt = normalizedInstant(archive.createdAt);
  const updatedAt = normalizedInstant(archive.updatedAt);
  validateStoredReportDeliveryState(archive.delivery, 'INTERNAL');
  if (
    archive.schemaVersion !== REPORT_ARCHIVE_SCHEMA_VERSION
    || archive.id !== report.id
    || archive.userId !== uid
    || archive.ownerHash !== report.ownerHash
    || archive.type !== report.type
    || archive.localStartDate !== report.period.localStartDate
    || archive.localEndDate !== report.period.localEndDate
    || archive.timezone !== report.period.timezone
    || archive.reportSchemaVersion !== REPORT_SCHEMA_VERSION
    || archive.metricSchemaVersion !== REPORT_METRIC_SCHEMA_VERSION
    || archive.formulaVersion !== REPORT_FORMULA_VERSION
    || archive.metricHash !== report.metrics.metricHash
    || !HASH_PATTERN.test(archive.artifactHash)
    || archive.artifactHash !== scientificReportArtifactHash(report)
    || generatedAt !== report.generatedAt
    || archive.createdAt !== createdAt
    || archive.updatedAt !== updatedAt
    || !createdAt
    || !updatedAt
    || Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    fail();
  }
  return report;
}

function sameSvg(
  actual: RenderedReportChartSvg,
  expected: RenderedReportChartSvg,
): boolean {
  return actual.schemaVersion === expected.schemaVersion
    && actual.chartId === expected.chartId
    && actual.kind === expected.kind
    && actual.metricHash === expected.metricHash
    && actual.sourceDataHash === expected.sourceDataHash
    && actual.svgHash === expected.svgHash
    && actual.mimeType === expected.mimeType
    && actual.width === expected.width
    && actual.height === expected.height
    && actual.renderedPointCount === expected.renderedPointCount
    && actual.omittedPointCount === expected.omittedPointCount
    && actual.svg === expected.svg;
}

function validateAndCopyCharts(
  report: ScientificExecutionReport,
  charts: readonly RenderedReportChart[],
): readonly ReportEmailAttachment[] {
  if (!Array.isArray(charts) || charts.length !== report.charts.length) fail();
  const chartIds = new Set<string>();
  const attachments = report.charts.map((source, index): ReportEmailAttachment => {
    const rendered = charts[index];
    if (!rendered || typeof rendered !== 'object') fail();
    const expectedSvg = renderReportChartSvg(source);
    if (!sameSvg(rendered.svg, expectedSvg)) fail();
    verifyRenderedReportChartPng(rendered.png);
    if (
      rendered.png.chartId !== source.id
      || rendered.png.kind !== source.kind
      || rendered.png.metricHash !== report.metrics.metricHash
      || rendered.png.sourceDataHash !== source.dataHash
      || rendered.png.sourceSvgHash !== expectedSvg.svgHash
      || chartIds.has(source.id)
    ) {
      fail();
    }
    chartIds.add(source.id);
    const content = Buffer.from(rendered.png.png);
    return Object.freeze({
      chartId: source.id,
      filename: CHART_FILENAMES[source.kind],
      contentId: rendered.png.contentId,
      contentType: 'image/png',
      byteLength: content.length,
      contentHash: sha256(content),
      content,
    });
  });
  return Object.freeze(attachments);
}

function number(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function metricValue(metric: ScientificMetric): string {
  if (metric.value === null) return 'Unavailable';
  const suffix = metric.unit === 'minutes'
    ? ' min'
    : metric.unit === 'percent'
      ? '%'
      : metric.unit === 'index'
        ? ' / 100'
        : '';
  return `${number(metric.value)}${suffix}`;
}

function metricEvidence(metric: ScientificMetric): string {
  return `${metric.availability.toUpperCase()} · N=${metric.sampleSize} · missing=${metric.missingCount}`;
}

function metricCard(key: string, label: string, metric: ScientificMetric): ReactNode {
  return createElement('td', {
    key,
    className: 'metric-cell',
    style: {
      width: '50%',
      padding: '10px',
      verticalAlign: 'top',
    },
  }, createElement('div', {
    style: {
      padding: '14px',
      backgroundColor: '#f8fafc',
      border: '1px solid #e2e8f0',
      borderRadius: '8px',
    },
  },
  createElement('p', { style: { ...MUTED_STYLE, marginBottom: '4px', fontWeight: 700 } }, label),
  createElement('p', {
    style: { margin: '0 0 4px', color: '#0f172a', fontSize: '22px', lineHeight: '28px', fontWeight: 700 },
  }, metricValue(metric)),
  createElement('p', { style: { ...MUTED_STYLE, margin: 0 } }, metricEvidence(metric))));
}

function metricGrid(items: readonly [string, string, ScientificMetric][]): ReactNode {
  const rows: ReactNode[] = [];
  for (let index = 0; index < items.length; index += 2) {
    const left = items[index];
    const right = items[index + 1];
    if (!left) continue;
    rows.push(createElement('tr', { key: `metric-row-${index}` },
      metricCard(left[0], left[1], left[2]),
      right
        ? metricCard(right[0], right[1], right[2])
        : createElement('td', { key: `empty-${index}`, style: { width: '50%' } }),
    ));
  }
  return createElement('table', {
    role: 'presentation',
    width: '100%',
    cellPadding: 0,
    cellSpacing: 0,
    style: { borderCollapse: 'collapse', margin: '0 -10px' },
  }, createElement('tbody', null, rows));
}

function section(key: string, title: string, content: ReactNode): ReactNode {
  return createElement('section', {
    key,
    style: { padding: '22px 0', borderBottom: '1px solid #e2e8f0' },
  }, createElement('h2', { style: HEADING_STYLE }, title), content);
}

function paragraphs(values: readonly string[]): ReactNode {
  return createElement('ul', { style: { margin: '0', paddingLeft: '22px' } },
    values.map((value, index) => createElement('li', {
      key: `paragraph-${index}`,
      style: { ...TEXT_STYLE, paddingLeft: '2px' },
    }, value)),
  );
}

function metricParagraph(label: string, metric: ScientificMetric): ReactNode {
  return createElement('div', { style: { marginBottom: '12px' } },
    createElement('p', { style: { ...TEXT_STYLE, marginBottom: '2px' } },
      createElement('strong', null, `${label}: `), metricValue(metric)),
    createElement('p', { style: MUTED_STYLE },
      `${metricEvidence(metric)} · Formula: ${metric.formula}`),
  );
}

function chartFigures(
  report: ScientificExecutionReport,
  attachments: readonly ReportEmailAttachment[],
  kinds?: ReadonlySet<string>,
): ReactNode {
  const nodes = report.charts
    .map((chart, index) => ({ chart, attachment: attachments[index] }))
    .filter(({ chart }) => !kinds || kinds.has(chart.kind))
    .map(({ chart, attachment }) => {
      if (!attachment) fail();
      return createElement('div', {
        key: chart.id,
        style: { margin: '18px 0 28px' },
      },
      createElement('img', {
        className: 'report-chart',
        src: `cid:${attachment.contentId}`,
        width: 696,
        alt: `${chart.title}. Deterministic ${chart.yAxisLabel} by ${chart.xAxisLabel}; missing values are not zero.`,
        style: { display: 'block', width: '100%', maxWidth: '696px', height: 'auto', border: '1px solid #e2e8f0' },
      }),
      createElement('p', { style: { ...MUTED_STYLE, marginTop: '6px' } },
        `Deterministic source ${chart.dataHash.slice(0, 12)} · metric ${chart.metricHash.slice(0, 12)}`));
    });
  return createElement('div', null, nodes);
}

function dataQuality(report: ScientificExecutionReport): ReactNode {
  const flags = report.metrics.dataQuality.flags;
  const visible = flags.slice(0, 20);
  return createElement('div', null,
    createElement('p', { style: TEXT_STYLE },
      `Dataset status: ${report.metrics.dataQuality.complete ? 'complete' : 'incomplete or partial'}. Missing Sessions are unknown and never treated as zero execution.`),
    visible.length > 0
      ? paragraphs([
        ...visible,
        ...(flags.length > visible.length ? [`${flags.length - visible.length} additional flags remain in the archived report.`] : []),
      ])
      : createElement('p', { style: TEXT_STYLE }, 'No data-quality flags were recorded.'),
  );
}

function scientificStatements(report: ScientificExecutionReport): ReactNode {
  return createElement('div', null, report.statements.map((statement) => createElement('div', {
    key: statement.id,
    style: { marginBottom: '14px', paddingLeft: '12px', borderLeft: '3px solid #2563eb' },
  },
  createElement('p', { style: { ...TEXT_STYLE, marginBottom: '3px' } },
    createElement('strong', null, `${statement.kind}: `), statement.text),
  createElement('p', { style: MUTED_STYLE },
    `Confidence ${statement.confidence} · N=${statement.sampleSize} · missing=${statement.missingCount}${statement.comparisonBaseline ? ` · baseline ${statement.comparisonBaseline}` : ''}`),
  statement.uncertainty
    ? createElement('p', { style: MUTED_STYLE }, `Uncertainty: ${statement.uncertainty}`)
    : null,
  )));
}

function dailySections(
  report: Extract<ScientificExecutionReport, { type: 'daily' }>,
  attachments: readonly ReportEmailAttachment[],
): readonly ReactNode[] {
  const point = report.metrics.daily[0];
  return [
    section('summary', 'Executive Summary', paragraphs(report.executiveSummary)),
    section('overview', 'Execution Overview', metricGrid([
      ['planned', 'Planned time', report.metrics.plannedMinutes],
      ['actual', 'Actual Session time', report.metrics.actualMinutes],
      ['adherence', 'Adherence', report.metrics.adherencePercent],
      ['blocks', 'TimeBlock completion', report.metrics.timeBlockCompletionPercent],
      ['tasks', 'Task completion', report.metrics.taskCompletionPercent],
      ['alignment', 'Goal Alignment Index', report.metrics.goalAlignmentIndex],
    ])),
    section('completion', 'Completed and Missed Blocks', createElement('div', null,
      point
        ? createElement('p', { style: TEXT_STYLE },
          `${point.completedBlocks} completed TimeBlocks from ${point.eligibleBlocks} eligible blocks; ${point.completedTasks} Tasks completed.`)
        : createElement('p', { style: TEXT_STYLE }, 'No complete daily block sample is available.'),
      metricParagraph('TimeBlock completion', report.metrics.timeBlockCompletionPercent),
    )),
    section('charts', 'Deterministic Charts', chartFigures(report, attachments)),
    section('deviation', 'Main Deviation', createElement('p', { style: TEXT_STYLE }, report.mainDeviation)),
    section('pattern', 'Observed Pattern', createElement('p', { style: TEXT_STYLE }, report.observedPattern)),
    section('tomorrow', 'Tomorrow Workload and Risk', createElement('div', null,
      createElement('p', { style: TEXT_STYLE }, `Local date ${report.tomorrow.localDate} · risk ${report.tomorrow.risk.toUpperCase()}`),
      metricParagraph('Planned time', report.tomorrow.plannedMinutes),
      metricParagraph('Capacity utilization', report.tomorrow.capacityUtilizationPercent),
    )),
    section('statements', 'Scientific Statements', scientificStatements(report)),
    section('quality', 'Data-quality Note', createElement('div', null,
      createElement('p', { style: TEXT_STYLE }, report.dataQualityNote),
      dataQuality(report),
    )),
  ];
}

function weeklySections(
  report: WeeklyExecutionReport,
  attachments: readonly ReportEmailAttachment[],
): readonly ReactNode[] {
  return [
    section('1-summary', '1. Executive Summary', paragraphs(report.executiveSummary)),
    section('2-index', '2. Weekly Execution Index', metricParagraph(
      'Weekly Execution Index', report.metrics.weeklyExecutionIndex,
    )),
    section('3-planned-actual', '3. Planned vs Actual', createElement('div', null,
      metricGrid([
        ['planned', 'Planned time', report.metrics.plannedMinutes],
        ['actual', 'Actual Session time', report.metrics.actualMinutes],
        ['adherence', 'Adherence', report.metrics.adherencePercent],
        ['variance', 'Planned-vs-actual variance', report.metrics.varianceMinutes],
      ]),
      chartFigures(report, attachments, new Set(['planned_vs_actual_by_day'])),
    )),
    section('4-goals', '4. Goal Allocation', chartFigures(
      report, attachments, new Set(['goal_allocation']),
    )),
    section('5-time', '5. Completion by Time of Day', createElement('div', null,
      metricParagraph('TimeBlock completion', report.metrics.timeBlockCompletionPercent),
      chartFigures(report, attachments, new Set(['completion_by_time_of_day'])),
    )),
    section('6-capacity', '6. Capacity', metricParagraph(
      'Capacity utilization', report.metrics.capacityUtilizationPercent,
    )),
    section('7-deep', '7. Deep Work', metricParagraph(
      'Deep-work time', report.metrics.deepWorkMinutes,
    )),
    section('8-habit', '8. Habit Adherence', metricParagraph(
      'Habit adherence', report.metrics.habitAdherencePercent,
    )),
    section('9-estimation', '9. Estimation Error', createElement('div', null,
      metricParagraph('Mean absolute error', report.metrics.estimationErrorMeanAbsoluteMinutes),
      metricParagraph('Relative estimation error', report.metrics.estimationErrorPercent),
      metricParagraph('Measured overrun', report.metrics.overrunMinutes),
    )),
    section('10-carryover', '10. Carryover', metricParagraph(
      'Carryover Tasks', report.metrics.carryoverTasks,
    )),
    section('11-volatility', '11. Schedule Volatility', metricParagraph(
      'Schedule volatility', report.metrics.scheduleVolatility,
    )),
    section('12-trends', '12. Rolling 4-week Context', chartFigures(
      report, attachments, new Set(['four_week_trend', 'adherence_trend']),
    )),
    section('13-pattern', '13. Strongest Observed Pattern', createElement(
      'p', { style: TEXT_STYLE }, report.strongestObservedPattern,
    )),
    section('14-uncertainty', '14. Largest Uncertainty', createElement(
      'p', { style: TEXT_STYLE }, report.largestUncertainty,
    )),
    section('15-experiments', '15. Next-week Experiments and Recommendations', paragraphs(
      report.nextWeekExperiments,
    )),
    section('statements', 'Scientific Statements', scientificStatements(report)),
    section('16-methodology', '16. Methodology and Data Quality', createElement('div', null,
      createElement('p', { style: TEXT_STYLE },
        `Metrics ${report.methodology.metricSchemaVersion}; formulas ${report.methodology.formulaVersion}.`),
      createElement('p', { style: TEXT_STYLE },
        'Actual time uses completed Sessions first, then explicit actual intervals without double counting. Missing Sessions are unknown, never zero. Associations are not causal claims.'),
      dataQuality(report),
    )),
  ];
}

function emailTree(
  report: ScientificExecutionReport,
  attachments: readonly ReportEmailAttachment[],
  subject: string,
): ReactNode {
  const preview = report.type === 'daily'
    ? `Daily execution evidence for ${report.period.localStartDate}`
    : `Weekly scientific execution evidence from ${report.period.localStartDate}`;
  const sections = report.type === 'daily'
    ? dailySections(report, attachments)
    : weeklySections(report, attachments);
  const language = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(report.locale)
    ? report.locale.slice(0, 2).toLowerCase()
    : 'en';
  return createElement('html', { lang: language },
    createElement('head', null,
      createElement('meta', { charSet: 'utf-8' }),
      createElement('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      createElement('title', null, subject),
      createElement('style', null, RESPONSIVE_EMAIL_CSS),
    ),
    createElement('body', { style: PAGE_STYLE },
      createElement('div', {
        style: {
          display: 'none',
          maxHeight: 0,
          overflow: 'hidden',
          opacity: 0,
          color: 'transparent',
        },
      }, preview),
      createElement('table', {
        className: 'email-outer',
        role: 'presentation',
        width: '100%',
        cellPadding: 0,
        cellSpacing: 0,
        style: { width: '100%', backgroundColor: '#f1f5f9', padding: '24px 8px' },
      }, createElement('tbody', null, createElement('tr', null, createElement('td', null,
        createElement('table', {
          className: 'email-shell',
          role: 'presentation',
          width: '100%',
          cellPadding: 0,
          cellSpacing: 0,
          style: CONTAINER_STYLE,
        }, createElement('tbody', null,
          createElement('tr', null, createElement('td', {
            className: 'email-header',
            style: { padding: '28px 32px', backgroundColor: '#0f172a' },
          },
          createElement('p', {
            style: { margin: '0 0 6px', color: '#93c5fd', fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em' },
          }, 'LIFE TRACKER'),
          createElement('h1', {
            style: { margin: 0, color: '#ffffff', fontSize: '26px', lineHeight: '34px' },
          }, report.type === 'daily' ? 'Daily Execution Report' : 'Weekly Scientific Report'),
          createElement('p', {
            style: { margin: '8px 0 0', color: '#cbd5e1', fontSize: '13px', lineHeight: '19px' },
          }, `${report.period.localStartDate} → ${report.period.localEndDate} (end exclusive) · ${report.period.timezone}`),
          )),
          createElement('tr', null, createElement('td', {
            className: 'email-content',
            style: CONTENT_STYLE,
          }, sections)),
          createElement('tr', null, createElement('td', {
            className: 'email-footer',
            style: { padding: '20px 32px', backgroundColor: '#f8fafc' },
          },
          createElement('p', { style: MUTED_STYLE },
            `Generated ${report.generatedAt} · metric ${report.metrics.metricHash.slice(0, 16)} · deterministic fallback active.`),
          createElement('p', { style: { ...MUTED_STYLE, margin: 0 } },
            'Numerical truth is deterministic. Any future AI interpretation cannot modify these values.'),
          )),
        )),
      )))),
    ),
  );
}

function metricLine(label: string, metric: ScientificMetric): string {
  return `${label}: ${metricValue(metric)} [${metricEvidence(metric)}]\nFormula: ${metric.formula}`;
}

function chartsText(report: ScientificExecutionReport): string[] {
  return report.charts.map((chart) =>
    `- ${chart.title}: ${chart.yAxisLabel} by ${chart.xAxisLabel}; missing values are not zero; source ${chart.dataHash.slice(0, 12)}.`,
  );
}

function statementsText(report: ScientificExecutionReport): string[] {
  return report.statements.flatMap((statement) => [
    `${statement.kind}: ${statement.text}`,
    `Confidence: ${statement.confidence}; N=${statement.sampleSize}; missing=${statement.missingCount}; baseline=${statement.comparisonBaseline ?? 'none'}.`,
    ...(statement.uncertainty ? [`Uncertainty: ${statement.uncertainty}`] : []),
  ]);
}

function commonTextHeader(report: ScientificExecutionReport): string[] {
  return [
    'LIFE TRACKER',
    report.type === 'daily' ? 'DAILY EXECUTION REPORT' : 'WEEKLY SCIENTIFIC REPORT',
    `Period: ${report.period.localStartDate} to ${report.period.localEndDate} (end exclusive)`,
    `Timezone: ${report.period.timezone}`,
    `Generated: ${report.generatedAt}`,
    '',
  ];
}

function dailyText(report: Extract<ScientificExecutionReport, { type: 'daily' }>): string[] {
  const point = report.metrics.daily[0];
  return [
    'EXECUTIVE SUMMARY',
    ...report.executiveSummary.map((line) => `- ${line}`),
    '',
    'EXECUTION OVERVIEW',
    metricLine('Planned time', report.metrics.plannedMinutes),
    metricLine('Actual Session time', report.metrics.actualMinutes),
    metricLine('Adherence', report.metrics.adherencePercent),
    metricLine('TimeBlock completion', report.metrics.timeBlockCompletionPercent),
    metricLine('Task completion', report.metrics.taskCompletionPercent),
    metricLine('Goal Alignment Index', report.metrics.goalAlignmentIndex),
    '',
    'COMPLETED AND MISSED BLOCKS',
    point
      ? `${point.completedBlocks} completed TimeBlocks from ${point.eligibleBlocks} eligible blocks; ${point.completedTasks} Tasks completed.`
      : 'No complete daily block sample is available.',
    '',
    'DETERMINISTIC CHARTS (attached inline in HTML)',
    ...chartsText(report),
    '',
    'MAIN DEVIATION',
    report.mainDeviation,
    '',
    'OBSERVED PATTERN',
    report.observedPattern,
    '',
    'TOMORROW WORKLOAD AND RISK',
    `Local date: ${report.tomorrow.localDate}; risk: ${report.tomorrow.risk}.`,
    metricLine('Planned time', report.tomorrow.plannedMinutes),
    metricLine('Capacity utilization', report.tomorrow.capacityUtilizationPercent),
    '',
    'SCIENTIFIC STATEMENTS',
    ...statementsText(report),
    '',
    'DATA-QUALITY NOTE',
    report.dataQualityNote,
  ];
}

function weeklyText(report: WeeklyExecutionReport): string[] {
  return [
    '1. EXECUTIVE SUMMARY',
    ...report.executiveSummary.map((line) => `- ${line}`),
    '',
    '2. WEEKLY EXECUTION INDEX',
    metricLine('Weekly Execution Index', report.metrics.weeklyExecutionIndex),
    '',
    '3. PLANNED VS ACTUAL',
    metricLine('Planned time', report.metrics.plannedMinutes),
    metricLine('Actual Session time', report.metrics.actualMinutes),
    metricLine('Adherence', report.metrics.adherencePercent),
    metricLine('Variance', report.metrics.varianceMinutes),
    '',
    '4. GOAL ALLOCATION',
    'See the deterministic Goal allocation chart attached inline in HTML.',
    '',
    '5. COMPLETION BY TIME OF DAY',
    metricLine('TimeBlock completion', report.metrics.timeBlockCompletionPercent),
    '',
    '6. CAPACITY',
    metricLine('Capacity utilization', report.metrics.capacityUtilizationPercent),
    '',
    '7. DEEP WORK',
    metricLine('Deep-work time', report.metrics.deepWorkMinutes),
    '',
    '8. HABIT ADHERENCE',
    metricLine('Habit adherence', report.metrics.habitAdherencePercent),
    '',
    '9. ESTIMATION ERROR',
    metricLine('Mean absolute error', report.metrics.estimationErrorMeanAbsoluteMinutes),
    metricLine('Relative estimation error', report.metrics.estimationErrorPercent),
    metricLine('Measured overrun', report.metrics.overrunMinutes),
    '',
    '10. CARRYOVER',
    metricLine('Carryover Tasks', report.metrics.carryoverTasks),
    '',
    '11. SCHEDULE VOLATILITY',
    metricLine('Schedule volatility', report.metrics.scheduleVolatility),
    '',
    '12. ROLLING 4-WEEK CONTEXT',
    ...chartsText(report),
    '',
    '13. STRONGEST OBSERVED PATTERN',
    report.strongestObservedPattern,
    '',
    '14. LARGEST UNCERTAINTY',
    report.largestUncertainty,
    '',
    '15. NEXT-WEEK EXPERIMENTS AND RECOMMENDATIONS',
    ...report.nextWeekExperiments.map((line) => `- ${line}`),
    '',
    'SCIENTIFIC STATEMENTS',
    ...statementsText(report),
    '',
    '16. METHODOLOGY AND DATA QUALITY',
    `Metrics: ${report.methodology.metricSchemaVersion}; formulas: ${report.methodology.formulaVersion}.`,
    'Actual time uses completed Sessions first, then explicit actual intervals without double counting.',
    'Missing Sessions are unknown, never zero. Associations are not causal claims.',
  ];
}

function textFallback(report: ScientificExecutionReport): string {
  const flags = report.metrics.dataQuality.flags;
  return [
    ...commonTextHeader(report),
    ...(report.type === 'daily' ? dailyText(report) : weeklyText(report)),
    '',
    `DATASET STATUS: ${report.metrics.dataQuality.complete ? 'complete' : 'incomplete or partial'}`,
    ...(flags.length > 0 ? flags.map((flag) => `- ${flag}`) : ['- No data-quality flags recorded.']),
    '',
    `Metric hash: ${report.metrics.metricHash}`,
    'Numerical truth is deterministic. AI cannot modify the values in this report.',
  ].join('\n');
}

function subjectFor(report: ScientificExecutionReport): string {
  return report.type === 'daily'
    ? `Life Tracker Daily Execution Report — ${report.period.localStartDate}`
    : `Life Tracker Weekly Scientific Report — week of ${report.period.localStartDate}`;
}

function normalizeReactEmailHtml(value: string): string {
  if (!value.startsWith(REACT_EMAIL_XHTML_DOCTYPE)) fail();
  return `<!doctype html>${value.slice(REACT_EMAIL_XHTML_DOCTYPE.length)}`;
}

export async function composeScientificReportEmail(
  input: ComposeScientificReportEmailInput,
  chartRenderer: ScientificReportChartRenderer = renderReportCharts,
): Promise<ComposedScientificReportEmail> {
  try {
    const report = validateArchiveAuthority(input.uid, input.archive);
    const renderedCharts = await chartRenderer(report.charts);
    const attachments = validateAndCopyCharts(report, renderedCharts);
    const subject = subjectFor(report);
    const html = normalizeReactEmailHtml(await render(emailTree(report, attachments, subject)));
    const text = textFallback(report);
    const content = Object.freeze({
      schemaVersion: REPORT_EMAIL_SCHEMA_VERSION,
      templateVersion: REPORT_EMAIL_TEMPLATE_VERSION,
      reportId: report.id,
      reportType: report.type,
      reportArtifactHash: input.archive.artifactHash,
      metricHash: report.metrics.metricHash,
      subject,
      html,
      text,
      attachments,
      idempotencyKey: `life-tracker-report/${report.id}`,
    });
    const email: ComposedScientificReportEmail = Object.freeze({
      ...content,
      contentHash: reportEmailContentHash(content),
    });
    validateComposedScientificReportEmail(email);
    return email;
  } catch (error) {
    if (error instanceof ReportEmailCompositionError) throw error;
    throw new ReportEmailCompositionError();
  }
}
