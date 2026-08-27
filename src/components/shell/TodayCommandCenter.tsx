'use client';

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { BarChart3, Brain, CalendarDays, Play, Settings, Sparkles, Target } from 'lucide-react';
import type { Goal, Project, Session, Task, TimeBlock } from '@/types';
import type { StreakData } from '@/lib/streakCalculator';
import type { DesktopNativeStatus } from '@/lib/desktop/nativeBridge';
import type { EditableNotificationPreferences } from '@/lib/notifications/preferences';
import {
  computeTodayExecutionMetrics,
  type TodaySessionCoverage,
} from '@/lib/todayExecution';
import { isTaskOperationallyCurrent } from '@/lib/currentOperationalState';

type PreferenceStatus = 'loading' | 'ready' | 'error';

export interface TodayCommandCenterProps {
  /** Fixed clock for tests. Without it, the view refreshes every 30 seconds. */
  now?: Date;
  ownerUid: string;
  timezone: string;
  locale: string;
  preferenceStatus: PreferenceStatus;
  reminderPreferences: EditableNotificationPreferences;
  nativeStatus: DesktopNativeStatus;
  timeBlocks: ReadonlyArray<TimeBlock>;
  sessions: ReadonlyArray<Session>;
  sessionCoverage: TodaySessionCoverage;
  currentSessionStatus?: Session['status'] | null;
  tasks: ReadonlyArray<Task>;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
  streakData: StreakData;
  onOpenTab: (tabId: string) => void;
  onOpenAskAI: () => void;
  onStartFocus: (taskId?: string, timeBlockId?: string) => void;
  onQuickCapture: (text: string) => Promise<void>;
}

export default function TodayCommandCenter({
  now,
  ownerUid,
  timezone,
  locale,
  preferenceStatus,
  reminderPreferences,
  nativeStatus,
  timeBlocks,
  sessions,
  sessionCoverage,
  currentSessionStatus = null,
  tasks,
  goals,
  projects,
  streakData,
  onOpenTab,
  onOpenAskAI,
  onStartFocus,
  onQuickCapture,
}: TodayCommandCenterProps) {
  const [liveNow, setLiveNow] = useState(() => new Date());
  useEffect(() => {
    if (now) return undefined;
    const interval = window.setInterval(() => setLiveNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, [now]);
  const effectiveNow = now ?? liveNow;
  const todayMetrics = useMemo(
    () => computeTodayExecutionMetrics({
      now: effectiveNow,
      ownerUid,
      timezone,
      timeBlocks,
      sessions,
      sessionCoverage,
    }),
    [effectiveNow, ownerUid, sessionCoverage, sessions, timeBlocks, timezone],
  );
  const topTasks = useMemo(
    () => pickTopTasks(tasks, ownerUid, goals, projects),
    [goals, ownerUid, projects, tasks],
  );
  const goalsView = useMemo(() => summarizeGoals(goals), [goals]);

  return (
    <section
      className="space-y-4"
      data-testid="today-command-center"
      aria-label="Centro di comando di oggi"
    >
      <DayIntro
        now={effectiveNow}
        locale={locale}
        timezone={timezone}
        plannedMinutes={todayMetrics.plannedMinutes}
        actualMinutes={todayMetrics.actualMinutes}
        adherencePct={todayMetrics.adherencePct}
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Hero
            now={effectiveNow}
            active={todayMetrics.active}
            currentSessionStatus={currentSessionStatus}
            sessionCoverage={sessionCoverage}
            locale={locale}
            timezone={timezone}
            onOpenAskAI={onOpenAskAI}
            onStartFocus={onStartFocus}
          />
        </div>
        <div className="xl:col-span-4">
          <UpcomingCommitmentsCard
            blocks={todayMetrics.upcoming.slice(0, 3)}
            locale={locale}
            timezone={timezone}
            onOpenTab={onOpenTab}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ExecutionPulseCard
          metrics={todayMetrics}
          streak={streakData.currentStreak}
          bestStreak={streakData.bestStreak}
        />
        <TodayMissionCard topTasks={topTasks} onOpenTab={onOpenTab} />
        <StrategicGoalsCard goals={goalsView} onOpenTab={onOpenTab} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QuickCaptureCard onCapture={onQuickCapture} onOpenNotes={() => onOpenTab('notes')} />
        </div>
        <ReminderStatusCard
          preferences={reminderPreferences}
          preferenceStatus={preferenceStatus}
          nativeStatus={nativeStatus}
          onOpenSettings={() => onOpenTab('settings')}
        />
      </div>
    </section>
  );
}

function DayIntro({
  now,
  locale,
  timezone,
  plannedMinutes,
  actualMinutes,
  adherencePct,
}: {
  now: Date;
  locale: string;
  timezone: string;
  plannedMinutes: number;
  actualMinutes: number | null;
  adherencePct: number | null;
}) {
  const hour = Number(new Intl.DateTimeFormat('it-IT', { timeZone: timezone, hour: '2-digit', hour12: false }).format(now));
  const greeting = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-700">Precision Performance OS</p>
        <h1 className="mt-1 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-slate-950">{greeting}</h1>
        <p className="mt-1 text-sm capitalize text-slate-500">{formatDateLabel(now, locale, timezone)}</p>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/80 px-1 py-2">
        <Metric label="Pianificato" value={minutesLabel(plannedMinutes)} />
        <Metric label="Eseguito" value={actualMinutes === null ? '—' : minutesLabel(actualMinutes)} />
        <Metric label="Aderenza" value={adherencePct === null ? '—' : `${Math.round(adherencePct)}%`} emphasis />
      </dl>
    </header>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-[108px] px-4 text-right">
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${emphasis ? 'text-indigo-700' : 'text-slate-900'}`}>{value}</dd>
    </div>
  );
}

function Hero({
  now,
  active,
  currentSessionStatus,
  sessionCoverage,
  locale,
  timezone,
  onOpenAskAI,
  onStartFocus,
}: {
  now: Date;
  active: TimeBlock | undefined;
  currentSessionStatus: Session['status'] | null;
  sessionCoverage: TodaySessionCoverage;
  locale: string;
  timezone: string;
  onOpenAskAI: () => void;
  onStartFocus: (taskId?: string, timeBlockId?: string) => void;
}) {
  const sessionActive = currentSessionStatus === 'active';
  const sessionPaused = currentSessionStatus === 'paused';
  const sessionAuthorityReady = sessionCoverage === 'ready' || sessionPaused;
  let startLabel = active ? 'Avvia blocco' : 'Avvia sessione libera';
  if (sessionPaused) startLabel = 'Riprendi sessione';
  if (!sessionAuthorityReady) {
    startLabel = sessionCoverage === 'loading' ? 'Verifica sessioni…' : 'Sessioni non disponibili';
  }
  if (sessionActive) startLabel = 'Sessione attiva';
  const progress = active ? progressWithin(active, now) : 0;
  return (
    <header
      data-testid="today-hero"
      className="flex h-full min-h-[278px] flex-col justify-between overflow-hidden rounded-[16px] border border-slate-900 bg-slate-950 px-6 py-6 text-white shadow-lg"
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Ora</p>
          <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${active ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-cyan-300' : 'bg-slate-500'}`} aria-hidden="true" />
            {active ? 'Blocco attuale' : 'Spazio disponibile'}
          </span>
        </div>
        <h2 className="mt-5 max-w-3xl text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-white">
          {active?.title ?? 'Scegli il prossimo risultato da produrre'}
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {active
            ? `${formatTime(active.startTime, locale, timezone)}–${formatTime(active.endTime, locale, timezone)}`
            : 'Nessun TimeBlock è attivo in questo momento.'}
        </p>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-800" aria-label={`Avanzamento blocco ${progress}%`}>
          <div className="h-full rounded-full bg-cyan-400 transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {sessionActive ? 'Il tempo effettivo viene misurato dalla Sessione attiva.' : 'Avvia una Sessione per misurare l’esecuzione reale.'}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onOpenAskAI}
              data-testid="today-ask-ai"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-[10px] border border-slate-700 bg-slate-900 px-4 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-600 hover:bg-slate-800"
            >
              <Brain size={16} aria-hidden="true" /> Chiedi all’AI
            </button>
            <button
              type="button"
              onClick={() => onStartFocus(
                sessionPaused ? undefined : active?.taskId,
                sessionPaused ? undefined : active?.id,
              )}
              disabled={sessionActive || !sessionAuthorityReady}
              data-testid="today-start-focus"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-[10px] bg-indigo-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Play size={16} fill="currentColor" aria-hidden="true" /> {startLabel}
            </button>
        </div>
      </div>
    </header>
  );
}

function TodayMissionCard({
  topTasks,
  onOpenTab,
}: {
  topTasks: ReadonlyArray<Task>;
  onOpenTab: (tabId: string) => void;
}) {
  return (
    <Card title="Priorità di oggi" subtitle="Massimo tre risultati da proteggere">
      {topTasks.length === 0 ? (
        <EmptyHint
          message="Non ci sono attività prioritarie aperte."
          ctaLabel="Apri Obiettivi e progetti"
          onCta={() => onOpenTab('okr')}
        />
      ) : (
        <ul className="space-y-1.5">
          {topTasks.map((task) => (
            <li
              key={task.id}
              className="flex min-h-[42px] items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm"
            >
              <span className="truncate font-medium text-gray-800">{task.title}</span>
              <PriorityChip priority={task.priority} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PriorityChip({ priority }: { priority: Task['priority'] | undefined }) {
  if (!priority) return null;
  const cls = priority === 'critical'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : priority === 'high'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : priority === 'medium'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {priority === 'critical' ? 'critica' : priority === 'high' ? 'alta' : priority === 'medium' ? 'media' : 'bassa'}
    </span>
  );
}

function ExecutionPulseCard({
  metrics,
  streak,
  bestStreak,
}: {
  metrics: ReturnType<typeof computeTodayExecutionMetrics>;
  streak: number;
  bestStreak: number;
}) {
  const complete = metrics.actualAvailability === 'complete';
  const qualityMessage = executionQualityMessage(metrics);
  const progress = metrics.adherencePct === null
    ? 0
    : Math.min(100, Math.max(0, Math.round(metrics.adherencePct)));
  return (
    <Card title="Ritmo di esecuzione" subtitle="Solo evidenza persistita">
      <div className="space-y-2.5 text-sm" data-testid="today-execution-pulse">
        <Row label="Pianificato oggi" value={minutesLabel(metrics.plannedMinutes)} />
        <Row
          label={complete ? 'Effettivo misurato' : 'Effettivo noto'}
          value={metrics.actualMinutes === null ? 'Non disponibile' : minutesLabel(metrics.actualMinutes)}
        />
        <Row
          label="Aderenza"
          value={metrics.adherencePct === null ? '—' : `${Math.round(metrics.adherencePct)}%`}
          highlight
        />
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
          <div
            className="h-full bg-cyan-600"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p
          className={complete ? 'text-xs leading-5 text-emerald-700' : 'text-xs leading-5 text-amber-700'}
          data-testid="today-execution-quality"
        >
          {qualityMessage}
        </p>
        <Row label="Continuità" value={`${streak} giorni · record ${bestStreak}`} />
      </div>
    </Card>
  );
}

function executionQualityMessage(
  metrics: ReturnType<typeof computeTodayExecutionMetrics>,
): string {
  if (metrics.actualAvailability === 'loading') return 'Caricamento delle Sessioni persistite…';
  if (metrics.actualAvailability === 'unavailable') {
    return 'Le Sessioni non sono disponibili: l’esecuzione non viene indicata come zero.';
  }
  if (metrics.actualAvailability === 'complete') {
    return 'Il tempo effettivo proviene da Sessioni concluse o intervalli espliciti.';
  }
  const issues: string[] = [];
  if (metrics.blocksMissingActualCount > 0) {
    issues.push(metrics.blocksMissingActualCount === 1
      ? '1 blocco eseguito senza evidenza effettiva'
      : `${metrics.blocksMissingActualCount} blocchi eseguiti senza evidenza effettiva`);
  }
  if (metrics.openSessionCount > 0) {
    issues.push(`${metrics.openSessionCount} Sessioni aperte escluse`);
  }
  if (metrics.invalidActualSourceCount > 0) {
    issues.push(`${metrics.invalidActualSourceCount} fonti effettive non valide escluse`);
  }
  if (metrics.invalidPlannedBlockCount > 0) {
    issues.push(`${metrics.invalidPlannedBlockCount} blocchi pianificati non validi esclusi`);
  }
  return `Dati parziali: ${issues.join('; ')}.`;
}

function StrategicGoalsCard({
  goals,
  onOpenTab,
}: {
  goals: GoalsView;
  onOpenTab: (tabId: string) => void;
}) {
  return (
    <Card title="Rischio e direzione" subtitle="Focus strategico attivo">
      {goals.active.length === 0 ? (
        <EmptyHint
          message="Nessun obiettivo attivo."
          ctaLabel="Apri Goal Architect"
          onCta={() => onOpenTab('goal_architect')}
        />
      ) : (
        <>
          <ul className="space-y-1.5">
            {goals.active.slice(0, 3).map((goal) => (
              <li
                key={goal.id}
                className="flex min-h-[42px] items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm"
              >
                <span className="truncate font-medium text-gray-800">{goal.title}</span>
                <PriorityChip priority={goal.priority} />
              </li>
            ))}
          </ul>
          {goals.atRiskCount > 0 && (
            <p className="mt-2 text-[11px] text-amber-700" data-testid="today-at-risk">
              {goals.atRiskCount} obiettiv{goals.atRiskCount === 1 ? 'o' : 'i'} a rischio: verifica il piano.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function UpcomingCommitmentsCard({
  blocks,
  locale,
  timezone,
  onOpenTab,
}: {
  blocks: readonly TimeBlock[];
  locale: string;
  timezone: string;
  onOpenTab: (tabId: string) => void;
}) {
  return (
    <Card title="Prossimi impegni" subtitle="I prossimi tre di oggi">
      {blocks.length === 0 ? (
        <EmptyHint
          message="Nessun altro impegno pianificato oggi."
          ctaLabel="Apri Time Planner"
          onCta={() => onOpenTab('planner')}
        />
      ) : (
        <ul className="space-y-2" data-testid="today-upcoming-commitments">
          {blocks.map((block) => (
            <li key={block.id} className="relative rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 pl-4 text-sm before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-cyan-500">
              <p className="truncate font-semibold text-slate-800">{block.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatTime(block.startTime, locale, timezone)}–{formatTime(block.endTime, locale, timezone)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReminderStatusCard({
  preferences,
  preferenceStatus,
  nativeStatus,
  onOpenSettings,
}: {
  preferences: EditableNotificationPreferences;
  preferenceStatus: PreferenceStatus;
  nativeStatus: DesktopNativeStatus;
  onOpenSettings: () => void;
}) {
  const desktopState = preferenceStatus === 'loading'
    ? 'caricamento'
    : preferenceStatus === 'error'
      ? 'non disponibile'
      : !preferences.desktopEnabled
        ? 'disattivato'
        : nativeStatus.notificationPermission === 'granted'
          ? 'attivo'
          : `permesso ${nativeStatus.notificationPermission}`;
  return (
    <Card title="Promemoria" subtitle="Stato operativo essenziale">
      <div className="space-y-2.5 text-sm" data-testid="today-reminder-state">
        <Row label="Desktop" value={desktopState} highlight={desktopState === 'attivo'} />
        <Row
          label="Prima del blocco"
          value={preferences.reminderOffsetsMinutes.map((minutes) => `${minutes}m`).join(', ')}
        />
        <Row
          label="Ore silenziose"
          value={preferences.quietHours.enabled
            ? `${preferences.quietHours.start}–${preferences.quietHours.end}`
            : 'disattivate'}
        />
        <div className="flex flex-wrap gap-1 pt-1 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
            {preferences.timezone}
          </span>
        </div>
        {preferenceStatus === 'error' && (
          <p className="text-[11px] text-amber-700">
            Preferenze non leggibili; i valori mostrati sono solo di sicurezza.
          </p>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          className="pt-1 text-sm font-medium text-indigo-700 hover:text-indigo-900"
        >
          Apri impostazioni →
        </button>
      </div>
    </Card>
  );
}

function ChannelChip({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={enabled
      ? 'rounded-full bg-emerald-50 px-2 py-1 text-emerald-700'
      : 'rounded-full bg-slate-100 px-2 py-1 text-slate-500'}>
      {label} {enabled ? 'on' : 'off'}
    </span>
  );
}

function QuickCaptureCard({
  onCapture,
  onOpenNotes,
}: {
  onCapture: (text: string) => Promise<void>;
  onOpenNotes: () => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim() || status === 'saving') return;
    setStatus('saving');
    try {
      await onCapture(text);
      setText('');
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };
  return (
    <Card title="Cattura rapida" subtitle="Salva un pensiero senza interrompere il flusso">
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="today-quick-capture" className="sr-only">Nota rapida</label>
        <textarea
          id="today-quick-capture"
          aria-label="Nota rapida"
          value={text}
          maxLength={1_000}
          rows={3}
          onChange={(event) => {
            setText(event.target.value);
            if (status !== 'saving') setStatus('idle');
          }}
          placeholder="Annota un pensiero, un impegno o un’idea…"
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 focus:border-indigo-400 focus:bg-white focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenNotes}
            className="text-xs font-medium text-blue-700 hover:text-blue-900"
          >
            Apri note
          </button>
          <button
            type="submit"
            disabled={!text.trim() || status === 'saving'}
            className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'saving' ? 'Salvataggio…' : 'Salva nota'}
          </button>
        </div>
        {status === 'saved' && <p role="status" className="text-xs text-emerald-700">Nota salvata nel Second Brain.</p>}
        {status === 'error' && (
          <p role="alert" className="text-[11px] text-rose-700">
            Salvataggio non riuscito. I dati di tracking restano invariati.
          </p>
        )}
      </form>
    </Card>
  );
}

function ExecutionSnapshot({
  plannedMinutes,
  actualMinutes,
  actualAvailability,
  onOpenTab,
}: {
  plannedMinutes: number;
  actualMinutes: number | null;
  actualAvailability: ReturnType<typeof computeTodayExecutionMetrics>['actualAvailability'];
  onOpenTab: (tabId: string) => void;
}) {
  return (
    <Card title="Snapshot di esecuzione" subtitle="Oggi, prima della review scientifica">
      <div className="space-y-2 text-xs">
        <Row label="Pianificato" value={minutesLabel(plannedMinutes)} />
        <Row
          label={actualAvailability === 'complete' ? 'Eseguito tracciato' : 'Eseguito noto'}
          value={actualMinutes === null ? 'Non disponibile' : minutesLabel(actualMinutes)}
          highlight
        />
        <button
          type="button"
          onClick={() => onOpenTab('reports')}
          className="mt-1 inline-flex items-center gap-2 text-xs font-medium text-blue-700 hover:text-blue-900"
          data-testid="today-open-reports"
        >
          Apri le review scientifiche →
        </button>
      </div>
    </Card>
  );
}

function QuickActions({
  onOpenTab,
  onOpenAskAI,
  projectsCount,
  goalsCount,
}: {
  onOpenTab: (tabId: string) => void;
  onOpenAskAI: () => void;
  projectsCount: number;
  goalsCount: number;
}) {
  return (
    <Card title="Azioni rapide" subtitle="Vai subito a ciò che serve">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="today-quick-actions">
        <ActionTile icon={<Sparkles size={17} />} label="Chiedi all’AI" subtitle="Assistente sicuro" onClick={onOpenAskAI} />
        <ActionTile icon={<Target size={17} />} label="Crea obiettivo" subtitle="Architetto obiettivi" onClick={() => onOpenTab('goal_architect')} />
        <ActionTile icon={<CalendarDays size={17} />} label="Pianifica settimana" subtitle="Intelligenza settimanale" onClick={() => onOpenTab('weekly_intel')} />
        <ActionTile icon={<CalendarDays size={17} />} label="Pianificazione" subtitle="Aggiungi un TimeBlock" onClick={() => onOpenTab('planner')} />
        <ActionTile icon={<BarChart3 size={17} />} label="Rivedi settimana" subtitle="Esecuzione settimanale" onClick={() => onOpenTab('weekly')} />
        <ActionTile icon={<Settings size={17} />} label="Impostazioni" subtitle="Avvisi e review" onClick={() => onOpenTab('settings')} />
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        {goalsCount} obiettiv{goalsCount === 1 ? 'o' : 'i'} · {projectsCount} progett{projectsCount === 1 ? 'o' : 'i'}.
      </p>
    </Card>
  );
}

function ActionTile({
  icon,
  label,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <span className="text-indigo-600" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p>
    </button>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <article className="h-full overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3.5">
        <h3 className="text-[15px] font-semibold leading-5 text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs leading-4 text-slate-500">{subtitle}</p>}
      </header>
      <div className="px-4 py-4">{children}</div>
    </article>
  );
}

function Row({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={highlight
        ? 'text-right font-semibold tabular-nums text-gray-900'
        : 'text-right tabular-nums text-gray-700'}>
        {value}
      </span>
    </div>
  );
}

function EmptyHint({
  message,
  ctaLabel,
  onCta,
}: {
  message: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="text-sm leading-5 text-slate-500">
      <p>{message}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-2 inline-flex min-h-[32px] items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
      >
        {ctaLabel} →
      </button>
    </div>
  );
}

function pickTopTasks(
  tasks: ReadonlyArray<Task>,
  ownerUid: string,
  goals: ReadonlyArray<Goal>,
  projects: ReadonlyArray<Project>,
): Task[] {
  const weights: Record<NonNullable<Task['priority']>, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return tasks
    .filter((task) => (
      task.status !== 'completed'
      && task.status !== 'cancelled'
      && isTaskOperationallyCurrent(task, ownerUid, goals, projects)
    ))
    .slice()
    .sort((left, right) => weights[right.priority] - weights[left.priority])
    .slice(0, 3);
}

interface GoalsView {
  readonly active: ReadonlyArray<Goal>;
  readonly atRiskCount: number;
}

function summarizeGoals(goals: ReadonlyArray<Goal>): GoalsView {
  const live = goals.filter((goal) => !goal.deleted);
  return {
    active: live.filter((goal) => goal.status === 'active'),
    atRiskCount: live.filter((goal) => goal.status === 'at_risk').length,
  };
}

function formatTime(date: Date, locale: string, timezone: string): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '—';
  }
}

function formatDateLabel(date: Date, locale: string, timezone: string): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return 'Data non disponibile';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return 'Data non disponibile';
  }
}

function progressWithin(block: TimeBlock, now: Date): number {
  const start = block.startTime instanceof Date ? block.startTime.getTime() : Number.NaN;
  const end = block.endTime instanceof Date ? block.endTime.getTime() : Number.NaN;
  const current = now.getTime();
  if (![start, end, current].every(Number.isFinite) || end <= start) return 0;
  return Math.round(Math.min(100, Math.max(0, ((current - start) / (end - start)) * 100)));
}

function minutesLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}
