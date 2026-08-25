import { createHash } from 'node:crypto';
import { canonicalJson } from '../domain/integrity';
import { DomainError } from '../domain/errors';
import type {
  MetricUnit,
  ReportChartData,
  ReportChartPoint,
  ReportChartSeries,
} from './types';
import { REPORT_CHART_SCHEMA_VERSION } from './types';

export const REPORT_CHART_SVG_SCHEMA_VERSION = 'report-chart-svg-v1' as const;
export const REPORT_CHART_WIDTH = 800;
export const REPORT_CHART_HEIGHT = 460;
export const REPORT_CHART_MAX_RENDERED_POINTS = 12;
export const REPORT_CHART_MAX_SOURCE_POINTS = 1_000;
export const REPORT_CHART_MAX_SVG_BYTES = 200_000;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CHART_ID_PATTERN = /^chart_[0-9a-f]{48}$/;
const SERIES_KEY_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,63}$/;
const CHART_KINDS = new Set([
  'planned_vs_actual_by_day',
  'goal_allocation',
  'completion_by_time_of_day',
  'estimation_error',
  'adherence_trend',
  'four_week_trend',
]);
const UNITS = new Set<MetricUnit>(['minutes', 'percent', 'count', 'index']);
const AVAILABILITY = new Set(['available', 'partial', 'unavailable']);
const COLORS = [
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#c2410c',
  '#be185d',
  '#475569',
] as const;
const FONT_FAMILY = 'DejaVu Sans, Arial, Helvetica, sans-serif';

export interface RenderedReportChartSvg {
  readonly schemaVersion: typeof REPORT_CHART_SVG_SCHEMA_VERSION;
  readonly chartId: string;
  readonly kind: ReportChartData['kind'];
  readonly metricHash: string;
  readonly sourceDataHash: string;
  readonly svgHash: string;
  readonly mimeType: 'image/svg+xml';
  readonly width: typeof REPORT_CHART_WIDTH;
  readonly height: typeof REPORT_CHART_HEIGHT;
  readonly renderedPointCount: number;
  readonly omittedPointCount: number;
  readonly svg: string;
}

interface SelectedPoints {
  readonly points: readonly ReportChartPoint[];
  readonly omitted: number;
}

interface PlotGeometry {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

const PLOT: PlotGeometry = Object.freeze({
  left: 72,
  right: 776,
  top: 100,
  bottom: 365,
  width: 704,
  height: 265,
});

function fail(message: string): never {
  throw new DomainError('INVALID_ARGUMENT', message);
}

export function isReportChartId(value: unknown): value is string {
  return typeof value === 'string' && CHART_ID_PATTERN.test(value);
}

export function isSupportedReportChartKind(
  value: unknown,
): value is ReportChartData['kind'] {
  return typeof value === 'string' && CHART_KINDS.has(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function withoutDataHash(chart: ReportChartData): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(chart as unknown as Record<string, unknown>)
      .filter(([key]) => key !== 'dataHash'),
  );
}

function cleanText(value: string, maximum: number, fallback: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const points = Array.from(normalized || fallback);
  if (points.length <= maximum) return points.join('');
  return `${points.slice(0, Math.max(1, maximum - 1)).join('')}…`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function safeText(value: string, maximum: number, fallback: string): string {
  return escapeXml(cleanText(value, maximum, fallback));
}

function validateShortText(value: unknown, label: string, maximum = 240): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    fail(`${label} is invalid.`);
  }
}

function validateSeries(series: readonly ReportChartSeries[]): MetricUnit {
  if (series.length < 1 || series.length > COLORS.length) {
    fail('Report chart series count is invalid.');
  }
  const keys = new Set<string>();
  const units = new Set<MetricUnit>();
  for (const item of series) {
    if (!SERIES_KEY_PATTERN.test(item.key) || keys.has(item.key)) {
      fail('Report chart series identity is invalid.');
    }
    validateShortText(item.label, 'Report chart series label', 120);
    if (!UNITS.has(item.unit)) fail('Report chart series unit is invalid.');
    keys.add(item.key);
    units.add(item.unit);
  }
  if (units.size !== 1) fail('Report chart cannot mix units on one axis.');
  const unit = series[0]?.unit;
  if (!unit) fail('Report chart unit is missing.');
  return unit;
}

function validatePoints(
  points: readonly ReportChartPoint[],
  series: readonly ReportChartSeries[],
  unit: MetricUnit,
): void {
  if (points.length > REPORT_CHART_MAX_SOURCE_POINTS) {
    throw new DomainError('LIMIT_EXCEEDED', 'Report chart exceeds its safe point bound.');
  }
  const pointKeys = new Set<string>();
  const seriesKeys = new Set(series.map(({ key }) => key));
  for (const point of points) {
    if (
      typeof point.key !== 'string'
      || point.key.length < 1
      || point.key.length > 160
      || /[\u0000-\u001f\u007f]/.test(point.key)
      || pointKeys.has(point.key)
    ) {
      fail('Report chart point identity is invalid.');
    }
    pointKeys.add(point.key);
    validateShortText(point.label, 'Report chart point label');
    if (!AVAILABILITY.has(point.availability)) fail('Report chart point availability is invalid.');
    if (!Number.isInteger(point.sampleSize) || point.sampleSize < 0 || point.sampleSize > 1_000_000) {
      fail('Report chart point sample size is invalid.');
    }
    if (!Array.isArray(point.values) || point.values.length !== series.length) {
      fail('Report chart point series are incomplete.');
    }
    const valueKeys = new Set<string>();
    for (const [index, value] of point.values.entries()) {
      if (
        !seriesKeys.has(value.seriesKey)
        || valueKeys.has(value.seriesKey)
        || value.seriesKey !== series[index]?.key
      ) {
        fail('Report chart point series identity is invalid.');
      }
      valueKeys.add(value.seriesKey);
      if (
        value.value !== null
        && (!Number.isFinite(value.value) || value.value < 0 || (unit === 'percent' && value.value > 100))
      ) {
        fail('Report chart point value is invalid.');
      }
    }
  }
}

/** Revalidates the hash-bound chart contract immediately before rendering. */
export function validateRenderableReportChart(chart: ReportChartData): MetricUnit {
  if (
    !chart
    || typeof chart !== 'object'
    || chart.schemaVersion !== REPORT_CHART_SCHEMA_VERSION
    || !isReportChartId(chart.id)
    || !isSupportedReportChartKind(chart.kind)
    || !HASH_PATTERN.test(chart.metricHash)
    || !HASH_PATTERN.test(chart.dataHash)
  ) {
    fail('Report chart identity or schema is invalid.');
  }
  validateShortText(chart.title, 'Report chart title');
  validateShortText(chart.xAxisLabel, 'Report chart x-axis label', 120);
  validateShortText(chart.yAxisLabel, 'Report chart y-axis label', 120);
  if (!Array.isArray(chart.series) || !Array.isArray(chart.points)) {
    fail('Report chart data is invalid.');
  }
  const unit = validateSeries(chart.series);
  validatePoints(chart.points, chart.series, unit);
  const calculated = createHash('sha256')
    .update(canonicalJson(withoutDataHash(chart)))
    .digest('hex');
  if (calculated !== chart.dataHash) fail('Report chart data hash is invalid.');
  return unit;
}

function selectPoints(chart: ReportChartData): SelectedPoints {
  if (chart.points.length <= REPORT_CHART_MAX_RENDERED_POINTS) {
    return { points: chart.points, omitted: 0 };
  }
  const points = chart.kind === 'goal_allocation'
    ? [...chart.points].sort((left, right) => {
      const maximum = (point: ReportChartPoint): number => Math.max(
        0,
        ...point.values.map(({ value }) => value ?? 0),
      );
      return maximum(right) - maximum(left) || left.key.localeCompare(right.key, 'en-US');
    })
    : [...chart.points];
  return {
    points: Object.freeze(points.slice(0, REPORT_CHART_MAX_RENDERED_POINTS)),
    omitted: chart.points.length - REPORT_CHART_MAX_RENDERED_POINTS,
  };
}

function chartMaximum(points: readonly ReportChartPoint[], unit: MetricUnit): number {
  if (unit === 'percent') return 100;
  const maximum = Math.max(
    0,
    ...points.flatMap((point) => point.values.map(({ value }) => value ?? 0)),
  );
  if (maximum <= 0) return 1;
  const rawStep = maximum / 5;
  const exponent = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / exponent;
  const niceFraction = fraction <= 1
    ? 1
    : fraction <= 2
      ? 2
      : fraction <= 2.5
        ? 2.5
        : fraction <= 5
          ? 5
          : 10;
  return niceFraction * exponent * 5;
}

function formatValue(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(rounded) >= 1_000) return String(Math.round(rounded));
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function gridAndAxes(chart: ReportChartData, maximum: number): string {
  const output: string[] = [];
  for (let index = 0; index <= 5; index += 1) {
    const ratio = index / 5;
    const y = PLOT.bottom - ratio * PLOT.height;
    const value = maximum * ratio;
    output.push(
      `<line x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`,
      `<text x="${PLOT.left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#475569">${formatValue(value)}</text>`,
    );
  }
  output.push(
    `<line x1="${PLOT.left}" y1="${PLOT.top}" x2="${PLOT.left}" y2="${PLOT.bottom}" stroke="#64748b" stroke-width="1.25"/>`,
    `<line x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}" stroke="#64748b" stroke-width="1.25"/>`,
    `<text x="${(PLOT.left + PLOT.right) / 2}" y="448" text-anchor="middle" font-size="12" font-weight="600" fill="#334155">${safeText(chart.xAxisLabel, 80, 'Category')}</text>`,
    `<text transform="translate(18 ${(PLOT.top + PLOT.bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="12" font-weight="600" fill="#334155">${safeText(chart.yAxisLabel, 80, 'Value')}</text>`,
  );
  return output.join('');
}

function legend(series: readonly ReportChartSeries[]): string {
  const width = Math.min(130, Math.floor(PLOT.width / series.length));
  return series.map((item, index) => {
    const x = PLOT.left + index * width;
    return [
      `<rect x="${x}" y="50" width="12" height="12" rx="2" fill="${COLORS[index]}"/>`,
      `<text x="${x + 18}" y="60" font-size="11" font-weight="600" fill="#334155">${safeText(item.label, 16, `Series ${index + 1}`)}</text>`,
    ].join('');
  }).join('');
}

function xLabel(point: ReportChartPoint, x: number, rotate: boolean): string {
  const label = safeText(point.label, rotate ? 18 : 12, 'Unlabelled');
  if (rotate) {
    return `<text x="${x}" y="382" transform="rotate(-32 ${x} 382)" text-anchor="end" font-size="10" fill="#475569">${label}</text>`;
  }
  return `<text x="${x}" y="383" text-anchor="middle" font-size="10" fill="#475569">${label}</text>`;
}

function barPlot(
  chart: ReportChartData,
  points: readonly ReportChartPoint[],
  maximum: number,
): string {
  if (points.length === 0) {
    return `<text x="${(PLOT.left + PLOT.right) / 2}" y="235" text-anchor="middle" font-size="14" fill="#64748b">No chartable observations</text>`;
  }
  const output: string[] = [];
  const groupWidth = PLOT.width / points.length;
  const barArea = Math.min(groupWidth * 0.76, 120);
  const barGap = 3;
  const barWidth = Math.max(2, Math.min(28, (barArea - barGap * (chart.series.length - 1)) / chart.series.length));
  const totalWidth = barWidth * chart.series.length + barGap * (chart.series.length - 1);
  const showValues = points.length * chart.series.length <= 24;
  const rotateLabels = points.length > 6 || points.some(({ label }) => Array.from(label).length > 12);
  points.forEach((point, pointIndex) => {
    const center = PLOT.left + groupWidth * (pointIndex + 0.5);
    const firstX = center - totalWidth / 2;
    chart.series.forEach((series, seriesIndex) => {
      const item = point.values.find(({ seriesKey }) => seriesKey === series.key);
      if (!item) fail('Report chart point series are incomplete.');
      const x = firstX + seriesIndex * (barWidth + barGap);
      if (item.value === null) {
        output.push(`<text x="${x + barWidth / 2}" y="${PLOT.bottom - 6}" text-anchor="middle" font-size="11" fill="#94a3b8">—</text>`);
        return;
      }
      const height = maximum <= 0 ? 0 : Math.max(0, item.value / maximum * PLOT.height);
      const y = PLOT.bottom - height;
      output.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="2" fill="${COLORS[seriesIndex]}"/>`);
      if (showValues) {
        output.push(`<text x="${x + barWidth / 2}" y="${Math.max(PLOT.top + 10, y - 5)}" text-anchor="middle" font-size="9" fill="#334155">${formatValue(item.value)}</text>`);
      }
    });
    output.push(xLabel(point, center, rotateLabels));
  });
  return output.join('');
}

function linePlot(
  chart: ReportChartData,
  points: readonly ReportChartPoint[],
  maximum: number,
): string {
  if (points.length === 0) {
    return `<text x="${(PLOT.left + PLOT.right) / 2}" y="235" text-anchor="middle" font-size="14" fill="#64748b">No chartable observations</text>`;
  }
  const output: string[] = [];
  const xFor = (index: number): number => points.length === 1
    ? (PLOT.left + PLOT.right) / 2
    : PLOT.left + index * PLOT.width / (points.length - 1);
  chart.series.forEach((series, seriesIndex) => {
    let segment: string[] = [];
    const flush = () => {
      if (segment.length > 1) {
        output.push(`<path d="${segment.join(' ')}" fill="none" stroke="${COLORS[seriesIndex]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      segment = [];
    };
    points.forEach((point, pointIndex) => {
      const value = point.values.find(({ seriesKey }) => seriesKey === series.key)?.value ?? null;
      if (value === null) {
        flush();
        output.push(`<text x="${xFor(pointIndex)}" y="${PLOT.bottom - 6}" text-anchor="middle" font-size="11" fill="#94a3b8">—</text>`);
        return;
      }
      const x = xFor(pointIndex);
      const y = PLOT.bottom - value / maximum * PLOT.height;
      segment.push(`${segment.length ? 'L' : 'M'} ${x} ${y}`);
      output.push(`<circle cx="${x}" cy="${y}" r="4" fill="#ffffff" stroke="${COLORS[seriesIndex]}" stroke-width="2.5"/>`);
      if (points.length <= 7 && chart.series.length === 1) {
        output.push(`<text x="${x}" y="${Math.max(PLOT.top + 10, y - 8)}" text-anchor="middle" font-size="9" fill="#334155">${formatValue(value)}</text>`);
      }
    });
    flush();
  });
  const rotateLabels = points.length > 6;
  points.forEach((point, pointIndex) => output.push(xLabel(point, xFor(pointIndex), rotateLabels)));
  return output.join('');
}

function isLineChart(chart: ReportChartData): boolean {
  return chart.kind === 'four_week_trend' || chart.kind === 'adherence_trend';
}

export function renderReportChartSvg(chart: ReportChartData): RenderedReportChartSvg {
  const unit = validateRenderableReportChart(chart);
  const selected = selectPoints(chart);
  const maximum = chartMaximum(selected.points, unit);
  const titleId = `${chart.id}_title`;
  const descriptionId = `${chart.id}_description`;
  const title = cleanText(chart.title, 120, 'Life Tracker report chart');
  const description = `${title}. ${selected.points.length} rendered point${selected.points.length === 1 ? '' : 's'} across ${chart.series.length} series. ${selected.omitted > 0 ? `${selected.omitted} lower-ranked or later points omitted. ` : ''}Missing values are shown as an em dash.`;
  const note = selected.omitted > 0
    ? `Showing ${selected.points.length} of ${chart.points.length} points; omitted points remain in the report JSON.`
    : `${selected.points.length} point${selected.points.length === 1 ? '' : 's'}; missing values are not treated as zero.`;
  const plot = isLineChart(chart)
    ? linePlot(chart, selected.points, maximum)
    : barPlot(chart, selected.points, maximum);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_CHART_WIDTH}" height="${REPORT_CHART_HEIGHT}" viewBox="0 0 ${REPORT_CHART_WIDTH} ${REPORT_CHART_HEIGHT}" role="img" aria-labelledby="${titleId} ${descriptionId}">`,
    `<title id="${titleId}">${escapeXml(title)}</title>`,
    `<desc id="${descriptionId}">${escapeXml(description)}</desc>`,
    `<metadata>${REPORT_CHART_SVG_SCHEMA_VERSION}|${chart.id}|${chart.metricHash}|${chart.dataHash}</metadata>`,
    `<rect width="${REPORT_CHART_WIDTH}" height="${REPORT_CHART_HEIGHT}" fill="#ffffff"/>`,
    `<g font-family="${FONT_FAMILY}">`,
    `<text x="${PLOT.left}" y="28" font-size="18" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`,
    legend(chart.series),
    `<text x="${PLOT.left}" y="82" font-size="10" fill="#64748b">${escapeXml(note)}</text>`,
    gridAndAxes(chart, maximum),
    plot,
    '</g>',
    '</svg>',
  ].join('');
  if (Buffer.byteLength(svg, 'utf8') > REPORT_CHART_MAX_SVG_BYTES) {
    throw new DomainError('LIMIT_EXCEEDED', 'Rendered report chart SVG exceeds its safe size.');
  }
  return Object.freeze({
    schemaVersion: REPORT_CHART_SVG_SCHEMA_VERSION,
    chartId: chart.id,
    kind: chart.kind,
    metricHash: chart.metricHash,
    sourceDataHash: chart.dataHash,
    svgHash: sha256(svg),
    mimeType: 'image/svg+xml',
    width: REPORT_CHART_WIDTH,
    height: REPORT_CHART_HEIGHT,
    renderedPointCount: selected.points.length,
    omittedPointCount: selected.omitted,
    svg,
  });
}
