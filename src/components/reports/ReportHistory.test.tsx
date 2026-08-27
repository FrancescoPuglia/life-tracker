import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ReportHistoryItem,
  ReportHistoryPage,
  ReportHistoryStore,
} from '@/lib/reports/reportHistory';
import ReportHistory from './ReportHistory';

describe('Report history UI', () => {
  it('renders deterministic evidence, preserves unknown actuals, and escapes hostile text', async () => {
    const item = reportItem({
      actualUnavailable: true,
      summary: '<img src=x onerror="steal()"> is user-authored data.',
      delivery: 'sent',
    });
    const store = resolvedStore(page([item]));
    const { container } = render(<ReportHistory userId="owner-1" store={store} />);

    expect(screen.getByRole('status')).toHaveTextContent('Caricamento dei report');
    expect(await screen.findAllByText('Email accettata')).not.toHaveLength(0);
    expect(screen.getAllByText('Sconosciuto').length).toBeGreaterThan(0);
    expect(screen.getByText(/Sessioni mancanti non sono interpretate come zero/i)).toBeInTheDocument();
    expect(screen.getAllByText(item.executiveSummary[0]).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container).not.toHaveTextContent('provider-message-id');
    expect(store.list).toHaveBeenCalledWith('owner-1', 12);
  });

  it('renders a clear empty state without implying missing tracking data', async () => {
    render(<ReportHistory userId="owner-1" store={resolvedStore(page([]))} />);
    expect(await screen.findByText(/Il primo Executive Review verrà generato domenica/i)).toBeInTheDocument();
    expect(screen.getByText(/Sessioni autorevoli/i)).toBeInTheDocument();
  });

  it('surfaces quarantined records and bounded overflow without loading server-only state', async () => {
    render(
      <ReportHistory
        userId="owner-1"
        store={resolvedStore(page([reportItem()], { malformedCount: 2, overflow: true }))}
      />,
    );
    expect(await screen.findByText(/2 report archiviati sono stati esclusi/i)).toBeInTheDocument();
    expect(screen.getByText(/12 review più recenti/i)).toBeInTheDocument();
    expect(screen.getByText(/Nessun report o dato di tracking è stato modificato/i)).toBeInTheDocument();
  });

  it('normalizes read failures and retries without exposing private error details', async () => {
    const store: ReportHistoryStore = {
      list: vi.fn()
        .mockRejectedValueOnce(new Error('private index/provider detail'))
        .mockResolvedValueOnce(page([])),
    };
    render(<ReportHistory userId="owner-1" store={store} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('temporaneamente non disponibile');
    expect(alert).not.toHaveTextContent('private index/provider detail');
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText(/Il primo Executive Review verrà generato domenica/i)).toBeInTheDocument();
    expect(store.list).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale result after the authenticated owner changes', async () => {
    let resolveFirst: ((page: ReportHistoryPage) => void) | undefined;
    const first = new Promise<ReportHistoryPage>((resolve) => { resolveFirst = resolve; });
    const store: ReportHistoryStore = {
      list: vi.fn((uid: string) => uid === 'owner-1'
        ? first
        : Promise.resolve(page([reportItem({ id: `report_${'b'.repeat(56)}`, summary: 'Owner two report.' })]))),
    };
    const { rerender } = render(<ReportHistory userId="owner-1" store={store} />);
    rerender(<ReportHistory userId="owner-2" store={store} />);

    expect((await screen.findAllByText('Owner two report.')).length).toBeGreaterThan(0);
    resolveFirst?.(page([reportItem({ summary: 'Stale owner one report.' })]));
    await waitFor(() => expect(screen.queryByText('Stale owner one report.')).toBeNull());
  });
});

function resolvedStore(result: ReportHistoryPage): ReportHistoryStore {
  return { list: vi.fn(async () => result) };
}

function page(
  items: readonly ReportHistoryItem[],
  options: Readonly<{ malformedCount?: number; overflow?: boolean }> = {},
): ReportHistoryPage {
  return {
    items,
    malformedCount: options.malformedCount ?? 0,
    overflow: options.overflow ?? false,
  };
}

function reportItem(options: Readonly<{
  id?: string;
  summary?: string;
  actualUnavailable?: boolean;
  delivery?: ReportHistoryItem['delivery']['status'];
}> = {}): ReportHistoryItem {
  const availableMetric = {
    value: 60,
    unit: 'minutes' as const,
    availability: 'available' as const,
    sampleSize: 2,
    missingCount: 0,
  };
  const actual = options.actualUnavailable
    ? { ...availableMetric, value: null, availability: 'unavailable' as const }
    : { ...availableMetric, value: 45 };
  return {
    id: options.id ?? `report_${'a'.repeat(56)}`,
    type: 'daily',
    locale: 'en-GB',
    period: {
      localStartDate: '2026-08-25',
      localEndDate: '2026-08-26',
      timezone: 'Europe/Rome',
    },
    generatedAt: '2026-08-25T20:30:00.000Z',
    metricSchemaVersion: 'life-tracker-scientific-metrics-v1',
    formulaVersion: 'life-tracker-report-formulas-2026-08-25',
    executiveSummary: [options.summary ?? 'A deterministic report summary.'],
    metrics: {
      plannedMinutes: availableMetric,
      actualMinutes: actual,
      adherencePercent: options.actualUnavailable
        ? { ...availableMetric, value: null, unit: 'percent', availability: 'unavailable' }
        : { ...availableMetric, value: 75, unit: 'percent' },
      timeBlockCompletionPercent: { ...availableMetric, value: 50, unit: 'percent' },
      taskCompletionPercent: { ...availableMetric, value: 50, unit: 'percent' },
      goalAlignmentIndex: { ...availableMetric, value: 65, unit: 'index' },
      weeklyExecutionIndex: {
        ...availableMetric,
        value: null,
        unit: 'index',
        availability: 'unavailable',
      },
    },
    charts: [{
      kind: 'planned_vs_actual_by_day',
      title: 'Planned vs actual',
      series: [
        { key: 'planned', label: 'Planned', unit: 'minutes' },
        { key: 'actual', label: 'Actual', unit: 'minutes' },
      ],
      points: [{ key: 'day', label: 'Mon', values: [60, options.actualUnavailable ? null : 45] }],
    }],
    weeklyInsights: null,
    dataQuality: {
      complete: !options.actualUnavailable,
      flags: options.actualUnavailable ? ['sessions_dataset_unavailable'] : [],
      sessionsCoverage: options.actualUnavailable ? 'unavailable' : 'complete',
      missingSessionsAreZero: false,
    },
    delivery: {
      status: options.delivery ?? 'not_attempted',
      lastAttemptAt: options.delivery === 'sent' ? '2026-08-25T20:30:01.000Z' : null,
      sentAt: options.delivery === 'sent' ? '2026-08-25T20:30:02.000Z' : null,
    },
  };
}
