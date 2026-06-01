'use client';

// src/components/GoalArchitect/GoalArchitectIssuesPanel.tsx
// Groups draft.issues by severity. Errors first, then warnings, then info.

import type {
  GoalArchitectIssue,
  GoalArchitectSeverity,
} from '@/lib/goalArchitect';
import { severityStyle } from './goalArchitectUi';

export interface GoalArchitectIssuesPanelProps {
  issues: ReadonlyArray<GoalArchitectIssue>;
}

const ORDER: ReadonlyArray<GoalArchitectSeverity> = ['error', 'warning', 'info'];

export default function GoalArchitectIssuesPanel({
  issues,
}: GoalArchitectIssuesPanelProps) {
  const grouped = new Map<GoalArchitectSeverity, GoalArchitectIssue[]>([
    ['error', []],
    ['warning', []],
    ['info', []],
  ]);
  for (const issue of issues) {
    const bucket = grouped.get(issue.severity);
    if (bucket) bucket.push(issue);
  }

  const clean = issues.length === 0;

  return (
    <section
      aria-label="Draft issues"
      data-testid="goal-architect-issues"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Issues & warnings
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Errors block the commit. Warnings & info are advisory.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {ORDER.map((sev) => (
            <span
              key={sev}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${severityStyle(sev).badge}`}
            >
              {severityStyle(sev).label}
              <span className="tabular-nums">
                {grouped.get(sev)?.length ?? 0}
              </span>
            </span>
          ))}
        </div>
      </header>

      {clean ? (
        <div
          className="px-5 py-6 text-center"
          data-testid="goal-architect-issues-clean"
        >
          <p className="text-sm font-medium text-emerald-700">
            No blocking issues detected.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            La bozza è strutturalmente valida.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {ORDER.flatMap((sev) =>
            (grouped.get(sev) ?? []).map((issue) => (
              <IssueRow key={issue.id} issue={issue} />
            )),
          )}
        </ul>
      )}
    </section>
  );
}

function IssueRow({ issue }: { issue: GoalArchitectIssue }) {
  const s = severityStyle(issue.severity);
  return (
    <li
      data-testid={`goal-architect-issue-${issue.severity}`}
      className={`px-5 py-3 flex items-start gap-3 border-l-4 ${s.accent} bg-white`}
    >
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.badge} shrink-0`}
      >
        {s.label}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-gray-800">{issue.message}</p>
        {issue.suggestion && (
          <p className="text-xs text-gray-500 mt-1">{issue.suggestion}</p>
        )}
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
          {issue.code.replace(/_/g, ' ')}
          {issue.entityKind ? ` · ${issue.entityKind}` : ''}
          {issue.field ? ` · ${issue.field}` : ''}
        </p>
      </div>
    </li>
  );
}
