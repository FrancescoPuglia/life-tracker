'use client';

// src/components/shell/TodayCommandCenter.tsx
// Minimal "Today" dashboard composed exclusively from data already loaded
// by the DataProvider — no new fetches, no new persistence, no new logic.
//
// Sections:
//   1. Today Mission        — active / next block, top 3 tasks, focus CTA
//   2. Execution Pulse      — planned vs completed minutes, streak
//   3. Strategic Goals      — top active goals, at-risk count
//   4. Weekly Intelligence  — quick link with planned vs completed minutes
//   5. Quick Actions        — Goal Architect / Weekly / Add Block / Time Planner

import { useMemo, type ReactNode } from 'react';
import type { Goal, Project, Task, TimeBlock } from '@/types';
import type { StreakData } from '@/lib/streakCalculator';

export interface TodayCommandCenterProps {
  /** Real-time clock to keep "active block" math testable. Defaults to `new Date()`. */
  now?: Date;
  timeBlocks: ReadonlyArray<TimeBlock>;
  tasks: ReadonlyArray<Task>;
  goals: ReadonlyArray<Goal>;
  projects: ReadonlyArray<Project>;
  streakData: StreakData;
  onOpenTab: (tabId: string) => void;
  onStartFocus?: () => void;
}

export default function TodayCommandCenter({
  now = new Date(),
  timeBlocks,
  tasks,
  goals,
  projects,
  streakData,
  onOpenTab,
  onStartFocus,
}: TodayCommandCenterProps) {
  const todayMetrics = useMemo(
    () => computeTodayMetrics(now, timeBlocks),
    [now, timeBlocks],
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
        onStartFocus={onStartFocus}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <TodayMissionCard
          topTasks={topTasks}
          onOpenTab={onOpenTab}
        />
        <ExecutionPulseCard
          plannedMinutes={todayMetrics.plannedMinutes}
          completedMinutes={todayMetrics.completedMinutes}
          completionPct={todayMetrics.completionPct}
          streak={streakData.currentStreak}
          bestStreak={streakData.bestStreak}
        />
        <StrategicGoalsCard goals={goalsView} onOpenTab={onOpenTab} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WeeklyIntelligenceSnapshot
          plannedMinutes={todayMetrics.plannedMinutes}
          completedMinutes={todayMetrics.completedMinutes}
          onOpenTab={onOpenTab}
        />
        <QuickActions
          onOpenTab={onOpenTab}
          projectsCount={projects.length}
          goalsCount={goals.length}
        />
      </div>
    </section>
  );
}

// ============================================================================
// HERO
// ============================================================================

interface HeroProps {
  active: TimeBlock | undefined;
  next: TimeBlock | undefined;
  onStartFocus?: () => void;
}

function Hero({ active, next, onStartFocus }: HeroProps) {
  return (
    <header
      data-testid="today-hero"
      className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 px-6 py-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-blue-700">
            Today
          </p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            What matters now
          </h2>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            One screen with the active block, the next block, and the few
            things worth doing today.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <StatusLine
            label="Active"
            value={active ? active.title : 'No active block'}
            tone={active ? 'emerald' : 'neutral'}
          />
          <StatusLine
            label="Next"
            value={next ? next.title : 'No upcoming block'}
            tone={next ? 'blue' : 'neutral'}
          />
          {onStartFocus && (
            <button
              type="button"
              onClick={onStartFocus}
              data-testid="today-start-focus"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-emerald-700 hover:to-blue-700 transition"
            >
              ▶ Start focus
            </button>
          )}
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
  const cls =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'blue'
        ? 'border-blue-200 bg-blue-50 text-blue-700'
        : 'border-gray-200 bg-gray-50 text-gray-600';
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-semibold max-w-[200px] truncate">{value}</span>
    </span>
  );
}

// ============================================================================
// CARDS
// ============================================================================

interface TodayMissionCardProps {
  topTasks: ReadonlyArray<Task>;
  onOpenTab: (tabId: string) => void;
}

function TodayMissionCard({ topTasks, onOpenTab }: TodayMissionCardProps) {
  return (
    <Card title="Today Mission" subtitle="Top 3 priorities">
      {topTasks.length === 0 ? (
        <EmptyHint
          message="No prioritized tasks for today."
          ctaLabel="Open Goals & Projects"
          onCta={() => onOpenTab('okr')}
        />
      ) : (
        <ul className="space-y-1.5">
          {topTasks.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs flex items-center justify-between gap-2"
            >
              <span className="truncate font-medium text-gray-800">{t.title}</span>
              <PriorityChip priority={t.priority} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PriorityChip({ priority }: { priority: Task['priority'] | undefined }) {
  if (!priority) return null;
  const cls =
    priority === 'critical'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : priority === 'high'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : priority === 'medium'
          ? 'border-sky-200 bg-sky-50 text-sky-700'
          : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {priority}
    </span>
  );
}

interface ExecutionPulseProps {
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
  streak: number;
  bestStreak: number;
}

function ExecutionPulseCard(p: ExecutionPulseProps) {
  return (
    <Card title="Execution Pulse" subtitle="Today vs plan">
      <div className="space-y-2 text-xs">
        <Row label="Planned today" value={`${minutesLabel(p.plannedMinutes)}`} />
        <Row label="Completed" value={`${minutesLabel(p.completedMinutes)}`} />
        <Row label="Completion" value={`${Math.round(p.completionPct)}%`} highlight />
        <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-blue-500"
            style={{ width: `${Math.min(100, Math.max(0, Math.round(p.completionPct)))}%` }}
          />
        </div>
        <Row label="Streak" value={`${p.streak} days · best ${p.bestStreak}`} />
      </div>
    </Card>
  );
}

interface StrategicGoalsCardProps {
  goals: GoalsView;
  onOpenTab: (tabId: string) => void;
}

function StrategicGoalsCard({ goals, onOpenTab }: StrategicGoalsCardProps) {
  return (
    <Card title="Strategic Goals" subtitle="Top focus this quarter">
      {goals.active.length === 0 ? (
        <EmptyHint
          message="No active goals yet."
          ctaLabel="Open Goal Architect"
          onCta={() => onOpenTab('goal_architect')}
        />
      ) : (
        <>
          <ul className="space-y-1.5">
            {goals.active.slice(0, 3).map((g) => (
              <li
                key={g.id}
                className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs flex items-center justify-between gap-2"
              >
                <span className="truncate font-medium text-gray-800">{g.title}</span>
                <PriorityChip priority={g.priority} />
              </li>
            ))}
          </ul>
          {goals.atRiskCount > 0 && (
            <p
              className="mt-2 text-[11px] text-amber-700"
              data-testid="today-at-risk"
            >
              ⚠ {goals.atRiskCount} goal{goals.atRiskCount === 1 ? '' : 's'} at risk
            </p>
          )}
        </>
      )}
    </Card>
  );
}

interface WeeklySnapshotProps {
  plannedMinutes: number;
  completedMinutes: number;
  onOpenTab: (tabId: string) => void;
}

function WeeklyIntelligenceSnapshot({
  plannedMinutes,
  completedMinutes,
  onOpenTab,
}: WeeklySnapshotProps) {
  const empty = plannedMinutes === 0 && completedMinutes === 0;
  return (
    <Card
      title="Weekly Intelligence Snapshot"
      subtitle="Planned vs completed minutes (today)"
    >
      {empty ? (
        <EmptyHint
          message="No planned blocks yet this week."
          ctaLabel="Generate Weekly Plan"
          onCta={() => onOpenTab('weekly_intel')}
        />
      ) : (
        <div className="space-y-2 text-xs">
          <Row label="Planned" value={minutesLabel(plannedMinutes)} />
          <Row label="Completed" value={minutesLabel(completedMinutes)} highlight />
          <button
            type="button"
            onClick={() => onOpenTab('weekly_intel')}
            className="mt-1 inline-flex items-center gap-2 text-xs font-medium text-blue-700 hover:text-blue-900"
            data-testid="today-open-weekly-intel"
          >
            Open Weekly Intelligence →
          </button>
        </div>
      )}
    </Card>
  );
}

interface QuickActionsProps {
  onOpenTab: (tabId: string) => void;
  projectsCount: number;
  goalsCount: number;
}

function QuickActions({ onOpenTab, projectsCount, goalsCount }: QuickActionsProps) {
  return (
    <Card title="Quick Actions" subtitle="Jump to what you need">
      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
        data-testid="today-quick-actions"
      >
        <ActionTile
          icon="🏗️"
          label="Create Goal"
          subtitle="Use Goal Architect"
          onClick={() => onOpenTab('goal_architect')}
        />
        <ActionTile
          icon="🧭"
          label="Plan Week"
          subtitle="Weekly Intelligence"
          onClick={() => onOpenTab('weekly_intel')}
        />
        <ActionTile
          icon="📅"
          label="Time Planner"
          subtitle="Add a time block"
          onClick={() => onOpenTab('planner')}
        />
        <ActionTile
          icon="📈"
          label="Review Week"
          subtitle="Weekly Execution"
          onClick={() => onOpenTab('weekly')}
        />
      </div>
      <p className="mt-3 text-[11px] text-gray-400">
        {goalsCount} active goal{goalsCount === 1 ? '' : 's'} · {projectsCount}{' '}
        project{projectsCount === 1 ? '' : 's'}.
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
      className="text-left rounded-lg border border-gray-100 bg-white px-3 py-2.5 hover:border-blue-200 hover:bg-blue-50/40 transition"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>
    </button>
  );
}

// ============================================================================
// SHARED PRIMITIVES
// ============================================================================

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
    <article className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && (
          <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>
        )}
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
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span
        className={
          highlight
            ? 'font-semibold text-gray-900 tabular-nums'
            : 'text-gray-700 tabular-nums'
        }
      >
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
        className="mt-1.5 inline-flex items-center gap-1 text-blue-700 font-medium hover:text-blue-900"
      >
        {ctaLabel} →
      </button>
    </div>
  );
}

// ============================================================================
// PURE LOGIC
// ============================================================================

interface TodayMetrics {
  active: TimeBlock | undefined;
  next: TimeBlock | undefined;
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
}

function computeTodayMetrics(
  now: Date,
  timeBlocks: ReadonlyArray<TimeBlock>,
): TodayMetrics {
  const todayKey = now.toDateString();
  const todayBlocks = timeBlocks.filter(
    (b) => !b.deleted && new Date(b.startTime).toDateString() === todayKey,
  );

  const active = todayBlocks.find((b) => {
    const start = new Date(b.startTime).getTime();
    const end = new Date(b.endTime).getTime();
    return (
      start <= now.getTime() && end >= now.getTime() && b.status !== 'completed'
    );
  });
  const next = todayBlocks
    .filter((b) => new Date(b.startTime).getTime() > now.getTime())
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    )[0];

  const plannedMinutes = todayBlocks.reduce(
    (sum, b) =>
      sum +
      Math.max(
        0,
        (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) /
          (1000 * 60),
      ),
    0,
  );
  const completedMinutes = todayBlocks
    .filter((b) => b.status === 'completed')
    .reduce(
      (sum, b) =>
        sum +
        Math.max(
          0,
          (new Date(b.actualEndTime ?? b.endTime).getTime() -
            new Date(b.actualStartTime ?? b.startTime).getTime()) /
            (1000 * 60),
        ),
      0,
    );
  const completionPct =
    plannedMinutes > 0 ? (completedMinutes / plannedMinutes) * 100 : 0;

  return {
    active,
    next,
    plannedMinutes: Math.round(plannedMinutes),
    completedMinutes: Math.round(completedMinutes),
    completionPct,
  };
}

function pickTopTasks(tasks: ReadonlyArray<Task>): Task[] {
  const PRIORITY_WEIGHT: Record<NonNullable<Task['priority']>, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };
  return tasks
    .filter((t) => !t.deleted && t.status !== 'completed' && t.status !== 'cancelled')
    .slice()
    .sort((a, b) => {
      const wa = a.priority ? PRIORITY_WEIGHT[a.priority] : 0;
      const wb = b.priority ? PRIORITY_WEIGHT[b.priority] : 0;
      return wb - wa;
    })
    .slice(0, 3);
}

interface GoalsView {
  active: ReadonlyArray<Goal>;
  atRiskCount: number;
}

function summarizeGoals(goals: ReadonlyArray<Goal>): GoalsView {
  const live = goals.filter((g) => !g.deleted);
  const active = live.filter((g) => g.status === 'active');
  const atRiskCount = live.filter((g) => g.status === 'at_risk').length;
  return { active, atRiskCount };
}

function minutesLabel(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '0 min';
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}
