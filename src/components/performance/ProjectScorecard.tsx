'use client';

// Project Scorecard — sortable table of every project's period performance.
// Desktop: dense table with tabular numerals. Mobile (< sm): stacked cards.
// "Focus" scopes the dashboard to the project (real drill-down, not a modal).

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Crosshair } from 'lucide-react';
import type { ProjectPerformance } from '@/lib/performance/types';
import {
  formatDaysAgo,
  formatMinutes,
  formatSignedMinutes,
} from '@/lib/performance/format';
import { STATUS_META, describeStatus } from './theme';

interface ProjectScorecardProps {
  projects: ProjectPerformance[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

type SortKey =
  | 'projectName'
  | 'plannedMinutes'
  | 'actualMinutes'
  | 'varianceMinutes'
  | 'completedTasksInPeriod'
  | 'openTasks'
  | 'carryOverTasks'
  | 'lastActivityAt';

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean; title?: string }> = [
  { key: 'projectName', label: 'Project', numeric: false },
  { key: 'plannedMinutes', label: 'Planned', numeric: true },
  { key: 'actualMinutes', label: 'Actual', numeric: true },
  { key: 'varianceMinutes', label: 'Variance', numeric: true, title: 'Actual − planned' },
  { key: 'completedTasksInPeriod', label: 'Done', numeric: true, title: 'Tasks completed in the period' },
  { key: 'openTasks', label: 'Open', numeric: true, title: 'Currently open tasks' },
  { key: 'carryOverTasks', label: 'Carry', numeric: true, title: 'Planned tasks that slipped' },
  { key: 'lastActivityAt', label: 'Last activity', numeric: true },
];

function sortValue(p: ProjectPerformance, key: SortKey): number | string {
  if (key === 'projectName') return p.projectName.toLowerCase();
  if (key === 'lastActivityAt') return p.lastActivityAt ? p.lastActivityAt.getTime() : 0;
  return p[key];
}

export default function ProjectScorecard({
  projects,
  activeProjectId,
  onSelectProject,
}: ProjectScorecardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('actualMinutes');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const rows = [...projects];
    rows.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [projects, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'projectName' ? 'asc' : 'desc');
    }
  };

  if (projects.length === 0) {
    return (
      <section
        aria-label="Project performance"
        className="rounded-2xl border border-slate-200 bg-white p-5"
        data-testid="project-scorecard"
      >
        <h3 className="text-sm font-bold text-slate-900 mb-1">Project Scorecard</h3>
        <p className="text-sm text-slate-400 py-4 text-center">No projects with data in this period.</p>
      </section>
    );
  }

  return (
    <section
      aria-label="Project performance"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
      data-testid="project-scorecard"
    >
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-900">Project Scorecard</h3>
        <p className="text-xs text-slate-500">
          Which projects advanced, which absorbed time without progress — sort any column
        </p>
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs" data-testid="project-table">
          <thead>
            <tr className="border-b border-slate-200">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={`py-2 px-2 font-semibold text-slate-500 ${col.numeric ? 'text-right' : 'text-left'}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    title={col.title}
                    className={`inline-flex items-center gap-1 hover:text-slate-800 ${
                      col.numeric ? 'flex-row-reverse' : ''
                    } ${sortKey === col.key ? 'text-slate-800' : ''}`}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="w-3 h-3" aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-40" aria-hidden="true" />
                    )}
                  </button>
                </th>
              ))}
              <th scope="col" className="py-2 px-2 text-right font-semibold text-slate-500">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((project) => {
              const status = STATUS_META[project.status];
              const isActive = activeProjectId === project.projectId;
              return (
                <tr
                  key={project.projectId ?? 'none'}
                  data-testid={`project-row-${project.projectId}`}
                  className={`border-b border-slate-100 ${isActive ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}
                >
                  <td className="py-2 px-2 max-w-[220px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectProject(isActive ? null : project.projectId)}
                        aria-pressed={isActive}
                        title={isActive ? 'Clear project focus' : 'Focus dashboard on this project'}
                        className={`p-1 rounded-md border ${
                          isActive
                            ? 'border-blue-300 bg-blue-100 text-blue-700'
                            : 'border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200'
                        }`}
                      >
                        <Crosshair className="w-3 h-3" aria-hidden="true" />
                      </button>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{project.projectName}</div>
                        <div className="text-[10px] text-slate-400 truncate">{project.goalName}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                    {formatMinutes(project.plannedMinutes)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold text-slate-900">
                    {formatMinutes(project.actualMinutes)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                    {formatSignedMinutes(project.varianceMinutes)}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                    {project.completedTasksInPeriod}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">{project.openTasks}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-600">
                    {project.carryOverTasks}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-slate-500">
                    {formatDaysAgo(project.lastActivityAt)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}
                      title={describeStatus(project.status, project)}
                    >
                      <span aria-hidden="true">{status.symbol}</span>
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="sm:hidden space-y-2">
        {sorted.map((project) => {
          const status = STATUS_META[project.status];
          const isActive = activeProjectId === project.projectId;
          return (
            <li key={project.projectId ?? 'none'}>
              <button
                type="button"
                onClick={() => onSelectProject(isActive ? null : project.projectId)}
                aria-pressed={isActive}
                className={`w-full text-left rounded-xl border px-3 py-2.5 ${
                  isActive ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-900 truncate">
                      {project.projectName}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{project.goalName}</div>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}
                    title={describeStatus(project.status, project)}
                  >
                    <span aria-hidden="true">{status.symbol}</span>
                    {status.label}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-[11px] text-slate-500 tabular-nums">
                  <span>
                    Actual <strong className="text-slate-800">{formatMinutes(project.actualMinutes)}</strong>
                  </span>
                  <span>
                    Plan <strong className="text-slate-800">{formatMinutes(project.plannedMinutes)}</strong>
                  </span>
                  <span>
                    Done <strong className="text-slate-800">{project.completedTasksInPeriod}</strong> · Open{' '}
                    <strong className="text-slate-800">{project.openTasks}</strong>
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
