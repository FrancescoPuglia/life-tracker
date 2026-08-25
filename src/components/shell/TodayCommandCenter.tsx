'use client';

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Goal, Project, Session, Task, TimeBlock } from '@/types';
import type { StreakData } from '@/lib/streakCalculator';
import type { DesktopNativeStatus } from '@/lib/desktop/nativeBridge';
import type { EditableNotificationPreferences } from '@/lib/notifications/preferences';
import {
  computeTodayExecutionMetrics,
  type TodaySessionCoverage,
} from '@/lib/todayExecution';

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
  const topTasks = useMemo(() => pickTopTasks(tasks), [tasks]);
  const goalsView = useMemo(() => summarizeGoals(goals), [goals]);

  return (
    <section
      className="space-y-6"
      data-testid="today-command-center"
      aria-label="Today Command Center"
    >
      <Hero
        active={todayMetrics.active}
        next={todayMetrics.next}
        currentSessionStatus={currentSessionStatus}
        sessionCoverage={sessionCoverage}
        onOpenAskAI={onOpenAskAI}
        onStartFocus={onStartFocus}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <TodayMissionCard topTasks={topTasks} onOpenTab={onOpenTab} />
        <ExecutionPulseCard
          metrics={todayMetrics}
          streak={streakData.currentStreak}
          bestStreak={streakData.bestStreak}
        />
        <StrategicGoalsCard goals={goalsView} onOpenTab={onOpenTab} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <UpcomingCommitmentsCard
          blocks={todayMetrics.upcoming.slice(0, 3)}
          locale={locale}
          timezone={timezone}
          onOpenTab={onOpenTab}
        />
        <ReminderStatusCard
          preferences={reminderPreferences}
          preferenceStatus={preferenceStatus}
          nativeStatus={nativeStatus}
          onOpenSettings={() => onOpenTab('settings')}
        />
        <QuickCaptureCard onCapture={onQuickCapture} onOpenNotes={() => onOpenTab('notes')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ExecutionSnapshot
          plannedMinutes={todayMetrics.plannedMinutes}
          actualMinutes={todayMetrics.actualMinutes}
          actualAvailability={todayMetrics.actualAvailability}
          onOpenTab={onOpenTab}
        />
        <QuickActions
          onOpenTab={onOpenTab}
          onOpenAskAI={onOpenAskAI}
          projectsCount={projects.filter((project) => !project.deleted).length}
          goalsCount={goals.filter((goal) => !goal.deleted).length}
        />
      </div>
    </section>
  );
}

function Hero({
  active,
  next,
  currentSessionStatus,
  sessionCoverage,
  onOpenAskAI,
  onStartFocus,
}: {
  active: TimeBlock | undefined;
  next: TimeBlock | undefined;
  currentSessionStatus: Session['status'] | null;
  sessionCoverage: TodaySessionCoverage;
  onOpenAskAI: () => void;
  onStartFocus: (taskId?: string, timeBlockId?: string) => void;
}) {
  const sessionActive = currentSessionStatus === 'active';
  const sessionPaused = currentSessionStatus === 'paused';
  const sessionAuthorityReady = sessionCoverage === 'ready' || sessionPaused;
  let startLabel = active ? 'Start current block' : 'Start unplanned session';
  if (sessionPaused) startLabel = 'Resume session';
  if (!sessionAuthorityReady) {
    startLabel = sessionCoverage === 'loading' ? 'Checking Sessions' : 'Sessions unavailable';
  }
  if (sessionActive) startLabel = 'Session active';
  return (
    <header
      data-testid="today-hero"
      className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 px-6 py-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Today</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">What matters now</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Your current block, tracked execution, reminders, and next commitments in one place.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <StatusLine
            label="Active"
            value={active?.title ?? 'No active block'}
            tone={active ? 'emerald' : 'neutral'}
          />
          <StatusLine
            label="Next"
            value={next?.title ?? 'No upcoming block'}
            tone={next ? 'blue' : 'neutral'}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onOpenAskAI}
              data-testid="today-ask-ai"
              className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              Ask AI
            </button>
            <button
              type="button"
              onClick={() => onStartFocus(
                sessionPaused ? undefined : active?.taskId,
                sessionPaused ? undefined : active?.id,
              )}
              disabled={sessionActive || !sessionAuthorityReady}
              data-testid="today-start-focus"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-emerald-700 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              ▶ {startLabel}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatusLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'blue' | 'neutral';
}) {
  const cls = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'blue'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-gray-200 bg-gray-50 text-gray-600';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span className="max-w-[220px] truncate font-semibold">{value}</span>
    </span>
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
    <Card title="Today Mission" subtitle="Top 3 priorities">
      {topTasks.length === 0 ? (
        <EmptyHint
          message="No prioritized tasks are open."
          ctaLabel="Open Goals & Projects"
          onCta={() => onOpenTab('okr')}
        />
      ) : (
        <ul className="space-y-1.5">
          {topTasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs"
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
      {priority}
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
    <Card title="Execution Pulse" subtitle="Persisted evidence only">
      <div className="space-y-2 text-xs" data-testid="today-execution-pulse">
        <Row label="Planned today" value={minutesLabel(metrics.plannedMinutes)} />
        <Row
          label={complete ? 'Tracked actual' : 'Known actual'}
          value={metrics.actualMinutes === null ? 'Unavailable' : minutesLabel(metrics.actualMinutes)}
        />
        <Row
          label="Adherence"
          value={metrics.adherencePct === null ? '—' : `${Math.round(metrics.adherencePct)}%`}
          highlight
        />
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-blue-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p
          className={complete ? 'text-[11px] text-emerald-700' : 'text-[11px] text-amber-700'}
          data-testid="today-execution-quality"
        >
          {qualityMessage}
        </p>
        <Row label="Streak" value={`${streak} days · best ${bestStreak}`} />
      </div>
    </Card>
  );
}

function executionQualityMessage(
  metrics: ReturnType<typeof computeTodayExecutionMetrics>,
): string {
  if (metrics.actualAvailability === 'loading') return 'Loading persisted Sessions…';
  if (metrics.actualAvailability === 'unavailable') {
    return 'Session data is unavailable; execution is not reported as zero.';
  }
  if (metrics.actualAvailability === 'complete') {
    return 'Actual time comes from completed Sessions or explicit actual intervals.';
  }
  const issues: string[] = [];
  if (metrics.blocksMissingActualCount > 0) {
    issues.push(`${metrics.blocksMissingActualCount} executed block${metrics.blocksMissingActualCount === 1 ? '' : 's'} missing actual evidence`);
  }
  if (metrics.openSessionCount > 0) {
    issues.push(`${metrics.openSessionCount} open Session${metrics.openSessionCount === 1 ? '' : 's'} excluded`);
  }
  if (metrics.invalidActualSourceCount > 0) {
    issues.push(`${metrics.invalidActualSourceCount} invalid actual source${metrics.invalidActualSourceCount === 1 ? '' : 's'} excluded`);
  }
  if (metrics.invalidPlannedBlockCount > 0) {
    issues.push(`${metrics.invalidPlannedBlockCount} invalid planned block${metrics.invalidPlannedBlockCount === 1 ? '' : 's'} excluded`);
  }
  return `Partial data: ${issues.join('; ')}.`;
}

function StrategicGoalsCard({
  goals,
  onOpenTab,
}: {
  goals: GoalsView;
  onOpenTab: (tabId: string) => void;
}) {
  return (
    <Card title="Strategic Goals" subtitle="Top active focus">
      {goals.active.length === 0 ? (
        <EmptyHint
          message="No active goals yet."
          ctaLabel="Open Goal Architect"
          onCta={() => onOpenTab('goal_architect')}
        />
      ) : (
        <>
          <ul className="space-y-1.5">
            {goals.active.slice(0, 3).map((goal) => (
              <li
                key={goal.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs"
              >
                <span className="truncate font-medium text-gray-800">{goal.title}</span>
                <PriorityChip priority={goal.priority} />
              </li>
            ))}
          </ul>
          {goals.atRiskCount > 0 && (
            <p className="mt-2 text-[11px] text-amber-700" data-testid="today-at-risk">
              ⚠ {goals.atRiskCount} goal{goals.atRiskCount === 1 ? '' : 's'} at risk
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
    <Card title="Upcoming Commitments" subtitle="Next three today">
      {blocks.length === 0 ? (
        <EmptyHint
          message="No more commitments today."
          ctaLabel="Open Time Planner"
          onCta={() => onOpenTab('planner')}
        />
      ) : (
        <ul className="space-y-2" data-testid="today-upcoming-commitments">
          {blocks.map((block) => (
            <li key={block.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs">
              <p className="truncate font-semibold text-slate-800">{block.title}</p>
              <p className="mt-0.5 text-slate-500">
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
    ? 'loading'
    : preferenceStatus === 'error'
      ? 'unavailable'
      : !preferences.desktopEnabled
        ? 'disabled'
        : nativeStatus.notificationPermission === 'granted'
          ? 'ready'
          : `permission ${nativeStatus.notificationPermission}`;
  return (
    <Card title="Reminder State" subtitle="Policy and native permission">
      <div className="space-y-2 text-xs" data-testid="today-reminder-state">
        <Row label="Desktop" value={desktopState} highlight={desktopState === 'ready'} />
        <Row
          label="Before block"
          value={preferences.reminderOffsetsMinutes.map((minutes) => `${minutes}m`).join(', ')}
        />
        <Row label="At start" value={preferences.atStartEnabled ? 'enabled' : 'disabled'} />
        <Row
          label="Missed start"
          value={preferences.missedStart.enabled
            ? `after ${preferences.missedStart.afterMinutes}m`
            : 'disabled'}
        />
        <Row
          label="Quiet hours"
          value={preferences.quietHours.enabled
            ? `${preferences.quietHours.start}–${preferences.quietHours.end}`
            : 'disabled'}
        />
        <div className="flex flex-wrap gap-1 pt-1 text-[10px]">
          <ChannelChip label="WhatsApp" enabled={preferences.whatsappEnabled} />
          <ChannelChip label="Email" enabled={preferences.emailEnabled} />
          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
            {preferences.timezone}
          </span>
        </div>
        {preferenceStatus === 'error' && (
          <p className="text-[11px] text-amber-700">
            Preferences could not be read; shown values are fallback only.
          </p>
        )}
        <button
          type="button"
          onClick={onOpenSettings}
          className="pt-1 text-xs font-medium text-blue-700 hover:text-blue-900"
        >
          Open reminder settings →
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
    <Card title="Quick Capture" subtitle="Save an untrusted note, never an instruction">
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="today-quick-capture" className="sr-only">Quick capture note</label>
        <textarea
          id="today-quick-capture"
          aria-label="Quick capture note"
          value={text}
          maxLength={1_000}
          rows={3}
          onChange={(event) => {
            setText(event.target.value);
            if (status !== 'saving') setStatus('idle');
          }}
          placeholder="Capture a thought or commitment…"
          className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-blue-400 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onOpenNotes}
            className="text-xs font-medium text-blue-700 hover:text-blue-900"
          >
            Open notes
          </button>
          <button
            type="submit"
            disabled={!text.trim() || status === 'saving'}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'saving' ? 'Saving…' : 'Capture'}
          </button>
        </div>
        {status === 'saved' && <p role="status" className="text-[11px] text-emerald-700">Captured in Notes.</p>}
        {status === 'error' && (
          <p role="alert" className="text-[11px] text-rose-700">
            Capture failed safely. Tracking data was not changed.
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
    <Card title="Execution Snapshot" subtitle="Today, before the scientific report">
      <div className="space-y-2 text-xs">
        <Row label="Planned" value={minutesLabel(plannedMinutes)} />
        <Row
          label={actualAvailability === 'complete' ? 'Tracked actual' : 'Known actual'}
          value={actualMinutes === null ? 'Unavailable' : minutesLabel(actualMinutes)}
          highlight
        />
        <button
          type="button"
          onClick={() => onOpenTab('reports')}
          className="mt-1 inline-flex items-center gap-2 text-xs font-medium text-blue-700 hover:text-blue-900"
          data-testid="today-open-reports"
        >
          Open scientific reports →
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
    <Card title="Quick Actions" subtitle="Jump to what you need">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="today-quick-actions">
        <ActionTile icon="✨" label="Ask AI" subtitle="Secure assistant" onClick={onOpenAskAI} />
        <ActionTile icon="🏗️" label="Create Goal" subtitle="Goal Architect" onClick={() => onOpenTab('goal_architect')} />
        <ActionTile icon="🧭" label="Plan Week" subtitle="Weekly Intelligence" onClick={() => onOpenTab('weekly_intel')} />
        <ActionTile icon="📅" label="Time Planner" subtitle="Add a TimeBlock" onClick={() => onOpenTab('planner')} />
        <ActionTile icon="📈" label="Review Week" subtitle="Weekly Execution" onClick={() => onOpenTab('weekly')} />
        <ActionTile icon="⚙️" label="Settings" subtitle="Reminders and reports" onClick={() => onOpenTab('settings')} />
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        {goalsCount} goal{goalsCount === 1 ? '' : 's'} · {projectsCount} project{projectsCount === 1 ? '' : 's'}.
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
  icon: string;
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
        <span>{icon}</span>
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
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p>}
      </header>
      <div className="px-4 py-3">{children}</div>
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
    <div className="text-xs text-gray-500">
      <p>{message}</p>
      <button
        type="button"
        onClick={onCta}
        className="mt-1.5 inline-flex items-center gap-1 font-medium text-blue-700 hover:text-blue-900"
      >
        {ctaLabel} →
      </button>
    </div>
  );
}

function pickTopTasks(tasks: ReadonlyArray<Task>): Task[] {
  const weights: Record<NonNullable<Task['priority']>, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return tasks
    .filter((task) => !task.deleted && task.status !== 'completed' && task.status !== 'cancelled')
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
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function minutesLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}
