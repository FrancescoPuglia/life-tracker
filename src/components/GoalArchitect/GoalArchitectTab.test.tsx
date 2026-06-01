// src/components/GoalArchitect/GoalArchitectTab.test.tsx
// UI tests for the Goal Architect tab — smoke, interaction, persistence
// (Prompt 4) and safe-commit (Prompt 4).
//
// The view is provider-free: tests render `GoalArchitectView` directly.
// `useDataContext` is mocked to throw if anything inside the view accidentally
// reaches for the DataProvider.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { GoalArchitectView } from './GoalArchitectTab';
import {
  buildGoalArchitectDraftStorageKey,
  createChessGoalArchitectInputText,
  createWorkGoalArchitectInputText,
  loadGoalArchitectureDraft,
  saveGoalArchitectureDraft,
  type CreateGoalFn,
  type CreateKeyResultFn,
  type CreateProjectFn,
  type CreateTaskFn,
  type ExistingGoalSnapshot,
  type ExistingProjectSnapshot,
  type ExistingTaskSnapshot,
} from '@/lib/goalArchitect';
import { parseGoalArchitecture } from '@/lib/goalArchitect';

vi.mock('@/providers/DataProvider', () => ({
  useDataContext: () => {
    throw new Error('GoalArchitect UI must not call useDataContext');
  },
}));

const USER_ID = 'test-user';

// ============================================================================
// Render helpers
// ============================================================================

interface FakeCreateBundle {
  createGoal: ReturnType<typeof vi.fn>;
  createProject: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
  createKeyResult: ReturnType<typeof vi.fn>;
  goalCalls: { title: string }[];
}

function makeFakeFns(overrides?: {
  goalDelayMs?: number;
}): FakeCreateBundle {
  const goalCalls: { title: string }[] = [];
  let goalIndex = 0;
  let projectIndex = 0;
  let taskIndex = 0;
  let krIndex = 0;
  const createGoal = vi.fn(async (input: { title: string }) => {
    goalCalls.push({ title: input.title });
    if (overrides?.goalDelayMs) {
      await new Promise((r) => setTimeout(r, overrides.goalDelayMs));
    }
    return `real-goal-${goalIndex++}`;
  });
  const createProject = vi.fn(async () => `real-project-${projectIndex++}`);
  const createTask = vi.fn(async () => `real-task-${taskIndex++}`);
  const createKeyResult = vi.fn(async () => `real-kr-${krIndex++}`);
  return { createGoal, createProject, createTask, createKeyResult, goalCalls };
}

interface RenderOpts {
  userIdOrLocal?: string;
  existingGoals?: ExistingGoalSnapshot[];
  existingProjects?: ExistingProjectSnapshot[];
  existingTasks?: ExistingTaskSnapshot[];
  withCreateFns?: boolean;
  fakeFns?: FakeCreateBundle;
  goalDelayMs?: number;
}

function renderView(opts: RenderOpts = {}) {
  const fns = opts.fakeFns ?? (opts.withCreateFns ? makeFakeFns(opts) : null);
  render(
    <GoalArchitectView
      userIdOrLocal={opts.userIdOrLocal ?? USER_ID}
      existingGoals={opts.existingGoals ?? []}
      existingProjects={opts.existingProjects ?? []}
      existingTasks={opts.existingTasks ?? []}
      existingKeyResults={[]}
      createGoal={fns?.createGoal as CreateGoalFn | undefined}
      createProject={fns?.createProject as CreateProjectFn | undefined}
      createTask={fns?.createTask as CreateTaskFn | undefined}
      createKeyResult={fns?.createKeyResult as CreateKeyResultFn | undefined}
    />,
  );
  return { fns };
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByTestId('goal-architect-textarea') as HTMLTextAreaElement;
}
function typeInto(value: string) {
  fireEvent.change(getTextarea(), { target: { value } });
}
function clickGenerate() {
  fireEvent.click(screen.getByTestId('goal-architect-generate'));
}
function clickLoadExampleChess() {
  fireEvent.click(screen.getByTestId('goal-architect-chip-chess'));
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

// ============================================================================
// Smoke (carry-over from Prompt 3)
// ============================================================================

describe('GoalArchitectView — smoke', () => {
  it('renders header, input, draft banner and empty state on first paint', () => {
    renderView();
    expect(
      screen.getByText(/Goal Architect Intelligence/i),
    ).toBeInTheDocument();
    expect(getTextarea()).toBeInTheDocument();
    expect(
      screen.getByTestId('goal-architect-empty-state'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('goal-architect-draft-banner'),
    ).toBeInTheDocument();
  });

  it('Quick fixture chip loads the matching example text', () => {
    renderView();
    fireEvent.click(screen.getByTestId('goal-architect-chip-work'));
    expect(getTextarea().value).toBe(createWorkGoalArchitectInputText());
  });

  it('Generate from Chess fixture renders projects and binds Catalana under Aperture', () => {
    renderView();
    clickLoadExampleChess();
    clickGenerate();
    const cards = screen.getAllByTestId('goal-architect-project-card');
    expect(cards.length).toBe(5);
    const aperture = cards.find((c) => {
      const titleInput = within(c).getAllByRole('textbox')[0] as HTMLInputElement;
      return titleInput.value === 'Aperture';
    });
    expect(aperture).toBeDefined();
    const taskTitles = within(aperture as HTMLElement)
      .getAllByLabelText('Task title')
      .map((el) => (el as HTMLInputElement).value);
    expect(taskTitles.join(' | ')).toContain('Catalana');
  });

  it('does not crash on random text', () => {
    renderView();
    typeInto('asdf qwer zxcv 1234 !!! ???');
    expect(() => clickGenerate()).not.toThrow();
    expect(screen.getByTestId('goal-architect-issues')).toBeInTheDocument();
  });
});

// ============================================================================
// Persistence (Prompt 4)
// ============================================================================

describe('GoalArchitectView — persistence', () => {
  it('saves the draft to localStorage on Generate', () => {
    renderView();
    clickLoadExampleChess();
    clickGenerate();
    const key = buildGoalArchitectDraftStorageKey(USER_ID);
    const raw = window.localStorage.getItem(key);
    expect(raw).not.toBeNull();
    expect(screen.getByTestId('goal-architect-draft-saved')).toBeInTheDocument();
  });

  it('updates the saved draft on every edit', () => {
    renderView();
    clickLoadExampleChess();
    clickGenerate();
    const key = buildGoalArchitectDraftStorageKey(USER_ID);
    const before = JSON.parse(window.localStorage.getItem(key) ?? '{}');

    const hours = screen.getByTestId(
      'goal-architect-goal-hours',
    ) as HTMLInputElement;
    fireEvent.change(hours, { target: { value: '500' } });

    const after = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    expect(after.goal.targetHours).toBe(500);
    expect(after.updatedAtISO).not.toBe(before.updatedAtISO);
  });

  it('hydrates a saved draft on mount and shows the Loaded badge', () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    saveGoalArchitectureDraft(
      buildGoalArchitectDraftStorageKey(USER_ID),
      draft,
    );
    renderView();
    expect(
      screen.getByTestId('goal-architect-loaded-from-storage'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('goal-architect-review')).toBeInTheDocument();
  });

  it('Clear removes the saved draft and resets the view', () => {
    renderView();
    clickLoadExampleChess();
    clickGenerate();
    const key = buildGoalArchitectDraftStorageKey(USER_ID);
    expect(window.localStorage.getItem(key)).not.toBeNull();

    fireEvent.click(screen.getByTestId('goal-architect-clear'));
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(getTextarea().value).toBe('');
    expect(screen.queryByTestId('goal-architect-review')).toBeNull();
    expect(screen.getByTestId('goal-architect-empty-state')).toBeInTheDocument();
  });
});

// ============================================================================
// Approve disabled without commit dependencies (Prompt 3 carry-over)
// ============================================================================

describe('GoalArchitectView — approve button without commit deps', () => {
  it('shows the disabled "not wired" label when no create functions are provided', () => {
    renderView();
    clickLoadExampleChess();
    clickGenerate();
    const btn = screen.getByTestId(
      'goal-architect-commit-button',
    ) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/not wired/i);
  });
});

// ============================================================================
// Commit pipeline (Prompt 4)
// ============================================================================

describe('GoalArchitectView — commit pipeline', () => {
  it('Approve calls createGoal → createProject → createTask in order', async () => {
    const { fns } = renderView({ withCreateFns: true });
    if (!fns) throw new Error('fns expected');

    clickLoadExampleChess();
    clickGenerate();

    const btn = screen.getByTestId('goal-architect-commit-button');
    expect(btn).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(btn);
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('goal-architect-commit-success'),
      ).toBeInTheDocument();
    });
    expect(fns.createGoal).toHaveBeenCalledTimes(1);
    expect(fns.createProject).toHaveBeenCalled();
    expect(fns.createTask).toHaveBeenCalled();
    expect(fns.createKeyResult).toHaveBeenCalled();

    // The first project call must use the goalId returned by createGoal.
    const goalRealId = await fns.createGoal.mock.results[0].value;
    const projectArg = fns.createProject.mock.calls[0][0];
    expect(projectArg.goalId).toBe(goalRealId);
  });

  it('after a successful commit the button is disabled', async () => {
    const { fns } = renderView({ withCreateFns: true });
    if (!fns) throw new Error('fns expected');
    clickLoadExampleChess();
    clickGenerate();
    await act(async () => {
      fireEvent.click(screen.getByTestId('goal-architect-commit-button'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('goal-architect-commit-success'),
      ).toBeInTheDocument();
    });
    const btn = screen.getByTestId(
      'goal-architect-commit-button',
    ) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/Draft committed/i);
  });

  it('double-clicking Approve only invokes createGoal once', async () => {
    const fns = makeFakeFns({ goalDelayMs: 30 });
    renderView({ withCreateFns: true, fakeFns: fns });
    clickLoadExampleChess();
    clickGenerate();
    const btn = screen.getByTestId('goal-architect-commit-button');
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('goal-architect-commit-success'),
      ).toBeInTheDocument();
    });
    expect(fns.createGoal).toHaveBeenCalledTimes(1);
  });

  it('does not commit on Generate or on edit', async () => {
    const { fns } = renderView({ withCreateFns: true });
    if (!fns) throw new Error('fns expected');
    clickLoadExampleChess();
    clickGenerate();
    const hours = screen.getByTestId(
      'goal-architect-goal-hours',
    ) as HTMLInputElement;
    fireEvent.change(hours, { target: { value: '500' } });
    // None of the create functions should have been touched.
    expect(fns.createGoal).not.toHaveBeenCalled();
    expect(fns.createProject).not.toHaveBeenCalled();
    expect(fns.createTask).not.toHaveBeenCalled();
    expect(fns.createKeyResult).not.toHaveBeenCalled();
  });

  it('skips a duplicate goal: existing GAI_KEY prevents re-creation', async () => {
    const draft = parseGoalArchitecture(createChessGoalArchitectInputText());
    if (!draft.goal) throw new Error('draft.goal expected');
    const existingDescription = `existing\n\nGAI_KEY: gai:${draft.id}:goal:${draft.goal.id}`;
    const fns = makeFakeFns();
    render(
      <GoalArchitectView
        userIdOrLocal={USER_ID}
        existingGoals={[
          {
            id: 'pre-existing-goal',
            title: 'doesnt matter',
            description: existingDescription,
          },
        ]}
        existingProjects={[]}
        existingTasks={[]}
        existingKeyResults={[]}
        createGoal={fns.createGoal as CreateGoalFn}
        createProject={fns.createProject as CreateProjectFn}
        createTask={fns.createTask as CreateTaskFn}
        createKeyResult={fns.createKeyResult as CreateKeyResultFn}
      />,
    );
    clickLoadExampleChess();
    clickGenerate();
    await act(async () => {
      fireEvent.click(screen.getByTestId('goal-architect-commit-button'));
    });
    await waitFor(() => {
      // partial or success — both acceptable, but the goal must NOT have been
      // re-created. Children get wired against the pre-existing goal id.
      expect(fns.createGoal).not.toHaveBeenCalled();
    });
    // Projects are wired against pre-existing-goal id.
    if (fns.createProject.mock.calls.length > 0) {
      const arg = fns.createProject.mock.calls[0][0];
      expect(arg.goalId).toBe('pre-existing-goal');
    }
  });

  it('blocks commit when input is invalid', async () => {
    const { fns } = renderView({ withCreateFns: true });
    if (!fns) throw new Error('fns expected');
    typeInto('random text without any goal');
    clickGenerate();
    const btn = screen.getByTestId(
      'goal-architect-commit-button',
    ) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(fns.createGoal).not.toHaveBeenCalled();
  });

  it('shows a partial commit panel when createKeyResult is missing', async () => {
    const fns = makeFakeFns();
    render(
      <GoalArchitectView
        userIdOrLocal={USER_ID}
        existingGoals={[]}
        existingProjects={[]}
        existingTasks={[]}
        existingKeyResults={[]}
        createGoal={fns.createGoal as CreateGoalFn}
        createProject={fns.createProject as CreateProjectFn}
        createTask={fns.createTask as CreateTaskFn}
        // createKeyResult intentionally omitted
      />,
    );
    clickLoadExampleChess();
    clickGenerate();
    await act(async () => {
      fireEvent.click(screen.getByTestId('goal-architect-commit-button'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('goal-architect-commit-partial'),
      ).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Saved draft survives across hydrations + edits
// ============================================================================

describe('GoalArchitectView — persistence round-trip', () => {
  it('the persisted draft contains the goal title after Generate', () => {
    renderView();
    clickLoadExampleChess();
    clickGenerate();
    const reloaded = loadGoalArchitectureDraft(
      buildGoalArchitectDraftStorageKey(USER_ID),
    );
    expect(reloaded).not.toBeNull();
    expect(reloaded?.goal?.title).toContain('SCACCHI');
  });
});
