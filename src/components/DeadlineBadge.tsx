'use client';

import { Clock, AlertTriangle, Flame, CheckCircle } from 'lucide-react';

export type UrgencyLevel = 'safe' | 'approaching' | 'urgent' | 'overdue' | 'completed';

export interface DeadlineInfo {
  daysRemaining: number;
  urgency: UrgencyLevel;
  label: string;
}

export function getDeadlineInfo(targetDate: Date | string | undefined, status?: string): DeadlineInfo | null {
  if (!targetDate) return null;
  if (status === 'completed' || status === 'archived') {
    return { daysRemaining: 0, urgency: 'completed', label: 'Completato' };
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    const overdueDays = Math.abs(daysRemaining);
    return {
      daysRemaining,
      urgency: 'overdue',
      label: overdueDays === 1 ? '1 giorno in ritardo' : `${overdueDays} giorni in ritardo`,
    };
  }

  if (daysRemaining === 0) {
    return { daysRemaining: 0, urgency: 'urgent', label: 'Scade OGGI' };
  }

  if (daysRemaining <= 3) {
    return {
      daysRemaining,
      urgency: 'urgent',
      label: daysRemaining === 1 ? '1 giorno' : `${daysRemaining} giorni`,
    };
  }

  if (daysRemaining <= 14) {
    return {
      daysRemaining,
      urgency: 'approaching',
      label: `${daysRemaining} giorni`,
    };
  }

  if (daysRemaining <= 30) {
    return {
      daysRemaining,
      urgency: 'safe',
      label: `${daysRemaining} giorni`,
    };
  }

  const weeks = Math.floor(daysRemaining / 7);
  if (daysRemaining <= 90) {
    return {
      daysRemaining,
      urgency: 'safe',
      label: `${weeks} settimane`,
    };
  }

  const months = Math.floor(daysRemaining / 30);
  return {
    daysRemaining,
    urgency: 'safe',
    label: `${months} mesi`,
  };
}

const URGENCY_STYLES: Record<UrgencyLevel, { bg: string; text: string; border: string; pulse: boolean }> = {
  overdue: { bg: 'bg-red-900/40', text: 'text-red-400', border: 'border-red-500/50', pulse: true },
  urgent: { bg: 'bg-orange-900/40', text: 'text-orange-400', border: 'border-orange-500/50', pulse: true },
  approaching: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-500/40', pulse: false },
  safe: { bg: 'bg-green-900/20', text: 'text-green-400', border: 'border-green-500/30', pulse: false },
  completed: { bg: 'bg-blue-900/20', text: 'text-blue-400', border: 'border-blue-500/30', pulse: false },
};

const URGENCY_ICONS: Record<UrgencyLevel, React.ReactNode> = {
  overdue: <Flame className="w-3.5 h-3.5" />,
  urgent: <AlertTriangle className="w-3.5 h-3.5" />,
  approaching: <Clock className="w-3.5 h-3.5" />,
  safe: <Clock className="w-3.5 h-3.5" />,
  completed: <CheckCircle className="w-3.5 h-3.5" />,
};

interface DeadlineBadgeProps {
  targetDate: Date | string | undefined;
  status?: string;
  size?: 'sm' | 'md';
  className?: string;
}

export default function DeadlineBadge({ targetDate, status, size = 'sm', className = '' }: DeadlineBadgeProps) {
  const info = getDeadlineInfo(targetDate, status);
  if (!info) return null;

  const style = URGENCY_STYLES[info.urgency];
  const icon = URGENCY_ICONS[info.urgency];

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5 gap-1'
    : 'text-xs px-2 py-1 gap-1.5';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border
        ${style.bg} ${style.text} ${style.border} ${sizeClasses}
        ${style.pulse ? 'animate-pulse' : ''} ${className}`}
    >
      {icon}
      {info.label}
    </span>
  );
}
