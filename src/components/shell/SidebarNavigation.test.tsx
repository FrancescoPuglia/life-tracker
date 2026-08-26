// src/components/shell/SidebarNavigation.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SidebarNavigation, {
  SIDEBAR_GROUPS,
  type SidebarNavId,
} from './SidebarNavigation';

describe('SidebarNavigation', () => {
  it('renders the four semantic priority groups', () => {
    render(<SidebarNavigation activeTab="today" onSelect={() => {}} />);
    expect(screen.getByTestId('sidebar-group-plan')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-group-execute')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-group-review')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-group-intelligence')).toBeInTheDocument();
  });

  it('exposes the five primary nav targets that must keep working', () => {
    render(<SidebarNavigation activeTab="today" onSelect={() => {}} />);
    expect(screen.getByTestId('sidebar-item-today')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-planner')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-events')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-goal_architect')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-weekly_intel')).toBeInTheDocument();
  });

  it('exposes the scientific report archive inside Intelligence', () => {
    const onSelect = vi.fn();
    render(<SidebarNavigation activeTab="today" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('sidebar-item-reports'));
    expect(onSelect).toHaveBeenCalledWith('reports');
  });

  it('reports the selected tab via aria-current', () => {
    render(<SidebarNavigation activeTab="goal_architect" onSelect={() => {}} />);
    const item = screen.getByTestId('sidebar-item-goal_architect');
    expect(item.getAttribute('aria-current')).toBe('page');
  });

  it('fires onSelect with the clicked tab id', () => {
    const onSelect = vi.fn();
    render(<SidebarNavigation activeTab="today" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('sidebar-item-weekly_intel'));
    expect(onSelect).toHaveBeenCalledWith('weekly_intel');
  });

  it('does NOT render a persistent AI Assistant card', () => {
    render(<SidebarNavigation activeTab="today" onSelect={() => {}} />);
    // The old sidebar showed "AI Assistant" as a giant card; the new sidebar
    // must not. The AI item in the Intelligence group is just a nav target
    // labelled "AI Coach" (not "AI Assistant").
    expect(screen.queryByText(/AI Assistant/i)).toBeNull();
    expect(screen.getByText(/AI Coach/i)).toBeInTheDocument();
  });

  it('SIDEBAR_GROUPS export is stable and ordered', () => {
    const orderedIds: ReadonlyArray<string> = SIDEBAR_GROUPS.map((g) => g.id);
    expect(orderedIds).toEqual([
      'plan',
      'execute',
      'review',
      'intelligence',
    ]);
  });

  it('every group has at least three items', () => {
    for (const g of SIDEBAR_GROUPS) {
      expect(g.items.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('all nav ids are unique', () => {
    const ids: SidebarNavId[] = SIDEBAR_GROUPS.flatMap((g) =>
      g.items.map((i) => i.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
