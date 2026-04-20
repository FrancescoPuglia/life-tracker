'use client';

import { useMemo } from 'react';
import { AlertTriangle, Target, Clock, TrendingDown, Flame } from 'lucide-react';
import { useDataContext } from '@/providers/DataProvider';

function getWeekBounds(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

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

    // 3. Weekly execution rate
    const { start, end } = getWeekBounds();
    const weekBlocks = data.timeBlocks.filter(b => {
      if (b.deleted) return false;
      const bStart = new Date(b.startTime);
      return bStart >= start && bStart <= end;
    });

    if (weekBlocks.length > 0) {
      let plannedMin = 0;
      let completedMin = 0;
      for (const b of weekBlocks) {
        plannedMin += (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / (1000 * 60);
        if (b.status === 'completed') {
          const aStart = b.actualStartTime ? new Date(b.actualStartTime) : new Date(b.startTime);
          const aEnd = b.actualEndTime ? new Date(b.actualEndTime) : new Date(b.endTime);
          completedMin += (aEnd.getTime() - aStart.getTime()) / (1000 * 60);
        }
      }
      const rate = Math.round((completedMin / plannedMin) * 100);
      const plannedH = Math.round(plannedMin / 60);
      const completedH = Math.round(completedMin / 60);

      if (rate < 50 && completedMin > 0) {
        result.push({
          text: `Settimana al ${rate}%. ${completedH}h su ${plannedH}h pianificate. Recupera oggi.`,
          urgency: 'warning',
          icon: <TrendingDown className="w-3.5 h-3.5" />,
        });
      } else if (rate >= 80) {
        result.push({
          text: `${rate}% di esecuzione. ${completedH}h completate. Mantieni il ritmo.`,
          urgency: 'positive',
          icon: <Flame className="w-3.5 h-3.5" />,
        });
      } else if (plannedMin > 0 && completedMin === 0) {
        result.push({
          text: `${plannedH}h pianificate, 0h completate. Il piano senza esecuzione non vale nulla.`,
          urgency: 'critical',
          icon: <Clock className="w-3.5 h-3.5" />,
        });
      }
    }

    // Sort: critical first, then warning, then rest
    const order = { critical: 0, warning: 1, info: 2, positive: 3 };
    return result.sort((a, b) => order[a.urgency] - order[b.urgency]).slice(0, 4);
  }, [data.status, data.goals, data.timeBlocks]);

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
