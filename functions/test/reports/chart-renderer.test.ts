import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/domain/integrity';
import type { EntityRecord, UserPlanningPreferences } from '../../src/domain/types';
import {
  REPORT_CHART_MAX_PNG_BYTES,
  REPORT_CHART_PNG_HEIGHT,
  REPORT_CHART_PNG_WIDTH,
  ReportChartRasterizationError,
  buildScientificExecutionReport,
  renderReportChartPng,
  renderReportChartSvg,
  renderReportCharts,
  sharpReportChartPngRasterizer,
  verifyRenderedReportChartPng,
} from '../../src/reports';
import type {
  ReportChartData,
  ScientificExecutionReport,
  ScientificReportInput,
} from '../../src/reports';

const UID = 'chart-owner';
const PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};

function record(id: string, values: Readonly<Record<string, unknown>> = {}): EntityRecord {
  return {
    id,
    _version: 1,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
    ...values,
  };
}

function executionReport(sessionsAvailable = true): ScientificExecutionReport {
  const goals = Array.from({ length: 15 }, (_, index) => record(`goal-${index}`, {
    title: index === 0
      ? '& <script>destroy()</script> "authority"'
      : `Goal ${index}`,
    timeAllocationTarget: index === 0 ? 168 : index,
  }));
  const timeBlocks = Array.from({ length: 7 }, (_, index) => {
    const day = 17 + index;
    const plannedMinutes = 60 + index * 10;
    return record(`block-${index}`, {
      title: `Block ${index}`,
      goalId: `goal-${index}`,
      startTime: `2026-08-${day}T07:00:00.000Z`,
      endTime: new Date(Date.parse(`2026-08-${day}T07:00:00.000Z`) + plannedMinutes * 60_000)
        .toISOString(),
      status: 'completed',
      type: index % 2 === 0 ? 'deep' : 'work',
    });
  });
  const sessions = sessionsAvailable
    ? Array.from({ length: 7 }, (_, index) => {
      const day = 17 + index;
      const actualMinutes = 50 + index * 5;
      return record(`session-${index}`, {
        timeBlockId: `block-${index}`,
        goalId: `goal-${index}`,
        startTime: `2026-08-${day}T07:05:00.000Z`,
        endTime: new Date(Date.parse(`2026-08-${day}T07:05:00.000Z`) + actualMinutes * 60_000)
          .toISOString(),
        duration: actualMinutes * 60,
        status: 'completed',
        tags: [],
      });
    })
    : null;
  const input: ScientificReportInput = {
    uid: UID,
    reportType: 'weekly',
    localDate: '2026-08-23',
    timezone: 'Europe/Rome',
    locale: 'en-GB',
    generatedAt: '2026-08-23T20:30:00.000Z',
    preferences: PREFERENCES,
    coverage: {
      goals: 'complete',
      projects: 'complete',
      tasks: 'complete',
      timeBlocks: 'complete',
      sessions: sessionsAvailable ? 'complete' : 'unavailable',
      habits: 'complete',
      habitLogs: 'complete',
    },
    records: {
      goals,
      projects: [],
      tasks: [],
      timeBlocks,
      sessions,
      habits: [],
      habitLogs: [],
    },
  };
  return buildScientificExecutionReport(input);
}

function chart(report: ScientificExecutionReport, kind: ReportChartData['kind']): ReportChartData {
  const result = report.charts.find((item) => item.kind === kind);
  if (!result) throw new Error(`Missing ${kind} chart fixture.`);
  return result;
}

describe('deterministic accessible report chart rendering', () => {
  it('renders exact title, axes, source hashes, and accessible missing-data semantics', () => {
    const report = executionReport(false);
    const source = chart(report, 'planned_vs_actual_by_day');
    const first = renderReportChartSvg(source);
    const retry = renderReportChartSvg(source);

    expect(first).toEqual(retry);
    expect(first.sourceDataHash).toBe(source.dataHash);
    expect(first.metricHash).toBe(source.metricHash);
    expect(first.svgHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.svg).toContain('<title');
    expect(first.svg).toContain('<desc');
    expect(first.svg).toContain('role="img"');
    expect(first.svg).toContain('Planned vs actual by day');
    expect(first.svg).toContain('Local date');
    expect(first.svg).toContain('Minutes');
    expect(first.svg).toContain('missing values are not treated as zero');
    expect(first.svg).toContain('—');
    expect(first.svg).toContain(source.metricHash);
    expect(first.svg).toContain(source.dataHash);
  });

  it('escapes hostile labels, caps visual density, and discloses deterministic omission', () => {
    const source = chart(executionReport(), 'goal_allocation');
    const rendered = renderReportChartSvg(source);

    expect(source.points).toHaveLength(15);
    expect(rendered.renderedPointCount).toBe(12);
    expect(rendered.omittedPointCount).toBe(3);
    expect(rendered.svg).toContain('Showing 12 of 15 points');
    expect(rendered.svg).toContain('&lt;script&gt;');
    expect(rendered.svg).toContain('&amp;');
    expect(rendered.svg).not.toMatch(/<script\b/i);
    expect(rendered.svg).not.toMatch(/<foreignObject\b/i);
    expect(rendered.svg).not.toMatch(/\b(?:href|xlink:href)\s*=/i);
    expect(rendered.svg).not.toMatch(/\burl\s*\(/i);
  });

  it('rejects chart-value or series-order tampering before drawing', () => {
    const source = chart(executionReport(), 'planned_vs_actual_by_day');
    const valueTamper = structuredClone(source) as ReportChartData;
    const value = valueTamper.points[0]?.values[0];
    if (!value) throw new Error('Missing chart value fixture.');
    (value as { value: number | null }).value = 999;
    expect(() => renderReportChartSvg(valueTamper)).toThrow('data hash is invalid');

    const orderTamper = structuredClone(source) as ReportChartData;
    const values = orderTamper.points[0]?.values;
    if (!values || values.length < 2) throw new Error('Missing chart series fixture.');
    (orderTamper.points[0] as { values: typeof values }).values = [values[1]!, values[0]!];
    expect(() => renderReportChartSvg(orderTamper)).toThrow('series identity is invalid');
  });

  it('fails closed before rendering an excessive source chart', () => {
    const source = chart(executionReport(), 'goal_allocation');
    const template = source.points[0];
    if (!template) throw new Error('Missing chart point fixture.');
    const { dataHash: _dataHash, ...originalContent } = source;
    const content = {
      ...originalContent,
      points: Array.from({ length: 1_001 }, (_, index) => ({
        ...structuredClone(template),
        key: `goal-bound-${index}`,
        label: `Goal bound ${index}`,
      })),
    };
    const excessive = {
      ...content,
      dataHash: createHash('sha256').update(canonicalJson(content)).digest('hex'),
    } as ReportChartData;

    expect(() => renderReportChartSvg(excessive)).toThrow('safe point bound');
  });

  it('renders bounded real PNGs deterministically and verifies attachment integrity', async () => {
    const source = renderReportChartSvg(chart(executionReport(), 'planned_vs_actual_by_day'));
    const first = await renderReportChartPng(source);
    const retry = await renderReportChartPng(source);
    const metadata = await sharp(first.png).metadata();

    expect(first.png.equals(retry.png)).toBe(true);
    expect(first.pngHash).toBe(retry.pngHash);
    expect(first.sourceSvgHash).toBe(source.svgHash);
    expect(first.sourceDataHash).toBe(source.sourceDataHash);
    expect(first.byteLength).toBeGreaterThan(1_000);
    expect(first.byteLength).toBeLessThan(REPORT_CHART_MAX_PNG_BYTES);
    expect(first.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(metadata).toMatchObject({
      format: 'png',
      width: REPORT_CHART_PNG_WIDTH,
      height: REPORT_CHART_PNG_HEIGHT,
    });
    expect(() => verifyRenderedReportChartPng(first)).not.toThrow();

    const corrupted = { ...first, png: Buffer.from(first.png) };
    const lastByte = corrupted.png.length - 1;
    corrupted.png[lastByte] = (corrupted.png[lastByte] ?? 0) ^ 1;
    expect(() => verifyRenderedReportChartPng(corrupted)).toThrow('integrity is invalid');

    expect(() => verifyRenderedReportChartPng({
      ...first,
      metricHash: 'not-a-hash',
    })).toThrow('integrity is invalid');
    expect(() => verifyRenderedReportChartPng(null as unknown as typeof first))
      .toThrow('integrity is invalid');
  });

  it('rejects active SVG and malformed raster output even when an injected hash matches', async () => {
    const source = renderReportChartSvg(chart(executionReport(), 'planned_vs_actual_by_day'));
    const unsafeSvg = source.svg.replace('</svg>', '<script>alert(1)</script></svg>');
    const unsafe = {
      ...source,
      svg: unsafeSvg,
      svgHash: createHash('sha256').update(unsafeSvg).digest('hex'),
    };
    let called = false;
    await expect(renderReportChartPng(unsafe, async () => {
      called = true;
      throw new Error('must not run');
    })).rejects.toThrow('SVG authority is invalid');
    expect(called).toBe(false);

    await expect(renderReportChartPng(
      { ...source, svg: undefined } as unknown as typeof source,
    )).rejects.toThrow('SVG authority is invalid');

    await expect(renderReportChartPng(source, async () => ({
      data: Buffer.from('not a PNG'),
      format: 'png',
      width: REPORT_CHART_PNG_WIDTH,
      height: REPORT_CHART_PNG_HEIGHT,
    }))).rejects.toThrow('PNG output is invalid');

    const oversizedPng = Buffer.alloc(REPORT_CHART_MAX_PNG_BYTES + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversizedPng);
    await expect(renderReportChartPng(source, async () => ({
      data: oversizedPng,
      format: 'png',
      width: REPORT_CHART_PNG_WIDTH,
      height: REPORT_CHART_PNG_HEIGHT,
    }))).rejects.toThrow('PNG output is invalid');
  });

  it('renders the bounded report chart set sequentially and isolates native failure from the report', async () => {
    const report = executionReport();
    const before = canonicalJson(report);
    const rendered = await renderReportCharts(report.charts);

    expect(rendered).toHaveLength(5);
    expect(new Set(rendered.map(({ svg }) => svg.sourceDataHash))).toEqual(
      new Set(report.charts.map(({ dataHash }) => dataHash)),
    );
    for (const artifact of rendered) verifyRenderedReportChartPng(artifact.png);

    let calls = 0;
    const failingRasterizer = async (svg: Buffer) => {
      calls += 1;
      if (calls === 2) throw new Error('native detail and credential-shaped internal text');
      return sharpReportChartPngRasterizer(svg);
    };
    const failure = renderReportCharts(report.charts, failingRasterizer);
    await expect(failure).rejects.toBeInstanceOf(ReportChartRasterizationError);
    await expect(failure).rejects.not.toThrow('native detail');
    expect(calls).toBe(2);
    expect(canonicalJson(report)).toBe(before);
  });
});
