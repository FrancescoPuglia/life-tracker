import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { ReportChartData } from './types';
import {
  REPORT_CHART_HEIGHT,
  REPORT_CHART_MAX_RENDERED_POINTS,
  REPORT_CHART_MAX_SVG_BYTES,
  REPORT_CHART_SVG_SCHEMA_VERSION,
  REPORT_CHART_WIDTH,
  isReportChartId,
  isSupportedReportChartKind,
  type RenderedReportChartSvg,
  renderReportChartSvg,
} from './svg-chart-renderer';

export const REPORT_CHART_PNG_SCHEMA_VERSION = 'report-chart-png-v1' as const;
export const REPORT_CHART_PNG_DENSITY = 144;
export const REPORT_CHART_PNG_WIDTH = REPORT_CHART_WIDTH * 2;
export const REPORT_CHART_PNG_HEIGHT = REPORT_CHART_HEIGHT * 2;
export const REPORT_CHART_MAX_INPUT_PIXELS = 2_000_000;
export const REPORT_CHART_MAX_PNG_BYTES = 1_000_000;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UNSAFE_SVG_PATTERN = /(?:<script\b|<foreignObject\b|<!DOCTYPE\b|<!ENTITY\b|\b(?:href|xlink:href)\s*=|\burl\s*\()/i;

export interface ReportChartRasterizedBuffer {
  readonly data: Buffer;
  readonly format: string;
  readonly width: number;
  readonly height: number;
}

export type ReportChartPngRasterizer = (
  svg: Buffer,
) => Promise<ReportChartRasterizedBuffer>;

export interface RenderedReportChartPng {
  readonly schemaVersion: typeof REPORT_CHART_PNG_SCHEMA_VERSION;
  readonly chartId: string;
  readonly kind: ReportChartData['kind'];
  readonly metricHash: string;
  readonly sourceDataHash: string;
  readonly sourceSvgHash: string;
  readonly pngHash: string;
  readonly mimeType: 'image/png';
  readonly width: typeof REPORT_CHART_PNG_WIDTH;
  readonly height: typeof REPORT_CHART_PNG_HEIGHT;
  readonly byteLength: number;
  readonly contentId: string;
  readonly png: Buffer;
}

export interface RenderedReportChart {
  readonly svg: RenderedReportChartSvg;
  readonly png: RenderedReportChartPng;
}

export class ReportChartRasterizationError extends Error {
  readonly code = 'REPORT_CHART_RASTERIZATION_FAILED';

  constructor(message = 'Report chart PNG rendering failed.') {
    super(message);
    this.name = 'ReportChartRasterizationError';
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSvgArtifact(artifact: RenderedReportChartSvg): Buffer {
  if (!artifact || typeof artifact !== 'object' || typeof artifact.svg !== 'string') {
    throw new ReportChartRasterizationError('Report chart SVG authority is invalid.');
  }
  const svg = Buffer.from(artifact.svg, 'utf8');
  if (
    artifact.schemaVersion !== REPORT_CHART_SVG_SCHEMA_VERSION
    || !isReportChartId(artifact.chartId)
    || !isSupportedReportChartKind(artifact.kind)
    || artifact.mimeType !== 'image/svg+xml'
    || artifact.width !== REPORT_CHART_WIDTH
    || artifact.height !== REPORT_CHART_HEIGHT
    || !Number.isInteger(artifact.renderedPointCount)
    || artifact.renderedPointCount < 0
    || artifact.renderedPointCount > REPORT_CHART_MAX_RENDERED_POINTS
    || !Number.isInteger(artifact.omittedPointCount)
    || artifact.omittedPointCount < 0
    || !HASH_PATTERN.test(artifact.metricHash)
    || !HASH_PATTERN.test(artifact.sourceDataHash)
    || !HASH_PATTERN.test(artifact.svgHash)
    || svg.length < 100
    || svg.length > REPORT_CHART_MAX_SVG_BYTES
    || sha256(svg) !== artifact.svgHash
    || !artifact.svg.startsWith('<svg ')
    || !artifact.svg.includes(`|${artifact.chartId}|${artifact.metricHash}|${artifact.sourceDataHash}</metadata>`)
    || UNSAFE_SVG_PATTERN.test(artifact.svg)
  ) {
    throw new ReportChartRasterizationError('Report chart SVG authority is invalid.');
  }
  return svg;
}

export const sharpReportChartPngRasterizer: ReportChartPngRasterizer = async (svg) => {
  const { data, info } = await sharp(svg, {
    density: REPORT_CHART_PNG_DENSITY,
    limitInputPixels: REPORT_CHART_MAX_INPUT_PIXELS,
  })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    format: info.format,
    width: info.width,
    height: info.height,
  };
};

function assertRasterizedBuffer(
  artifact: RenderedReportChartSvg,
  output: ReportChartRasterizedBuffer,
): Buffer {
  if (
    !output
    || !Buffer.isBuffer(output.data)
    || output.format !== 'png'
    || output.width !== REPORT_CHART_PNG_WIDTH
    || output.height !== REPORT_CHART_PNG_HEIGHT
    || output.data.length < PNG_SIGNATURE.length
    || output.data.length > REPORT_CHART_MAX_PNG_BYTES
    || !output.data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new ReportChartRasterizationError('Report chart PNG output is invalid.');
  }
  // Copy provider/native output before hashing so later renderer buffer reuse
  // cannot mutate the attachment underneath its recorded digest.
  const data = Buffer.from(output.data);
  if (artifact.width * 2 !== output.width || artifact.height * 2 !== output.height) {
    throw new ReportChartRasterizationError('Report chart PNG dimensions are invalid.');
  }
  return data;
}

export async function renderReportChartPng(
  artifact: RenderedReportChartSvg,
  rasterizer: ReportChartPngRasterizer = sharpReportChartPngRasterizer,
): Promise<RenderedReportChartPng> {
  const svg = assertSvgArtifact(artifact);
  let output: ReportChartRasterizedBuffer;
  try {
    output = await rasterizer(svg);
  } catch {
    throw new ReportChartRasterizationError();
  }
  const png = assertRasterizedBuffer(artifact, output);
  return Object.freeze({
    schemaVersion: REPORT_CHART_PNG_SCHEMA_VERSION,
    chartId: artifact.chartId,
    kind: artifact.kind,
    metricHash: artifact.metricHash,
    sourceDataHash: artifact.sourceDataHash,
    sourceSvgHash: artifact.svgHash,
    pngHash: sha256(png),
    mimeType: 'image/png',
    width: REPORT_CHART_PNG_WIDTH,
    height: REPORT_CHART_PNG_HEIGHT,
    byteLength: png.length,
    contentId: `${artifact.chartId}@life-tracker-report`,
    png,
  });
}

export function verifyRenderedReportChartPng(artifact: RenderedReportChartPng): void {
  if (
    !artifact
    || typeof artifact !== 'object'
    || !Buffer.isBuffer(artifact.png)
    || artifact.schemaVersion !== REPORT_CHART_PNG_SCHEMA_VERSION
    || !isReportChartId(artifact.chartId)
    || !isSupportedReportChartKind(artifact.kind)
    || artifact.mimeType !== 'image/png'
    || artifact.width !== REPORT_CHART_PNG_WIDTH
    || artifact.height !== REPORT_CHART_PNG_HEIGHT
    || !Number.isInteger(artifact.byteLength)
    || artifact.byteLength < PNG_SIGNATURE.length
    || artifact.byteLength !== artifact.png.length
    || artifact.byteLength > REPORT_CHART_MAX_PNG_BYTES
    || !HASH_PATTERN.test(artifact.metricHash)
    || !HASH_PATTERN.test(artifact.sourceDataHash)
    || !HASH_PATTERN.test(artifact.sourceSvgHash)
    || !HASH_PATTERN.test(artifact.pngHash)
    || sha256(artifact.png) !== artifact.pngHash
    || !artifact.png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || artifact.contentId !== `${artifact.chartId}@life-tracker-report`
  ) {
    throw new ReportChartRasterizationError('Rendered report chart PNG integrity is invalid.');
  }
}

/** Sequential by design: report generation has a small bounded memory profile. */
export async function renderReportCharts(
  charts: readonly ReportChartData[],
  rasterizer: ReportChartPngRasterizer = sharpReportChartPngRasterizer,
): Promise<readonly RenderedReportChart[]> {
  if (!Array.isArray(charts) || charts.length < 1 || charts.length > 10) {
    throw new ReportChartRasterizationError('Report chart set is invalid.');
  }
  const output: RenderedReportChart[] = [];
  for (const chart of charts) {
    const svg = renderReportChartSvg(chart);
    const png = await renderReportChartPng(svg, rasterizer);
    output.push(Object.freeze({ svg, png }));
  }
  return Object.freeze(output);
}
