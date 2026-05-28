'use client';

// src/components/WeeklyPlanning/ApprovePlanPanel.tsx
// Operational commit panel.
//
// Safety rules surfaced here (kept in sync with `commitDraft.classifyBlock`):
//   - blocking reasons must be empty;
//   - committableCount must be > 0;
//   - isCommitting must be false.
// Otherwise the button is disabled with explicit reasons. After commit, the
// result is displayed and the button stays disabled (no auto re-commit).

import type {
  CommitDraftResult,
  CommitBlockedReason,
  WeeklyPlanDraft,
} from '@/lib/weeklyPlanner';

export interface ApprovePlanPanelProps {
  draft: WeeklyPlanDraft;
  committableCount: number;
  skippedCount: number;
  blockedReasons: ReadonlyArray<CommitBlockedReason>;
  canCommit: boolean;
  isCommitting: boolean;
  commitResult: CommitDraftResult | null;
  onApprove: () => void;
}

export default function ApprovePlanPanel({
  draft,
  committableCount,
  skippedCount,
  blockedReasons,
  canCommit,
  isCommitting,
  commitResult,
  onApprove,
}: ApprovePlanPanelProps) {
  const wasCommitted = commitResult !== null && commitResult.status !== 'blocked';
  const buttonDisabled =
    !canCommit || isCommitting || wasCommitted;

  const buttonLabel = isCommitting
    ? 'Creazione TimeBlock in corso…'
    : wasCommitted
      ? '✓ Bozza approvata'
      : '✅ Approve and Create TimeBlocks';

  return (
    <section
      aria-label="Approve plan"
      className="rounded-2xl border border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
      data-testid="approve-plan-panel"
    >
      <header className="border-b border-blue-100 px-5 py-4">
        <h3 className="text-base font-semibold text-gray-900">
          Approvazione & commit
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Solo i blocchi mappati e non-maintenance diventano TimeBlock reali.
          Routine di manutenzione e blocchi ambigui sono saltati.
        </p>
      </header>

      <div className="grid gap-5 px-5 py-5 md:grid-cols-[1fr_auto] items-start">
        <div className="space-y-3">
          {/* Counts */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CountChip label="Committable" value={committableCount} tone="emerald" />
            <CountChip label="Skipped" value={skippedCount} tone="amber" />
            <CountChip
              label="Totale bozza"
              value={draft.blocks.length}
              tone="slate"
            />
          </div>

          {/* Safety bullets */}
          <ul className="text-xs text-gray-600 space-y-1 list-disc pl-5">
            <li>
              Only mapped, non-maintenance blocks will be converted into real
              TimeBlocks.
            </li>
            <li>Maintenance routines are skipped in this MVP.</li>
            <li>
              Unmapped or needs-review blocks must be fixed before commit.
            </li>
          </ul>

          {/* Blocking reasons (when commit is not allowed yet) */}
          {!wasCommitted && blockedReasons.length > 0 && (
            <BlockedReasonsList reasons={blockedReasons} />
          )}

          {/* Commit result (success / partial / blocked from server side) */}
          {commitResult && <CommitResultPanel result={commitResult} />}
        </div>

        <div className="md:w-64 md:shrink-0 space-y-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={buttonDisabled}
            className={`w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold shadow-sm transition ${
              buttonDisabled
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white hover:from-emerald-700 hover:to-blue-700'
            }`}
            data-testid="approve-button"
          >
            {isCommitting && (
              <span
                className="inline-block w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin"
                aria-hidden
              />
            )}
            <span>{buttonLabel}</span>
          </button>
          {!canCommit && !wasCommitted && (
            <p className="text-[11px] text-rose-600 text-center">
              Risolvere i blocchi qui sotto prima di approvare.
            </p>
          )}
          {wasCommitted && (
            <p
              className="text-[11px] text-emerald-700 text-center"
              data-testid="approve-already-committed"
            >
              Bozza già approvata. Per ricommittare, modifica gli intenti e
              rigenera la bozza.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'slate';
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold ${cls}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function BlockedReasonsList({
  reasons,
}: {
  reasons: ReadonlyArray<CommitBlockedReason>;
}) {
  return (
    <div
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"
      data-testid="approve-blocked-reasons"
    >
      <p className="text-xs font-semibold text-rose-800">
        Cannot commit yet:
      </p>
      <ul className="mt-1 text-xs text-rose-700 list-disc pl-5 space-y-0.5">
        {reasons.map((r, i) => (
          <li key={`${r.type}-${r.blockId ?? i}-${i}`}>{r.message}</li>
        ))}
      </ul>
    </div>
  );
}

function CommitResultPanel({ result }: { result: CommitDraftResult }) {
  const tone =
    result.status === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : result.status === 'partial'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-rose-200 bg-rose-50 text-rose-800';
  const statusLabel =
    result.status === 'success'
      ? 'Success'
      : result.status === 'partial'
        ? 'Partial'
        : 'Blocked';
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${tone}`}
      data-testid="commit-result"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider">
          Commit · {statusLabel}
        </p>
        <p className="text-[10px] tabular-nums">
          created {result.createdCount} · skipped {result.skippedCount} ·
          duplicates {result.duplicateCount}
        </p>
      </div>
      <p className="mt-1 text-xs">{result.message}</p>
      {result.skipped.length > 0 && (
        <details className="mt-1 text-[11px]">
          <summary className="cursor-pointer font-medium">
            Dettaglio blocchi saltati ({result.skipped.length})
          </summary>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {result.skipped.slice(0, 12).map((s) => (
              <li key={s.blockId}>
                <span className="font-medium">{s.label}</span> —{' '}
                <span className="uppercase tracking-wider">{s.reason}</span>:{' '}
                {s.message}
              </li>
            ))}
            {result.skipped.length > 12 && (
              <li className="italic">… altri {result.skipped.length - 12}.</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
