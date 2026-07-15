// src/components/performance/PlanVsActualChart.test.tsx
//
// Regression tests for the Plan vs Reality chart. The 2026-07 incident:
// KPIs showed real totals but the chart rendered no bars, no Y axis and
// no tooltips. These tests render the REAL chart (ResponsiveContainer is
// given a concrete size via getBoundingClientRect) with points produced
// by the REAL engine, and assert that visible graphical primitives with
// valid geometry exist — not merely that the title or an axis mounted.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { TimeBlock } from '@/types';
import { computePerformanceOverview } from '@/lib/performance/metrics';
import { resolvePeriod } from '@/lib/performance/period';
import type { PerformancePeriod, PerformanceTimePoint } from '@/lib/performance/types';
import PlanVsActualChart from './PlanVsActualChart';

// ---- Chart-sized jsdom -------------------------------------------------------
// ResponsiveContainer measures its container via getBoundingClientRect (and
// ResizeObserver for later changes); jsdom returns 0×0, which silently
// renders an empty chart. Give every element a real box so the chart mounts.

const realGetBCR = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  Element.prototype.getBoundingClientRect = function getBCR() {
    return {
      width: 900,
      height: 280,
      top: 0,
      left: 0,
      right: 900,
      bottom: 280,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = realGetBCR;
});

// ---- Fixtures: July 2026, same shape as the incident --------------------------

const NOW = new Date(2026, 6, 14, 19, 0); // Tue Jul 14 2026, 19:00 local

let seq = 0;
function makeBlock(over: Partial<TimeBlock>): TimeBlock {
  const startTime = over.startTime ?? new Date(2026, 6, 6, 9, 0);
  const endTime = over.endTime ?? new Date(startTime.getTime() + 2 * 3600 * 1000);
  return {
    id: `block-${++seq}`,
    userId: 'user-a',
    domainId: 'd1',
    title: 'Deep work',
    type: 'work',
    status: 'completed',
    startTime,
    endTime,
    // Scheduled the day before ⇒ advance-planned (counts as plan).
    createdAt: new Date(startTime.getTime() - 24 * 3600 * 1000),
    updatedAt: startTime,
    ...over,
  } as TimeBlock;
}

function day(d: number, h: number, min = 0): Date {
  return new Date(2026, 6, d, h, min);
}

/** July 2026 fixture: mixed planned/executed/unplanned/future days. */
function buildMonthOverview(blocks?: TimeBlock[]) {
  const period = resolvePeriod(NOW, 'month', NOW);
  const input = {
    timeBlocks:
      blocks ??
      [
        // Jul 2: planned 3h, executed 2h30m (measured).
        makeBlock({
          startTime: day(2, 9),
          endTime: day(2, 12),
          actualStartTime: day(2, 9, 15),
          actualEndTime: day(2, 11, 45),
        }),
        // Jul 6: planned 2h, fully executed via planned window (assumed).
        makeBlock({ startTime: day(6, 9), endTime: day(6, 11) }),
        // Jul 8: retro-logged 1h30m ⇒ unplanned actual.
        makeBlock({
          startTime: day(8, 20),
          endTime: day(8, 21, 30),
          createdAt: day(8, 21, 35),
        }),
        // Jul 9: planned 6h, never executed.
        makeBlock({ status: 'planned', startTime: day(9, 9), endTime: day(9, 15) }),
        // Jul 20 (future): planned 4h.
        makeBlock({ status: 'planned', startTime: day(20, 9), endTime: day(20, 13) }),
      ],
    sessions: [],
    tasks: [],
    projects: [],
    goals: [],
  };
  const overview = computePerformanceOverview(input, period, undefined, NOW);
  return { overview, period };
}

function renderChart(points: PerformanceTimePoint[], period: PerformancePeriod) {
  return render(
    <PlanVsActualChart points={points} period={period} selectedKey={null} onSelectKey={() => {}} />
  );
}

/** Bars recharts actually drew: rectangles with real, finite geometry. */
function visibleBars(container: HTMLElement): Array<{ width: number; height: number }> {
  const nodes = Array.from(container.querySelectorAll('.recharts-bar-rectangle path'));
  return nodes
    .map((node) => ({
      width: Number(node.getAttribute('width')),
      height: Number(node.getAttribute('height')),
      d: node.getAttribute('d') ?? '',
    }))
    .filter((r) => r.d !== '')
    .map(({ width, height, d }) => {
      expect(d).not.toContain('NaN');
      expect(d).not.toContain('Infinity');
      expect(Number.isFinite(width)).toBe(true);
      expect(Number.isFinite(height)).toBe(true);
      return { width, height };
    });
}

// ---- Tests --------------------------------------------------------------------

describe('PlanVsActualChart — bars must really render (2026-07 empty-chart bug)', () => {
  it('draws visible Planned/Actual/Unplanned bars for a month with data', () => {
    const { overview, period } = buildMonthOverview();
    const { container } = renderChart(overview.timeSeries, period);

    const bars = visibleBars(container);
    expect(bars.length).toBeGreaterThan(0);
    // At least the 4 non-zero days × planned series must have real height.
    const withHeight = bars.filter((b) => b.height > 0 && b.width > 0);
    expect(withHeight.length).toBeGreaterThanOrEqual(4);
  });

  it('renders a numeric Y axis (ticks exist and are finite)', () => {
    const { overview, period } = buildMonthOverview();
    const { container } = renderChart(overview.timeSeries, period);

    const ticks = Array.from(
      container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')
    );
    // jsdom cannot measure text, so recharts' overlap logic may collapse the
    // axis to a single tick — zero ticks is the bug signal (broken Y domain).
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    for (const tick of ticks) {
      expect(tick.textContent).not.toContain('NaN');
    }
  });

  it('keeps distinct series: planned, planned-executed and unplanned stacks', () => {
    const { overview, period } = buildMonthOverview();
    const { container } = renderChart(overview.timeSeries, period);

    // 3 Bar series → 3 layers, each with at least one drawn rectangle.
    const layers = Array.from(container.querySelectorAll('.recharts-bar'));
    expect(layers.length).toBe(3);
    for (const layer of layers) {
      expect(layer.querySelectorAll('.recharts-bar-rectangle path').length).toBeGreaterThan(0);
    }
  });

  it('scales correctly when Planned dominates Actual (incident shape: 79h vs 36h)', () => {
    const blocks = [
      makeBlock({ status: 'planned', startTime: day(9, 8), endTime: day(9, 18) }), // 10h plan
      makeBlock({
        startTime: day(10, 9),
        endTime: day(10, 10),
        actualStartTime: day(10, 9),
        actualEndTime: day(10, 10),
      }), // 1h done
    ];
    const { overview, period } = buildMonthOverview(blocks);
    const { container } = renderChart(overview.timeSeries, period);

    const bars = visibleBars(container).filter((b) => b.height > 0);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    const max = Math.max(...bars.map((b) => b.height));
    const min = Math.min(...bars.map((b) => b.height));
    // 10h vs 1h on one linear axis: heights must actually differ.
    expect(max).toBeGreaterThan(min * 4);
  });

  it('scales correctly when Actual dominates Planned', () => {
    const blocks = [
      makeBlock({ status: 'planned', startTime: day(9, 9), endTime: day(9, 10) }), // 1h plan
      makeBlock({
        startTime: day(10, 8),
        endTime: day(10, 18),
        actualStartTime: day(10, 8),
        actualEndTime: day(10, 18),
      }), // 10h done
    ];
    const { overview, period } = buildMonthOverview(blocks);
    const { container } = renderChart(overview.timeSeries, period);
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('handles a single day with data in the whole month', () => {
    const blocks = [
      makeBlock({
        startTime: day(3, 9),
        endTime: day(3, 11),
        actualStartTime: day(3, 9),
        actualEndTime: day(3, 11),
      }),
    ];
    const { overview, period } = buildMonthOverview(blocks);
    const { container } = renderChart(overview.timeSeries, period);
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThanOrEqual(1);
  });

  it('handles very large values without NaN/Infinity in the geometry', () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      makeBlock({
        startTime: day(i + 1, 0),
        endTime: new Date(2026, 6, i + 2, 0),
        actualStartTime: day(i + 1, 0),
        actualEndTime: new Date(2026, 6, i + 2, 0),
      })
    );
    const { overview, period } = buildMonthOverview(blocks);
    const { container } = renderChart(overview.timeSeries, period);
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThanOrEqual(10);
  });

  it('shows the empty state (not a blank chart) when the period has no data', () => {
    const { period } = buildMonthOverview([]);
    const { overview } = buildMonthOverview([]);
    const { container, getByText } = renderChart(overview.timeSeries, period);
    getByText(/No planned or executed time/i);
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(0);
  });

  it('tolerates zero-filled and gap days without breaking neighbours', () => {
    const blocks = [
      makeBlock({
        startTime: day(1, 9),
        endTime: day(1, 10),
        actualStartTime: day(1, 9),
        actualEndTime: day(1, 10),
      }),
      makeBlock({
        startTime: day(31, 9),
        endTime: day(31, 10),
        actualStartTime: day(31, 9),
        actualEndTime: day(31, 10),
      }),
    ];
    const { overview, period } = buildMonthOverview(blocks);
    expect(overview.timeSeries).toHaveLength(31);
    const { container } = renderChart(overview.timeSeries, period);
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThanOrEqual(2);
  });

  it('sanitizes non-finite input values instead of emitting NaN geometry', () => {
    const { overview, period } = buildMonthOverview();
    const corrupted = overview.timeSeries.map((p, i) =>
      i === 2
        ? {
            ...p,
            plannedMinutes: Number.NaN,
            actualMinutes: Number.POSITIVE_INFINITY,
            unplannedMinutes: undefined as unknown as number,
          }
        : p
    );
    const { container } = renderChart(corrupted, period);
    const bars = visibleBars(container); // asserts no NaN/Infinity in every path
    expect(bars.filter((b) => b.height > 0).length).toBeGreaterThan(0);
    const yTicks = container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value');
    expect(yTicks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PlanVsActualChart — Daily ⇄ Cumulative', () => {
  it('switching to Cumulative draws real line paths and back restores bars', () => {
    const { overview, period } = buildMonthOverview();
    const { container, getByRole } = renderChart(overview.timeSeries, period);

    fireEvent.click(getByRole('button', { name: 'Cumulative' }));
    const lines = Array.from(container.querySelectorAll('.recharts-line-curve'));
    expect(lines.length).toBe(2); // cumulative planned + cumulative actual
    for (const line of lines) {
      const d = line.getAttribute('d') ?? '';
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('NaN');
    }
    expect(container.querySelectorAll('.recharts-bar-rectangle path').length).toBe(0);

    fireEvent.click(getByRole('button', { name: 'Daily' }));
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThan(0);
  });
});

describe('PlanVsActualChart — week and year buckets', () => {
  it('renders bars for a week period', () => {
    const period = resolvePeriod(NOW, 'week', NOW);
    const input = {
      timeBlocks: [
        makeBlock({
          startTime: day(13, 9),
          endTime: day(13, 12),
          actualStartTime: day(13, 9),
          actualEndTime: day(13, 12),
        }),
      ],
      sessions: [],
      tasks: [],
      projects: [],
      goals: [],
    };
    const overview = computePerformanceOverview(input, period, undefined, NOW);
    const { container } = renderChart(overview.timeSeries, period);
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThanOrEqual(1);
  });

  it('renders monthly bars for a year period (Monthly label)', () => {
    const period = resolvePeriod(NOW, 'year', NOW);
    const input = {
      timeBlocks: [
        makeBlock({
          startTime: new Date(2026, 2, 10, 9, 0),
          endTime: new Date(2026, 2, 10, 12, 0),
          actualStartTime: new Date(2026, 2, 10, 9, 0),
          actualEndTime: new Date(2026, 2, 10, 12, 0),
        }),
        makeBlock({
          startTime: day(2, 9),
          endTime: day(2, 12),
          actualStartTime: day(2, 9),
          actualEndTime: day(2, 12),
        }),
      ],
      sessions: [],
      tasks: [],
      projects: [],
      goals: [],
    };
    const overview = computePerformanceOverview(input, period, undefined, NOW);
    const { container, getByRole } = renderChart(overview.timeSeries, period);
    getByRole('button', { name: 'Monthly' });
    expect(visibleBars(container).filter((b) => b.height > 0).length).toBeGreaterThanOrEqual(2);
  });
});

describe('PlanVsActualChart — data updates', () => {
  it('re-renders bars when the points prop changes', () => {
    const first = buildMonthOverview([
      makeBlock({
        startTime: day(3, 9),
        endTime: day(3, 10),
        actualStartTime: day(3, 9),
        actualEndTime: day(3, 10),
      }),
    ]);
    const { container, rerender } = renderChart(first.overview.timeSeries, first.period);
    const before = visibleBars(container).filter((b) => b.height > 0).length;
    expect(before).toBeGreaterThanOrEqual(1);

    const second = buildMonthOverview(); // richer fixture
    rerender(
      <PlanVsActualChart
        points={second.overview.timeSeries}
        period={second.period}
        selectedKey={null}
        onSelectKey={() => {}}
      />
    );
    const after = visibleBars(container).filter((b) => b.height > 0).length;
    expect(after).toBeGreaterThan(before);
  });
});
