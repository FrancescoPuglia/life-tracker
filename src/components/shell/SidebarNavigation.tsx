'use client';

import { memo, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  CalendarDays,
  ChevronDown,
  Compass,
  FileText,
  Flame,
  Image,
  Layers3,
  Mic2,
  PlayCircle,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react';

export type SidebarNavId =
  | 'today'
  | 'planner'
  | 'events'
  | 'goal_architect'
  | 'okr'
  | 'weekly_intel'
  | 'weekly'
  | 'micro_coach'
  | 'performance'
  | 'analytics'
  | 'reports'
  | 'goal_analytics'
  | 'notes'
  | 'habits'
  | 'vision-board'
  | 'badges'
  | 'voice'
  | 'smart_scheduler'
  | 'adaptation'
  | 'settings';

interface NavItem {
  id: SidebarNavId;
  label: string;
  icon: LucideIcon;
  subtitle: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: ReadonlyArray<NavItem>;
}

const TODAY_ITEM: NavItem = {
  id: 'today',
  label: 'Oggi',
  icon: Sun,
  subtitle: 'Comando della giornata',
};

export const SIDEBAR_GROUPS: ReadonlyArray<NavGroup> = [
  {
    id: 'plan',
    label: 'Pianifica',
    items: [
      { id: 'planner', label: 'Pianificazione', icon: CalendarDays, subtitle: 'Blocchi di esecuzione' },
      { id: 'events', label: 'Calendario', icon: Compass, subtitle: 'Scadenze e milestone' },
      { id: 'okr', label: 'Obiettivi e progetti', icon: Target, subtitle: 'Direzione e risultati' },
      { id: 'weekly_intel', label: 'Piano settimanale', icon: Layers3, subtitle: 'Costruisci la settimana' },
      { id: 'goal_architect', label: 'Architetto obiettivi', icon: Sparkles, subtitle: 'Struttura un obiettivo' },
    ],
  },
  {
    id: 'execute',
    label: 'Esegui',
    items: [
      { id: 'habits', label: 'Abitudini', icon: Flame, subtitle: 'Ritmo quotidiano' },
      { id: 'smart_scheduler', label: 'Pianificazione automatica', icon: PlayCircle, subtitle: 'Organizza il carico' },
      { id: 'adaptation', label: 'Adatta piano', icon: RefreshCw, subtitle: 'Ripara la giornata' },
    ],
  },
  {
    id: 'review',
    label: 'Analizza',
    items: [
      { id: 'weekly', label: 'Esecuzione settimanale', icon: Activity, subtitle: 'Piano e realtà' },
      { id: 'performance', label: 'Rendimento', icon: BarChart3, subtitle: 'Evidenza di esecuzione' },
      { id: 'analytics', label: 'Analisi', icon: BarChart3, subtitle: 'Tendenze e distribuzione' },
      { id: 'reports', label: 'Review executive', icon: FileText, subtitle: 'Archivio settimanale' },
      { id: 'badges', label: 'Traguardi', icon: Trophy, subtitle: 'Progressi sbloccati' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligenza',
    items: [
      { id: 'micro_coach', label: 'AI Coach', icon: Brain, subtitle: 'Insight contestuali' },
      { id: 'goal_analytics', label: 'Intelligenza obiettivi', icon: Target, subtitle: 'Analisi per obiettivo' },
      { id: 'notes', label: 'Second Brain', icon: BookOpen, subtitle: 'Conoscenza e note' },
      { id: 'vision-board', label: 'Bacheca visiva', icon: Image, subtitle: 'Orizzonte strategico' },
      { id: 'voice', label: 'Voce', icon: Mic2, subtitle: 'Comandi e lingua' },
    ],
  },
];

export interface SidebarNavigationProps {
  activeTab: SidebarNavId;
  onSelect: (id: SidebarNavId) => void;
}

function SidebarNavigationInner({ activeTab, onSelect }: SidebarNavigationProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SIDEBAR_GROUPS.map((group) => [group.id, true])),
  );

  return (
    <nav aria-label="Navigazione principale" data-testid="sidebar-navigation" className="lt-panel flex h-full flex-col overflow-hidden">
      <div className="border-b border-slate-200 p-2">
        <NavButton item={TODAY_ITEM} active={activeTab === TODAY_ITEM.id} onSelect={onSelect} featured />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {SIDEBAR_GROUPS.map((group) => {
          const expanded = openGroups[group.id];
          const containsActive = group.items.some((item) => item.id === activeTab);
          return (
            <section key={group.id} className="mb-1" data-testid={`sidebar-group-${group.id}`}>
              <button
                type="button"
                className={`flex min-h-[34px] w-full items-center justify-between rounded-lg px-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${containsActive ? 'text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                aria-expanded={expanded}
                aria-controls={`sidebar-group-items-${group.id}`}
                onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
              >
                {group.label}
                <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
              </button>
              {expanded && (
                <ul id={`sidebar-group-items-${group.id}`} className="space-y-0.5 pb-1">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <NavButton item={item} active={activeTab === item.id} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="border-t border-slate-200 p-2">
        <NavButton
          item={{ id: 'settings', label: 'Impostazioni', icon: Settings, subtitle: 'Desktop e preferenze' }}
          active={activeTab === 'settings'}
          onSelect={onSelect}
        />
      </div>
    </nav>
  );
}

function NavButton({
  item,
  active,
  onSelect,
  featured = false,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (id: SidebarNavId) => void;
  featured?: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? 'page' : undefined}
      data-testid={`sidebar-item-${item.id}`}
      className={`group flex min-h-[44px] w-full items-center gap-3 rounded-[10px] border px-2.5 text-left transition-colors ${
        active
          ? 'border-indigo-100 bg-indigo-50 text-indigo-950'
          : featured
            ? 'border-transparent bg-slate-50 text-slate-900 hover:border-slate-200 hover:bg-white'
            : 'border-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-950'
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 group-hover:text-slate-700'}`} aria-hidden="true">
        <Icon size={16} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-[18px]">{item.label}</span>
        <span className={`block truncate text-[11px] leading-4 ${active ? 'text-indigo-700' : 'text-slate-500'}`}>{item.subtitle}</span>
      </span>
    </button>
  );
}

const SidebarNavigation = memo(SidebarNavigationInner);
export default SidebarNavigation;
