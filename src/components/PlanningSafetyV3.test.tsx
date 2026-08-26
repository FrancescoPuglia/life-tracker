import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Task, TimeBlock } from '@/types';
import SmartScheduler from './SmartScheduler';
import RealTimeAdaptation from './RealTimeAdaptation';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  replan: vi.fn(),
}));

vi.mock('@/lib/autoScheduler', () => ({ autoScheduler: { schedule: mocks.schedule } }));
vi.mock('@/lib/rePlanningEngine', () => ({ rePlanningEngine: { handleTrigger: mocks.replan } }));
vi.mock('@/lib/audioManager', () => ({
  audioManager: {
    play: vi.fn(),
    perfectDay: vi.fn(),
    buttonFeedback: vi.fn(),
    taskCompleted: vi.fn(),
  },
}));

describe('V3 planning proposal safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.schedule.mockResolvedValue({
      schedule: [block('primary')],
      conflicts: [],
      alternatives: [{
        name: 'Energia ottimizzata',
        description: 'Usa le ore migliori',
        schedule: [block('alternative')],
        tradeoffs: ['Sposta un blocco'],
        confidence: 0.8,
      }],
      reasoning: 'Deterministic multi-constraint proposal',
      confidence: 0.9,
    });
    mocks.replan.mockResolvedValue({
      newSchedule: [block('moved')],
      changes: [{
        type: 'moved',
        originalBlock: block('primary'),
        newBlock: block('moved'),
        reasoning: 'Protect the remaining day',
      }],
      alternatives: [],
      reasoning: 'Move one block and keep the rest',
      confidence: 0.85,
      impact: { goalsAffected: [], deadlinesRisk: [], energyImpact: 'neutral' },
    });
  });

  it('never generates or persists an Auto Scheduler proposal before explicit actions', async () => {
    const onTimeBlocksCreated = vi.fn();
    render(
      <SmartScheduler
        tasks={[task()]}
        existingTimeBlocks={[]}
        goals={[goal()]}
        onTimeBlocksCreated={onTimeBlocksCreated}
      />,
    );

    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(onTimeBlocksCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Genera proposta' }));
    await waitFor(() => expect(screen.getByText('Anteprima del piano')).toBeInTheDocument());
    expect(onTimeBlocksCreated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Energia ottimizzata'));
    fireEvent.click(screen.getByRole('button', { name: 'Applica piano' }));
    expect(onTimeBlocksCreated).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'alternative' }),
    ]);
  });

  it('keeps Adapt Plan changes preview-only until Apply delta', async () => {
    const onScheduleAdapted = vi.fn();
    render(
      <RealTimeAdaptation
        currentSchedule={[block('primary')]}
        tasks={[task()]}
        goals={[goal()]}
        userEnergyLevel={0.7}
        onScheduleAdapted={onScheduleAdapted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Sessione più lunga/ }));
    await waitFor(() => expect(screen.getByText('Delta proposto')).toBeInTheDocument());
    expect(onScheduleAdapted).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Applica delta' }));
    expect(onScheduleAdapted).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'moved' })],
      [expect.objectContaining({ type: 'moved' })],
    );
  });
});

function block(id: string): TimeBlock {
  return {
    id,
    userId: 'owner-1',
    domainId: 'work',
    title: `Block ${id}`,
    taskId: 'task-1',
    goalId: 'goal-1',
    startTime: new Date('2026-08-27T09:00:00.000Z'),
    endTime: new Date('2026-08-27T10:00:00.000Z'),
    status: 'planned',
    type: 'deep',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function task(): Task {
  return {
    id: 'task-1', userId: 'owner-1', domainId: 'work', projectId: 'project-1',
    goalId: 'goal-1', title: 'Ship', status: 'pending', priority: 'high',
    estimatedMinutes: 60, createdAt: new Date(), updatedAt: new Date(),
  };
}

function goal(): Goal {
  return {
    id: 'goal-1', userId: 'owner-1', domainId: 'work', title: 'Enterprise V3',
    status: 'active', priority: 'high', targetDate: new Date('2026-12-01'),
    timeAllocationTarget: 5, keyResults: [], category: 'important_not_urgent',
    complexity: 'complex', createdAt: new Date(), updatedAt: new Date(),
  };
}
