'use client';

// Performance Review — the section orchestrator.
//
// Data flow: DataProvider already holds the signed-in user's goals /
// projects / tasks / time blocks (filtered by userId + soft-delete at load).
// Sessions are the one collection it does not preload, so this component
// fetches them once per user via the same adapter (`db.getByIndex` on the
// user index — Firebase paths are additionally scoped per user). All
// aggregation happens in the pure engine `lib/performance/metrics`; this
// file only owns UI state: period, filters, drill-down selection.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarPlus, Clock3, PlayCircle } from 'lucide-react';
import type { Session } from '@/types';
import { db } from '@/lib/database';
import { toDateSafe } from '@/utils/dateUtils';
import { useDataContext } from '@/providers/DataProvider';
import {
  computePerformanceOverview,
  UNASSIGNED_ID,
  type PerformanceInput,
} from '@/lib/performance/metrics';
import { navigatePeriod, resolvePeriod } from '@/lib/performance/period';
import type {
  PerformanceFilters,
  PerformanceInsight,
  PerformanceOverview,
  PerformancePeriodType,
} from '@/lib/performance/types';
import { EMPTY_FILTERS } from '@/lib/performance/types';

import PerfToolbar from './PerfToolbar';
import PerfKpiGrid from './PerfKpiGrid';
import PlanVsActualChart from './PlanVsActualChart';
import GoalPerformancePanel from './GoalPerformancePanel';
import ProjectScorecard from './ProjectScorecard';
import ConsistencyHeatmap from './ConsistencyHeatmap';
import InsightsPanel from './InsightsPanel';
import ActivityDetailPanel from './ActivityDetailPanel';

type SessionStatus = 'loading' | 'ready' | 'error';

interface PerformanceDashboardProps {
  /** Optional: navigate to another app tab (e.g. the planner) from empty states. */
  onNavigate?: (tabId: string) => void;
}

function deserializeSession(raw: Session): Session {
  return {
    ...raw,
    startTime: toDateSafe(raw.startTime),
    endTime: raw.endTime ? toDateSafe(raw.endTime) : undefined,
    createdAt: toDateSafe(raw.createdAt),
    updatedAt: toDateSafe(raw.updatedAt),
  };
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-100 ${className}`} aria-hidden="true" />;
}

export default function PerformanceDashboard({ onNavigate }: PerformanceDashboardProps) {
  const data = useDataContext();

  // ---- UI state -----------------------------------------------------------
  const [periodType, setPeriodType] = useState<PerformancePeriodType>('week');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<PerformanceFilters>(EMPTY_FILTERS);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  // ---- Sessions (the one collection DataProvider does not hold) ------------
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [sessionReloadKey, setSessionReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessionStatus('loading');
    (async () => {
      try {
        const raw = await db.getByIndex<Session>('sessions', 'userId', data.userId);
        if (cancelled) return;
        // Defense in depth: never trust a record that is not the signed-in user's.
        setSessions(raw.filter((s) => s.userId === data.userId).map(deserializeSession));
        setSessionStatus('ready');
      } catch (error) {
        console.error('[Performance] Failed to load sessions:', error);
        if (cancelled) return;
        setSessions([]);
        setSessionStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.userId, sessionReloadKey]);

  // ---- Aggregation (pure, memoized) ----------------------------------------
  const period = useMemo(
    () => resolvePeriod(anchor, periodType, new Date()),
    [anchor, periodType]
  );

  const { overview, computeError } = useMemo((): {
    overview: PerformanceOverview | null;
    computeError: boolean;
  } => {
    try {
      const input: PerformanceInput = {
        ownerUid: data.userId,
        timeBlocks: data.timeBlocks,
        sessions,
        tasks: data.tasks,
        projects: data.projects,
        goals: data.goals,
      };
      return { overview: computePerformanceOverview(input, period, filters, new Date()), computeError: false };
    } catch (error) {
      console.error('[Performance] Aggregation failed:', error);
      return { overview: null, computeError: true };
    }
  }, [data.userId, data.timeBlocks, data.tasks, data.projects, data.goals, sessions, period, filters]);

  // ---- Handlers -------------------------------------------------------------
  const handlePeriodType = useCallback((type: PerformancePeriodType) => {
    setPeriodType(type);
    setSelectedDayKey(null);
  }, []);

  const handleNavigate = useCallback(
    (offset: number) => {
      setAnchor(navigatePeriod(period, offset).start);
      setSelectedDayKey(null);
    },
    [period]
  );

  const handleToday = useCallback(() => {
    setAnchor(new Date());
    setSelectedDayKey(null);
  }, []);

  const handleReset = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSelectedDayKey(null);
  }, []);

  const scrollToDetail = useCallback(() => {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (typeof detailRef.current?.scrollIntoView === 'function') {
      detailRef.current.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
  }, []);

  const handleSelectDay = useCallback(
    (key: string | null) => {
      setSelectedDayKey(key);
      if (key) scrollToDetail();
    },
    [scrollToDetail]
  );

  const handleSelectGoal = useCallback((goalId: string | null) => {
    setFilters((f) => ({ ...f, goalId, projectId: null }));
  }, []);

  const handleSelectProject = useCallback((projectId: string | null) => {
    setFilters((f) => ({ ...f, projectId }));
  }, []);

  const handleInsightLink = useCallback(
    (insight: PerformanceInsight) => {
      const link = insight.link;
      if (!link) return;
      if (link.goalId) setFilters((f) => ({ ...f, goalId: link.goalId ?? null, projectId: null }));
      if (link.projectId) setFilters((f) => ({ ...f, projectId: link.projectId ?? null }));
      if (link.dayKey) handleSelectDay(link.dayKey);
    },
    [handleSelectDay]
  );

  // ---- Render ----------------------------------------------------------------
  if (data.status === 'error') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center" role="alert">
        <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-semibold text-red-700">I dati non possono essere caricati.</p>
        <p className="text-xs text-red-600 mt-1">Ricarica l’app e riprova. Nessun dato è stato modificato.</p>
      </div>
    );
  }

  if (sessionStatus === 'error') {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center" role="alert">
        <AlertTriangle className="w-6 h-6 text-amber-600 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-semibold text-amber-900">L’esecuzione effettiva non è disponibile.</p>
        <p className="text-xs text-amber-800 mt-1">
          Le Sessioni non sono state caricate: Life Tracker non presenterà l’evidenza mancante come zero.
        </p>
        <button
          type="button"
          onClick={() => setSessionReloadKey((key) => key + 1)}
          className="mt-3 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-semibold text-amber-900 hover:bg-amber-100"
        >
          Riprova
        </button>
      </div>
    );
  }

  if (sessionStatus === 'loading' || !overview) {
    if (computeError) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center" role="alert">
          <AlertTriangle className="w-6 h-6 text-red-500 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-red-700">Le metriche Performance non possono essere calcolate.</p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-3 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            Reimposta vista
          </button>
        </div>
      );
    }
    // Stable-size skeleton — no layout shift when data arrives.
    return (
      <div className="space-y-4" data-testid="performance-skeleton">
        <SkeletonBlock className="h-[76px]" />
        <SkeletonBlock className="h-[92px]" />
        <SkeletonBlock className="h-[340px]" />
        <SkeletonBlock className="h-[220px]" />
      </div>
    );
  }

  const { summary } = overview;
  const isEmptyPeriod =
    summary.plannedMinutes === 0 &&
    summary.actualMinutes === 0 &&
    summary.plannedTasks === 0 &&
    summary.completedTasksInPeriod === 0;

  const hasUnassigned =
    overview.goals.some((g) => g.goalId === null) || filters.goalId === UNASSIGNED_ID;

  const sortedGoals = [...data.goals].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  const sortedProjects = [...data.projects].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div className="space-y-4" data-testid="performance-dashboard">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Intelligenza di esecuzione</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">Rendimento</h2>
          <p className="mt-1 text-sm text-slate-600">Aderenza, allocazione e accuratezza stimata da evidenza misurata.</p>
        </div>
      </header>
      <PerfToolbar
        period={overview.period}
        filters={filters}
        goals={sortedGoals}
        projects={sortedProjects}
        hasUnassigned={hasUnassigned}
        onPeriodTypeChange={handlePeriodType}
        onNavigate={handleNavigate}
        onToday={handleToday}
        onFiltersChange={setFilters}
        onReset={handleReset}
      />

      {isEmptyPeriod ? (
        <div
          className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center"
          data-testid="performance-empty-state"
        >
          <Clock3 className="mx-auto mb-3 h-8 w-8 text-indigo-500" aria-hidden="true" />
          <h3 className="text-base font-bold text-slate-900">Nessun piano o tracking nel periodo</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            Non risultano TimeBlock pianificati né Sessioni registrate
            {filters.goalId || filters.projectId || filters.source !== 'all'
              ? ' con i filtri correnti — prova a reimpostarli.'
              : ' — pianifica un blocco o avvia una Sessione.'}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            {(filters.goalId || filters.projectId || filters.source !== 'all') && (
              <button
                type="button"
                onClick={handleReset}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reimposta filtri
              </button>
            )}
            {onNavigate && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate('planner')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />
                  Apri Pianificazione
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('today')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <PlayCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  Avvia da Oggi
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <PerfKpiGrid
            summary={overview.summary}
            previous={overview.previousSummary}
            dataQuality={overview.dataQuality}
            isPartial={overview.period.isPartial}
          />

          <PlanVsActualChart
            points={overview.timeSeries}
            period={overview.period}
            selectedKey={selectedDayKey}
            onSelectKey={handleSelectDay}
          />

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3">
              <GoalPerformancePanel
                goals={overview.goals}
                activeGoalId={filters.goalId}
                onSelectGoal={handleSelectGoal}
              />
            </div>
            <div className="xl:col-span-2">
              <InsightsPanel insights={overview.insights} onApplyLink={handleInsightLink} />
            </div>
          </div>

          <ProjectScorecard
            projects={overview.projects}
            activeProjectId={filters.projectId}
            onSelectProject={handleSelectProject}
          />

          <ConsistencyHeatmap
            days={overview.heatmap}
            period={overview.period}
            selectedKey={selectedDayKey}
            onSelectKey={handleSelectDay}
          />

          <div ref={detailRef}>
            <ActivityDetailPanel
              activity={overview.activity}
              carryOver={overview.carryOver}
              dataQuality={overview.dataQuality}
              selectedDayKey={selectedDayKey}
              onClearDay={() => setSelectedDayKey(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
