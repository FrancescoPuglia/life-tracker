'use client';

import { useEffect, useState } from 'react';
import {
  REPORT_HISTORY_PAGE_SIZE,
  type ReportHistoryDeliveryStatus,
  type ReportHistoryItem,
  type ReportHistoryMetric,
  type ReportHistoryPage,
  type ReportHistoryStore,
} from '@/lib/reports/reportHistory';
import { reportHistoryStore } from '@/lib/reports/firestoreReportHistory';

interface ReportHistoryProps {
  readonly userId: string;
  readonly store?: ReportHistoryStore;
}

type LoadState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; page: ReportHistoryPage }>
  | Readonly<{ status: 'unavailable' }>;

export default function ReportHistory({
  userId,
  store = reportHistoryStore,
}: ReportHistoryProps) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let disposed = false;
    setState({ status: 'loading' });
    void store.list(userId, REPORT_HISTORY_PAGE_SIZE)
      .then((page) => {
        if (!disposed) setState({ status: 'ready', page });
      })
      .catch(() => {
        if (!disposed) setState({ status: 'unavailable' });
      });
    return () => { disposed = true; };
  }, [requestVersion, store, userId]);

  return (
    <section className="space-y-5" aria-labelledby="report-history-title">
      <header className="border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
              Evidenza deterministica
            </p>
            <h3 id="report-history-title" className="mt-1 text-xl font-bold text-slate-900">
              Archivio report
            </h3>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Report giornalieri e settimanali versionati. Le Sessioni non disponibili restano
              sconosciute e non vengono mai rappresentate come zero.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRequestVersion((version) => version + 1)}
            disabled={state.status === 'loading'}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
          >
            {state.status === 'loading' ? 'Caricamento…' : 'Aggiorna'}
          </button>
        </div>
      </header>

      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-600"
        >
          Caricamento dei report archiviati più recenti…
        </div>
      )}

      {state.status === 'unavailable' && (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h4 className="font-semibold text-amber-950">Archivio report temporaneamente non disponibile</h4>
          <p className="mt-1 text-sm text-amber-900">
            I dati di tracking sono al sicuro. Verifica la connessione e riprova.
          </p>
          <button
            type="button"
            onClick={() => setRequestVersion((version) => version + 1)}
            className="mt-4 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Riprova
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <ReportHistoryPageView page={state.page} />
      )}
    </section>
  );
}

function ReportHistoryPageView({ page }: { readonly page: ReportHistoryPage }) {
  return (
    <div className="space-y-4">
      {page.malformedCount > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {page.malformedCount} archived {page.malformedCount === 1 ? 'report was' : 'reports were'}
          {' '}hidden because the stored schema was invalid. No report or tracking data was changed.
        </div>
      )}

      {page.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
          <h4 className="font-bold text-slate-900">
            {page.malformedCount > 0 ? 'Nessun report valido da mostrare' : 'Nessun report disponibile'}
          </h4>
          <p className="mt-1 text-sm text-slate-600">
            {page.malformedCount > 0
              ? 'Gli archivi non validi restano intatti per una diagnosi sicura.'
              : 'I report giornalieri e settimanali compariranno qui dopo la generazione deterministica.'}
          </p>
        </div>
      ) : (
        <ol className="space-y-4" aria-label="Archived scientific reports">
          {page.items.map((item) => (
            <li key={item.id}>
              <ReportCard item={item} />
            </li>
          ))}
        </ol>
      )}

      {page.overflow && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700" role="status">
          Showing the newest {REPORT_HISTORY_PAGE_SIZE} reports. Older archives remain safely
          stored and were not loaded in this bounded view.
        </p>
      )}
    </div>
  );
}

function ReportCard({ item }: { readonly item: ReportHistoryItem }) {
  const periodLabel = formatPeriod(item);
  const generatedLabel = formatInstant(item.generatedAt, item.locale, item.period.timezone);
  const metrics = [
    ['Planned', item.metrics.plannedMinutes],
    ['Actual', item.metrics.actualMinutes],
    ['Adherence', item.metrics.adherencePercent],
    ['Blocks completed', item.metrics.timeBlockCompletionPercent],
    ...(item.type === 'weekly'
      ? [['Execution index', item.metrics.weeklyExecutionIndex] as const]
      : []),
  ] as const;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-indigo-700">
              {item.type}
            </span>
            <DeliveryBadge status={item.delivery.status} />
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              item.dataQuality.complete
                ? 'bg-emerald-50 text-emerald-800'
                : 'bg-amber-50 text-amber-900'
            }`}>
              {item.dataQuality.complete ? 'Data complete' : 'Partial / incomplete data'}
            </span>
          </div>
          <h4 className="mt-3 text-lg font-bold text-slate-950">{periodLabel}</h4>
          <p className="mt-1 text-xs text-slate-500">
            Generated <time dateTime={item.generatedAt}>{generatedLabel}</time>
            {' · '}{item.period.timezone}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, metric]) => (
          <MetricCard key={label} label={label} metric={metric} locale={item.locale} />
        ))}
      </dl>

      {item.metrics.actualMinutes.availability === 'unavailable' && (
        <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          Actual execution is unknown for this period. Missing Sessions are not interpreted as
          zero productivity.
        </p>
      )}

      <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-semibold text-slate-900">
          View deterministic summary and data quality
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Executive summary
            </h5>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-800" data-untrusted-content="true">
              {item.executiveSummary.map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </div>

          <div>
            <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Data quality
            </h5>
            <p className="mt-2 text-sm text-slate-700">
              Sessions dataset: <strong>{item.dataQuality.sessionsCoverage}</strong>. Missing
              Sessions are unknown, never zero.
            </p>
            {item.dataQuality.flags.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Data-quality flags">
                {item.dataQuality.flags.map((flag) => (
                  <li key={flag} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-950">
                    {friendlyFlag(flag)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-emerald-800">No data-quality flags.</p>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Metric schema: {item.metricSchemaVersion} · Formula version: {item.formulaVersion}
          </p>
        </div>
      </details>
    </article>
  );
}

function MetricCard({
  label,
  metric,
  locale,
}: {
  readonly label: string;
  readonly metric: ReportHistoryMetric;
  readonly locale: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-bold text-slate-950">{formatMetric(metric, locale)}</dd>
      <dd className="mt-1 text-[11px] text-slate-500">
        {metric.availability} · N={metric.sampleSize} · missing={metric.missingCount}
      </dd>
    </div>
  );
}

function DeliveryBadge({ status }: { readonly status: ReportHistoryDeliveryStatus }) {
  const presentation: Record<ReportHistoryDeliveryStatus, readonly [string, string]> = {
    not_attempted: ['Not emailed', 'bg-slate-100 text-slate-700'],
    pending: ['Email pending', 'bg-blue-50 text-blue-800'],
    retry_scheduled: ['Email retry scheduled', 'bg-amber-50 text-amber-900'],
    sent: ['Email sent', 'bg-emerald-50 text-emerald-800'],
    failed: ['Email not delivered', 'bg-rose-50 text-rose-800'],
    uncertain: ['Email status uncertain', 'bg-amber-50 text-amber-900'],
  };
  const [label, className] = presentation[status];
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function formatMetric(metric: ReportHistoryMetric, locale: string): string {
  if (metric.value === null) return 'Unknown';
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metric.value);
  if (metric.unit === 'minutes') return `${value} min`;
  if (metric.unit === 'percent') return `${value}%`;
  if (metric.unit === 'index') return `${value}/100`;
  return value;
}

function formatPeriod(item: ReportHistoryItem): string {
  const start = formatLocalDate(item.period.localStartDate, item.locale);
  if (item.type === 'daily') return start;
  const inclusiveEnd = shiftLocalDate(item.period.localEndDate, -1);
  return `${start} – ${formatLocalDate(inclusiveEnd, item.locale)}`;
}

function formatLocalDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatInstant(value: string, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(value));
}

function shiftLocalDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function friendlyFlag(flag: string): string {
  return flag.replaceAll('_', ' ');
}
