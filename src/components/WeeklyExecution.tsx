'use client';

import { useMemo } from 'react';
import { Target, Clock, TrendingUp, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useDataContext } from '@/providers/DataProvider';

function getWeekBounds(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

interface GoalBreakdown {
  goalId: string;
  goalTitle: string;
  planned: number;
  completed: number;
  blocks: number;
  completedBlocks: number;
}

export default function WeeklyExecution() {
  const data = useDataContext();

  const weekData = useMemo(() => {
    if (data.status !== 'ready') return null;

    const now = new Date();
    const { start, end } = getWeekBounds(now);

    const weekBlocks = data.timeBlocks.filter(b => {
      if (b.deleted) return false;
      const bStart = new Date(b.startTime);
      return bStart >= start && bStart <= end;
    });

    let totalPlanned = 0;
    let totalCompleted = 0;
    let completedCount = 0;
    let skippedCount = 0;
    const goalMap = new Map<string, GoalBreakdown>();

    for (const block of weekBlocks) {
      const startTime = new Date(block.startTime);
      const endTime = new Date(block.endTime);
      const plannedMin = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      totalPlanned += plannedMin;

      let actualMin = 0;
      if (block.status === 'completed') {
        completedCount++;
        const aStart = block.actualStartTime ? new Date(block.actualStartTime) : startTime;
        const aEnd = block.actualEndTime ? new Date(block.actualEndTime) : endTime;
        actualMin = (aEnd.getTime() - aStart.getTime()) / (1000 * 60);
        totalCompleted += actualMin;
      } else if (block.status === 'cancelled') {
        skippedCount++;
      }

      // Goal breakdown
      const gId = block.goalId || '_unlinked';
      if (!goalMap.has(gId)) {
        const goal = data.goals.find(g => g.id === gId);
        goalMap.set(gId, {
          goalId: gId,
          goalTitle: goal?.title || 'Senza Goal',
          planned: 0,
          completed: 0,
          blocks: 0,
          completedBlocks: 0,
        });
      }
      const entry = goalMap.get(gId)!;
      entry.planned += plannedMin;
      entry.blocks += 1;
      if (block.status === 'completed') {
        entry.completed += actualMin;
        entry.completedBlocks += 1;
      }
    }

    // Today stats
    const todayStr = now.toDateString();
    const todayBlocks = weekBlocks.filter(b => new Date(b.startTime).toDateString() === todayStr);
    let todayPlanned = 0;
    let todayCompleted = 0;
    for (const b of todayBlocks) {
      const pMin = (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60);
      todayPlanned += pMin;
      if (b.status === 'completed') {
        const aStart = b.actualStartTime ? new Date(b.actualStartTime) : new Date(b.startTime);
        const aEnd = b.actualEndTime ? new Date(b.actualEndTime) : new Date(b.endTime);
        todayCompleted += (aEnd.getTime() - aStart.getTime()) / (1000 * 60);
      }
    }

    const execRate = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0;
    const todayRate = todayPlanned > 0 ? Math.round((todayCompleted / todayPlanned) * 100) : 0;

    const goalBreakdown = Array.from(goalMap.values())
      .filter(g => g.planned > 0)
      .sort((a, b) => b.planned - a.planned);

    return {
      start,
      end,
      totalPlanned,
      totalCompleted,
      execRate,
      totalBlocks: weekBlocks.length,
      completedCount,
      skippedCount,
      todayPlanned,
      todayCompleted,
      todayRate,
      goalBreakdown,
    };
  }, [data.status, data.timeBlocks, data.goals]);

  if (!weekData) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-700/50 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-800 rounded w-48" />
          <div className="h-20 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  const rateColor = weekData.execRate >= 80 ? 'text-green-400' : weekData.execRate >= 50 ? 'text-yellow-400' : 'text-red-400';
  const rateBg = weekData.execRate >= 80 ? 'bg-green-500' : weekData.execRate >= 50 ? 'bg-yellow-500' : 'bg-red-500';

  const weekLabel = `${weekData.start.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} - ${weekData.end.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-gray-700/50">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            Esecuzione Settimanale
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{weekLabel}</p>
        </div>
        <div className={`text-3xl font-black ${rateColor}`}>
          {weekData.execRate}%
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Main progress bar */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">
              Completato: <span className="text-white font-semibold">{formatHours(weekData.totalCompleted)}</span>
            </span>
            <span className="text-gray-400">
              Pianificato: <span className="text-white font-semibold">{formatHours(weekData.totalPlanned)}</span>
            </span>
          </div>
          <div className="h-4 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${rateBg} rounded-full transition-all duration-700`}
              style={{ width: `${Math.min(100, weekData.execRate)}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/30">
            <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-green-400" />
            <div className="text-lg font-bold text-white">{weekData.completedCount}</div>
            <div className="text-[10px] text-gray-500 uppercase">Completati</div>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/30">
            <Clock className="w-4 h-4 mx-auto mb-1 text-blue-400" />
            <div className="text-lg font-bold text-white">{weekData.totalBlocks}</div>
            <div className="text-[10px] text-gray-500 uppercase">Pianificati</div>
          </div>
          <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/30">
            <XCircle className="w-4 h-4 mx-auto mb-1 text-red-400" />
            <div className="text-lg font-bold text-white">{weekData.skippedCount}</div>
            <div className="text-[10px] text-gray-500 uppercase">Saltati</div>
          </div>
        </div>

        {/* Today */}
        <div className="bg-gray-800/40 rounded-xl p-4 border border-gray-700/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-300">Oggi</span>
            <span className={`text-sm font-bold ${weekData.todayRate >= 80 ? 'text-green-400' : weekData.todayRate >= 50 ? 'text-yellow-400' : 'text-gray-400'}`}>
              {weekData.todayRate}%
            </span>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>{formatHours(weekData.todayCompleted)} completate</span>
            <span>{formatHours(weekData.todayPlanned)} pianificate</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${weekData.todayRate >= 80 ? 'bg-green-500' : weekData.todayRate >= 50 ? 'bg-yellow-500' : 'bg-gray-500'} rounded-full transition-all`}
              style={{ width: `${Math.min(100, weekData.todayRate)}%` }}
            />
          </div>
        </div>

        {/* Goal breakdown */}
        {weekData.goalBreakdown.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" />
              Per Goal
            </h3>
            <div className="space-y-2.5">
              {weekData.goalBreakdown.map(g => {
                const rate = g.planned > 0 ? Math.round((g.completed / g.planned) * 100) : 0;
                return (
                  <div key={g.goalId} className="bg-gray-800/40 rounded-lg p-3 border border-gray-700/20">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-medium text-gray-200 truncate flex-1">{g.goalTitle}</span>
                      <span className={`text-xs font-bold ml-2 ${rate >= 80 ? 'text-green-400' : rate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {rate}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full ${rate >= 80 ? 'bg-green-500' : rate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, rate)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-gray-500">
                      <span>{formatHours(g.completed)} / {formatHours(g.planned)}</span>
                      <span>{g.completedBlocks}/{g.blocks} blocchi</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Motivational message */}
        {weekData.totalPlanned > 0 && (
          <div className={`rounded-xl p-3 border text-center text-sm font-medium ${
            weekData.execRate >= 80 ? 'bg-green-900/20 border-green-500/20 text-green-300' :
            weekData.execRate >= 50 ? 'bg-yellow-900/20 border-yellow-500/20 text-yellow-300' :
            'bg-red-900/20 border-red-500/20 text-red-300'
          }`}>
            {weekData.execRate >= 80 ? (
              <>{formatHours(weekData.totalCompleted)} completate. Esecuzione solida.</>
            ) : weekData.execRate >= 50 ? (
              <>A meta\' strada. Hai ancora {formatHours(weekData.totalPlanned - weekData.totalCompleted)} da recuperare.</>
            ) : weekData.execRate > 0 ? (
              <>Esecuzione al {weekData.execRate}%. Recupera adesso, non domani.</>
            ) : (
              <>Nessun blocco completato. Il piano non vale nulla senza esecuzione.</>
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
      </div>
    </div>
  );
}
