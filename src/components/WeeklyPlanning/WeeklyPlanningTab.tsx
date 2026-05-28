'use client';

// src/components/WeeklyPlanning/WeeklyPlanningTab.tsx
// Top-level orchestrator for the Weekly Planning Intelligence feature.
//
// Architecture:
//   `WeeklyPlanningTab`   — default export, consumes useDataContext()
//                           and supplies real createTimeBlock + existing blocks.
//   `WeeklyPlanningView`  — named export, props-driven, no provider needed
//                           (used by tests).
//
// Prompt 4 additions:
//   - draft is persisted to localStorage on Generate.
//   - draft is hydrated from localStorage on mount.
//   - Approve drives a safe commit pipeline via createTimeBlock.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateWpiWeeklyAnalytics,
  commitWeeklyPlanDraft,
  deleteWeeklyPlanDraft,
  extractWpiKey,
  findMatchingDraftForWeek,
  generateWeeklyDraft,
  isTimeBlockInWeek,
  isWpiTimeBlock,
  loadWeeklyPlanDraft,
  parseWpiKey,
  saveWeeklyPlanDraft,
  validateDraftForCommit,
  type CommitDraftResult,
  type CommitTimeBlockInput,
  type ExistingTimeBlockSnapshot,
  type GoalLike,
  type ProjectLike,
  type TaskLike,
  type WeeklyPlanDraft,
  type WeeklyIntentRaw,
  type WpiAnalyticsResult,
} from '@/lib/weeklyPlanner';
import { useDataContext } from '@/providers/DataProvider';
import ApprovePlanPanel from './ApprovePlanPanel';
import WeeklyIntelligenceReviewPanel from './WeeklyIntelligenceReviewPanel';
import DraftWeekCalendar from './DraftWeekCalendar';
import GoalMappingReview from './GoalMappingReview';
import PlanWarningsPanel from './PlanWarningsPanel';
import RealismScorePanel from './RealismScorePanel';
import WeeklyIntentInput from './WeeklyIntentInput';
import WeeklyPlanningEmptyState from './WeeklyPlanningEmptyState';
import {
  toGoalLikes,
  toProjectLikes,
  toTaskLikes,
  type GoalSource,
  type ProjectSource,
  type TaskSource,
} from './weeklyPlanningAdapters';

// ============================================================================
// EXAMPLE TEXT (Phase 3 spec, anchored on the 5 user goals)
// ============================================================================

export const WEEKLY_PLANNING_EXAMPLE_TEXT =
  `Ogni giorno sveglia alle 7.
Career deep work ogni mattina 90 minuti.
Lunedì Catalana 2 ore.
Martedì Sveshnikov 90 minuti.
Giovedì Benko 90 minuti.
Palestra 4 volte a settimana.
Leggere ogni sera 30 minuti.
Presence upgrade sabato 1 ora.
Review settimanale domenica 45 minuti.`;

// ============================================================================
// VIEW (provider-free, fully testable)
// ============================================================================

export interface WeeklyPlanningViewProps {
  goals: ReadonlyArray<GoalLike>;
  projects: ReadonlyArray<ProjectLike>;
  tasks: ReadonlyArray<TaskLike>;
  existingTimeBlocks: ReadonlyArray<ExistingTimeBlockSnapshot>;
  userIdOrLocal: string;
  onCommitBlock: (input: CommitTimeBlockInput) => Promise<unknown> | unknown;
  /** Fixed "now" — only set in tests to avoid date drift. */
  nowProvider?: () => Date;
}

export function WeeklyPlanningView({
  goals,
  projects,
  tasks,
  existingTimeBlocks,
  userIdOrLocal,
  onCommitBlock,
  nowProvider,
}: WeeklyPlanningViewProps) {
  const [rawText, setRawText] = useState<string>('');
  const [draft, setDraft] = useState<WeeklyPlanDraft | null>(null);
  const [loadedFromStorage, setLoadedFromStorage] = useState<boolean>(false);
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitResult, setCommitResult] = useState<CommitDraftResult | null>(null);
  // Synchronous in-flight latch: React state updates are async, so two
  // back-to-back clicks both observe `isCommitting === false`. A ref flips
  // immediately and stops the second call before it spawns a duplicate.
  const commitInFlightRef = useRef<boolean>(false);

  // Stable Monday for the current week — re-computed only if `nowProvider`
  // identity changes (tests pass a constant, prod uses the closure default).
  const weekStartISO = useMemo(
    () => mondayISO(nowProvider ? nowProvider() : new Date()),
    [nowProvider],
  );

  // ----- Hydrate from localStorage on mount / user change ---------------
  useEffect(() => {
    if (!userIdOrLocal) return;
    const loaded = loadWeeklyPlanDraft({ userIdOrLocal, weekStartISO });
    if (loaded) {
      setDraft(loaded);
      setRawText(loaded.sourceIntent.text);
      setLoadedFromStorage(true);
      setHasSavedDraft(true);
      setCommitResult(null);
    } else {
      setHasSavedDraft(false);
    }
  }, [userIdOrLocal, weekStartISO]);

  // ----- Actions --------------------------------------------------------

  const handleGenerate = useCallback(() => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const now = nowProvider ? nowProvider() : new Date();
    const raw: WeeklyIntentRaw = {
      id: `intent-${now.getTime()}`,
      text: trimmed,
      weekStartISO,
      createdAtISO: now.toISOString(),
    };
    const result = generateWeeklyDraft({
      raw,
      goals: [...goals],
      projects: [...projects],
      tasks: [...tasks],
    });
    setDraft(result.draft);
    setLoadedFromStorage(false);
    setCommitResult(null);
    const saved = saveWeeklyPlanDraft({
      userIdOrLocal,
      weekStartISO,
      draft: result.draft,
    });
    setHasSavedDraft(saved);
  }, [rawText, goals, projects, tasks, weekStartISO, userIdOrLocal, nowProvider]);

  const handleClear = useCallback(() => {
    setRawText('');
    setDraft(null);
    setCommitResult(null);
    setLoadedFromStorage(false);
    // Clear also drops the persisted draft so the user can't be confused
    // by a textbox-clear that secretly leaves data behind on disk.
    if (hasSavedDraft) {
      deleteWeeklyPlanDraft({ userIdOrLocal, weekStartISO });
      setHasSavedDraft(false);
    }
  }, [hasSavedDraft, userIdOrLocal, weekStartISO]);

  const handleLoadExample = useCallback(() => {
    setRawText(WEEKLY_PLANNING_EXAMPLE_TEXT);
  }, []);

  const handleDeleteSavedDraft = useCallback(() => {
    deleteWeeklyPlanDraft({ userIdOrLocal, weekStartISO });
    setHasSavedDraft(false);
    setLoadedFromStorage(false);
  }, [userIdOrLocal, weekStartISO]);

  const handleApprove = useCallback(async () => {
    if (!draft) return;
    if (commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    setIsCommitting(true);
    try {
      const result = await commitWeeklyPlanDraft({
        draft,
        existingTimeBlocks,
        createTimeBlock: onCommitBlock,
      });
      setCommitResult(result);
    } finally {
      commitInFlightRef.current = false;
      setIsCommitting(false);
    }
  }, [draft, existingTimeBlocks, onCommitBlock]);

  // ----- Derived data ----------------------------------------------------

  const validation = useMemo(() => {
    if (!draft) return null;
    return validateDraftForCommit(draft, existingTimeBlocks);
  }, [draft, existingTimeBlocks]);

  const mappings = useMemo(() => {
    if (!draft) return [];
    const seen = new Map<
      string,
      NonNullable<typeof draft.blocks[number]['mapping']>
    >();
    for (const b of draft.blocks) {
      if (b.mapping && !seen.has(b.intentId)) {
        seen.set(b.intentId, b.mapping);
      }
    }
    return draft.parsedIntents.map((intent) => {
      const m = seen.get(intent.id);
      if (m) return m;
      return {
        intentId: intent.id,
        status: 'unmapped' as const,
        confidence: 0,
        reason: 'Intento non programmato — nessun blocco generato',
        matchedKeywords: [] as string[],
      };
    });
  }, [draft]);

  const summary = useMemo(() => {
    if (!draft) return null;
    return {
      intents: draft.parsedIntents.length,
      blocks: draft.blocks.length,
      conflicts: draft.conflicts.length,
      warnings: draft.warnings.length,
      score: draft.realismScore.overallScore,
      coverage: draft.realismScore.goalCoverageScore,
    };
  }, [draft]);

  // Plan-vs-actual analytics — recomputed when the real TimeBlock list moves.
  const analyticsResult = useMemo<WpiAnalyticsResult | null>(() => {
    // Collect the draftIds of WPI-tagged blocks already in the current week,
    // so the matched draft is only adopted when at least one real TimeBlock
    // actually came from it (prevents apples-vs-oranges calibration after a
    // user has re-generated mid-week).
    const draftIdsInPlay = new Set<string>();
    for (const b of existingTimeBlocks) {
      if (!isTimeBlockInWeek(b, weekStartISO)) continue;
      if (!isWpiTimeBlock(b)) continue;
      const key = extractWpiKey(b.notes);
      if (!key) continue;
      const parsed = parseWpiKey(key);
      if (parsed) draftIdsInPlay.add(parsed.draftId);
    }
    const matchedDraft = findMatchingDraftForWeek({
      userIdOrLocal,
      weekStartISO,
      draftIdsInPlay: Array.from(draftIdsInPlay),
    });
    return calculateWpiWeeklyAnalytics({
      allTimeBlocks: existingTimeBlocks,
      weekStartISO,
      matchedDraft,
    });
    // commitResult is included because committing changes existingTimeBlocks
    // upstream — when the parent rerenders with new blocks, this recomputes.
  }, [existingTimeBlocks, userIdOrLocal, weekStartISO, commitResult]);

  // ----- Render ----------------------------------------------------------

  return (
    <div className="space-y-6" data-testid="weekly-planning-view">
      <Header />

      <WeeklyIntentInput
        value={rawText}
        onChange={setRawText}
        onGenerate={handleGenerate}
        onClear={handleClear}
        onLoadExample={handleLoadExample}
      />

      <DraftStatusBar
        loadedFromStorage={loadedFromStorage}
        hasSavedDraft={hasSavedDraft}
        generatedAtISO={draft?.generatedAtISO}
        weekStartISO={weekStartISO}
        onDeleteSavedDraft={handleDeleteSavedDraft}
      />

      {summary && (
        <SummaryRow
          intents={summary.intents}
          blocks={summary.blocks}
          conflicts={summary.conflicts}
          warnings={summary.warnings}
          score={summary.score}
          coverage={summary.coverage}
        />
      )}

      {!draft && (
        <WeeklyPlanningEmptyState onLoadExample={handleLoadExample} />
      )}

      {draft && (
        <>
          <GoalMappingReview
            intents={draft.parsedIntents}
            mappings={mappings}
            goals={goals}
            projects={projects}
            tasks={tasks}
          />
          <DraftWeekCalendar
            blocks={draft.blocks}
            conflicts={draft.conflicts}
            warnings={draft.warnings}
          />
          <PlanWarningsPanel
            conflicts={draft.conflicts}
            warnings={draft.warnings}
          />
          <RealismScorePanel score={draft.realismScore} />
          <ApprovePlanPanel
            draft={draft}
            committableCount={validation?.committableBlocks.length ?? 0}
            skippedCount={validation?.skipped.length ?? 0}
            blockedReasons={validation?.blockedReasons ?? []}
            canCommit={validation?.canCommit ?? false}
            isCommitting={isCommitting}
            commitResult={commitResult}
            onApprove={handleApprove}
          />
        </>
      )}

      {/* Review panel — always shown after the first draft is generated.
          It owns its own empty/partial-data states, so we render it
          unconditionally once the user has interacted with the feature. */}
      {(draft || (analyticsResult && analyticsResult.weekly.generatedBlocks > 0)) && (
        <WeeklyIntelligenceReviewPanel result={analyticsResult} />
      )}
    </div>
  );
}

// ============================================================================
// CONTAINER (default export — consumes useDataContext)
// ============================================================================

export default function WeeklyPlanningTab() {
  const data = useDataContext();
  const goals = useMemo<GoalLike[]>(
    () => toGoalLikes(data.goals as ReadonlyArray<GoalSource>),
    [data.goals],
  );
  const projects = useMemo<ProjectLike[]>(
    () => toProjectLikes(data.projects as ReadonlyArray<ProjectSource>),
    [data.projects],
  );
  const tasks = useMemo<TaskLike[]>(
    () => toTaskLikes(data.tasks as ReadonlyArray<TaskSource>),
    [data.tasks],
  );
  const existingTimeBlocks = useMemo<ExistingTimeBlockSnapshot[]>(
    () =>
      data.timeBlocks.map((b) => ({
        id: b.id,
        title: b.title,
        notes: b.notes,
        startTime: b.startTime,
        endTime: b.endTime,
        // status/type carried through so the WPI analytics layer can
        // classify each block (completed / missed / pending).
        status: b.status,
        type: b.type,
        taskId: b.taskId,
        projectId: b.projectId,
        goalId: b.goalId,
      })),
    [data.timeBlocks],
  );
  const userIdOrLocal = data.userId && data.userId.length > 0 ? data.userId : 'local';

  // `createTimeBlock` accepts `Partial<TimeBlock>`. Our payload is a strict
  // subset of those fields, so the cast is structurally safe.
  const handleCommitBlock = useCallback(
    async (input: CommitTimeBlockInput) => {
      await data.createTimeBlock(input);
    },
    [data],
  );

  return (
    <WeeklyPlanningView
      goals={goals}
      projects={projects}
      tasks={tasks}
      existingTimeBlocks={existingTimeBlocks}
      userIdOrLocal={userIdOrLocal}
      onCommitBlock={handleCommitBlock}
    />
  );
}

// ============================================================================
// Sub-components & helpers
// ============================================================================

function Header() {
  return (
    <header className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 px-5 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-blue-700">
            Weekly Planning Intelligence
          </p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            Da intenzione settimanale a bozza connessa ai Goal
          </h2>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            La bozza viene salvata in locale. L&apos;approvazione crea veri
            TimeBlock solo dopo le tue conferme di sicurezza.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge color="blue">Deterministic MVP</Badge>
          <Badge color="amber">Draft saved locally</Badge>
          <Badge color="indigo">Commit via DataProvider</Badge>
        </div>
      </div>
    </header>
  );
}

interface DraftStatusBarProps {
  loadedFromStorage: boolean;
  hasSavedDraft: boolean;
  generatedAtISO?: string;
  weekStartISO: string;
  onDeleteSavedDraft: () => void;
}

function DraftStatusBar({
  loadedFromStorage,
  hasSavedDraft,
  generatedAtISO,
  weekStartISO,
  onDeleteSavedDraft,
}: DraftStatusBarProps) {
  if (!hasSavedDraft && !loadedFromStorage && !generatedAtISO) {
    return (
      <section
        aria-label="Draft status"
        className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-2 text-xs text-gray-500"
        data-testid="draft-status-bar"
      >
        Nessuna bozza salvata per la settimana del {weekStartISO}.
      </section>
    );
  }
  return (
    <section
      aria-label="Draft status"
      className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
      data-testid="draft-status-bar"
    >
      <div className="flex items-center gap-2 text-blue-800">
        {loadedFromStorage && (
          <span
            className="inline-flex items-center rounded-full border border-blue-200 bg-white px-2 py-0.5 font-semibold"
            data-testid="loaded-from-storage-badge"
          >
            ↺ Loaded from local draft
          </span>
        )}
        {hasSavedDraft && (
          <span
            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"
            data-testid="draft-saved-badge"
          >
            ✓ Draft saved locally
          </span>
        )}
        {generatedAtISO && (
          <span className="text-blue-700/80">
            Last generated: {formatGeneratedAt(generatedAtISO)} · week {weekStartISO}
          </span>
        )}
      </div>
      {hasSavedDraft && (
        <button
          type="button"
          onClick={onDeleteSavedDraft}
          className="text-xs font-medium text-rose-600 hover:text-rose-800 transition"
          data-testid="delete-saved-draft"
        >
          Delete saved draft
        </button>
      )}
    </section>
  );
}

interface SummaryRowProps {
  intents: number;
  blocks: number;
  conflicts: number;
  warnings: number;
  score: number;
  coverage: number;
}

function SummaryRow({
  intents,
  blocks,
  conflicts,
  warnings,
  score,
  coverage,
}: SummaryRowProps) {
  return (
    <section
      aria-label="Draft summary"
      className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="weekly-planning-summary"
    >
      <SummaryCard label="Parsed intents" value={intents} />
      <SummaryCard label="Draft blocks" value={blocks} />
      <SummaryCard
        label="Conflitti / warning"
        value={`${conflicts} / ${warnings}`}
      />
      <SummaryCard label="Realism score" value={`${score}/100`} highlight />
      <SummaryCard label="Goal coverage" value={`${coverage}%`} />
    </section>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border ${highlight ? 'border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50' : 'border-gray-100 bg-white'} px-4 py-3 shadow-sm`}
    >
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${highlight ? 'text-blue-700' : 'text-gray-900'}`}
      >
        {value}
      </p>
    </div>
  );
}

function Badge({
  color,
  children,
}: {
  color: 'blue' | 'amber' | 'rose' | 'indigo';
  children: React.ReactNode;
}) {
  const cls =
    color === 'blue'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : color === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : color === 'indigo'
          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
          : 'border-rose-200 bg-rose-50 text-rose-700';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * ISO date for the Monday of the week containing `d`. Pure: no timezone
 * conversion — uses the local calendar day, matching how the existing
 * `TimeBlockPlanner` computes its week start.
 */
function mondayISO(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayOfWeek = copy.getDay(); // 0=Sun..6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  copy.setDate(copy.getDate() + diffToMonday);
  const yyyy = copy.getFullYear();
  const mm = String(copy.getMonth() + 1).padStart(2, '0');
  const dd = String(copy.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
