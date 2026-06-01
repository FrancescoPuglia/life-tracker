'use client';

// src/components/GoalArchitect/GoalArchitectApprovePanel.tsx
// Operational commit panel.
//
// Safety contract (kept in sync with commitGoalArchitectureDraft):
//   • blockedReasons must be empty;
//   • draft.summary.canCommit must be true;
//   • isCommitting must be false;
//   • a previous success/partial commit disables further attempts.
// The button is otherwise rendered as disabled with explicit copy.

import type {
  GoalArchitectBlockedReason,
  GoalArchitectCommitResult,
  GoalArchitectureDraft,
} from '@/lib/goalArchitect';

export interface GoalArchitectApprovePanelProps {
  draft: GoalArchitectureDraft;
  canCommit: boolean;
  blockedReasons: ReadonlyArray<GoalArchitectBlockedReason>;
  isCommitting: boolean;
  commitResult: GoalArchitectCommitResult | null;
  onApprove?: () => void;
}

export default function GoalArchitectApprovePanel({
  draft,
  canCommit,
  blockedReasons,
  isCommitting,
  commitResult,
  onApprove,
}: GoalArchitectApprovePanelProps) {
  const { status, summary } = draft;
  const wasCommitted =
    commitResult !== null &&
    (commitResult.status === 'success' || commitResult.status === 'partial');
  const buttonDisabled =
    !canCommit ||
    isCommitting ||
    wasCommitted ||
    !onApprove;

  const buttonLabel = isCommitting
    ? 'Creating Goal/Projects/Tasks…'
    : wasCommitted
      ? '✓ Draft committed'
      : !onApprove
        ? '🔒 Commit not wired'
        : '🏗️ Approve & create real entities';

  return (
    <section
      aria-label="Approve panel"
      data-testid="goal-architect-approve"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Approval</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Only the explicit click below creates real Goal, Projects, Tasks
            and Key Results. Nothing happens during typing or generation.
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="px-5 py-4 grid gap-3 sm:grid-cols-3">
        <StatPill
          label="Errors"
          value={summary.errorCount}
          color={summary.errorCount > 0 ? 'rose' : 'emerald'}
        />
        <StatPill
          label="Warnings"
          value={summary.warningCount}
          color={summary.warningCount > 0 ? 'amber' : 'sky'}
        />
        <StatPill
          label="Can commit"
          value={canCommit ? 'YES' : 'NO'}
          color={canCommit ? 'emerald' : 'rose'}
        />
      </div>

      {!wasCommitted && blockedReasons.length > 0 && (
        <BlockedReasonsList reasons={blockedReasons} />
      )}

      {commitResult && <CommitResultPanel result={commitResult} />}

      <div className="px-5 pb-4 space-y-2">
        {canCommit ? (
          <p
            data-testid="goal-architect-approve-ready"
            className="text-sm text-emerald-700"
          >
            Draft is structurally ready. Click below to convert it into real
            Goal, Projects, Tasks and Key Results.
          </p>
        ) : (
          <p
            data-testid="goal-architect-approve-blocked"
            className="text-sm text-rose-700"
          >
            Resolve blocking errors before this draft can be committed.
          </p>
        )}

        <div className="pt-2">
          <button
            type="button"
            disabled={buttonDisabled}
            aria-disabled={buttonDisabled}
            onClick={() => {
              if (onApprove && !buttonDisabled) onApprove();
            }}
            data-testid="goal-architect-commit-button"
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition ${
              buttonDisabled
                ? 'border border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white hover:from-emerald-700 hover:to-blue-700'
            }`}
          >
            {buttonLabel}
          </button>
          <p className="mt-1.5 text-[11px] text-gray-400">
            Real creation uses only the existing DataProvider create functions.
            No direct database writes.
          </p>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function StatusBadge({
  status,
}: {
  status: GoalArchitectureDraft['status'];
}) {
  const map: Record<
    GoalArchitectureDraft['status'],
    { label: string; cls: string }
  > = {
    draft: {
      label: 'Draft',
      cls: 'border-slate-200 bg-slate-50 text-slate-700',
    },
    valid: {
      label: 'Valid',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    invalid: {
      label: 'Invalid',
      cls: 'border-rose-200 bg-rose-50 text-rose-700',
    },
    committed: {
      label: 'Committed',
      cls: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${s.cls}`}
      data-testid={`goal-architect-status-${status}`}
    >
      {s.label}
    </span>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: 'rose' | 'amber' | 'emerald' | 'sky';
}) {
  const cls =
    color === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : color === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : color === 'emerald'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-sky-200 bg-sky-50 text-sky-700';
  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function BlockedReasonsList({
  reasons,
}: {
  reasons: ReadonlyArray<GoalArchitectBlockedReason>;
}) {
  return (
    <div
      data-testid="goal-architect-blocked-reasons"
      className="mx-5 mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3"
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold text-rose-700">
        {reasons.length === 1
          ? 'Blocking reason'
          : `Blocking reasons (${reasons.length})`}
      </p>
      <ul className="mt-1.5 space-y-1 text-xs text-rose-800">
        {reasons.map((r) => (
          <li key={`${r.code}-${r.entityId ?? ''}`} className="flex gap-2">
            <span className="opacity-60">·</span>
            <span>{r.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommitResultPanel({
  result,
}: {
  result: GoalArchitectCommitResult;
}) {
  const palette: Record<
    GoalArchitectCommitResult['status'],
    { tone: string; testId: string; label: string }
  > = {
    success: {
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      testId: 'goal-architect-commit-success',
      label: 'Commit successful',
    },
    partial: {
      tone: 'border-amber-200 bg-amber-50 text-amber-800',
      testId: 'goal-architect-commit-partial',
      label: 'Partial commit',
    },
    blocked: {
      tone: 'border-rose-200 bg-rose-50 text-rose-800',
      testId: 'goal-architect-commit-blocked',
      label: 'Commit blocked',
    },
    failed: {
      tone: 'border-rose-200 bg-rose-50 text-rose-800',
      testId: 'goal-architect-commit-failed',
      label: 'Commit failed',
    },
  };
  const p = palette[result.status];
  return (
    <div
      data-testid={p.testId}
      className={`mx-5 mb-4 rounded-xl border px-4 py-3 ${p.tone}`}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold">
        {p.label}
      </p>
      <p className="mt-1 text-sm">{result.message}</p>
      <CountList
        items={[
          { label: 'Goals', count: result.createdGoals.length },
          { label: 'Projects', count: result.createdProjects.length },
          { label: 'Tasks', count: result.createdTasks.length },
          { label: 'Key Results', count: result.createdKeyResults.length },
          { label: 'Duplicates reused', count: result.duplicates.length },
          { label: 'Skipped', count: result.skipped.length },
          { label: 'Errors', count: result.errors.length },
        ]}
      />
      {result.errors.length > 0 && (
        <ul className="mt-2 text-[11px] text-rose-700 space-y-0.5">
          {result.errors.map((err) => (
            <li key={`${err.entityKind}-${err.draftId}`}>
              · {err.entityKind} &ldquo;{err.title}&rdquo;: {err.message}
            </li>
          ))}
        </ul>
      )}
      {(result.status === 'success' || result.status === 'partial') && (
        <p
          className="mt-2 text-[10px] leading-snug opacity-80"
          data-testid="goal-architect-gai-key-note"
        >
          Each created entity carries a hidden{' '}
          <code className="font-mono">GAI_KEY</code> marker in its description.
          Please don&rsquo;t delete it — it prevents accidental duplicates if
          you re-commit this draft after editing.
        </p>
      )}
    </div>
  );
}

function CountList({
  items,
}: {
  items: ReadonlyArray<{ label: string; count: number }>;
}) {
  const nonZero = items.filter((i) => i.count > 0);
  if (nonZero.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      {nonZero.map((i) => (
        <li key={i.label} className="tabular-nums">
          <span className="font-semibold">{i.count}</span>{' '}
          <span className="opacity-80">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}
