'use client';

// Detailed Activity — the audit trail behind every aggregate number.
//
// Three stacked blocks:
//   1. Data-quality strip (honesty chips: coverage, exclusions, anomalies)
//   2. Carry-over list (planned tasks that slipped)
//   3. Activity table — every counted block/session with its provenance,
//      searchable, day-filterable, paginated ("show more").

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type {
  ActivityDetailRow,
  CarryOverTask,
  PerformanceDataQuality,
} from '@/lib/performance/types';
import { formatDayShort, formatMinutes, formatPercent } from '@/lib/performance/format';

const PAGE_SIZE = 50;

interface ActivityDetailPanelProps {
  activity: ActivityDetailRow[];
  carryOver: CarryOverTask[];
  dataQuality: PerformanceDataQuality;
  selectedDayKey: string | null;
  onClearDay: () => void;
}

function QualityChip({ label, value, title }: { label: string; value: string; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600"
    >
      <span className="font-semibold text-slate-800 tabular-nums">{value}</span>
      {label}
    </span>
  );
}

const CARRY_OUTCOME_META: Record<CarryOverTask['outcome'], { label: string; className: string }> = {
  open: { label: 'Still open', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  'completed-late': { label: 'Done late', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export default function ActivityDetailPanel({
  activity,
  carryOver,
  dataQuality,
  selectedDayKey,
  onClearDay,
}: ActivityDetailPanelProps) {
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showCarry, setShowCarry] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activity.filter((row) => {
      if (selectedDayKey && !(row.dayKey === selectedDayKey || row.dayKey.startsWith(selectedDayKey))) {
        return false;
      }
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.goalName.toLowerCase().includes(q) ||
        row.projectName.toLowerCase().includes(q) ||
        (row.taskTitle ?? '').toLowerCase().includes(q)
      );
    });
  }, [activity, search, selectedDayKey]);

  const visible = filtered.slice(0, limit);

  return (
    <section
      aria-label="Detailed activity"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      data-testid="activity-detail-panel"
    >
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-900">Detailed Activity</h3>
        <p className="text-xs text-slate-500">
          Every counted record — verify any aggregate above against its source data
        </p>
      </div>

      {/* 1 · Data quality strip */}
      <div className="flex flex-wrap gap-1.5 mb-4" data-testid="data-quality-strip">
        <QualityChip
          label="execution evidence coverage"
          value={formatPercent(dataQuality.coverageRate)}
          title={`${dataQuality.actualSourceCount} valid source${dataQuality.actualSourceCount === 1 ? '' : 's'} · ${dataQuality.blocksMissingActualCount} executed block${dataQuality.blocksMissingActualCount === 1 ? '' : 's'} missing actual evidence · ${formatMinutes(dataQuality.measuredMinutes)} known actual time`}
        />
        {dataQuality.blocksMissingActualCount > 0 && (
          <QualityChip
            label="executed blocks missing actual"
            value={String(dataQuality.blocksMissingActualCount)}
            title="No completed Session or valid explicit actual interval exists. Planned duration is never substituted; known actual totals are partial."
          />
        )}
        {dataQuality.unclassifiedMinutes > 0 && (
          <QualityChip
            label="unassigned to any goal"
            value={formatMinutes(dataQuality.unclassifiedMinutes)}
            title="Executed time with no resolvable goal — visible as the Unassigned row, never dropped."
          />
        )}
        {dataQuality.orphanSessionCount > 0 && (
          <QualityChip
            label={`ad-hoc session${dataQuality.orphanSessionCount === 1 ? '' : 's'}`}
            value={String(dataQuality.orphanSessionCount)}
            title={`${formatMinutes(dataQuality.orphanSessionMinutes)} tracked by sessions not linked to any time block (counted as unplanned).`}
          />
        )}
        {dataQuality.openSessionCount > 0 && (
          <QualityChip
            label="running sessions excluded"
            value={String(dataQuality.openSessionCount)}
            title="Sessions still active or paused are not counted until they finish."
          />
        )}
        {dataQuality.overrunBlockCount > 0 && (
          <QualityChip
            label="overrun blocks counted"
            value={String(dataQuality.overrunBlockCount)}
            title="Blocks that ran shorter/longer than planned; they executed, so their measured time counts."
          />
        )}
        {dataQuality.cancelledPlannedMinutes > 0 && (
          <QualityChip
            label="cancelled plan excluded"
            value={formatMinutes(dataQuality.cancelledPlannedMinutes)}
            title="Planned time of cancelled blocks — excluded from every total."
          />
        )}
        {dataQuality.excludedBreakMinutes > 0 && (
          <QualityChip
            label="breaks/buffers excluded"
            value={formatMinutes(dataQuality.excludedBreakMinutes)}
            title="Blocks of type break/buffer are rest and slack, not invested work."
          />
        )}
        {dataQuality.estimatedUnscheduledMinutes > 0 && (
          <QualityChip
            label="estimated, never scheduled"
            value={formatMinutes(dataQuality.estimatedUnscheduledMinutes)}
            title="Open tasks due in the period with an estimate but no time block — invisible workload."
          />
        )}
        {dataQuality.completedTasksWithoutTime > 0 && (
          <QualityChip
            label="tasks done with no tracked time"
            value={String(dataQuality.completedTasksWithoutTime)}
            title="Completed in the period but no block/session recorded the effort."
          />
        )}
        {dataQuality.blocksWithMissingParents > 0 && (
          <QualityChip
            label="records with missing parents"
            value={String(dataQuality.blocksWithMissingParents)}
            title="Blocks/sessions pointing to a task, project or goal that no longer exists."
          />
        )}
        {dataQuality.anomalousDurationCount > 0 && (
          <QualityChip
            label="anomalous durations capped"
            value={String(dataQuality.anomalousDurationCount)}
            title="Records with invalid or >24h intervals, capped for safety."
          />
        )}
      </div>

      {/* 2 · Carry-over */}
      {carryOver.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2.5" data-testid="carry-over-block">
          <button
            type="button"
            onClick={() => setShowCarry((s) => !s)}
            aria-expanded={showCarry}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="text-[13px] font-semibold text-amber-800">
              Carry-over — {carryOver.length} planned task{carryOver.length === 1 ? '' : 's'} slipped
            </span>
            <span className="text-xs text-amber-700">{showCarry ? 'Hide' : 'Show'}</span>
          </button>
          {showCarry && (
            <ul className="mt-2 divide-y divide-amber-100">
              {carryOver.map((item) => {
                const meta = CARRY_OUTCOME_META[item.outcome];
                return (
                  <li key={item.taskId} className="py-1.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{item.taskTitle}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {item.goalName} · {item.projectName}
                        {item.dueDate && ` · due ${formatDayShort(item.dueDate)}`}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 3 · Activity table */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder="Search activity…"
            aria-label="Search activity"
            className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        {selectedDayKey && (
          <button
            type="button"
            onClick={onClearDay}
            data-testid="clear-day-filter"
            className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
          >
            {selectedDayKey}
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
        <span className="text-[11px] text-slate-400 ml-auto tabular-nums">
          {filtered.length} record{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No activity matches the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="activity-table">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th scope="col" className="py-2 pr-2 font-semibold text-slate-500">Date</th>
                <th scope="col" className="py-2 pr-2 font-semibold text-slate-500">Activity</th>
                <th scope="col" className="py-2 pr-2 font-semibold text-slate-500 hidden md:table-cell">Goal · Project</th>
                <th scope="col" className="py-2 pr-2 font-semibold text-slate-500 text-right">Planned</th>
                <th scope="col" className="py-2 pr-2 font-semibold text-slate-500 text-right">Actual</th>
                <th scope="col" className="py-2 pr-2 font-semibold text-slate-500">Origin</th>
                <th scope="col" className="py-2 font-semibold text-slate-500 hidden sm:table-cell">Time source</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={`${row.source}-${row.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-1.5 pr-2 whitespace-nowrap text-slate-500 tabular-nums">
                    {formatDayShort(row.date)}
                  </td>
                  <td className="py-1.5 pr-2 max-w-[220px]">
                    <div className="font-medium text-slate-800 truncate">{row.title}</div>
                    {row.taskTitle && (
                      <div className="text-[10px] text-slate-400 truncate">task: {row.taskTitle}</div>
                    )}
                    <div className="text-[10px] text-slate-400 truncate md:hidden">
                      {row.goalName} · {row.projectName}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 hidden md:table-cell max-w-[180px]">
                    <div className="text-slate-600 truncate">{row.goalName}</div>
                    <div className="text-[10px] text-slate-400 truncate">{row.projectName}</div>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">
                    {row.plannedMinutes > 0 ? formatMinutes(row.plannedMinutes) : '—'}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold text-slate-900">
                    {row.actualMinutes > 0 ? formatMinutes(row.actualMinutes) : '—'}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                        row.source === 'session'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : row.plannedInAdvance
                            ? 'bg-slate-50 text-slate-600 border-slate-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {row.source === 'session' ? 'Session' : row.plannedInAdvance ? 'Planned' : 'Retro-logged'}
                    </span>
                    <span className="ml-1 text-[10px] text-slate-400">{row.status}</span>
                  </td>
                  <td className="py-1.5 hidden sm:table-cell">
                    {row.timeSource === 'none' ? (
                      <span className="text-[10px] text-slate-300">—</span>
                    ) : (
                      <span
                        title={
                          row.timeSource === 'measured'
                            ? 'Real start/end timestamps'
                            : 'Executed status exists, but no authoritative actual-time evidence exists'
                        }
                        className={`text-[10px] font-medium ${
                          row.timeSource === 'measured' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {row.timeSource}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > limit && (
            <div className="pt-3 text-center">
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
