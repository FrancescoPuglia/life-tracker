'use client';

// Toolbar — period switcher, navigation, and the single filter row that
// scopes every panel below it (filters never live inside a chart card).

import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { Goal, Project } from '@/types';
import type { PerformanceFilters, PerformancePeriod, PerformancePeriodType } from '@/lib/performance/types';
import { UNASSIGNED_ID } from '@/lib/performance/metrics';
import { formatPeriodLabel } from '@/lib/performance/format';

interface PerfToolbarProps {
  period: PerformancePeriod;
  filters: PerformanceFilters;
  goals: Goal[];
  projects: Project[];
  hasUnassigned: boolean;
  onPeriodTypeChange: (type: PerformancePeriodType) => void;
  onNavigate: (offset: number) => void;
  onToday: () => void;
  onFiltersChange: (filters: PerformanceFilters) => void;
  onReset: () => void;
}

const PERIOD_TYPES: Array<[PerformancePeriodType, string]> = [
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
];

export default function PerfToolbar({
  period,
  filters,
  goals,
  projects,
  hasUnassigned,
  onPeriodTypeChange,
  onNavigate,
  onToday,
  onFiltersChange,
  onReset,
}: PerfToolbarProps) {
  const visibleProjects = filters.goalId && filters.goalId !== UNASSIGNED_ID
    ? projects.filter((p) => p.goalId === filters.goalId)
    : projects;

  const anyFilter =
    filters.goalId !== null || filters.projectId !== null || filters.source !== 'all';

  const selectClass =
    'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 max-w-[180px]';

  return (
    <div className="space-y-3" data-testid="perf-toolbar">
      {/* Row 1: period type + navigation */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Period type" className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          {PERIOD_TYPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`period-${value}`}
              onClick={() => onPeriodTypeChange(value)}
              aria-pressed={period.type === value}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                period.type === value
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            aria-label="Previous period"
            data-testid="period-prev"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="px-2 min-w-[180px] text-center">
            <span className="text-sm font-bold text-slate-900" data-testid="period-label">
              {formatPeriodLabel(period)}
            </span>
            {period.isCurrent && (
              <span className="ml-2 inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-semibold text-blue-700 align-middle">
                In progress
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            aria-label="Next period"
            data-testid="period-next"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
          {!period.isCurrent && (
            <button
              type="button"
              onClick={onToday}
              data-testid="period-today"
              className="ml-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              Current
            </button>
          )}
        </div>
      </div>

      {/* Row 2: filters — they scope everything below */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="perf-goal-filter">
          Filter by goal
        </label>
        <select
          id="perf-goal-filter"
          data-testid="filter-goal"
          className={selectClass}
          value={filters.goalId ?? ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              goalId: e.target.value || null,
              // A goal change invalidates a project selection outside it.
              projectId: null,
            })
          }
        >
          <option value="">All goals</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
          {hasUnassigned && <option value={UNASSIGNED_ID}>Unassigned time</option>}
        </select>

        <label className="sr-only" htmlFor="perf-project-filter">
          Filter by project
        </label>
        <select
          id="perf-project-filter"
          data-testid="filter-project"
          className={selectClass}
          value={filters.projectId ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, projectId: e.target.value || null })}
          disabled={filters.goalId === UNASSIGNED_ID}
        >
          <option value="">All projects</option>
          {visibleProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="perf-source-filter">
          Filter by time source
        </label>
        <select
          id="perf-source-filter"
          data-testid="filter-source"
          className={selectClass}
          value={filters.source}
          onChange={(e) =>
            onFiltersChange({ ...filters, source: e.target.value as PerformanceFilters['source'] })
          }
        >
          <option value="all">Planned + unplanned</option>
          <option value="planned">Planned only</option>
          <option value="unplanned">Unplanned only</option>
        </select>

        {anyFilter && (
          <button
            type="button"
            onClick={onReset}
            data-testid="filter-reset"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
