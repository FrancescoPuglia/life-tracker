'use client';

import { useState, useEffect } from 'react';
import { useAuthContext } from '@/providers/AuthProvider';

// ============================================================================
// STRATEGIC DOPAMINE TRACKING
// ============================================================================

interface DopamineState {
  lastLoginDate: string;
  hasReceivedDailyReward: boolean;
  timeBlocksCompletedToday: string[]; // IDs dei time blocks completati
  goalsAchievedToday: string[]; // IDs dei goal raggiunti
  habitsCompletedToday: string[]; // IDs delle abitudini completate
  pagesCreatedToday: string[]; // IDs delle pagine create
}

// ============================================================================
// STRATEGIC DOPAMINE SYSTEM
// ============================================================================

interface StrategicDopamineSystemProps {
  onTimeBlockCompleted?: (timeBlockId: string) => void;
  onGoalAchieved?: (goalId: string) => void;
  onHabitCompleted?: (habitId: string) => void;
  children?: React.ReactNode;
}

export default function StrategicDopamineSystem({ 
  onTimeBlockCompleted,
  onGoalAchieved,
  onHabitCompleted,
  children 
}: StrategicDopamineSystemProps) {
  const { user } = useAuthContext();
  const [dopamineState, setDopamineState] = useState<DopamineState | null>(null);

  // ============================================================================
  // INITIALIZE DOPAMINE STATE
  // ============================================================================

  useEffect(() => {
    if (!user?.uid) return;

    const today = new Date().toISOString().split('T')[0];
    const storageKey = `dopamine_${user.uid}`;
    
    try {
      const stored = localStorage.getItem(storageKey);
      let state: DopamineState;
      
      if (stored) {
        const parsed = JSON.parse(stored);
        // Reset daily counters if new day
        if (parsed.lastLoginDate !== today) {
          state = {
            lastLoginDate: today,
            hasReceivedDailyReward: false, // Will trigger daily login reward
            timeBlocksCompletedToday: [],
            goalsAchievedToday: [],
            habitsCompletedToday: [],
            pagesCreatedToday: []
          };
        } else {
          state = {
            ...parsed,
            // Ensure all fields exist for backwards compatibility
            pagesCreatedToday: parsed.pagesCreatedToday || [],
            habitsCompletedToday: parsed.habitsCompletedToday || []
          };
        }
      } else {
        // First time user
        state = {
          lastLoginDate: today,
          hasReceivedDailyReward: false,
          timeBlocksCompletedToday: [],
          goalsAchievedToday: [],
          habitsCompletedToday: [],
          pagesCreatedToday: []
        };
      }
      
      setDopamineState(state);
      
      // Save updated state
      localStorage.setItem(storageKey, JSON.stringify(state));
      
    } catch (error) {
      console.error('Error initializing dopamine state:', error);
    }
  }, [user?.uid]);

  // ============================================================================
  // DOPAMINE TRIGGER FUNCTIONS
  // ============================================================================

  const triggerDailyLoginReward = () => {
    if (!user?.uid || !dopamineState || dopamineState.hasReceivedDailyReward) return;

    console.log('🎉 DAILY LOGIN REWARD TRIGGERED!');
    
    if (typeof window !== 'undefined' && (window as any).dopamineSystem) {
      (window as any).dopamineSystem.triggerReward('first_login');
    }

    // Update state
    const newState = { ...dopamineState, hasReceivedDailyReward: true };
    setDopamineState(newState);
    localStorage.setItem(`dopamine_${user.uid}`, JSON.stringify(newState));
  };

  const triggerTimeBlockCompletion = (timeBlockId: string, isUrgent: boolean = false) => {
    if (!user?.uid || !dopamineState) return;
    
    // Check if already rewarded for this time block today
    if (dopamineState.timeBlocksCompletedToday.includes(timeBlockId)) {
      console.log('⚠️ Time block already rewarded today:', timeBlockId);
      return;
    }

    console.log('🎉 TIME BLOCK COMPLETION REWARD TRIGGERED!', timeBlockId);
    
    if (typeof window !== 'undefined' && (window as any).dopamineSystem) {
      if (isUrgent) {
        (window as any).dopamineSystem.triggerReward('urgent_task_completed');
      } else {
        (window as any).dopamineSystem.triggerReward('task_completed');
      }
    }

    // Update state
    const newState = {
      ...dopamineState,
      timeBlocksCompletedToday: [...dopamineState.timeBlocksCompletedToday, timeBlockId]
    };
    setDopamineState(newState);
    localStorage.setItem(`dopamine_${user.uid}`, JSON.stringify(newState));
    
    onTimeBlockCompleted?.(timeBlockId);
  };

  const triggerGoalAchievement = (goalId: string, progress: number) => {
    if (!user?.uid || !dopamineState) return;
    
    // Check if already rewarded for this goal today
    if (dopamineState.goalsAchievedToday.includes(goalId)) {
      console.log('⚠️ Goal already rewarded today:', goalId);
      return;
    }

    console.log('🎉🎉🎉 MASSIVE GOAL ACHIEVEMENT REWARD! 🎉🎉🎉', goalId);
    
    if (typeof window !== 'undefined' && (window as any).dopamineSystem) {
      // FULL SCREEN CELEBRATION!
      (window as any).dopamineSystem.triggerGoalMilestone(progress);
      
      // Check if it's a complete goal (100%)
      if (progress >= 100) {
        (window as any).dopamineSystem.triggerReward('perfect_day', {
          title: 'GOAL ACHIEVED! 🏆',
          message: 'You are UNSTOPPABLE! This is legendary! 🚀',
          points: 1000,
          rarity: 'legendary'
        });
      }
    }

    // Update state
    const newState = {
      ...dopamineState,
      goalsAchievedToday: [...dopamineState.goalsAchievedToday, goalId]
    };
    setDopamineState(newState);
    localStorage.setItem(`dopamine_${user.uid}`, JSON.stringify(newState));
    
    onGoalAchieved?.(goalId);
  };

  const triggerHabitCompletion = (habitId: string, streakCount: number) => {
    if (!user?.uid || !dopamineState) {
      console.warn('⚠️ Cannot trigger habit completion: missing user or dopamine state');
      return;
    }
    
    // Safe guard: ensure habitsCompletedToday exists
    const habitsCompletedToday = dopamineState.habitsCompletedToday || [];
    
    // Check if already rewarded for this habit today
    if (habitsCompletedToday.includes(habitId)) {
      console.log('⚠️ Habit already rewarded today:', habitId);
      return;
    }

    console.log('🎉 HABIT COMPLETION REWARD TRIGGERED!', habitId, `streak: ${streakCount}`);
    
    if (typeof window !== 'undefined' && (window as any).dopamineSystem) {
      // Special rewards for streaks
      if (streakCount >= 30) {
        (window as any).dopamineSystem.triggerReward('streak_7', {
          title: 'Habit Master! 👑',
          message: `30+ day streak! You're unstoppable! 🔥`,
          points: 200,
          rarity: 'legendary'
        });
      } else if (streakCount >= 7) {
        (window as any).dopamineSystem.triggerReward('streak_3', {
          title: 'Habit Streak! 🔥',
          message: `${streakCount} days strong! Keep going! 💪`,
          points: 50 + streakCount,
          rarity: 'rare'
        });
      } else {
        (window as any).dopamineSystem.triggerReward('habit_completed');
      }
    }

    // Update state
    const newState = {
      ...dopamineState,
      habitsCompletedToday: [...habitsCompletedToday, habitId]
    };
    setDopamineState(newState);
    localStorage.setItem(`dopamine_${user.uid}`, JSON.stringify(newState));
    
    onHabitCompleted?.(habitId);
  };

  const triggerPageCreation = () => {
    if (!user?.uid || !dopamineState) {
      console.warn('⚠️ Cannot trigger page creation: missing user or dopamine state');
      return;
    }
    
    // Generate random page ID for tracking (since we don't have the actual ID yet)
    const pageId = `page-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    // Safe guard: ensure pagesCreatedToday exists
    const pagesCreatedToday = dopamineState.pagesCreatedToday || [];
    
    // Check if we've already created many pages today (prevent spam)
    if (pagesCreatedToday.length >= 10) {
      console.log('⚠️ Page creation limit reached for today');
      return;
    }

    console.log('🧠 PAGE CREATION REWARD TRIGGERED!', pageId);
    
    if (typeof window !== 'undefined' && (window as any).dopamineSystem) {
      if (pagesCreatedToday.length === 0) {
        // First page of the day - special reward
        (window as any).dopamineSystem.triggerReward('first_page_created', {
          title: 'First Page Created! 📝',
          message: 'Your Second Brain is growing! 🧠',
          points: 25,
          rarity: 'common'
        });
      } else if (pagesCreatedToday.length >= 5) {
        // Multiple pages - creative burst!
        (window as any).dopamineSystem.triggerReward('creative_burst', {
          title: 'Creative Burst! ✨',
          message: 'Ideas are flowing! Keep creating! 🚀',
          points: 75,
          rarity: 'rare'
        });
      } else {
        (window as any).dopamineSystem.triggerReward('page_created');
      }
    }

    // Update state
    const newState = {
      ...dopamineState,
      pagesCreatedToday: [...pagesCreatedToday, pageId]
    };
    setDopamineState(newState);
    localStorage.setItem(`dopamine_${user.uid}`, JSON.stringify(newState));
  };

  // ============================================================================
  // EXPOSE FUNCTIONS GLOBALLY
  // ============================================================================

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // @ts-ignore
    window.strategicDopamine = {
      triggerDailyLoginReward,
      triggerTimeBlockCompletion,
      triggerGoalAchievement,
      triggerHabitCompletion,
      triggerPageCreation
    };

    return () => {
      // @ts-ignore
      delete window.strategicDopamine;
    };
  }, [dopamineState, user?.uid]);

  // ============================================================================
  // AUTO TRIGGER DAILY LOGIN REWARD
  // ============================================================================

  useEffect(() => {
    if (dopamineState && !dopamineState.hasReceivedDailyReward) {
      // Delay to let other systems load
      const timeout = setTimeout(() => {
        triggerDailyLoginReward();
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [dopamineState]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <>
      {children}
      
      {/* Dopamine Status Widget */}
      {dopamineState && (
        <div className="fixed bottom-8 left-4 bg-gradient-to-r from-gray-900 to-gray-700 backdrop-blur-md border border-gray-600/50 text-white p-6 rounded-2xl shadow-2xl z-50 min-w-[200px]">
          <div className="text-sm font-bold text-blue-300 mb-3">🎮 Daily Progress</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-300">Daily Reward:</span>
              <span className="text-lg">{dopamineState.hasReceivedDailyReward ? '✅' : '⏳'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">Blocks:</span>
              <span className="text-green-400 font-bold">{dopamineState.timeBlocksCompletedToday.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">Goals Today:</span>
              <span className="text-purple-400 font-bold">{dopamineState.goalsAchievedToday.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">Habits:</span>
              <span className="text-orange-400 font-bold">{dopamineState.habitsCompletedToday?.length || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">Pages:</span>
              <span className="text-cyan-400 font-bold">{(dopamineState.pagesCreatedToday || []).length}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}