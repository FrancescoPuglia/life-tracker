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
  {
    id: 'time-planner',
    name: 'Time Master',
    description: 'Crea il tuo primo time block',
    icon: 'Target',
    rarity: 'common',
    category: 'milestone',
    requirement: { type: 'time_blocks_created', value: 1, description: '1 time block creato' }
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
    id: 'goal-setter',
    name: 'Goal Setter',
    description: 'Crea il tuo primo obiettivo',
    icon: 'Star',
    rarity: 'common',
    category: 'goal',
    requirement: { type: 'goals_created', value: 1, description: '1 goal creato' }
  },
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
    goalsCreated?: number;
    totalSessions?: number;
    timeBlocksCreated?: number;
    daysTracked: number;
    earlySessionsCount: number;
    eveningSessionsCount: number;
    weeklyFocusMinutes: number;
  };
  onBadgeUnlocked: (badge: Badge) => void;
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
      case 'goals_created':
        return userStats.goalsCreated >= badge.requirement.value;
      case 'total_sessions':
        return userStats.totalSessions >= badge.requirement.value;
      case 'time_blocks_created':
        return userStats.timeBlocksCreated >= badge.requirement.value;
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
      case 'goals_created':
        current = userStats.goalsCreated || 0;
        break;
      case 'total_sessions':
        current = userStats.totalSessions || 0;
        break;
      case 'time_blocks_created':
        current = userStats.timeBlocksCreated || 0;
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
    const previousUnlocked = unlockedBadges.map(b => b.id);
    const nowUnlocked = ACHIEVEMENT_BADGES.filter(checkBadgeRequirements).map(badge => ({
      ...badge,
      unlockedAt: new Date()
    }));

    const newBadges = nowUnlocked.filter(badge => !previousUnlocked.includes(badge.id));
    
    if (newBadges.length > 0) {
      setNewlyUnlocked(newBadges);
      newBadges.forEach(onBadgeUnlocked);
      
      // Clear newly unlocked after 5 seconds
      setTimeout(() => setNewlyUnlocked([]), 5000);
    }

    setUnlockedBadges(nowUnlocked);
  }, [userStats]);

  const getRarityColor = (rarity: Badge['rarity']) => {
    switch (rarity) {
      case 'common': return 'badge-common';
      case 'rare': return 'badge-rare';
      case 'epic': return 'from-purple-500 to-pink-500 border-purple-400';
      case 'legendary': return 'badge-legendary';
    }
  };

  const getRarityGlow = (rarity: Badge['rarity']) => {
    switch (rarity) {
      case 'common': return '0 0 20px rgba(79, 172, 254, 0.6)';
      case 'rare': return '0 0 20px rgba(184, 74, 255, 0.6)';
      case 'epic': return '0 0 30px rgba(168, 85, 247, 0.8)';
      case 'legendary': return '0 0 40px rgba(255, 215, 0, 0.9)';
    }
  };

  return (
    <div className="space-y-8">
      {/* Newly Unlocked Badge Animation */}
      {newlyUnlocked.map(badge => (
        <div
          key={badge.id}
          className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop"
        >
          <div className="futuristic-card p-8 text-center max-w-md animate-pulse">
            <div className="mb-6">
              <div className={`achievement-badge mx-auto ${getRarityColor(badge.rarity)}`}>
                {React.createElement(ICON_MAP[badge.icon as keyof typeof ICON_MAP], {
                  className: "w-12 h-12 text-white"
                })}
              </div>
            </div>
            
            <h3 className="text-3xl font-bold holographic-text mb-2">
              BADGE SBLOCCATO!
            </h3>
            
            <h4 className="text-xl font-semibold text-white mb-4">
              {badge.name}
            </h4>
            
            <p className="text-gray-300 mb-6">
              {badge.description}
            </p>

            <div className="text-xs text-gray-400 uppercase tracking-wider">
              {badge.rarity} • {badge.category}
            </div>
          </div>
        </div>
      ))}

      {/* Badge Gallery */}
      <div className="futuristic-card">
        <h3 className="text-2xl font-bold mb-6 holographic-text">
          🏆 Hall of Fame
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {ACHIEVEMENT_BADGES.map(badge => {
            const isUnlocked = unlockedBadges.some(ub => ub.id === badge.id);
            const progress = calculateProgress(badge);
            const IconComponent = ICON_MAP[badge.icon as keyof typeof ICON_MAP];

            return (
              <div
                key={badge.id}
                className={`text-center group transition-all duration-300 ${
                  isUnlocked ? 'transform hover:scale-105' : ''
                }`}
              >
                <div 
                  className={`w-20 h-20 mx-auto mb-3 rounded-full border-3 flex items-center justify-center transition-all duration-300 ${
                    isUnlocked 
                      ? `${getRarityColor(badge.rarity)} achievement-badge` 
                      : 'border-gray-600 bg-gray-800 opacity-50'
                  }`}
                  style={{
                    boxShadow: isUnlocked ? getRarityGlow(badge.rarity) : 'none'
                  }}
                >
                  <IconComponent 
                    className={`w-8 h-8 ${isUnlocked ? 'text-white' : 'text-gray-500'}`}
                  />
                </div>

                <h4 className={`font-semibold text-sm mb-1 ${
                  isUnlocked ? 'text-white' : 'text-gray-500'
                }`}>
                  {badge.name}
                </h4>

                <p className={`text-xs mb-2 ${
                  isUnlocked ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {badge.description}
                </p>

                {/* Progress Bar for Locked Badges */}
                {!isUnlocked && progress > 0 && (
                  <div className="w-full">
                    <div className="futuristic-progress h-2">
                      <div 
                        className="progress-fill-futuristic h-full"
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
        <div className="mt-8 pt-6 border-t border-gray-700">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold neon-text">{unlockedBadges.length}</div>
              <div className="text-xs text-gray-400">BADGES SBLOCCATI</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-400">
                {unlockedBadges.filter(b => b.rarity === 'legendary').length}
              </div>
              <div className="text-xs text-gray-400">LEGENDARY</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-400">
                {unlockedBadges.filter(b => b.rarity === 'epic').length}
              </div>
              <div className="text-xs text-gray-400">EPIC</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">
                {Math.round((unlockedBadges.length / ACHIEVEMENT_BADGES.length) * 100)}%
              </div>
              <div className="text-xs text-gray-400">COMPLETAMENTO</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}