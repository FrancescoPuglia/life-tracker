// src/components/TimeBlockPlanner.test.tsx
// Smoke tests for the redesigned Time Planner.
// Focus: empty state, header CTAs, summary strip, optional onNavigate wiring.
// We do NOT exercise the heavy mouse-drag block creation path here — that has
// its own runtime guards and is not affected by this overhaul.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TimeBlockPlanner from './TimeBlockPlanner';
import type { Session, TimeBlock } from '@/types';

const FIXED_DATE = new Date('2026-05-25T10:00:00.000Z');

function renderPlanner(opts: {
  timeBlocks?: TimeBlock[];
  sessions?: Session[];
  sessionCoverage?: 'loading' | 'ready' | 'error';
  isReady?: boolean;
  onNavigate?: (id: string) => void;
  onUpdateTimeBlock?: (id: string, updates: Partial<TimeBlock>) => void;
} = {}) {
  return render(
    <TimeBlockPlanner
      timeBlocks={opts.timeBlocks ?? []}
      sessions={opts.sessions ?? []}
      sessionCoverage={opts.sessionCoverage ?? 'ready'}
      tasks={[]}
      projects={[]}
      goals={[]}
      onCreateTimeBlock={() => {}}
      onUpdateTimeBlock={opts.onUpdateTimeBlock ?? (() => {})}
      onDeleteTimeBlock={() => {}}
      selectedDate={FIXED_DATE}
      onDateChange={() => {}}
      currentUserId="test-user"
      isReady={opts.isReady ?? true}
      onNavigate={opts.onNavigate}
    />,
  );
}

describe('TimeBlockPlanner — shell', () => {
  it('renders the planner with the title and day-summary strip', () => {
    renderPlanner();
    expect(screen.getByTestId('time-block-planner')).toBeInTheDocument();
    expect(screen.getByText(/Time Planner/i)).toBeInTheDocument();
    expect(screen.getByTestId('planner-day-summary')).toBeInTheDocument();
  });

  it('shows the Today button and Add Block in the header', () => {
    renderPlanner();
    expect(screen.getByTestId('planner-today-button')).toBeInTheDocument();
    expect(screen.getByTestId('planner-add-block')).toBeInTheDocument();
  });

  it('exposes Day / Week / Month switcher buttons', () => {
    renderPlanner();
    expect(screen.getByRole('button', { name: /^giorno$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^settimana$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^mese$/i })).toBeInTheDocument();
  });
});

describe('TimeBlockPlanner — empty state', () => {
  it('renders the premium empty state when there are no blocks', () => {
    renderPlanner();
    const empty = screen.getByTestId('planner-empty-state');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/Nessun blocco per/i);
    expect(empty.textContent).toMatch(/genera la settimana dal Piano settimanale/i);
  });

  it('exposes Add Block inside the empty state', () => {
    renderPlanner();
    expect(screen.getByTestId('planner-empty-add-block')).toBeInTheDocument();
  });

  it('shows the weekly plan CTA only when onNavigate is provided', () => {
    const { rerender } = renderPlanner();
    expect(screen.queryByTestId('planner-empty-generate-weekly')).toBeNull();
    expect(screen.queryByTestId('planner-generate-weekly-plan')).toBeNull();

    rerender(
      <TimeBlockPlanner
        timeBlocks={[]}
        sessions={[]}
        sessionCoverage="ready"
        tasks={[]}
        projects={[]}
        goals={[]}
        onCreateTimeBlock={() => {}}
        onUpdateTimeBlock={() => {}}
        onDeleteTimeBlock={() => {}}
        selectedDate={FIXED_DATE}
        onDateChange={() => {}}
        currentUserId="test-user"
        isReady={true}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByTestId('planner-empty-generate-weekly')).toBeInTheDocument();
    expect(screen.getByTestId('planner-generate-weekly-plan')).toBeInTheDocument();
  });

  it('fires onNavigate("weekly_intel") when the header CTA is clicked', () => {
    const onNavigate = vi.fn();
    renderPlanner({ onNavigate });
    fireEvent.click(screen.getByTestId('planner-generate-weekly-plan'));
    expect(onNavigate).toHaveBeenCalledWith('weekly_intel');
  });

  it('fires onNavigate("weekly_intel") when the empty-state CTA is clicked', () => {
    const onNavigate = vi.fn();
    renderPlanner({ onNavigate });
    fireEvent.click(screen.getByTestId('planner-empty-generate-weekly'));
    expect(onNavigate).toHaveBeenCalledWith('weekly_intel');
  });
});

describe('TimeBlockPlanner — month layout', () => {
  it('renders a stable six-week grid with 42 complete day cells', () => {
    renderPlanner();
    fireEvent.click(screen.getByRole('button', { name: /^mese$/i }));
    const monthGrid = screen.getByTestId('planner-month-grid');
    expect(monthGrid.querySelectorAll(':scope > button')).toHaveLength(42);
  });
});

describe('TimeBlockPlanner — day summary', () => {
  it('shows an unavailable adherence denominator when there are no planned minutes', () => {
    renderPlanner();
    const summary = screen.getByTestId('planner-day-summary');
    expect(summary.textContent).toMatch(/Pianificato/i);
    expect(summary.textContent).toMatch(/Effettivo noto/i);
    expect(summary.textContent).toMatch(/Aderenza/i);
    expect(summary.textContent).toMatch(/0\s*min/);
    expect(summary.textContent).toMatch(/Non disponibile/);
  });

  it('does not substitute a completed block planned window for execution', () => {
    const block: TimeBlock = {
      id: 'block-1',
      userId: 'test-user',
      domainId: 'domain-1',
      title: 'Planned hour',
      type: 'work',
      status: 'completed',
      startTime: new Date('2026-05-25T08:00:00.000Z'),
      endTime: new Date('2026-05-25T09:00:00.000Z'),
      createdAt: new Date('2026-05-24T08:00:00.000Z'),
      updatedAt: new Date('2026-05-25T09:00:00.000Z'),
    };
    renderPlanner({ timeBlocks: [block] });

    const summary = screen.getByTestId('planner-day-summary');
    expect(summary.textContent).toMatch(/Pianificato1 h/i);
    expect(summary.textContent).toMatch(/Effettivo noto ≥0 min/i);
    expect(summary.textContent).toMatch(/AderenzaNon disponibile/i);
  });

  it('manual completion changes status only and does not manufacture actual timestamps', () => {
    const onUpdateTimeBlock = vi.fn();
    const block: TimeBlock = {
      id: 'block-1',
      userId: 'test-user',
      domainId: 'domain-1',
      title: 'Planned hour',
      type: 'work',
      status: 'planned',
      startTime: new Date('2026-05-25T08:00:00.000Z'),
      endTime: new Date('2026-05-25T09:00:00.000Z'),
      createdAt: new Date('2026-05-24T08:00:00.000Z'),
      updatedAt: new Date('2026-05-24T08:00:00.000Z'),
    };
    renderPlanner({ timeBlocks: [block], onUpdateTimeBlock });

    fireEvent.click(screen.getByTitle('Mark completed (execution time requires a Session)'));
    expect(onUpdateTimeBlock).toHaveBeenCalledWith('block-1', { status: 'completed' });
  });
});
