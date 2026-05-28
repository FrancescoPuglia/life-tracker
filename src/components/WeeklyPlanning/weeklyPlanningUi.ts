// src/components/WeeklyPlanning/weeklyPlanningUi.ts
// Pure UI helpers — colors, badge labels, formatters. No React in this file
// so it can be unit-tested or reused across the panels without re-renders.

import type {
  ActivityType,
  ConflictSeverity,
  MappingStatus,
  WeekDay,
} from '@/lib/weeklyPlanner';

// ============================================================================
// Activity styling
// ============================================================================

interface ActivityStyle {
  /** Tailwind classes for a small inline badge. */
  badge: string;
  /** Border accent on the draft block card. */
  accent: string;
  /** Emoji used in nav/headers. */
  emoji: string;
  /** Italian human-readable label for the activity type. */
  label: string;
}

const ACTIVITY_STYLES: Record<ActivityType, ActivityStyle> = {
  chess: {
    badge: 'bg-purple-100 text-purple-700 border-purple-200',
    accent: 'border-l-purple-500',
    emoji: '♟️',
    label: 'Scacchi',
  },
  exercise: {
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    accent: 'border-l-rose-500',
    emoji: '💪',
    label: 'Esercizio',
  },
  career: {
    badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    accent: 'border-l-indigo-500',
    emoji: '💼',
    label: 'Carriera',
  },
  deep_work: {
    badge: 'bg-blue-100 text-blue-700 border-blue-200',
    accent: 'border-l-blue-500',
    emoji: '🎯',
    label: 'Deep Work',
  },
  reading: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    accent: 'border-l-emerald-500',
    emoji: '📚',
    label: 'Lettura',
  },
  routine: {
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    accent: 'border-l-amber-500',
    emoji: '☀️',
    label: 'Routine',
  },
  maintenance: {
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    accent: 'border-l-slate-500',
    emoji: '🛠️',
    label: 'Manutenzione',
  },
  task: {
    badge: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    accent: 'border-l-cyan-500',
    emoji: '✅',
    label: 'Task',
  },
  event: {
    badge: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
    accent: 'border-l-fuchsia-500',
    emoji: '📌',
    label: 'Evento',
  },
  unknown: {
    badge: 'bg-gray-100 text-gray-600 border-gray-200',
    accent: 'border-l-gray-400',
    emoji: '❔',
    label: 'Non categorizzato',
  },
};

export function activityStyle(type: ActivityType): ActivityStyle {
  return ACTIVITY_STYLES[type];
}

// ============================================================================
// Mapping status
// ============================================================================

interface MappingStyle {
  badge: string;
  label: string;
}

const MAPPING_STYLES: Record<MappingStatus, MappingStyle> = {
  mapped: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    label: 'Mapped',
  },
  needs_review: {
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    label: 'Needs review',
  },
  unmapped: {
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    label: 'Unmapped',
  },
  maintenance: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    label: 'Maintenance',
  },
};

export function mappingStyle(status: MappingStatus): MappingStyle {
  return MAPPING_STYLES[status];
}

// ============================================================================
// Conflict severity
// ============================================================================

interface SeverityStyle {
  badge: string;
  label: string;
  /** Hex/Tailwind hint used for left-bar accents on warning panel rows. */
  accent: string;
}

const SEVERITY_STYLES: Record<ConflictSeverity, SeverityStyle> = {
  error: {
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    label: 'Error',
    accent: 'border-l-rose-500',
  },
  warning: {
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    label: 'Warning',
    accent: 'border-l-amber-500',
  },
  info: {
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    label: 'Info',
    accent: 'border-l-sky-500',
  },
};

export function severityStyle(s: ConflictSeverity): SeverityStyle {
  return SEVERITY_STYLES[s];
}

// ============================================================================
// Realism interpretation
// ============================================================================

export interface RealismVerdict {
  band: 'excellent' | 'good' | 'risky' | 'overloaded';
  label: string;
  badge: string;
  hint: string;
}

export function interpretRealism(score: number): RealismVerdict {
  if (score >= 85) {
    return {
      band: 'excellent',
      label: 'Excellent',
      badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      hint: 'Bilanciato e realistico. Buona base per la settimana.',
    };
  }
  if (score >= 70) {
    return {
      band: 'good',
      label: 'Good',
      badge: 'bg-sky-100 text-sky-700 border-sky-200',
      hint: 'Piano fattibile. Qualche tensione da rivedere.',
    };
  }
  if (score >= 50) {
    return {
      band: 'risky',
      label: 'Risky',
      badge: 'bg-amber-100 text-amber-700 border-amber-200',
      hint: 'Carico sostenuto: rivedere i blocchi a maggior peso.',
    };
  }
  return {
    band: 'overloaded',
    label: 'Overloaded',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    hint: 'Piano troppo pieno: tagliare o rinviare attività.',
  };
}

// ============================================================================
// Formatters
// ============================================================================

const DAY_LABELS: ReadonlyArray<{ short: string; long: string }> = [
  { short: 'Lun', long: 'Lunedì' },
  { short: 'Mar', long: 'Martedì' },
  { short: 'Mer', long: 'Mercoledì' },
  { short: 'Gio', long: 'Giovedì' },
  { short: 'Ven', long: 'Venerdì' },
  { short: 'Sab', long: 'Sabato' },
  { short: 'Dom', long: 'Domenica' },
];

export function dayLabelShort(d: WeekDay): string {
  return DAY_LABELS[d].short;
}
export function dayLabelLong(d: WeekDay): string {
  return DAY_LABELS[d].long;
}

export function minutesToHoursLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} h`;
  return `${hours.toFixed(1)} h`;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function confidenceLabel(c: number): string {
  return `${Math.round(c * 100)}%`;
}
