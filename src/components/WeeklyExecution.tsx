'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, Clock, TrendingUp, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { Session } from '@/types';
import { db } from '@/lib/database';
import { computePerformanceOverview, type PerformanceInput } from '@/lib/performance/metrics';
import { dayKey, resolvePeriod } from '@/lib/performance/period';
import { toDateSafe } from '@/utils/dateUtils';
import { useDataContext } from '@/providers/DataProvider';
import WpiWeeklyExecutionSummary from '@/components/WeeklyPlanning/WpiWeeklyExecutionSummary';

type SessionStatus = 'loading' | 'ready' | 'error';

function deserializeSession(raw: Session): Session {
  return {
    ...raw,
    startTime: toDateSafe(raw.startTime),
    endTime: raw.endTime ? toDateSafe(raw.endTime) : undefined,
    createdAt: toDateSafe(raw.createdAt),
    updatedAt: toDateSafe(raw.updatedAt),
  };
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function rateText(rate: number | null, partial = false): string {
  if (rate === null) return '—';
  return `${partial ? '≥ ' : ''}${rate}%`;
}

function rateTone(rate: number | null): string {
  if (rate === null) return 'text-gray-400';
  if (rate >= 80) return 'text-green-400';
  if (rate >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function rateBar(rate: number | null): string {
  if (rate === null) return 'bg-gray-500';
  if (rate >= 80) return 'bg-green-500';
  if (rate >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export default function WeeklyExecution() {
  const data = useDataContext();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSessionStatus('loading');
    (async () => {
      try {
        const raw = await db.getByIndex<Session>('sessions', 'userId', data.userId);
        if (cancelled) return;
        setSessions(raw.filter((item) => item.userId === data.userId).map(deserializeSession));
        setSessionStatus('ready');
      } catch (error) {
        console.error('[WeeklyExecution] Failed to load sessions:', error);
        if (cancelled) return;
        setSessions([]);
        setSessionStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.userId, reloadKey]);

  const weekData = useMemo(() => {
    if (data.status !== 'ready' || sessionStatus !== 'ready') return null;
    const now = new Date();
    const period = resolvePeriod(now, 'week', now);
    const input: PerformanceInput = {
      ownerUid: data.userId,
      timeBlocks: data.timeBlocks,
      sessions,
      tasks: data.tasks,
      projects: data.projects,
      goals: data.goals,
    };
    const overview = computePerformanceOverview(input, period, undefined, now);
    const productiveWeekBlocks = data.timeBlocks.filter((block) => {
      if (
        block.userId !== data.userId
        || block.deleted
        || block.type === 'break'
        || block.type === 'buffer'
      ) return false;
      const start = block.startTime instanceof Date ? block.startTime.getTime() : Number.NaN;
      return Number.isFinite(start) && start >= period.start.getTime() && start < period.end.getTime();
    });
    const completedCount = productiveWeekBlocks.filter(
      (block) => block.status === 'completed' || block.status === 'overrun',
    ).length;
    const skippedCount = productiveWeekBlocks.filter((block) => block.status === 'cancelled').length;
    const currentDayKey = dayKey(now);
    const today = overview.timeSeries.find((point) => point.key === currentDayKey);
    const todayMissingCount = overview.activity.filter(
      (row) => row.dayKey === currentDayKey && row.timeSource === 'missing',
    ).length;
    const totalPlanned = overview.summary.plannedMinutes;
    const totalCompleted = overview.summary.actualMinutes;
    const execRate = totalPlanned > 0 ? Math.round(totalCompleted / totalPlanned * 100) : null;
    const todayPlanned = today?.plannedMinutes ?? 0;
    const todayCompleted = today?.actualMinutes ?? 0;
    const todayRate = todayPlanned > 0 ? Math.round(todayCompleted / todayPlanned * 100) : null;
    const actualPartial = overview.dataQuality.actualAvailability === 'partial';
    const goalBreakdown = overview.goals
      .filter((goal) => goal.plannedMinutes > 0 || goal.actualMinutes > 0)
      .map((goal) => ({
        goalId: goal.goalId ?? '_unlinked',
        goalTitle: goal.goalName,
        planned: goal.plannedMinutes,
        completed: goal.actualMinutes,
      }));

    return {
      period,
      totalPlanned,
      totalCompleted,
      execRate,
      completedCount,
      skippedCount,
      actualSourceCount: overview.dataQuality.actualSourceCount,
      missingActualCount: overview.dataQuality.blocksMissingActualCount,
      openSessionCount: overview.dataQuality.openSessionCount,
      anomalousDurationCount: overview.dataQuality.anomalousDurationCount,
      actualPartial,
      todayPlanned,
      todayCompleted,
      todayRate,
      todayPartial: todayMissingCount > 0,
      goalBreakdown,
    };
  }, [data, sessionStatus, sessions]);

  if (data.status === 'error') {
    return (
      <div className="bg-red-950/40 rounded-2xl border border-red-500/30 p-6 text-center" role="alert">
        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
        <p className="text-sm font-semibold text-red-200">I dati settimanali non sono disponibili.</p>
      </div>
    );
  }

  if (sessionStatus === 'error') {
    return (
      <div className="bg-amber-950/30 rounded-2xl border border-amber-500/30 p-6 text-center" role="alert">
        <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto mb-2" />
        <p className="text-sm font-semibold text-amber-200">L'esecuzione reale non è disponibile.</p>
        <p className="text-xs text-amber-300/80 mt-1">
          Le Session non sono state caricate: Life Tracker non mostrerà il dato mancante come zero.
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="mt-3 px-3 py-1.5 rounded-lg border border-amber-400/40 bg-gray-900 text-xs font-semibold text-amber-100"
        >
          Riprova
        </button>
      </div>
    );
  }

  if (!weekData) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-700/50 p-6">
        <div className="animate-pulse space-y-4" data-testid="weekly-execution-skeleton">
          <div className="h-6 bg-gray-800 rounded w-48" />
          <div className="h-20 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  const weekEnd = new Date(weekData.period.end.getTime() - 1);
  const weekLabel = `${weekData.period.start.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-gray-700/50">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            Esecuzione Settimanale
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{weekLabel}</p>
        </div>
        <div className={`text-3xl font-black ${rateTone(weekData.execRate)}`}>
          {rateText(weekData.execRate, weekData.actualPartial)}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">
              {weekData.actualPartial ? 'Reale noto' : 'Reale'}:{' '}
              <span className="text-white font-semibold">{formatHours(weekData.totalCompleted)}</span>
            </span>
            <span className="text-gray-400">
              Pianificato: <span className="text-white font-semibold">{formatHours(weekData.totalPlanned)}</span>
            </span>
          </div>
          <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${rateBar(weekData.execRate)} rounded-full transition-all duration-700`}
              style={{ width: `${Math.min(100, weekData.execRate ?? 0)}%` }}
            />
          </div>
        </div>

        {weekData.actualPartial && (
          <div className="flex items-start gap-2 text-xs rounded-lg border border-amber-500/20 bg-amber-950/20 p-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <span className="text-amber-200/80">
              {weekData.missingActualCount > 0
                ? `${weekData.missingActualCount} blocchi eseguiti senza Session o intervallo reale. `
                : ''}
              {weekData.openSessionCount > 0
                ? `${weekData.openSessionCount} Session ancora aperte sono escluse. `
                : ''}
              {weekData.anomalousDurationCount > 0
                ? `${weekData.anomalousDurationCount} intervalli non validi sono esclusi. `
                : ''}
              Il totale è un minimo misurato; il tempo pianificato non viene usato come sostituto.
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/30">
            <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-green-400" />
            <div className="text-lg font-bold text-white">{weekData.completedCount}</div>
            <div className="text-[10px] text-gray-500 uppercase">Eseguiti</div>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/30">
            <Clock className="w-4 h-4 mx-auto mb-1 text-blue-400" />
            <div className="text-lg font-bold text-white">{weekData.actualSourceCount}</div>
            <div className="text-[10px] text-gray-500 uppercase">Fonti reali</div>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/30">
            <XCircle className="w-4 h-4 mx-auto mb-1 text-red-400" />
            <div className="text-lg font-bold text-white">{weekData.skippedCount}</div>
            <div className="text-[10px] text-gray-500 uppercase">Annullati</div>
          </div>
        </div>

        <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-300">Oggi</span>
            <span className={`text-sm font-bold ${rateTone(weekData.todayRate)}`}>
              {rateText(weekData.todayRate, weekData.todayPartial)}
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>{formatHours(weekData.todayCompleted)} reali{weekData.todayPartial ? ' noti' : ''}</span>
            <span>{formatHours(weekData.todayPlanned)} pianificate</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${rateBar(weekData.todayRate)} rounded-full transition-all`}
              style={{ width: `${Math.min(100, weekData.todayRate ?? 0)}%` }}
            />
          </div>
        </div>

        {weekData.goalBreakdown.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" />
              Per Goal
            </h3>
            <div className="space-y-2.5">
              {weekData.goalBreakdown.map((goal) => {
                const rate = goal.planned > 0 ? Math.round(goal.completed / goal.planned * 100) : null;
                return (
                  <div key={goal.goalId} className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/20">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-200 truncate flex-1">{goal.goalTitle}</span>
                      <span className={`text-xs font-bold ml-2 ${rateTone(rate)}`}>
                        {rateText(rate, weekData.actualPartial)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full ${rateBar(rate)}`}
                        style={{ width: `${Math.min(100, rate ?? 0)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {formatHours(goal.completed)} reali{weekData.actualPartial ? ' noti' : ''} / {formatHours(goal.planned)} pianificate
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {weekData.totalPlanned > 0 && !weekData.actualPartial && (
          <div className={`rounded-xl p-3 border text-center text-sm font-medium ${
            (weekData.execRate ?? 0) >= 80 ? 'bg-green-900/20 border-green-500/20 text-green-300' :
            (weekData.execRate ?? 0) >= 50 ? 'bg-yellow-900/20 border-yellow-500/20 text-yellow-300' :
            'bg-red-900/20 border-red-500/20 text-red-300'
          }`}>
            {(weekData.execRate ?? 0) >= 80 ? (
              <>{formatHours(weekData.totalCompleted)} misurate. Esecuzione solida.</>
            ) : (weekData.execRate ?? 0) >= 50 ? (
              <>Esecuzione misurata al {weekData.execRate}% del piano.</>
            ) : (weekData.execRate ?? 0) > 0 ? (
              <>Esecuzione misurata al {weekData.execRate}%.</>
            ) : (
              <>Nessuna esecuzione misurata questa settimana.</>
            )}
          </div>
        )}

        {weekData.totalPlanned === 0 && (
          <div className="text-center py-6">
            <AlertTriangle className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Nessun blocco pianificato questa settimana.</p>
            <p className="text-xs text-gray-600 mt-1">Vai al Time Planner per pianificare.</p>
          </div>
        )}

        <WpiWeeklyExecutionSummary />
      </div>
    </div>
  );
}
