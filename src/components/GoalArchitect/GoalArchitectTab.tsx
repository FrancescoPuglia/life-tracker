'use client';

// src/components/GoalArchitect/GoalArchitectTab.tsx
// Top-level UI for Goal Architect Intelligence.
//
// Layers:
//   • `GoalArchitectView` (named export, props-driven): no provider deps.
//     Owns rawText + draft state, persistence side-effects, and commit flow.
//   • `GoalArchitectTab` (default export): reads useDataContext() and wires
//     real `createGoal/createProject/createTask/createKeyResult` callbacks
//     + existing-entity snapshots into the view.
//
// Persistence:
//   • Hydrate on mount via `loadGoalArchitectureDraft`.
//   • Save on Generate and on every manual edit.
//   • Delete on Clear.
//
// Commit:
//   • Only triggered by an explicit click on the approve button.
//   • Sequential pipeline, double-click protected via a ref latch.
//   • After success/partial, the button is disabled — no auto re-commit.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildGoalArchitectDraftStorageKey,
  calculateGoalArchitectureSummary,
  commitGoalArchitectureDraft,
  createChessGoalArchitectInputText,
  createIntelligenceEngineGoalArchitectInputText,
  createModelPhysiqueGoalArchitectInputText,
  createPresenceUpgradeGoalArchitectInputText,
  createWorkGoalArchitectInputText,
  deleteGoalArchitectureDraft,
  loadGoalArchitectureDraft,
  parseGoalArchitecture,
  saveGoalArchitectureDraft,
  validateDraftForGoalArchitectCommit,
  validateGoalArchitectureDraft,
  type CreateGoalFn,
  type CreateKeyResultFn,
  type CreateProjectFn,
  type CreateTaskFn,
  type ExistingGoalSnapshot,
  type ExistingKeyResultSnapshot,
  type ExistingProjectSnapshot,
  type ExistingTaskSnapshot,
  type GoalArchitectCommitResult,
  type GoalArchitectureDraft,
} from '@/lib/goalArchitect';
import { useDataContext } from '@/providers/DataProvider';
import GoalArchitectApprovePanel from './GoalArchitectApprovePanel';
import GoalArchitectEmptyState from './GoalArchitectEmptyState';
import GoalArchitectInput, {
  type GoalArchitectExampleKey,
} from './GoalArchitectInput';
import GoalArchitectIssuesPanel from './GoalArchitectIssuesPanel';
import GoalDraftReview, { type GoalDraftEdit } from './GoalDraftReview';
import GoalDraftSummaryPanel from './GoalDraftSummaryPanel';
import type { KeyResultDraftEdit } from './KeyResultDraftPanel';
import type { ProjectDraftEdit } from './ProjectDraftCard';
import type { TaskDraftEdit } from './TaskDraftRow';
import {
  goalsToExistingGoalSnapshots,
  keyResultsToExistingKeyResultSnapshots,
  projectsToExistingProjectSnapshots,
  tasksToExistingTaskSnapshots,
} from './goalArchitectDataAdapters';

// ============================================================================
// EXAMPLE TEXT LOADERS
// ============================================================================

const EXAMPLE_LOADERS: Record<GoalArchitectExampleKey, () => string> = {
  work: createWorkGoalArchitectInputText,
  chess: createChessGoalArchitectInputText,
  modelPhysique: createModelPhysiqueGoalArchitectInputText,
  intelligenceEngine: createIntelligenceEngineGoalArchitectInputText,
  presenceUpgrade: createPresenceUpgradeGoalArchitectInputText,
};

export const GOAL_ARCHITECT_DEFAULT_EXAMPLE: GoalArchitectExampleKey = 'chess';

// ============================================================================
// VIEW
// ============================================================================

export interface GoalArchitectViewProps {
  /** Effective user id for the storage key. Defaults to `"local"`. */
  userIdOrLocal?: string;
  /** Existing entities used for duplicate detection. */
  existingGoals?: ReadonlyArray<ExistingGoalSnapshot>;
  existingProjects?: ReadonlyArray<ExistingProjectSnapshot>;
  existingTasks?: ReadonlyArray<ExistingTaskSnapshot>;
  existingKeyResults?: ReadonlyArray<ExistingKeyResultSnapshot>;
  /** When omitted the approve button is disabled — view stays draft-only. */
  createGoal?: CreateGoalFn;
  createProject?: CreateProjectFn;
  createTask?: CreateTaskFn;
  createKeyResult?: CreateKeyResultFn;
  /** Override the example loaders — tests only. */
  exampleLoaders?: Partial<Record<GoalArchitectExampleKey, () => string>>;
  /** Default domainId for created entities. */
  domainId?: string;
  /** Disable localStorage persistence. Defaults to `false`. */
  disablePersistence?: boolean;
}

export function GoalArchitectView({
  userIdOrLocal = 'local',
  existingGoals = [],
  existingProjects = [],
  existingTasks = [],
  existingKeyResults = [],
  createGoal,
  createProject,
  createTask,
  createKeyResult,
  exampleLoaders,
  domainId,
  disablePersistence = false,
}: GoalArchitectViewProps = {}) {
  const [rawText, setRawText] = useState<string>('');
  const [draft, setDraft] = useState<GoalArchitectureDraft | null>(null);
  const [loadedFromStorage, setLoadedFromStorage] = useState<boolean>(false);
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  const [isCommitting, setIsCommitting] = useState<boolean>(false);
  const [commitResult, setCommitResult] =
    useState<GoalArchitectCommitResult | null>(null);
  // Synchronous in-flight latch: prevents double-click duplicate commits.
  const commitInFlightRef = useRef<boolean>(false);

  const loaders = useMemo(
    () => ({ ...EXAMPLE_LOADERS, ...exampleLoaders }),
    [exampleLoaders],
  );

  const storageKey = useMemo(
    () => buildGoalArchitectDraftStorageKey(userIdOrLocal),
    [userIdOrLocal],
  );

  // ----- Hydration ----------------------------------------------------------
  useEffect(() => {
    if (disablePersistence) return;
    const loaded = loadGoalArchitectureDraft(storageKey);
    if (loaded) {
      setDraft(loaded);
      setRawText(loaded.sourceText ?? '');
      setLoadedFromStorage(true);
      setHasSavedDraft(true);
      setCommitResult(null);
    } else {
      setHasSavedDraft(false);
    }
  }, [disablePersistence, storageKey]);

  // ----- Helpers ------------------------------------------------------------

  const persist = useCallback(
    (next: GoalArchitectureDraft) => {
      if (disablePersistence) return;
      const saved = saveGoalArchitectureDraft(storageKey, next);
      setHasSavedDraft(saved);
    },
    [disablePersistence, storageKey],
  );

  const applyEdit = useCallback(
    (next: GoalArchitectureDraft): GoalArchitectureDraft => {
      const validation = validateGoalArchitectureDraft(next);
      const summary = calculateGoalArchitectureSummary(next, {
        issues: validation.issues,
      });
      const touchedAt = new Date().toISOString();
      return {
        ...next,
        status: validation.status,
        issues: validation.issues,
        summary,
        updatedAtISO: touchedAt,
      };
    },
    [],
  );

  // ----- Actions ------------------------------------------------------------

  const handleGenerate = useCallback(() => {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    const parsed = parseGoalArchitecture(trimmed);
    setDraft(parsed);
    setLoadedFromStorage(false);
    setCommitResult(null);
    persist(parsed);
  }, [rawText, persist]);

  const handleClear = useCallback(() => {
    setRawText('');
    setDraft(null);
    setCommitResult(null);
    setLoadedFromStorage(false);
    if (hasSavedDraft && !disablePersistence) {
      deleteGoalArchitectureDraft(storageKey);
      setHasSavedDraft(false);
    }
  }, [hasSavedDraft, disablePersistence, storageKey]);

  const handleLoadExample = useCallback(
    (key: GoalArchitectExampleKey) => {
      const loader = loaders[key];
      if (loader) setRawText(loader());
    },
    [loaders],
  );

  const handleGoalChange = useCallback(
    (patch: GoalDraftEdit) => {
      setDraft((prev) => {
        if (!prev || !prev.goal) return prev;
        const next = applyEdit({
          ...prev,
          goal: { ...prev.goal, ...patch },
        });
        persist(next);
        return next;
      });
    },
    [applyEdit, persist],
  );

  const handleProjectChange = useCallback(
    (projectId: string, patch: ProjectDraftEdit) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = applyEdit({
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === projectId ? { ...p, ...patch } : p,
          ),
        });
        persist(next);
        return next;
      });
    },
    [applyEdit, persist],
  );

  const handleTaskChange = useCallback(
    (taskId: string, patch: TaskDraftEdit) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = applyEdit({
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === taskId ? { ...t, ...patch } : t,
          ),
        });
        persist(next);
        return next;
      });
    },
    [applyEdit, persist],
  );

  const handleKeyResultChange = useCallback(
    (keyResultId: string, patch: KeyResultDraftEdit) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = applyEdit({
          ...prev,
          keyResults: prev.keyResults.map((kr) =>
            kr.id === keyResultId ? { ...kr, ...patch } : kr,
          ),
        });
        persist(next);
        return next;
      });
    },
    [applyEdit, persist],
  );

  // ----- Commit -------------------------------------------------------------

  const commitValidation = useMemo(() => {
    if (!draft) {
      return {
        canCommit: false,
        blockedReasons: [
          {
            code: 'no_draft' as const,
            message: 'Generate a draft before committing.',
          },
        ],
      };
    }
    return validateDraftForGoalArchitectCommit({
      draft,
      existingGoals,
      existingProjects,
      existingTasks,
      existingKeyResults,
      createGoal,
      createProject,
      createTask,
      createKeyResult,
    });
  }, [
    draft,
    existingGoals,
    existingProjects,
    existingTasks,
    existingKeyResults,
    createGoal,
    createProject,
    createTask,
    createKeyResult,
  ]);

  const handleApprove = useCallback(async () => {
    if (!draft || !createGoal) return;
    if (commitInFlightRef.current) return;
    commitInFlightRef.current = true;
    setIsCommitting(true);
    try {
      const result = await commitGoalArchitectureDraft({
        draft,
        existingGoals,
        existingProjects,
        existingTasks,
        existingKeyResults,
        createGoal,
        createProject,
        createTask,
        createKeyResult,
        domainId,
      });
      setCommitResult(result);
    } finally {
      commitInFlightRef.current = false;
      setIsCommitting(false);
    }
  }, [
    draft,
    existingGoals,
    existingProjects,
    existingTasks,
    existingKeyResults,
    createGoal,
    createProject,
    createTask,
    createKeyResult,
    domainId,
  ]);

  // Approve becomes operational only when create functions are present and
  // the user hasn't yet successfully committed this draft.
  const hasCommitDependencies = createGoal !== undefined;
  const wasCommitted =
    commitResult !== null &&
    (commitResult.status === 'success' ||
      commitResult.status === 'partial');

  return (
    <div className="space-y-6" data-testid="goal-architect-view">
      <Header />

      <GoalArchitectInput
        value={rawText}
        onChange={setRawText}
        onGenerate={handleGenerate}
        onClear={handleClear}
        onLoadExample={handleLoadExample}
      />

      <DraftStatusBar
        loadedFromStorage={loadedFromStorage}
        hasSavedDraft={hasSavedDraft}
        wasCommitted={wasCommitted}
      />

      {!draft && (
        <GoalArchitectEmptyState
          onLoadExample={() => handleLoadExample(GOAL_ARCHITECT_DEFAULT_EXAMPLE)}
        />
      )}

      {draft && (
        <>
          <GoalDraftSummaryPanel draft={draft} />
          <GoalDraftReview
            draft={draft}
            onGoalChange={handleGoalChange}
            onProjectChange={handleProjectChange}
            onTaskChange={handleTaskChange}
            onKeyResultChange={handleKeyResultChange}
          />
          <GoalArchitectIssuesPanel issues={draft.issues} />
          <GoalArchitectApprovePanel
            draft={draft}
            canCommit={commitValidation.canCommit && hasCommitDependencies}
            blockedReasons={commitValidation.blockedReasons}
            isCommitting={isCommitting}
            commitResult={commitResult}
            onApprove={hasCommitDependencies ? handleApprove : undefined}
          />
        </>
      )}
    </div>
  );
}

// ============================================================================
// CONTAINER (default export — consumes useDataContext)
// ============================================================================

export default function GoalArchitectTab() {
  const data = useDataContext();
  const userIdOrLocal =
    data.userId && data.userId.length > 0 ? data.userId : 'local';

  const existingGoals = useMemo(
    () => goalsToExistingGoalSnapshots(data.goals),
    [data.goals],
  );
  const existingProjects = useMemo(
    () => projectsToExistingProjectSnapshots(data.projects),
    [data.projects],
  );
  const existingTasks = useMemo(
    () => tasksToExistingTaskSnapshots(data.tasks),
    [data.tasks],
  );
  const existingKeyResults = useMemo(
    () => keyResultsToExistingKeyResultSnapshots(data.keyResults),
    [data.keyResults],
  );

  return (
    <GoalArchitectView
      userIdOrLocal={userIdOrLocal}
      existingGoals={existingGoals}
      existingProjects={existingProjects}
      existingTasks={existingTasks}
      existingKeyResults={existingKeyResults}
      createGoal={data.createGoal}
      createProject={data.createProject}
      createTask={data.createTask}
      createKeyResult={data.createKeyResult}
    />
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Header() {
  return (
    <header className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 px-5 py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-blue-700">
            Goal Architect Intelligence
          </p>
          <h2 className="mt-1 text-2xl font-bold text-gray-900">
            Transform a natural-language goal plan into a structured Goal →
            Projects → Tasks draft
          </h2>
          <p className="mt-1 text-sm text-gray-600 max-w-2xl">
            Rivedi la struttura. Quando sei pronto, conferma per creare i
            Goal, Project, Task e Key Result reali tramite il DataProvider.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HeaderBadge color="blue">Deterministic parser</HeaderBadge>
          <HeaderBadge color="amber">Draft persisted locally</HeaderBadge>
          <HeaderBadge color="indigo">Commit via DataProvider</HeaderBadge>
          <HeaderBadge color="rose">Human review required</HeaderBadge>
        </div>
      </div>
    </header>
  );
}

interface DraftStatusBarProps {
  loadedFromStorage: boolean;
  hasSavedDraft: boolean;
  wasCommitted: boolean;
}

function DraftStatusBar({
  loadedFromStorage,
  hasSavedDraft,
  wasCommitted,
}: DraftStatusBarProps) {
  if (!loadedFromStorage && !hasSavedDraft && !wasCommitted) {
    return (
      <div
        role="status"
        data-testid="goal-architect-draft-banner"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
      >
        ⚠ Nessuna bozza salvata. Genera una bozza per iniziare.
      </div>
    );
  }
  return (
    <section
      aria-label="Draft status"
      className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
      data-testid="goal-architect-draft-banner"
    >
      <div className="flex items-center gap-2 text-blue-800">
        {loadedFromStorage && (
          <span
            className="inline-flex items-center rounded-full border border-blue-200 bg-white px-2 py-0.5 font-semibold"
            data-testid="goal-architect-loaded-from-storage"
          >
            ↺ Loaded from local draft
          </span>
        )}
        {hasSavedDraft && (
          <span
            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700"
            data-testid="goal-architect-draft-saved"
          >
            ✓ Draft saved locally
          </span>
        )}
        {wasCommitted && (
          <span
            className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700"
            data-testid="goal-architect-was-committed"
          >
            ✅ Draft committed
          </span>
        )}
      </div>
    </section>
  );
}

function HeaderBadge({
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
