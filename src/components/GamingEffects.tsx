'use client';

import { useState, useEffect } from 'react';
import { audioManager } from '@/lib/audioManager';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  xp: number;
}

interface GamingEffectsProps {
  onTaskComplete?: () => void;
  onGoalProgress?: (percent: number) => void;
  onHabitComplete?: (streakCount: number) => void;
}

export default function GamingEffects({ 
  onTaskComplete, 
  onGoalProgress, 
  onHabitComplete 
}: GamingEffectsProps) {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [showAchievement, setShowAchievement] = useState<Achievement | null>(null);
  const [xpGained, setXpGained] = useState<number>(0);
  const [comboCount, setComboCount] = useState(0);
  const [lastActionTime, setLastActionTime] = useState<Date>(new Date());

  useEffect(() => {
    audioManager.init();
  }, []);

  // 🎯 ACHIEVEMENT DEFINITIONS
  const achievementLibrary: Achievement[] = [
    {
      id: 'first_task',
      title: '🎯 First Steps',
      description: 'Complete your first task',
      icon: '🌟',
      rarity: 'common',
      xp: 10
    },
    {
      id: 'streak_7',
      title: '🔥 Week Warrior',
      description: 'Maintain a 7-day streak',
      icon: '🔥',
      rarity: 'rare',
      xp: 50
    },
    {
      id: 'streak_30',
      title: '💎 Diamond Dedication',
      description: 'Maintain a 30-day streak',
      icon: '💎',
      rarity: 'epic',
      xp: 200
    },
    {
      id: 'perfect_day',
      title: '⭐ Perfect Day',
      description: 'Complete all planned activities',
      icon: '⭐',
      rarity: 'legendary',
      xp: 100
    },
    {
      id: 'focus_master',
      title: '🧠 Focus Master',
      description: 'Complete 4+ hours of deep work',
      icon: '🧠',
      rarity: 'epic',
      xp: 150
    },
    {
      id: 'early_bird',
      title: '🌅 Early Bird',
      description: 'Start work before 7 AM',
      icon: '🌅',
      rarity: 'rare',
      xp: 30
    },
    {
      id: 'night_owl',
      title: '🦉 Night Owl',
      description: 'Work productively after 10 PM',
      icon: '🦉',
      rarity: 'rare',
      xp: 30
    },
    {
      id: 'combo_x5',
      title: '🎮 Combo Master',
      description: 'Complete 5 tasks in quick succession',
      icon: '🎮',
      rarity: 'epic',
      xp: 75
    }
  ];

  // 🏆 ACHIEVEMENT SYSTEM
  
  const unlockAchievement = (achievementId: string) => {
    const achievement = achievementLibrary.find(a => a.id === achievementId);
    if (!achievement || achievements.find(a => a.id === achievementId)) return;

    setAchievements(prev => [...prev, achievement]);
    setShowAchievement(achievement);
    setXpGained(prev => prev + achievement.xp);
    
    audioManager.play('achievementUnlock');
    
    setTimeout(() => {
      setShowAchievement(null);
    }, 3000);
  };

  const checkCombo = () => {
    const now = new Date();
    const timeDiff = now.getTime() - lastActionTime.getTime();
    
    // Combo if action within 30 seconds
    if (timeDiff < 30000) {
      setComboCount(prev => {
        const newCount = prev + 1;
        if (newCount >= 5) {
          unlockAchievement('combo_x5');
          audioManager.comboAchieved(newCount);
        }
        return newCount;
      });
    } else {
      setComboCount(1);
    }
    
    setLastActionTime(now);
  };

  // 🎮 GAMING EVENT HANDLERS
  
  const handleTaskComplete = () => {
    checkCombo();
    audioManager.taskCompleted();
    
    if (achievements.length === 0) {
      unlockAchievement('first_task');
    }
    
    onTaskComplete?.();
    showFloatingXP(25, 'Task Complete!');
  };

  const handleHabitComplete = (streakCount: number) => {
    checkCombo();
    audioManager.habitCompleted(streakCount);
    
    if (streakCount >= 7 && !achievements.find(a => a.id === 'streak_7')) {
      unlockAchievement('streak_7');
    }
    
    if (streakCount >= 30 && !achievements.find(a => a.id === 'streak_30')) {
      unlockAchievement('streak_30');
    }
    
    onHabitComplete?.(streakCount);
    showFloatingXP(15, `${streakCount} Day Streak!`);
  };

  const handleGoalProgress = (percent: number) => {
    audioManager.goalProgress(percent);
    onGoalProgress?.(percent);
    showFloatingXP(50, `Goal Progress: ${percent}%`);
  };

  const showFloatingXP = (xp: number, text: string) => {
    const element = document.createElement('div');
    element.className = 'damage-number';
    element.style.left = '50%';
    element.style.top = '50%';
    element.style.color = '#39ff14';
    element.textContent = `+${xp} XP`;
    
    const subtitle = document.createElement('div');
    subtitle.style.fontSize = '14px';
    subtitle.style.marginTop = '5px';
    subtitle.textContent = text;
    element.appendChild(subtitle);
    
    document.body.appendChild(element);
    
    setTimeout(() => {
      element.remove();
    }, 2000);
  };

  // 🎆 PARTICLE EFFECT
  const createParticleExplosion = (x: number, y: number) => {
    const colors = ['#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff4500'];
    
    for (let i = 0; i < 20; i++) {
      const particle = document.createElement('div');
      particle.style.position = 'fixed';
      particle.style.left = x + 'px';
      particle.style.top = y + 'px';
      particle.style.width = '4px';
      particle.style.height = '4px';
      particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      particle.style.borderRadius = '50%';
      particle.style.pointerEvents = 'none';
      particle.style.zIndex = '10000';
      
      const angle = (i / 20) * 2 * Math.PI;
      const velocity = 100 + Math.random() * 100;
      const vx = Math.cos(angle) * velocity;
      const vy = Math.sin(angle) * velocity;
      
      document.body.appendChild(particle);
      
      let startTime = Date.now();
      const animate = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 2) {
          particle.remove();
          return;
        }
        
        const newX = x + vx * elapsed;
        const newY = y + vy * elapsed + 0.5 * 500 * elapsed * elapsed; // gravity
        const opacity = Math.max(0, 1 - elapsed / 2);
        
        particle.style.left = newX + 'px';
        particle.style.top = newY + 'px';
        particle.style.opacity = opacity.toString();
        
        requestAnimationFrame(animate);
      };
      
      requestAnimationFrame(animate);
    }
  };

  return (
    <>
      {/* 🏆 ACHIEVEMENT POPUP */}
      {showAchievement && (
        <div className="achievement-popup">
          <div className="text-6xl mb-4">{showAchievement.icon}</div>
          <div className="text-2xl font-bold text-yellow-400 mb-2">
            ACHIEVEMENT UNLOCKED!
          </div>
          <div className="text-xl font-bold text-white mb-1">
            {showAchievement.title}
          </div>
          <div className="text-sm text-gray-300 mb-3">
            {showAchievement.description}
          </div>
          <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
            showAchievement.rarity === 'legendary' ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-black' :
            showAchievement.rarity === 'epic' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' :
            showAchievement.rarity === 'rare' ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' :
            'bg-gradient-to-r from-gray-400 to-gray-600 text-white'
          }`}>
            {showAchievement.rarity.toUpperCase()}
          </div>
          <div className="text-lg font-bold text-green-400 mt-2">
            +{showAchievement.xp} XP
          </div>
        </div>
      )}

      {/* 🎮 COMBO COUNTER */}
      {comboCount > 1 && (
        <div className="fixed top-20 right-4 z-50">
          <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-4 py-2 rounded-full font-bold text-lg shadow-lg transform scale-110 animate-pulse">
            🔥 {comboCount}x COMBO!
          </div>
        </div>
      )}

      {/* 🏆 FLOATING XP COUNTER */}
      <div className="fixed top-4 right-4 z-50">
        <div className="bg-gradient-to-r from-green-500 to-blue-500 text-white px-4 py-2 rounded-lg font-bold shadow-lg">
          💎 {xpGained.toLocaleString()} XP
        </div>
      </div>

      {/* 🎯 ACTION BUTTONS FOR TESTING */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2">
        <button
          onClick={handleTaskComplete}
          className="btn-gaming px-3 py-2 text-sm"
        >
          🎯 Complete Task
        </button>
        <button
          onClick={() => handleHabitComplete(Math.floor(Math.random() * 50) + 1)}
          className="btn-gaming px-3 py-2 text-sm"
        >
          🔥 Complete Habit
        </button>
        <button
          onClick={() => handleGoalProgress(Math.floor(Math.random() * 100))}
          className="btn-gaming px-3 py-2 text-sm"
        >
          📈 Goal Progress
        </button>
        <button
          onClick={() => audioManager.perfectDay()}
          className="btn-gaming px-3 py-2 text-sm"
        >
          🌟 Perfect Day
        </button>
      </div>

      {/* 🎆 CELEBRATION EFFECTS */}
      <style jsx global>{`
        .achievement-popup {
          animation: achievementAppear 3s ease-in-out;
        }
      `}</style>
    </>
  );
}