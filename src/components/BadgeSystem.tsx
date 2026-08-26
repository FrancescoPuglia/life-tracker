'use client';

import React, { useState, useEffect } from 'react';
import { Trophy, Star, Flame, Target, Zap, Crown, Award, Shield, Rocket, Diamond } from 'lucide-react';

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  category: 'streak' | 'goal' | 'focus' | 'consistency' | 'milestone';
  requirement: {
    type: string;
    value: number;
    description: string;
  };
  unlockedAt?: Date;
  progress?: number;
}

const ACHIEVEMENT_BADGES: Badge[] = [
  // BEGINNER BADGES (Easy to achieve)
  {
    id: 'welcome',
    name: 'Welcome Warrior',
    description: 'Benvenuto nel tuo viaggio verso il successo!',
    icon: 'Star',
    rarity: 'common',
    category: 'milestone',
    requirement: { type: 'days_tracked', value: 1, description: '1 giorno di utilizzo' }
  },
  {
    id: 'first-session',
    name: 'Session Starter',
    description: 'Avvia la tua prima sessione di lavoro',
    icon: 'Rocket',
    rarity: 'common',
    category: 'milestone',
    requirement: { type: 'total_sessions', value: 1, description: '1 sessione completata' }
  },
  // STREAK BADGES (Progressive)
  {
    id: 'first-streak',
    name: 'First Fire',
    description: 'Completa una streak di 2 giorni',
    icon: 'Flame',
    rarity: 'common',
    category: 'streak',
    requirement: { type: 'habit_streak', value: 2, description: '2 giorni consecutivi' }
  },
  {
    id: 'week-warrior',
    name: 'Week Warrior',
    description: 'Mantieni una streak per 7 giorni',
    icon: 'Shield',
    rarity: 'rare',
    category: 'streak',
    requirement: { type: 'habit_streak', value: 7, description: '7 giorni consecutivi' }
  },
  {
    id: 'month-master',
    name: 'Month Master',
    description: 'Streak di 30 giorni - Sei un campione!',
    icon: 'Crown',
    rarity: 'epic',
    category: 'streak',
    requirement: { type: 'habit_streak', value: 30, description: '30 giorni consecutivi' }
  },

  // FOCUS BADGES (Achievable goals)
  {
    id: 'first-focus',
    name: 'Focus Initiate',
    description: 'Completa 15 minuti di focus time',
    icon: 'Target',
    rarity: 'common',
    category: 'focus',
    requirement: { type: 'total_focus', value: 15, description: '15 minuti totali' }
  },
  {
    id: 'focus-hour',
    name: 'Focus Hour',
    description: '1 ora di deep focus raggiunta',
    icon: 'Zap',
    rarity: 'rare',
    category: 'focus',
    requirement: { type: 'total_focus', value: 60, description: '60 minuti totali' }
  },
  {
    id: 'focus-master',
    name: 'Focus Master',
    description: '10 ore di focus totali - Mente di ferro!',
    icon: 'Award',
    rarity: 'epic',
    category: 'focus',
    requirement: { type: 'total_focus', value: 600, description: '10 ore totali' }
  },

  // GOAL BADGES
  {
    id: 'goal-achiever',
    name: 'Goal Achiever',
    description: 'Completa il tuo primo obiettivo',
    icon: 'Trophy',
    rarity: 'rare',
    category: 'goal',
    requirement: { type: 'goals_completed', value: 1, description: '1 obiettivo completato' }
  },

  // CONSISTENCY BADGES (Realistic)
  {
    id: 'early-riser',
    name: 'Early Riser',
    description: 'Avvia 3 sessioni prima delle 8:00',
    icon: 'Rocket',
    rarity: 'rare',
    category: 'consistency',
    requirement: { type: 'early_sessions', value: 3, description: '3 sessioni mattutine' }
  },
  {
    id: 'consistent-tracker',
    name: 'Consistent Tracker',
    description: 'Utilizza Life Tracker per 3 giorni',
    icon: 'Shield',
    rarity: 'rare',
    category: 'milestone',
    requirement: { type: 'days_tracked', value: 3, description: '3 giorni di utilizzo' }
  },

  // LEGENDARY ACHIEVEMENTS (Long-term)
  {
    id: 'legendary-streak',
    name: 'Legendary Streak',
    description: 'Streak di 100 giorni - Leggenda vivente!',
    icon: 'Diamond',
    rarity: 'legendary',
    category: 'streak',
    requirement: { type: 'habit_streak', value: 100, description: '100 giorni consecutivi' }
  },
  {
    id: 'power-user',
    name: 'Power User',
    description: '30 giorni di utilizzo attivo',
    icon: 'Crown',
    rarity: 'legendary',
    category: 'milestone',
    requirement: { type: 'days_tracked', value: 30, description: '30 giorni di utilizzo' }
  }
];

const ICON_MAP = {
  Flame: Flame,
  Star: Star,
  Trophy: Trophy,
  Target: Target,
  Zap: Zap,
  Crown: Crown,
  Award: Award,
  Shield: Shield,
  Rocket: Rocket,
  Diamond: Diamond
};

interface BadgeSystemProps {
  userStats: {
    maxStreak: number;
    totalFocusMinutes: number;
    goalsCompleted: number;
    totalSessions?: number;
    daysTracked: number;
    earlySessionsCount: number;
    eveningSessionsCount: number;
    weeklyFocusMinutes: number;
  };
  onBadgeUnlocked: (badge: Badge) => void;
}

const BADGE_STORAGE_KEY = 'life_tracker_unlocked_badges';

function loadPersistedBadges(): string[] {
  try {
    const stored = localStorage.getItem(BADGE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function persistBadges(badgeIds: string[]) {
  try {
    localStorage.setItem(BADGE_STORAGE_KEY, JSON.stringify(badgeIds));
  } catch { /* localStorage unavailable */ }
}

export default function BadgeSystem({ userStats, onBadgeUnlocked }: BadgeSystemProps) {
  const [unlockedBadges, setUnlockedBadges] = useState<Badge[]>([]);
  const [newlyUnlocked, setNewlyUnlocked] = useState<Badge[]>([]);

  const checkBadgeRequirements = (badge: Badge): boolean => {
    switch (badge.requirement.type) {
      case 'habit_streak':
        return userStats.maxStreak >= badge.requirement.value;
      case 'total_focus':
        return userStats.totalFocusMinutes >= badge.requirement.value;
      case 'weekly_focus':
        return userStats.weeklyFocusMinutes >= badge.requirement.value;
      case 'goals_completed':
        return userStats.goalsCompleted >= badge.requirement.value;
      case 'total_sessions':
        return (userStats.totalSessions || 0) >= badge.requirement.value;
      case 'early_sessions':
        return userStats.earlySessionsCount >= badge.requirement.value;
      case 'evening_sessions':
        return userStats.eveningSessionsCount >= badge.requirement.value;
      case 'days_tracked':
        return userStats.daysTracked >= badge.requirement.value;
      default:
        return false;
    }
  };

  const calculateProgress = (badge: Badge): number => {
    let current = 0;
    switch (badge.requirement.type) {
      case 'habit_streak':
        current = userStats.maxStreak;
        break;
      case 'total_focus':
        current = userStats.totalFocusMinutes;
        break;
      case 'weekly_focus':
        current = userStats.weeklyFocusMinutes;
        break;
      case 'goals_completed':
        current = userStats.goalsCompleted;
        break;
      case 'total_sessions':
        current = userStats.totalSessions || 0;
        break;
      case 'early_sessions':
        current = userStats.earlySessionsCount;
        break;
      case 'evening_sessions':
        current = userStats.eveningSessionsCount;
        break;
      case 'days_tracked':
        current = userStats.daysTracked;
        break;
    }
    return Math.min(100, (current / badge.requirement.value) * 100);
  };

  useEffect(() => {
    // TRUTH RULE: Badges are ONLY unlocked if current real stats meet the requirement.
    // No inflation from old persisted state. Recompute from scratch every time.
    const currentlyMet = ACHIEVEMENT_BADGES.filter(checkBadgeRequirements);
    const currentIds = currentlyMet.map(b => b.id);
    const nowUnlocked = currentlyMet.map(badge => ({ ...badge, unlockedAt: new Date() }));

    const previousIds = unlockedBadges.map(b => b.id);
    const newBadges = nowUnlocked.filter(badge => !previousIds.includes(badge.id));

    if (newBadges.length > 0) {
      setNewlyUnlocked(newBadges);
      newBadges.forEach(onBadgeUnlocked);
      setTimeout(() => setNewlyUnlocked([]), 5000);
    }

    setUnlockedBadges(nowUnlocked);
    // Persist only currently-earned badges (no accumulation of stale badges)
    persistBadges(currentIds);
  }, [userStats]);

  const getRarityColor = (rarity: Badge['rarity']) => {
    switch (rarity) {
      case 'common': return 'border-slate-500 bg-slate-600';
      case 'rare': return 'border-blue-500 bg-blue-600';
      case 'epic': return 'border-violet-500 bg-violet-600';
      case 'legendary': return 'border-amber-500 bg-amber-500';
    }
  };

  return (
    <div className="space-y-5">
      {/* Newly Unlocked Badge Animation */}
      {newlyUnlocked.map(badge => (
        <div
          key={badge.id}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
        >
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xl">
            <div className="mb-6">
              <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border ${getRarityColor(badge.rarity)}`}>
                {React.createElement(ICON_MAP[badge.icon as keyof typeof ICON_MAP], {
                  className: "w-12 h-12 text-white"
                })}
              </div>
            </div>
            
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
              Traguardo sbloccato
            </h3>
            
            <h4 className="mb-4 text-xl font-semibold text-slate-950">
              {badge.name}
            </h4>
            
            <p className="mb-6 text-sm text-slate-600">
              {badge.description}
            </p>

            <div className="text-xs uppercase tracking-wider text-slate-500">
              {badge.rarity} • {badge.category}
            </div>
          </div>
        </div>
      ))}

      {/* Badge Gallery */}
      <div className="rounded-[14px] border border-slate-200 bg-white p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Progressi verificati</p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">Traguardi</h3>
          </div>
          <p className="text-sm text-slate-500">{unlockedBadges.length} di {ACHIEVEMENT_BADGES.length} sbloccati</p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
          {ACHIEVEMENT_BADGES.map(badge => {
            const isUnlocked = unlockedBadges.some(ub => ub.id === badge.id);
            const progress = calculateProgress(badge);
            const IconComponent = ICON_MAP[badge.icon as keyof typeof ICON_MAP];

            return (
              <div
                key={badge.id}
                className={`group rounded-xl border p-3 text-center transition-colors ${isUnlocked ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-slate-200 bg-slate-50/70'}`}
              >
                <div 
                  className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border transition-colors ${
                    isUnlocked 
                      ? getRarityColor(badge.rarity)
                      : 'border-slate-200 bg-slate-100 opacity-60'
                  }`}
                >
                  <IconComponent 
                    className={`h-5 w-5 ${isUnlocked ? 'text-white' : 'text-slate-400'}`}
                  />
                </div>

                <h4 className={`font-semibold text-sm mb-1 ${
                  isUnlocked ? 'text-slate-900' : 'text-slate-500'
                }`}>
                  {badge.name}
                </h4>

                <p className={`text-xs mb-2 ${
                  isUnlocked ? 'text-slate-600' : 'text-slate-400'
                }`}>
                  {badge.description}
                </p>

                {/* Progress Bar for Locked Badges */}
                {!isUnlocked && progress > 0 && (
                  <div className="w-full">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div 
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {Math.round(progress)}%
                    </div>
                  </div>
                )}

                {/* Requirement Info */}
                <div className="text-xs text-gray-500 mt-1">
                  {badge.requirement.description}
                </div>

                {/* Rarity Indicator */}
                <div className={`text-xs mt-1 font-medium ${
                  badge.rarity === 'legendary' ? 'text-yellow-400' :
                  badge.rarity === 'epic' ? 'text-purple-400' :
                  badge.rarity === 'rare' ? 'text-blue-400' :
                  'text-gray-400'
                }`}>
                  {badge.rarity.toUpperCase()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Stats Summary */}
        <div className="mt-6 border-t border-slate-200 pt-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-semibold text-slate-950">{unlockedBadges.length}</div>
              <div className="text-xs text-slate-500">SBLOCCATI</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">
                {unlockedBadges.filter(b => b.rarity === 'legendary').length}
              </div>
              <div className="text-xs text-slate-500">LEGGENDARI</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-400">
                {unlockedBadges.filter(b => b.rarity === 'epic').length}
              </div>
              <div className="text-xs text-slate-500">EPICI</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">
                {Math.round((unlockedBadges.length / ACHIEVEMENT_BADGES.length) * 100)}%
              </div>
              <div className="text-xs text-slate-500">COMPLETAMENTO</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
