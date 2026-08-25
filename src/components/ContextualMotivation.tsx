'use client';

import { useMemo } from 'react';
import { AlertTriangle, Target } from 'lucide-react';
import { useDataContext } from '@/providers/DataProvider';

interface MotivationMessage {
  text: string;
  urgency: 'critical' | 'warning' | 'info' | 'positive';
  icon: React.ReactNode;
}

export default function ContextualMotivation({ className = '' }: { className?: string }) {
  const data = useDataContext();

  const messages = useMemo((): MotivationMessage[] => {
    if (data.status !== 'ready') return [];

    const now = new Date();
    const result: MotivationMessage[] = [];

    // 1. Upcoming events from localStorage
    try {
      const stored = localStorage.getItem('life_tracker_events');
      if (stored) {
        const events = JSON.parse(stored);
        for (const evt of events) {
          if (evt.completed) continue;
          const evtDate = new Date(evt.date);
          const daysLeft = Math.ceil((evtDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (daysLeft >= 0 && daysLeft <= 14) {
            const priority = evt.priority || 'medium';
            if (daysLeft <= 3 || priority === 'high') {
              result.push({
                text: `${daysLeft === 0 ? 'OGGI' : `${daysLeft} giorni`}: ${evt.title}`,
                urgency: daysLeft <= 1 ? 'critical' : 'warning',
                icon: <AlertTriangle className="w-3.5 h-3.5" />,
              });
            }
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Goal deadline urgency
    for (const goal of data.goals) {
      if (goal.status !== 'active' || goal.deleted || !goal.targetDate) continue;
      const daysLeft = Math.ceil((new Date(goal.targetDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft >= 0 && daysLeft <= 14) {
        result.push({
          text: `${daysLeft} giorni a "${goal.title}". ${daysLeft <= 3 ? 'Smetti di rimandare.' : 'Ogni ora conta.'}`,
          urgency: daysLeft <= 3 ? 'critical' : 'warning',
          icon: <Target className="w-3.5 h-3.5" />,
        });
      } else if (daysLeft < 0) {
        result.push({
          text: `"${goal.title}" scaduto da ${Math.abs(daysLeft)} giorni. Concludi o aggiorna la scadenza.`,
          urgency: 'critical',
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
        });
      }
    }

    // Sort: critical first, then warning, then rest
    const order = { critical: 0, warning: 1, info: 2, positive: 3 };
    return result.sort((a, b) => order[a.urgency] - order[b.urgency]).slice(0, 4);
  }, [data.status, data.goals]);

  if (messages.length === 0) return null;

  const urgencyStyles = {
    critical: 'bg-red-900/30 border-red-500/30 text-red-300',
    warning: 'bg-orange-900/20 border-orange-500/20 text-orange-300',
    info: 'bg-blue-900/20 border-blue-500/20 text-blue-300',
    positive: 'bg-green-900/20 border-green-500/20 text-green-300',
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {messages.map((msg, i) => (
        <div key={i} className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium ${urgencyStyles[msg.urgency]}`}>
          <span className="flex-shrink-0 mt-0.5">{msg.icon}</span>
          <span>{msg.text}</span>
        </div>
      ))}
    </div>
  );
}
