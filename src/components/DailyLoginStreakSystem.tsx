'use client';

import { useState, useEffect } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';
import { db } from '@/lib/database';
import { 
  Flame, Calendar, Award, Zap, Crown, Star, 
  TrendingUp, Target, Gift, Sparkles 
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface LoginStreak {
  id?: string;
  userId: string;
  currentStreak: number;
  maxStreak: number;
  lastLoginDate: string;
  totalLogins: number;
  weeklyLogins: number;
  monthlyLogins: number;
  streakStartDate: string;
  isOnFire: boolean; // 7+ days streak
  achievements: string[];
}

interface StreakReward {
  day: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  claimed: boolean;
}

// ============================================================================
// STREAK REWARDS SYSTEM
// ============================================================================

const STREAK_REWARDS: StreakReward[] = [
  {
    day: 1,
    title: "Primo Passo",
    description: "Hai iniziato il tuo viaggio!",
    icon: <Star className="w-5 h-5" />,
    color: "from-green-400 to-green-600",
    rarity: "common",
    claimed: false
  },
  {
    day: 3,
    title: "Momentum",
    description: "3 giorni di costanza!",
    icon: <TrendingUp className="w-5 h-5" />,
    color: "from-blue-400 to-blue-600", 
    rarity: "common",
    claimed: false
  },
  {
    day: 7,
    title: "Fuoco Acceso",
    description: "Una settimana di dedizione!",
    icon: <Flame className="w-5 h-5" />,
    color: "from-orange-400 to-red-600",
    rarity: "rare", 
    claimed: false
  },
  {
    day: 14,
    title: "Disciplina",
    description: "Due settimane di eccellenza!",
    icon: <Target className="w-5 h-5" />,
    color: "from-purple-400 to-purple-600",
    rarity: "rare",
    claimed: false
  },
  {
    day: 30,
    title: "Maestro dell'Abitudine",
    description: "Un mese di costanza assoluta!",
    icon: <Crown className="w-5 h-5" />,
    color: "from-yellow-400 to-yellow-600",
    rarity: "epic",
    claimed: false
  },
  {
    day: 100,
    title: "Leggenda Vivente",
    description: "100 giorni di pura determinazione!",
    icon: <Award className="w-5 h-5" />,
    color: "from-pink-400 to-purple-600", 
    rarity: "legendary",
    claimed: false
  }
];

// ============================================================================
// DAILY LOGIN STREAK COMPONENT
// ============================================================================

interface DailyLoginStreakSystemProps {
  onStreakUpdate?: (streak: LoginStreak) => void;
  showCompact?: boolean;
  className?: string;
}

export default function DailyLoginStreakSystem({ 
  onStreakUpdate,
  showCompact = false,
  className = "" 
}: DailyLoginStreakSystemProps) {
  const { user } = useAuthContext();
  const [streak, setStreak] = useState<LoginStreak | null>(null);
  const [showReward, setShowReward] = useState<StreakReward | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [animatingNumber, setAnimatingNumber] = useState(false);

  // ============================================================================
  // STREAK LOGIC
  // ============================================================================

  useEffect(() => {
    if (!user?.uid) return;

    const updateLoginStreak = async () => {
      try {
        setIsLoading(true);
        
        // Add timeout for database operations
        const timeoutId = setTimeout(() => {
          console.warn('⚠️ Database operation timeout - using cache');
          setIsLoading(false);
        }, 5000);
        const today = new Date().toISOString().split('T')[0];
        
        // Recupera streak attuale dal database
        const existingStreak = await db.read<LoginStreak>('login_streaks', user.uid);
        
        let updatedStreak: LoginStreak;
        
        if (!existingStreak || existingStreak.lastLoginDate !== today) {
          // Prima volta oggi o nuovo giorno
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];
          
          const isConsecutive = existingStreak?.lastLoginDate === yesterdayStr;
          
          updatedStreak = {
            userId: user.uid,
            currentStreak: isConsecutive ? (existingStreak.currentStreak + 1) : 1,
            maxStreak: Math.max(
              existingStreak?.maxStreak || 0, 
              isConsecutive ? (existingStreak.currentStreak + 1) : 1
            ),
            lastLoginDate: today,
            totalLogins: (existingStreak?.totalLogins || 0) + 1,
            weeklyLogins: calculateWeeklyLogins(existingStreak?.weeklyLogins || 0),
            monthlyLogins: calculateMonthlyLogins(existingStreak?.monthlyLogins || 0),
            streakStartDate: isConsecutive 
              ? (existingStreak?.streakStartDate || today)
              : today,
            isOnFire: isConsecutive ? (existingStreak.currentStreak + 1) >= 7 : false,
            achievements: existingStreak?.achievements || []
          };

          // Anima il numero se è un incremento
          if (isConsecutive) {
            setAnimatingNumber(true);
            setTimeout(() => setAnimatingNumber(false), 600);
          }

          // Verifica nuovi achievement
          const newReward = checkForNewReward(updatedStreak, existingStreak || undefined);
          if (newReward) {
            setShowReward(newReward);
            updatedStreak.achievements.push(`day_${newReward.day}`);
          }

          // Salva nel database
          const streakWithId = { ...updatedStreak, id: user.uid };
          if (existingStreak) {
            await db.update('login_streaks', streakWithId);
          } else {
            await db.create('login_streaks', streakWithId);
          }
        } else {
          updatedStreak = existingStreak as LoginStreak;
        }

        setStreak(updatedStreak);
        onStreakUpdate?.(updatedStreak);
        
        // Backup to localStorage
        localStorage.setItem(`streak_${user.uid}`, JSON.stringify(updatedStreak));

        clearTimeout(timeoutId);
        
      } catch (error) {
        console.error('Error updating login streak:', error);
        
        // Fallback to localStorage for basic streak tracking
        const localStreak = localStorage.getItem(`streak_${user.uid}`);
        if (localStreak) {
          try {
            const parsed = JSON.parse(localStreak);
            setStreak(parsed);
          } catch (e) {
            console.error('Failed to parse local streak:', e);
          }
        }
      } finally {
        setIsLoading(false);
      }
    };

    updateLoginStreak();
  }, [user?.uid, onStreakUpdate]);

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  const calculateWeeklyLogins = (current: number): number => {
    const today = new Date();
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    // Logic to count this week's logins
    return current + 1; // Simplified
  };

  const calculateMonthlyLogins = (current: number): number => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    // Logic to count this month's logins  
    return current + 1; // Simplified
  };

  const checkForNewReward = (newStreak: LoginStreak, oldStreak?: LoginStreak): StreakReward | null => {
    const currentDay = newStreak.currentStreak;
    const previousDay = oldStreak?.currentStreak || 0;
    
    const availableReward = STREAK_REWARDS.find(reward => 
      reward.day === currentDay && 
      !newStreak.achievements.includes(`day_${reward.day}`)
    );
    
    return availableReward || null;
  };

  const getRarityStyle = (rarity: string) => {
    switch (rarity) {
      case 'legendary': return 'border-pink-400 shadow-pink-400/30 bg-gradient-to-r from-pink-50 to-purple-50';
      case 'epic': return 'border-yellow-400 shadow-yellow-400/30 bg-gradient-to-r from-yellow-50 to-orange-50';
      case 'rare': return 'border-purple-400 shadow-purple-400/30 bg-gradient-to-r from-purple-50 to-blue-50';
      default: return 'border-blue-400 shadow-blue-400/30 bg-gradient-to-r from-blue-50 to-green-50';
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (isLoading || !streak) {
    return (
      <div className={`animate-pulse bg-gray-100 rounded-xl p-4 ${className}`}>
        <div className="h-6 bg-gray-200 rounded mb-2"></div>
        <div className="h-8 bg-gray-200 rounded w-1/2"></div>
      </div>
    );
  }

  if (showCompact) {
    return (
      <div className={`flex items-center gap-3 bg-gradient-to-r from-orange-50 to-red-50 
                     border border-orange-200 rounded-xl px-4 py-2 ${className}`}>
        {streak.isOnFire ? (
          <Flame className="w-6 h-6 text-orange-500 animate-pulse" />
        ) : (
          <Calendar className="w-5 h-5 text-gray-600" />
        )}
        <div className="flex items-center gap-1">
          <span className={`font-bold text-lg ${animatingNumber ? 'animate-bounce' : ''} 
                         ${streak.isOnFire ? 'text-orange-600' : 'text-gray-700'}`}>
            {streak.currentStreak}
          </span>
          <span className="text-sm text-gray-500">
            {streak.currentStreak === 1 ? 'giorno' : 'giorni'}
          </span>
        </div>
        {streak.isOnFire && (
          <div className="flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
            <Zap className="w-3 h-3" />
            ON FIRE
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={`bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 
                      rounded-2xl p-6 shadow-lg ${className}`}>
        
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-bold text-xl text-gray-800">🔥 Daily Streak</h3>
          <div className="text-xs bg-gray-100 px-3 py-1 rounded-full text-gray-600">
            Record: {streak.maxStreak} giorni
          </div>
        </div>

        {/* Main Streak Display */}
        <div className="text-center mb-6">
          <div className="relative inline-block">
            {streak.isOnFire && (
              <div className="absolute -inset-2 bg-gradient-to-r from-orange-400 to-red-500 
                            rounded-full blur opacity-30 animate-pulse"></div>
            )}
            <div className={`relative bg-white rounded-full w-24 h-24 flex items-center justify-center 
                           border-4 ${streak.isOnFire ? 'border-orange-400' : 'border-blue-400'} 
                           shadow-lg ${animatingNumber ? 'animate-bounce' : ''}`}>
              <span className={`font-black text-3xl ${streak.isOnFire ? 'text-orange-600' : 'text-blue-600'}`}>
                {streak.currentStreak}
              </span>
            </div>
          </div>
          
          <p className="text-gray-600 mt-3">
            {streak.currentStreak === 1 ? 'Primo giorno!' : `${streak.currentStreak} giorni consecutivi`}
          </p>
          
          {streak.isOnFire && (
            <div className="inline-flex items-center gap-1 mt-2 bg-gradient-to-r from-orange-100 to-red-100 
                          text-orange-700 px-3 py-1 rounded-full text-sm font-medium">
              <Flame className="w-4 h-4 animate-pulse" />
              Sei in fiamme!
            </div>
          )}
        </div>

        {/* Progress to Next Milestone */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">Prossimo traguardo</span>
            <span className="text-sm font-medium text-gray-800">
              {STREAK_REWARDS.find(r => r.day > streak.currentStreak)?.day || 'MAX'} giorni
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-blue-400 to-purple-500 h-2 rounded-full transition-all duration-500"
              style={{ 
                width: `${Math.min(100, (streak.currentStreak / (STREAK_REWARDS.find(r => r.day > streak.currentStreak)?.day || 100)) * 100)}%` 
              }}
            ></div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4 text-center text-sm">
          <div className="bg-white rounded-lg p-3 border">
            <div className="font-bold text-blue-600">{streak.totalLogins}</div>
            <div className="text-gray-500 text-xs">Login totali</div>
          </div>
          <div className="bg-white rounded-lg p-3 border">
            <div className="font-bold text-green-600">{streak.weeklyLogins}</div>
            <div className="text-gray-500 text-xs">Questa settimana</div>
          </div>
          <div className="bg-white rounded-lg p-3 border">
            <div className="font-bold text-purple-600">{streak.achievements.length}</div>
            <div className="text-gray-500 text-xs">Achievement</div>
          </div>
        </div>
      </div>

      {/* Reward Notification Modal */}
      {showReward && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${getRarityStyle(showReward.rarity)} rounded-2xl p-8 max-w-sm w-full 
                         border-2 shadow-2xl animate-in slide-in-from-bottom-8 duration-500`}>
            
            <div className="text-center">
              {/* Reward Icon */}
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full 
                             bg-gradient-to-r ${showReward.color} text-white mb-4 shadow-lg`}>
                {showReward.icon}
              </div>
              
              {/* Reward Title */}
              <h3 className="font-bold text-xl text-gray-800 mb-2">
                🎉 {showReward.title}
              </h3>
              
              {/* Reward Description */}
              <p className="text-gray-600 mb-4">{showReward.description}</p>
              
              {/* Rarity Badge */}
              <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase 
                             ${showReward.rarity === 'legendary' ? 'bg-pink-100 text-pink-700' :
                               showReward.rarity === 'epic' ? 'bg-yellow-100 text-yellow-700' :
                               showReward.rarity === 'rare' ? 'bg-purple-100 text-purple-700' :
                               'bg-blue-100 text-blue-700'}`}>
                {showReward.rarity}
              </div>
            </div>
            
            {/* Close Button */}
            <button
              onClick={() => setShowReward(null)}
              className="w-full mt-6 bg-gradient-to-r from-gray-800 to-gray-900 text-white 
                       py-3 rounded-xl font-medium hover:from-gray-700 hover:to-gray-800 
                       transition-all duration-200 shadow-lg"
            >
              Fantastico! 🚀
            </button>
          </div>
        </div>
      )}
    </>
  );
}