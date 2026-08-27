'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  REPORT_HISTORY_PAGE_SIZE,
  type ReportHistoryChart,
  type ReportHistoryDeliveryStatus,
  type ReportHistoryItem,
  type ReportHistoryMetric,
  type ReportHistoryPage,
  type ReportHistoryStore,
} from '@/lib/reports/reportHistory';
import { reportHistoryStore } from '@/lib/reports/firestoreReportHistory';
import {
  getWeeklyReviewApiClient,
  type WeeklyReviewApiClient,
} from '@/lib/reports/weeklyReviewApiClient';

interface ReportHistoryProps {
  readonly userId: string;
  readonly store?: ReportHistoryStore;
  readonly reviewApi?: WeeklyReviewApiClient;
}

type LoadState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; page: ReportHistoryPage }>
  | Readonly<{ status: 'unavailable' }>;

export default function ReportHistory({
  userId,
  store = reportHistoryStore,
  reviewApi,
}: ReportHistoryProps) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [action, setAction] = useState<'send' | string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const runDelivery = async (kind: 'send' | 'retry', reportId?: string) => {
    setAction(kind === 'send' ? 'send' : reportId ?? 'retry');
    setActionMessage(null);
    setActionError(null);
    try {
      const api = reviewApi ?? getWeeklyReviewApiClient();
      const result = kind === 'send'
        ? await api.sendTest()
        : await api.retryDelivery(reportId!);
      if (result.outcome === 'provider_accepted' || result.outcome === 'already_accepted') {
        setActionMessage('Review archiviata e accettata dal provider email.');
      } else if (result.outcome === 'retry_pending') {
        setActionMessage('Review al sicuro. Il prossimo tentativo è già programmato.');
      } else if (result.outcome === 'not_due') {
        setActionMessage('Nessuna review settimanale è ancora dovuta con le preferenze attuali.');
      } else {
        setActionError('La review resta archiviata, ma la consegna email richiede attenzione.');
      }
      setRequestVersion((version) => version + 1);
    } catch {
      setActionError('Invio non disponibile. Nessun dato storico è stato modificato.');
    } finally {
      setAction(null);
    }
  };

  return (
    <section className="space-y-6" aria-labelledby="report-history-title">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-600">
            Precision Performance OS
          </p>
          <h3 id="report-history-title" className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            Executive Review
          </h3>
          <p className="mt-2 max-w-3xl text-base text-slate-600">
            Il confronto onesto tra ciò che avevi pianificato e ciò che hai realmente eseguito.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRequestVersion((version) => version + 1)}
          disabled={state.status === 'loading'}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {state.status === 'loading' ? 'Caricamento…' : 'Aggiorna'}
        </button>
      </header>

      {actionMessage && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {actionMessage}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          {actionError}
        </p>
      )}

      {state.status === 'loading' && <ReportSkeleton />}

      {state.status === 'unavailable' && (
        <div role="alert" className="grid min-h-[340px] place-items-center rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-8 text-center">
          <div className="max-w-lg">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-700" aria-hidden="true" />
            <h4 className="mt-4 text-xl font-black text-amber-950">Archivio report temporaneamente non disponibile</h4>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              I dati di tracking sono al sicuro. La review non viene nascosta né ricreata.
            </p>
            <button type="button" onClick={() => setRequestVersion((version) => version + 1)} className="mt-6 rounded-xl bg-amber-950 px-5 py-2.5 text-sm font-bold text-white">
              Riprova
            </button>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <ReportHistoryPageView
          page={state.page}
          busyAction={action}
          onSendTest={() => void runDelivery('send')}
          onRetry={(reportId) => void runDelivery('retry', reportId)}
        />
      )}
    </section>
  );
}

function ReportSkeleton() {
  return (
    <div role="status" className="animate-pulse space-y-4" aria-label="Caricamento dei report archiviati più recenti">
      <div className="h-64 rounded-3xl bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44 rounded-2xl bg-slate-100" />
        <div className="h-44 rounded-2xl bg-slate-100" />
      </div>
      <span className="sr-only">Caricamento dei report archiviati più recenti…</span>
    </div>
  );
}

function ReportHistoryPageView({
  page,
  busyAction,
  onSendTest,
  onRetry,
}: {
  readonly page: ReportHistoryPage;
  readonly busyAction: string | null;
  readonly onSendTest: () => void;
  readonly onRetry: (reportId: string) => void;
}) {
  const featured = useMemo(
    () => page.items.find((item) => item.type === 'weekly') ?? page.items[0] ?? null,
    [page.items],
  );
  return (
    <div className="space-y-6">
      {page.malformedCount > 0 && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {page.malformedCount} {page.malformedCount === 1 ? 'report archiviato è stato escluso' : 'report archiviati sono stati esclusi'}
          {' '}perché lo schema salvato non era valido. Nessun report o dato di tracking è stato modificato.
        </div>
      )}

      {!featured ? (
        <EmptyReview busy={busyAction === 'send'} onSendTest={onSendTest} />
      ) : (
        <>
          <LatestReview item={featured} busyAction={busyAction} onRetry={onRetry} />
          <section aria-labelledby="archive-title" className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Archivio</p>
                <h4 id="archive-title" className="mt-1 text-xl font-black text-slate-950">Review precedenti</h4>
              </div>
              <button type="button" disabled={busyAction !== null} onClick={onSendTest} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50">
                <Send className="h-4 w-4" aria-hidden="true" />
                Invia review di test
              </button>
            </div>
            <ol className="grid gap-3 lg:grid-cols-2" aria-label="Review scientifiche archiviate">
              {page.items.map((item) => <li key={item.id}><ArchiveCard item={item} /></li>)}
            </ol>
          </section>
        </>
      )}

      {page.overflow && (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700" role="status">
          Sono mostrate le {REPORT_HISTORY_PAGE_SIZE} review più recenti. Gli archivi precedenti restano conservati in modo sicuro.
        </p>
      )}
    </div>
  );
}

function EmptyReview({ busy, onSendTest }: { readonly busy: boolean; readonly onSendTest: () => void }) {
  return (
    <div className="grid min-h-[420px] place-items-center overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-8 text-center text-white shadow-xl">
      <div className="max-w-xl">
        <Sparkles className="mx-auto h-11 w-11 text-indigo-200" aria-hidden="true" />
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-indigo-200">La tua prima review</p>
        <h4 className="mt-3 text-3xl font-black tracking-tight">
          Il primo Executive Review verrà generato domenica alle 20:30.
        </h4>
        <p className="mt-4 text-base leading-7 text-indigo-100">
          Userà TimeBlock e Sessioni autorevoli. Le prove mancanti resteranno sconosciute, mai zero.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={onSendTest} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-black text-indigo-950 shadow-lg disabled:opacity-60">
            <Send className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Generazione…' : 'Invia review di test'}
          </button>
          <span className="inline-flex h-11 items-center rounded-xl border border-white/25 px-5 text-sm font-semibold text-indigo-100">
            Anteprima disponibile dopo l’archiviazione
          </span>
        </div>
      </div>
    </div>
  );
}

function LatestReview({ item, busyAction, onRetry }: { readonly item: ReportHistoryItem; readonly busyAction: string | null; readonly onRetry: (reportId: string) => void }) {
  const score = item.type === 'weekly' ? item.metrics.weeklyExecutionIndex : item.metrics.adherencePercent;
  const metrics = [
    ['Pianificato', item.metrics.plannedMinutes],
    ['Eseguito', item.metrics.actualMinutes],
    ['Aderenza', item.metrics.adherencePercent],
    ['Allineamento obiettivi', item.metrics.goalAlignmentIndex],
  ] as const;
  return (
    <article className="space-y-6">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white shadow-xl sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-indigo-100">Ultima Executive Review</span>
              <DeliveryBadge status={item.delivery.status} dark />
            </div>
            <h4 className="mt-5 text-3xl font-black tracking-tight sm:text-4xl">{formatPeriod(item)}</h4>
            <p className="mt-2 text-sm text-indigo-200">
              Generata <time dateTime={item.generatedAt}>{formatInstant(item.generatedAt, item.locale, item.period.timezone)}</time>{' · '}{item.period.timezone}
            </p>
            <ul className="mt-6 max-w-3xl space-y-2 text-base leading-7 text-indigo-50" data-untrusted-content="true">
              {item.executiveSummary.slice(0, 3).map((line, index) => (
                <li key={index} className="flex gap-3"><ArrowRight className="mt-1 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" /><span>{line}</span></li>
              ))}
            </ul>
          </div>
          <div className="grid h-40 w-40 place-items-center rounded-full border border-white/20 bg-white/10 shadow-inner">
            <div className="text-center">
              <p className="text-5xl font-black tabular-nums">{score.value === null ? '—' : Math.round(score.value)}</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-indigo-200">Punteggio</p>
            </div>
          </div>
        </div>
        <dl className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(([label, metric]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
              <dt className="text-xs font-bold uppercase tracking-wide text-indigo-200">{label}</dt>
              <dd className="mt-2 text-2xl font-black">{formatMetric(metric, item.locale)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {(item.delivery.status === 'failed' || item.delivery.status === 'retry_scheduled') && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-rose-50 p-5">
          <div><h5 className="font-black text-rose-950">Problema nella consegna email</h5><p className="mt-1 text-sm text-rose-900">La review è archiviata in modo sicuro. Non verrà rigenerata né duplicata.</p></div>
          <button type="button" onClick={() => onRetry(item.id)} disabled={busyAction !== null} className="rounded-xl bg-rose-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busyAction === item.id ? 'Verifica…' : 'Riprova consegna'}
          </button>
        </div>
      )}

      {item.weeklyInsights && (
        <div className="grid gap-4 lg:grid-cols-3">
          <InsightCard title="Pattern più forte" icon={<BarChart3 />} text={item.weeklyInsights.strongestPattern} tone="indigo" />
          <InsightCard title="Incertezza maggiore" icon={<AlertTriangle />} text={item.weeklyInsights.largestUncertainty} tone="amber" />
          <InsightCard title="Prossima settimana" icon={<Sparkles />} text={item.weeklyInsights.nextWeekExperiments.join(' ')} tone="emerald" />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {item.charts.map((chart) => <MiniChart key={chart.kind} chart={chart} locale={item.locale} />)}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-indigo-600" aria-hidden="true" />
          <div><h5 className="font-black text-slate-950">Qualità dei dati</h5><p className="mt-1 text-sm leading-6 text-slate-700">Copertura Sessioni: <strong>{coverageLabel(item.dataQuality.sessionsCoverage)}</strong>. Le Sessioni mancanti restano sconosciute e non vengono mai trattate come zero esecuzione.</p></div>
        </div>
      </div>
    </article>
  );
}

function InsightCard({ title, text, icon, tone }: { readonly title: string; readonly text: string; readonly icon: ReactElement; readonly tone: 'indigo' | 'amber' | 'emerald' }) {
  const styles = { indigo: 'border-indigo-100 bg-indigo-50 text-indigo-700', amber: 'border-amber-100 bg-amber-50 text-amber-800', emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800' }[tone];
  return <section className={`rounded-2xl border p-5 ${styles}`}><div className="flex items-center gap-2 [&>svg]:h-5 [&>svg]:w-5">{icon}<h5 className="font-black">{title}</h5></div><p className="mt-3 text-sm leading-6 text-slate-800" data-untrusted-content="true">{text}</p></section>;
}

function MiniChart({ chart, locale }: { readonly chart: ReportHistoryChart; readonly locale: string }) {
  const values = chart.points.flatMap((point) => point.values).filter((value): value is number => value !== null && value >= 0);
  const maximum = Math.max(1, ...values);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h5 className="font-black text-slate-950">{italianChartTitle(chart.kind, chart.title)}</h5>
      <div className="mt-5 flex h-44 items-end gap-2 overflow-hidden" role="img" aria-label={italianChartTitle(chart.kind, chart.title)}>
        {chart.points.slice(0, 12).map((point) => (
          <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-32 w-full items-end justify-center gap-1">
              {point.values.map((value, index) => (
                <div key={chart.series[index]?.key ?? index} className={index % 2 === 0 ? 'w-full max-w-5 rounded-t bg-indigo-500' : 'w-full max-w-5 rounded-t bg-cyan-400'} style={{ height: value === null ? 2 : `${Math.max(4, (Math.max(0, value) / maximum) * 100)}%` }} title={value === null ? 'Dato non disponibile' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} />
              ))}
            </div>
            <span className="max-w-full truncate text-[10px] font-semibold text-slate-500">{point.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-600">
        {chart.series.map((series, index) => <span key={series.key} className="inline-flex items-center gap-1.5"><i className={`h-2.5 w-2.5 rounded-sm ${index % 2 === 0 ? 'bg-indigo-500' : 'bg-cyan-400'}`} />{series.label}</span>)}
      </div>
    </section>
  );
}

function ArchiveCard({ item }: { readonly item: ReportHistoryItem }) {
  const metrics: readonly [string, ReportHistoryMetric][] = [
    ['Aderenza', item.metrics.adherencePercent],
    ['Blocchi', item.metrics.timeBlockCompletionPercent],
    ['Obiettivi', item.metrics.goalAlignmentIndex],
  ];
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wide text-indigo-600">{item.type === 'weekly' ? 'Settimanale' : 'Giornaliera'}</p><h5 className="mt-1 font-black text-slate-950">{formatPeriod(item)}</h5></div><DeliveryBadge status={item.delivery.status} /></div>
      <dl className="mt-4 grid grid-cols-3 gap-2">{metrics.map(([label, metric]) => <MetricCard key={label} label={label} metric={metric} locale={item.locale} />)}</dl>
      {item.metrics.actualMinutes.availability === 'unavailable' && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-950">Esecuzione reale sconosciuta: le Sessioni mancanti non sono interpretate come zero.</p>}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-indigo-700">Leggi il riepilogo deterministico</summary><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700" data-untrusted-content="true">{item.executiveSummary.map((line, index) => <li key={index}>{line}</li>)}</ul></details>
    </article>
  );
}

function MetricCard({ label, metric, locale }: { readonly label: string; readonly metric: ReportHistoryMetric; readonly locale: string }) {
  return <div className="rounded-xl bg-slate-50 p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-base font-black text-slate-950">{formatMetric(metric, locale)}</dd></div>;
}

function DeliveryBadge({ status, dark = false }: { readonly status: ReportHistoryDeliveryStatus; readonly dark?: boolean }) {
  const presentation: Record<ReportHistoryDeliveryStatus, readonly [string, string]> = {
    not_attempted: ['Non inviata', dark ? 'bg-white/10 text-indigo-100' : 'bg-slate-100 text-slate-700'],
    pending: ['Invio in corso', dark ? 'bg-cyan-300/20 text-cyan-100' : 'bg-blue-50 text-blue-800'],
    retry_scheduled: ['Nuovo tentativo', dark ? 'bg-amber-300/20 text-amber-100' : 'bg-amber-50 text-amber-900'],
    sent: ['Email accettata', dark ? 'bg-emerald-300/20 text-emerald-100' : 'bg-emerald-50 text-emerald-800'],
    failed: ['Consegna fallita', dark ? 'bg-rose-300/20 text-rose-100' : 'bg-rose-50 text-rose-800'],
    uncertain: ['Stato incerto', dark ? 'bg-amber-300/20 text-amber-100' : 'bg-amber-50 text-amber-900'],
  };
  const [label, className] = presentation[status];
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>{label}</span>;
}

function formatMetric(metric: ReportHistoryMetric, locale: string): string {
  if (metric.value === null) return 'Sconosciuto';
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metric.value);
  if (metric.unit === 'minutes') return `${value} min`;
  if (metric.unit === 'percent') return `${value}%`;
  if (metric.unit === 'index') return `${value}/100`;
  return value;
}

function formatPeriod(item: ReportHistoryItem): string {
  const start = formatLocalDate(item.period.localStartDate, item.locale);
  if (item.type === 'daily') return start;
  return `${start} – ${formatLocalDate(shiftLocalDate(item.period.localEndDate, -1), item.locale)}`;
}

function formatLocalDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatInstant(value: string, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(value));
}

function shiftLocalDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function coverageLabel(value: ReportHistoryItem['dataQuality']['sessionsCoverage']): string {
  return { complete: 'completa', truncated: 'parziale', unavailable: 'non disponibile' }[value];
}

function italianChartTitle(kind: ReportHistoryChart['kind'], fallback: string): string {
  return {
    planned_vs_actual_by_day: 'Pianificato vs eseguito',
    goal_allocation: 'Allocazione per obiettivo',
    completion_by_time_of_day: 'Esecuzione per fascia oraria',
    estimation_error: 'Errore di stima',
    adherence_trend: 'Andamento dell’aderenza',
    four_week_trend: 'Tendenza delle ultime quattro settimane',
  }[kind] ?? fallback;
}
