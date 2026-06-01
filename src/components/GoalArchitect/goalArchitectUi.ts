// src/components/GoalArchitect/goalArchitectUi.ts
// Pure UI helpers — colors, badges, formatters. No React imports so the
// helpers can be reused across panels (and unit-tested) without re-render
// noise.

import type {
  DraftPriority,
  GoalArchitectSeverity,
  KeyResultUnit,
} from '@/lib/goalArchitect';

// ============================================================================
// Severity
// ============================================================================

interface SeverityStyle {
  label: string;
  badge: string;
  accent: string;
}

const SEVERITY_STYLES: Record<GoalArchitectSeverity, SeverityStyle> = {
  error: {
    label: 'Error',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    accent: 'border-l-rose-500',
  },
  warning: {
    label: 'Warning',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    accent: 'border-l-amber-500',
  },
  info: {
    label: 'Info',
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    accent: 'border-l-sky-500',
  },
};

export function severityStyle(s: GoalArchitectSeverity): SeverityStyle {
  return SEVERITY_STYLES[s];
}

// ============================================================================
// Priority
// ============================================================================

interface PriorityStyle {
  label: string;
  badge: string;
}

const PRIORITY_STYLES: Record<DraftPriority, PriorityStyle> = {
  critical: { label: 'Critical', badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  high: { label: 'High', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  medium: { label: 'Medium', badge: 'bg-sky-100 text-sky-700 border-sky-200' },
  low: { label: 'Low', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
};

export function priorityStyle(p: DraftPriority | undefined): PriorityStyle | null {
  if (!p) return null;
  return PRIORITY_STYLES[p];
}

// ============================================================================
// Confidence band
// ============================================================================

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'needs_review';

export interface ConfidenceVerdict {
  band: ConfidenceBand;
  label: string;
  badge: string;
  bar: string;
}

const HIGH_THRESHOLD = 0.85;
const MEDIUM_THRESHOLD = 0.65;
const LOW_THRESHOLD = 0.4;

export function interpretConfidence(value: number): ConfidenceVerdict {
  if (value >= HIGH_THRESHOLD) {
    return {
      band: 'high',
      label: 'High',
      badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      bar: 'bg-emerald-500',
    };
  }
  if (value >= MEDIUM_THRESHOLD) {
    return {
      band: 'medium',
      label: 'Medium',
      badge: 'bg-sky-100 text-sky-700 border-sky-200',
      bar: 'bg-sky-500',
    };
  }
  if (value >= LOW_THRESHOLD) {
    return {
      band: 'low',
      label: 'Low',
      badge: 'bg-amber-100 text-amber-700 border-amber-200',
      bar: 'bg-amber-500',
    };
  }
  return {
    band: 'needs_review',
    label: 'Needs review',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    bar: 'bg-rose-500',
  };
}

export function confidenceLabel(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

// ============================================================================
// Hours / dates / units
// ============================================================================

export function hoursLabel(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return `${value} h`;
  return `${value.toFixed(1)} h`;
}

export function dueDateLabel(iso: string | undefined): string {
  if (!iso) return '—';
  // Render dates as-is to avoid timezone drift; if the input is a full
  // datetime we only show the date portion for the review tree.
  return iso.slice(0, 10);
}

const KR_UNIT_LABELS: Record<KeyResultUnit, string> = {
  percent: '%',
  hours: 'h',
  days: 'gg',
  sessions: 'sessioni',
  courses: 'corsi',
  videos: 'video',
  studies: 'studi',
  tasks: 'task',
  books: 'libri',
  custom: 'custom',
};

export function keyResultUnitLabel(
  unit: KeyResultUnit | undefined,
  customUnit?: string,
): string {
  if (!unit) return '—';
  if (unit === 'custom' && customUnit) return customUnit;
  return KR_UNIT_LABELS[unit];
}
