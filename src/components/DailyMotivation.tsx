'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Target, Clock, Flame, TrendingUp, AlertTriangle } from 'lucide-react';
import { useDataContext } from '@/providers/DataProvider';
import { getDeadlineInfo, type DeadlineInfo } from './DeadlineBadge';

// ============================================================================
// MOTIVATIONAL QUOTES (rotated daily)
// ============================================================================

const QUOTES = [
  { text: "Il successo non e' definitivo, il fallimento non e' fatale: quello che conta e' il coraggio di continuare.", author: "Winston Churchill" },
  { text: "La disciplina e' la radice di tutte le buone qualita'.", author: "Ioannis Chrysostomos" },
  { text: "Il modo per iniziare e' smettere di parlare e iniziare a fare.", author: "Walt Disney" },
  { text: "Non aspettare. Il momento non sara' mai quello giusto.", author: "Napoleon Hill" },
  { text: "Il successo e' la somma di piccoli sforzi ripetuti giorno dopo giorno.", author: "Robert Collier" },
  { text: "La differenza tra l'ordinario e lo straordinario e' quel piccolo extra.", author: "Jimmy Johnson" },
  { text: "Non si tratta di quanto velocemente arrivi, ma di non fermarti mai.", author: "Confucio" },
  { text: "L'unica persona che sei destinato a diventare e' la persona che decidi di essere.", author: "Ralph Waldo Emerson" },
  { text: "Ogni mattina ci vengono date 24 ore d'oro. Ogni sera, non ne resta nessuna.", author: "John Mason" },
  { text: "Fai le cose difficili mentre sono facili, fai le grandi cose mentre sono piccole.", author: "Lao Tzu" },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function DailyMotivation() {
  const [isVisible, setIsVisible] = useState(true);
  const data = useDataContext();

  // Check if dismissed today
  useEffect(() => {
    const dismissed = localStorage.getItem('motivation-dismissed');
    if (dismissed === new Date().toDateString()) {
      setIsVisible(false);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem('motivation-dismissed', new Date().toDateString());
  };

  // Today's quote (rotated by day of year)
  const todayQuote = useMemo(() => {
    const today = new Date();
    const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
    return QUOTES[dayOfYear % QUOTES.length];
  }, []);

  // Top 3 upcoming deadlines from goals
  const urgentDeadlines = useMemo(() => {
    if (data.status !== 'ready') return [];
    const deadlines: { goalTitle: string; info: DeadlineInfo }[] = [];

    for (const goal of data.goals) {
      if (goal.status === 'completed' || goal.status === 'archived' || goal.deleted) continue;
      const info = getDeadlineInfo(goal.targetDate, goal.status);
      if (info && info.urgency !== 'completed') {
        deadlines.push({ goalTitle: goal.title, info });
      }
    }

    return deadlines
      .sort((a, b) => a.info.daysRemaining - b.info.daysRemaining)
      .slice(0, 3);
  }, [data.status, data.goals]);

  // Real stats
  const stats = useMemo(() => {
    if (data.status !== 'ready') return null;

    const activeGoals = data.goals.filter(g => g.status === 'active' && !g.deleted).length;
    const completedToday = data.timeBlocks.filter(b => {
      if (b.status !== 'completed' || b.deleted) return false;
      const d = new Date(b.actualEndTime || b.endTime);
      return d.toDateString() === new Date().toDateString();
    }).length;

    const activeHabitsWithStreak = data.habits.filter(h => h.isActive && h.streakCount > 0).length;
    const todayTasks = data.tasks.filter(t =>
      (t.status === 'pending' || t.status === 'in_progress') && !t.deleted
    ).length;

    return { activeGoals, completedToday, activeHabitsWithStreak, todayTasks };
  }, [data.status, data.goals, data.timeBlocks, data.habits, data.tasks]);

  // Contextual message based on real data
  const contextualMessage = useMemo(() => {
    if (!stats) return '';
    const parts: string[] = [];

    if (urgentDeadlines.length > 0 && urgentDeadlines[0].info.daysRemaining <= 7) {
      parts.push(`Hai ${urgentDeadlines.length} deadline ravvicinate. Concentrati sulle priorita'.`);
    } else if (stats.completedToday > 0) {
      parts.push(`Hai gia' completato ${stats.completedToday} blocchi oggi. Continua cosi'!`);
    } else if (stats.todayTasks > 0) {
      parts.push(`${stats.todayTasks} task ti aspettano. Inizia dal piu' urgente.`);
    } else {
      parts.push('Nuova giornata, nuove possibilita\'. Pianifica il tuo focus.');
    }

    return parts.join(' ');
  }, [stats, urgentDeadlines]);

  if (!isVisible || data.status !== 'ready') return null;

  const urgencyColor = urgentDeadlines.length > 0 && urgentDeadlines[0].info.urgency === 'overdue'
    ? 'from-red-900 to-gray-900'
    : urgentDeadlines.length > 0 && urgentDeadlines[0].info.urgency === 'urgent'
    ? 'from-orange-900 to-gray-900'
    : 'from-blue-900 to-gray-900';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`max-w-2xl w-full relative overflow-hidden rounded-2xl bg-gradient-to-br ${urgencyColor} border border-gray-700/50 shadow-2xl`}>
        {/* Close */}
        <button onClick={handleDismiss} className="absolute top-4 right-4 text-gray-400 hover:text-white z-10">
          <X className="w-5 h-5" />
        </button>

        <div className="p-8 space-y-6">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Buongiorno</h1>
            <p className="text-sm text-gray-400">
              {new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>

          {/* Deadline Countdown */}
          {urgentDeadlines.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Scadenze
              </h3>
              <div className="space-y-2">
                {urgentDeadlines.map((dl, i) => {
                  const urgencyStyles = {
                    overdue: 'bg-red-900/40 border-red-500/40 text-red-300',
                    urgent: 'bg-orange-900/30 border-orange-500/30 text-orange-300',
                    approaching: 'bg-yellow-900/20 border-yellow-500/20 text-yellow-300',
                    safe: 'bg-green-900/20 border-green-500/20 text-green-300',
                    completed: 'bg-blue-900/20 border-blue-500/20 text-blue-300',
                  };
                  return (
                    <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${urgencyStyles[dl.info.urgency]}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <Target className="w-4 h-4 flex-shrink-0" />
                        <span className="text-sm font-medium truncate">{dl.goalTitle}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="text-sm font-bold">{dl.info.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Real Stats */}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-800/50 rounded-lg p-3 text-center border border-gray-700/30">
                <Target className="w-5 h-5 mx-auto mb-1 text-blue-400" />
                <div className="text-xl font-bold text-white">{stats.activeGoals}</div>
                <div className="text-[10px] text-gray-500 uppercase">Goals attivi</div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3 text-center border border-gray-700/30">
                <Flame className="w-5 h-5 mx-auto mb-1 text-orange-400" />
                <div className="text-xl font-bold text-white">{stats.activeHabitsWithStreak}</div>
                <div className="text-[10px] text-gray-500 uppercase">Streak attive</div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3 text-center border border-gray-700/30">
                <TrendingUp className="w-5 h-5 mx-auto mb-1 text-green-400" />
                <div className="text-xl font-bold text-white">{stats.todayTasks}</div>
                <div className="text-[10px] text-gray-500 uppercase">Task pending</div>
              </div>
            </div>
          )}

          {/* Contextual Message */}
          <p className="text-center text-sm text-gray-300">{contextualMessage}</p>

          {/* Quote */}
          <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700/20">
            <p className="text-sm italic text-gray-300 text-center">"{todayQuote.text}"</p>
            <p className="text-xs text-gray-500 text-center mt-2">- {todayQuote.author}</p>
          </div>

          {/* CTA */}
          <div className="text-center">
            <button
              onClick={handleDismiss}
              className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl transition-colors"
            >
              Inizia la giornata
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
