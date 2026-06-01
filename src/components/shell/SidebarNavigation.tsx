'use client';

// src/components/shell/SidebarNavigation.tsx
// Grouped sidebar navigation for the Life Tracker command center.
//
// Replaces the flat 16-item gradient list with four semantic groups:
//   • Command Center  — what you're doing now / today / this week's plan
//   • Build System    — goal architecture and weekly intent
//   • Intelligence    — analytics, coaching, knowledge
//   • Growth          — habits, vision, achievements, voice
//
// Props-driven so MainApp keeps owning `activeTab` and we can test the
// component in isolation.

import { memo } from 'react';

export type SidebarNavId =
  | 'today'
  | 'planner'
  | 'events'
  | 'goal_architect'
  | 'okr'
  | 'weekly_intel'
  | 'weekly'
  | 'micro_coach'
  | 'analytics'
  | 'goal_analytics'
  | 'notes'
  | 'habits'
  | 'vision-board'
  | 'badges'
  | 'voice'
  | 'smart_scheduler'
  | 'adaptation';

interface NavItem {
  id: SidebarNavId;
  label: string;
  icon: string;
  subtitle: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: ReadonlyArray<NavItem>;
}

export const SIDEBAR_GROUPS: ReadonlyArray<NavGroup> = [
  {
    id: 'command_center',
    label: 'Command Center',
    items: [
      { id: 'today', label: 'Today', icon: '☀️', subtitle: 'Today at a glance' },
      { id: 'planner', label: 'Time Planner', icon: '📅', subtitle: 'Plan and execute blocks' },
      { id: 'events', label: 'Calendar', icon: '📆', subtitle: 'Strategic events' },
    ],
  },
  {
    id: 'build_system',
    label: 'Build System',
    items: [
      { id: 'goal_architect', label: 'Goal Architect', icon: '🏗️', subtitle: 'Draft goals from text' },
      { id: 'okr', label: 'Goals & Projects', icon: '🎯', subtitle: 'Manage your OKRs' },
      { id: 'weekly_intel', label: 'Weekly Intelligence', icon: '🧭', subtitle: 'Draft a week' },
      { id: 'weekly', label: 'Weekly Execution', icon: '📈', subtitle: 'Plan vs reality' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { id: 'micro_coach', label: 'AI Coach', icon: '🧠', subtitle: 'Performance insights' },
      { id: 'analytics', label: 'Analytics', icon: '📊', subtitle: 'Trend dashboards' },
      { id: 'goal_analytics', label: 'Goal Intelligence', icon: '🎯', subtitle: 'Goal-centric metrics' },
      { id: 'notes', label: 'Second Brain', icon: '📝', subtitle: 'Smart notes' },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    items: [
      { id: 'habits', label: 'Habits', icon: '🔥', subtitle: 'Track daily habits' },
      { id: 'vision-board', label: 'Vision Board', icon: '✧', subtitle: 'Long-term vision' },
      { id: 'badges', label: 'Achievements', icon: '🏆', subtitle: 'Earned milestones' },
      { id: 'voice', label: 'Voice System', icon: '🎙️', subtitle: 'Language & voice' },
    ],
  },
];

export interface SidebarNavigationProps {
  activeTab: SidebarNavId;
  onSelect: (id: SidebarNavId) => void;
}

function SidebarNavigationInner({ activeTab, onSelect }: SidebarNavigationProps) {
  return (
    <nav
      aria-label="Primary navigation"
      data-testid="sidebar-navigation"
      className="rounded-2xl border border-gray-200 bg-white/90 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="px-4 py-3 border-b border-gray-100">
        <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-blue-700">
          Life Tracker
        </p>
        <h2 className="mt-0.5 text-sm font-bold text-gray-900">Command Center</h2>
      </header>

      <ul className="max-h-[calc(100vh-220px)] overflow-y-auto py-2">
        {SIDEBAR_GROUPS.map((group) => (
          <li key={group.id} className="py-1.5">
            <p
              className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.16em] font-semibold text-gray-400"
              data-testid={`sidebar-group-${group.id}`}
            >
              {group.label}
            </p>
            <ul className="space-y-0.5 px-1.5">
              {group.items.map((item) => {
                const isActive = item.id === activeTab;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      data-testid={`sidebar-item-${item.id}`}
                      className={`group w-full text-left flex items-center gap-3 rounded-lg px-2.5 py-2 transition ${
                        isActive
                          ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 shadow-sm'
                          : 'border border-transparent hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md text-base ${
                          isActive
                            ? 'bg-white border border-blue-100'
                            : 'bg-gray-50 border border-gray-100 group-hover:bg-white'
                        }`}
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block text-[13px] font-semibold leading-tight ${
                            isActive ? 'text-blue-900' : 'text-gray-800'
                          }`}
                        >
                          {item.label}
                        </span>
                        <span
                          className={`block text-[11px] leading-tight ${
                            isActive ? 'text-blue-700/80' : 'text-gray-500'
                          }`}
                        >
                          {item.subtitle}
                        </span>
                      </span>
                      {isActive && (
                        <span
                          className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-500"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <footer className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
        Personal Execution Command Center
      </footer>
    </nav>
  );
}

const SidebarNavigation = memo(SidebarNavigationInner);
export default SidebarNavigation;
