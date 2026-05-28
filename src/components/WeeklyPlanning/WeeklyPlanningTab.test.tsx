// src/components/WeeklyPlanning/WeeklyPlanningTab.test.tsx
// Smoke + persistence + commit tests for the Weekly Planning Intelligence UI.
// We test the provider-free `WeeklyPlanningView` so no DataProvider mount is
// needed — the engine itself has its own unit tests, this layer verifies the
// wiring + safety guarantees.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import {
  WeeklyPlanningView,
  WEEKLY_PLANNING_EXAMPLE_TEXT,
} from './WeeklyPlanningTab';
import {
  buildWeeklyDraftStorageKey,
  type CommitTimeBlockInput,
  type ExistingTimeBlockSnapshot,
  type GoalLike,
  type ProjectLike,
  type TaskLike,
  type WeeklyPlanDraft,
  loadWeeklyPlanDraft,
  saveWeeklyPlanDraft,
  generateWeeklyDraft,
} from '@/lib/weeklyPlanner';

// Mock the createTimeBlock surface entirely. The test will fail if any new
// code accidentally imports the DataProvider mutation path via useDataContext.
vi.mock('@/providers/DataProvider', () => ({
  useDataContext: () => {
    throw new Error('UI must not call useDataContext during these tests');
  },
}));

// ----- Fixtures --------------------------------------------------------------

const FIXED_NOW = () => new Date('2026-05-25T10:00:00.000Z'); // Monday
const WEEK_START_ISO = '2026-05-25'; // same week's Monday

const USER_ID = 'test-user';

const GOALS: GoalLike[] = [
  { id: 'g_chess', title: 'Chess Mastery' },
  { id: 'g_career', title: 'Career 2026' },
  { id: 'g_physique', title: 'Model Physique' },
];
const PROJECTS: ProjectLike[] = [
  { id: 'p_openings', title: 'Openings', goalId: 'g_chess' },
  { id: 'p_strength', title: 'Strength Training', goalId: 'g_physique' },
];
const TASKS: TaskLike[] = [
  {
    id: 't_catalan',
    title: 'Catalan Course',
    projectId: 'p_openings',
    goalId: 'g_chess',
  },
];

interface RenderOpts {
  existingTimeBlocks?: ExistingTimeBlockSnapshot[];
  onCommitBlock?: (input: CommitTimeBlockInput) => Promise<unknown>;
  goals?: GoalLike[];
  projects?: ProjectLike[];
  tasks?: TaskLike[];
  userId?: string;
}

function renderView(opts: RenderOpts = {}) {
  const onCommitBlock = opts.onCommitBlock ?? vi.fn(async () => undefined);
  render(
    <WeeklyPlanningView
      goals={opts.goals ?? []}
      projects={opts.projects ?? []}
      tasks={opts.tasks ?? []}
      existingTimeBlocks={opts.existingTimeBlocks ?? []}
      userIdOrLocal={opts.userId ?? USER_ID}
      onCommitBlock={onCommitBlock}
      nowProvider={FIXED_NOW}
    />,
  );
  return { onCommitBlock };
}

function loadExampleAndGenerate() {
  fireEvent.click(screen.getAllByRole('button', { name: /Load Example/i })[0]);
  fireEvent.click(screen.getByTestId('weekly-intent-generate'));
}

// ----- Setup -----------------------------------------------------------------

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

// ============================================================================
// Smoke + empty-state
// ============================================================================

describe('WeeklyPlanningView — smoke', () => {
  it('renders the header, input and empty state on first paint', () => {
    renderView();
    expect(
      screen.getByText(/Weekly Planning Intelligence/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('weekly-intent-textarea')).toBeInTheDocument();
    expect(
      screen.getByText(/Trasforma la tua settimana/i),
    ).toBeInTheDocument();
  });

  it('Load Example populates the textarea with the canonical example', () => {
    renderView();
    fireEvent.click(screen.getAllByRole('button', { name: /Load Example/i })[0]);
    expect(
      (screen.getByTestId('weekly-intent-textarea') as HTMLTextAreaElement)
        .value,
    ).toBe(WEEKLY_PLANNING_EXAMPLE_TEXT);
  });

  it('Generate renders intents, blocks and a realism score', () => {
    renderView();
    loadExampleAndGenerate();
    expect(screen.getByTestId('weekly-planning-summary')).toBeInTheDocument();
    expect(screen.getByTestId('realism-score-panel')).toBeInTheDocument();
    expect(screen.getByTestId('draft-week-calendar')).toBeInTheDocument();
    expect(screen.getAllByTestId('draft-block').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('mapping-row').length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it('Clear resets textarea, removes the draft, and deletes the saved draft', () => {
    renderView();
    loadExampleAndGenerate();
    expect(screen.getByTestId('draft-week-calendar')).toBeInTheDocument();

    const key = buildWeeklyDraftStorageKey(USER_ID, WEEK_START_ISO);
    expect(window.localStorage.getItem(key)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Clear$/i }));

    expect(
      (screen.getByTestId('weekly-intent-textarea') as HTMLTextAreaElement)
        .value,
    ).toBe('');
    expect(screen.queryByTestId('draft-week-calendar')).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});

// ============================================================================
// Persistence
// ============================================================================

describe('WeeklyPlanningView — persistence', () => {
  it('saves the draft to localStorage on Generate', () => {
    renderView();
    loadExampleAndGenerate();

    const key = buildWeeklyDraftStorageKey(USER_ID, WEEK_START_ISO);
    const raw = window.localStorage.getItem(key);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.status).toBe('draft');
    expect(Array.isArray(parsed.blocks)).toBe(true);

    expect(screen.getByTestId('draft-saved-badge')).toBeInTheDocument();
  });

  it('hydrates an existing draft on mount and shows "Loaded from local draft"', () => {
    // Seed storage before render.
    const { draft } = generateWeeklyDraft({
      raw: {
        id: 'pre-seeded',
        text: 'Lunedì Catalana 2 ore.',
        weekStartISO: WEEK_START_ISO,
        createdAtISO: '2026-05-25T08:00:00.000Z',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    saveWeeklyPlanDraft({
      userIdOrLocal: USER_ID,
      weekStartISO: WEEK_START_ISO,
      draft,
    });

    renderView({ goals: GOALS, projects: PROJECTS, tasks: TASKS });

    expect(screen.getByTestId('loaded-from-storage-badge')).toBeInTheDocument();
    expect(screen.getByTestId('draft-week-calendar')).toBeInTheDocument();
    expect(
      (screen.getByTestId('weekly-intent-textarea') as HTMLTextAreaElement)
        .value,
    ).toBe('Lunedì Catalana 2 ore.');
  });

  it('"Delete saved draft" removes the localStorage entry but keeps the on-screen draft', () => {
    renderView();
    loadExampleAndGenerate();
    const key = buildWeeklyDraftStorageKey(USER_ID, WEEK_START_ISO);
    expect(window.localStorage.getItem(key)).not.toBeNull();

    fireEvent.click(screen.getByTestId('delete-saved-draft'));

    expect(window.localStorage.getItem(key)).toBeNull();
    // The current on-screen draft is still rendered; the user can still
    // approve from memory if they want.
    expect(screen.getByTestId('draft-week-calendar')).toBeInTheDocument();
  });
});

// ============================================================================
// Approve / commit
// ============================================================================

describe('WeeklyPlanningView — approve & commit', () => {
  it('Approve is disabled when blocks are unmapped (no fixtures supplied)', () => {
    renderView();
    loadExampleAndGenerate();
    const btn = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('approve-blocked-reasons')).toBeInTheDocument();
  });

  it('Approve is enabled with at least one mapped block and calls createTimeBlock', async () => {
    const onCommitBlock = vi.fn(async () => undefined);
    renderView({
      onCommitBlock,
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });

    // Use a focused intent so the only non-maintenance block is mappable.
    const textarea = screen.getByTestId(
      'weekly-intent-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Lunedì Catalana 2 ore.' } });
    fireEvent.click(screen.getByTestId('weekly-intent-generate'));

    const btn = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(onCommitBlock).toHaveBeenCalled();
    const payload = onCommitBlock.mock.calls[0][0];
    expect(payload.taskId).toBe('t_catalan');
    expect(payload.status).toBe('planned');
    expect(payload.notes).toMatch(/WPI_KEY: wpi:/);

    await waitFor(() => {
      expect(screen.getByTestId('commit-result')).toBeInTheDocument();
    });
  });

  it('double-click on Approve does NOT create duplicate calls', async () => {
    const onCommitBlock = vi.fn(async () => undefined);
    renderView({
      onCommitBlock,
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });

    fireEvent.change(
      screen.getByTestId('weekly-intent-textarea') as HTMLTextAreaElement,
      { target: { value: 'Lunedì Catalana 2 ore.' } },
    );
    fireEvent.click(screen.getByTestId('weekly-intent-generate'));

    const btn = screen.getByTestId('approve-button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });

    // Exactly one mapped block was committable; despite two clicks, only one
    // createTimeBlock call lands.
    expect(onCommitBlock).toHaveBeenCalledTimes(1);
  });

  it('skips maintenance routines and surfaces them in the commit result', async () => {
    const onCommitBlock = vi.fn(async () => undefined);
    renderView({
      onCommitBlock,
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });

    fireEvent.change(
      screen.getByTestId('weekly-intent-textarea') as HTMLTextAreaElement,
      {
        target: {
          value: 'Mi sveglio ogni giorno alle 7.\nLunedì Catalana 2 ore.',
        },
      },
    );
    fireEvent.click(screen.getByTestId('weekly-intent-generate'));

    const btn = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(btn);
    });

    // One mapped chess block + 7 maintenance blocks → 1 created, 7 skipped.
    expect(onCommitBlock).toHaveBeenCalledTimes(1);
    const result = screen.getByTestId('commit-result');
    expect(result.textContent).toMatch(/Success/);
    expect(result.textContent).toMatch(/created 1/);
  });
});

// ============================================================================
// Idempotency vs. existing TimeBlocks
// ============================================================================

describe('WeeklyPlanningView — duplicate prevention against existing TimeBlocks', () => {
  it('does NOT call createTimeBlock when an existing block already carries the WPI_KEY', async () => {
    // First render: commit once, capture the produced WPI_KEY notes.
    const firstCall = vi.fn(async () => undefined);
    const { unmount } = render(
      <WeeklyPlanningView
        goals={GOALS}
        projects={PROJECTS}
        tasks={TASKS}
        existingTimeBlocks={[]}
        userIdOrLocal={USER_ID}
        onCommitBlock={firstCall}
        nowProvider={FIXED_NOW}
      />,
    );
    fireEvent.change(
      screen.getByTestId('weekly-intent-textarea') as HTMLTextAreaElement,
      { target: { value: 'Lunedì Catalana 2 ore.' } },
    );
    fireEvent.click(screen.getByTestId('weekly-intent-generate'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('approve-button'));
    });
    expect(firstCall).toHaveBeenCalledTimes(1);
    const firstPayload: CommitTimeBlockInput = firstCall.mock.calls[0][0];
    unmount();

    // Second render: simulate the previously-committed block being present
    // in `existingTimeBlocks` (e.g. user refreshes page after committing).
    // The saved draft is still in localStorage and will be hydrated.
    const simulatedExisting: ExistingTimeBlockSnapshot[] = [
      {
        id: 'tb_existing_1',
        notes: firstPayload.notes,
        startTime: firstPayload.startTime,
        endTime: firstPayload.endTime,
        taskId: firstPayload.taskId,
        projectId: firstPayload.projectId,
        goalId: firstPayload.goalId,
      },
    ];
    const secondCall = vi.fn(async () => undefined);
    render(
      <WeeklyPlanningView
        goals={GOALS}
        projects={PROJECTS}
        tasks={TASKS}
        existingTimeBlocks={simulatedExisting}
        userIdOrLocal={USER_ID}
        onCommitBlock={secondCall}
        nowProvider={FIXED_NOW}
      />,
    );

    // Hydrated from storage → no need to re-Generate.
    await waitFor(() => {
      expect(screen.getByTestId('draft-week-calendar')).toBeInTheDocument();
    });

    // The validator marks all blocks as duplicates → Approve disabled,
    // blocked-reasons explain "no committable blocks".
    const approveBtn = screen.getByTestId('approve-button') as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
    expect(secondCall).not.toHaveBeenCalled();

    // The hydrated draft survived round-trip.
    expect(
      loadWeeklyPlanDraft({
        userIdOrLocal: USER_ID,
        weekStartISO: WEEK_START_ISO,
      }),
    ).not.toBeNull();
  });
});

// ============================================================================
// Review panel integration (Prompt 5)
// ============================================================================

describe('WeeklyPlanningView — review panel', () => {
  it('renders the review panel after Generate, in empty-state until WPI blocks exist', () => {
    renderView({ goals: GOALS, projects: PROJECTS, tasks: TASKS });
    loadExampleAndGenerate();
    // Panel present; empty state until existingTimeBlocks contain WPI blocks.
    expect(
      screen.getByTestId('weekly-intelligence-review-panel'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('wpi-review-empty-state')).toBeInTheDocument();
  });

  it('renders KPI + day-breakdown + calibration when WPI TimeBlocks are present', async () => {
    // Build a fixture set of WPI TimeBlocks: 4 committed blocks, 2 completed.
    const { draft } = generateWeeklyDraft({
      raw: {
        id: 'analytics-r',
        text:
          'Lunedì Catalana 1 ora. Martedì Catalana 1 ora. ' +
          'Mercoledì Catalana 1 ora. Giovedì Catalana 1 ora.',
        weekStartISO: WEEK_START_ISO,
        createdAtISO: '2026-05-25T08:00:00.000Z',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    saveWeeklyPlanDraft({
      userIdOrLocal: USER_ID,
      weekStartISO: WEEK_START_ISO,
      draft,
    });

    const wpiBlocks: ExistingTimeBlockSnapshot[] = draft.blocks
      .filter((b) => b.mapping?.status === 'mapped')
      .slice(0, 4)
      .map((b, i) => ({
        id: `tb_${i}`,
        notes:
          `Generated by Weekly Planning Intelligence.\n` +
          `Source: ${b.sourceText}\n` +
          `WPI_KEY: wpi:${draft.id}:${b.id}`,
        // Two completed, two cancelled — 50% completion.
        startTime: new Date(`2026-05-${25 + (b.day as number)}T${b.startTime}:00`),
        endTime: new Date(`2026-05-${25 + (b.day as number)}T${b.endTime}:00`),
        taskId: b.mapping?.taskId,
        projectId: b.mapping?.projectId,
        goalId: b.mapping?.goalId,
        // Attach status (the snapshot type allows it via TS at the analytics layer).
      }));
    // Augment with status — the analytics layer expects WpiTimeBlockSnapshot
    // which has optional `status`. The View's analytics reads from the same
    // shape, so we attach it via a cast through the engine's snapshot type.
    const withStatus = wpiBlocks.map((b, i) => ({
      ...b,
      status: i < 2 ? 'completed' : 'cancelled',
    }));

    render(
      <WeeklyPlanningView
        goals={GOALS}
        projects={PROJECTS}
        tasks={TASKS}
        existingTimeBlocks={withStatus}
        userIdOrLocal={USER_ID}
        onCommitBlock={vi.fn(async () => undefined)}
        nowProvider={FIXED_NOW}
      />,
    );

    // The draft is hydrated from storage, so the panel becomes visible.
    expect(
      screen.getByTestId('weekly-intelligence-review-panel'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('wpi-review-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('wpi-review-day-breakdown')).toBeInTheDocument();
    expect(screen.getByTestId('wpi-review-calibration')).toBeInTheDocument();
    // 4 blocks, 2 completed → calibration label should not be insufficient_data.
    // Badge is rendered both in the KPI strip and inside the calibration card;
    // assert at least one renders with the actual verdict text.
    const badges = screen.getAllByTestId('wpi-review-calibration-badge');
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) {
      expect(b.textContent).not.toMatch(/Insufficient data/i);
    }
  });

  it('shows the partial-data state when WPI blocks exist but no saved draft matches', () => {
    // No draft in storage — render WPI blocks tagged with an arbitrary draftId.
    const wpiBlocks: ExistingTimeBlockSnapshot[] = [
      {
        id: 'tb1',
        notes: 'WPI_KEY: wpi:draft_orphan:block_a',
        startTime: new Date('2026-05-26T09:00:00'),
        endTime: new Date('2026-05-26T10:00:00'),
        taskId: 't_catalan',
      },
    ];
    render(
      <WeeklyPlanningView
        goals={GOALS}
        projects={PROJECTS}
        tasks={TASKS}
        existingTimeBlocks={wpiBlocks}
        userIdOrLocal={USER_ID}
        onCommitBlock={vi.fn(async () => undefined)}
        nowProvider={FIXED_NOW}
      />,
    );
    expect(
      screen.getByTestId('weekly-intelligence-review-panel'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('wpi-review-partial-data')).toBeInTheDocument();
  });
});

// Sanity: the engine-produced draft we used in fixtures actually shapes the
// way the test relies on (lazy regression alarm).
describe('fixture sanity', () => {
  it('engine produces a draft with at least 1 chess block when fixtures are provided', () => {
    const { draft }: { draft: WeeklyPlanDraft } = generateWeeklyDraft({
      raw: {
        id: 'sanity',
        text: 'Lunedì Catalana 2 ore.',
        weekStartISO: WEEK_START_ISO,
        createdAtISO: '2026-05-25T08:00:00.000Z',
      },
      goals: GOALS,
      projects: PROJECTS,
      tasks: TASKS,
    });
    expect(draft.blocks.length).toBeGreaterThan(0);
    expect(draft.blocks[0].mapping?.taskId).toBe('t_catalan');
  });
});
