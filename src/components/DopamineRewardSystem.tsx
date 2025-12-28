'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Star, Award, Zap, Crown, Gift, 
  TrendingUp, Target, Flame, Heart 
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

export interface DopamineReward {
  id: string;
  type: 'streak' | 'task_completion' | 'goal_progress' | 'habit_consistency' | 'time_block_completion';
  title: string;
  message: string;
  points: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  icon: React.ReactNode;
  color: string;
  soundEffect?: 'chime' | 'celebration' | 'levelup' | 'achievement';
  duration: number; // milliseconds to show
}

export interface ParticleEffect {
  id: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

// ============================================================================
// REWARD TEMPLATES
// ============================================================================

const REWARD_TEMPLATES: Record<string, Partial<DopamineReward>> = {
  // Streak Rewards
  first_login: {
    type: 'streak',
    title: 'Welcome Back!',
    message: 'Great to see you again! 🎉',
    points: 10,
    rarity: 'common',
    icon: <Star className="w-6 h-6" />,
    color: 'from-blue-400 to-blue-600',
    soundEffect: 'chime',
    duration: 3000
  },
  streak_3: {
    type: 'streak',
    title: 'Building Momentum!',
    message: '3 days in a row! You\'re on fire! 🔥',
    points: 50,
    rarity: 'rare',
    icon: <Flame className="w-6 h-6" />,
    color: 'from-orange-400 to-red-600',
    soundEffect: 'celebration',
    duration: 4000
  },
  streak_7: {
    type: 'streak',
    title: 'Week Warrior!',
    message: 'A full week of consistency! 💪',
    points: 100,
    rarity: 'epic',
    icon: <Crown className="w-6 h-6" />,
    color: 'from-purple-400 to-purple-600',
    soundEffect: 'achievement',
    duration: 5000
  },
  
  // Task Completion Rewards
  task_completed: {
    type: 'task_completion',
    title: 'Task Crushed!',
    message: 'Another one bites the dust! ✨',
    points: 25,
    rarity: 'common',
    icon: <Sparkles className="w-6 h-6" />,
    color: 'from-green-400 to-green-600',
    soundEffect: 'chime',
    duration: 2000
  },
  urgent_task_completed: {
    type: 'task_completion',
    title: 'Crisis Averted!',
    message: 'Urgent task completed just in time! ⚡',
    points: 75,
    rarity: 'rare',
    icon: <Zap className="w-6 h-6" />,
    color: 'from-yellow-400 to-orange-600',
    soundEffect: 'celebration',
    duration: 3000
  },

  habit_completed: {
    type: 'habit_consistency',
    title: 'Habit Crushed! 💪',
    message: 'Consistency is key to success! 🎯',
    points: 20,
    rarity: 'common',
    icon: <Heart className="w-6 h-6" />,
    color: 'from-purple-400 to-pink-600',
    soundEffect: 'chime',
    duration: 2500
  },
  
  // Goal Progress Rewards
  goal_milestone: {
    type: 'goal_progress',
    title: 'Milestone Reached!',
    message: 'You\'re making incredible progress! 🎯',
    points: 150,
    rarity: 'epic',
    icon: <Target className="w-6 h-6" />,
    color: 'from-indigo-400 to-purple-600',
    soundEffect: 'levelup',
    duration: 4000
  },
  
  // Perfect Day Rewards
  perfect_day: {
    type: 'time_block_completion',
    title: 'Perfect Day!',
    message: 'All time blocks completed! You\'re unstoppable! 👑',
    points: 200,
    rarity: 'legendary',
    icon: <Crown className="w-6 h-6" />,
    color: 'from-pink-400 to-purple-600',
    soundEffect: 'achievement',
    duration: 6000
  }
};

// ============================================================================
// DOPAMINE REWARD SYSTEM COMPONENT
// ============================================================================

interface DopamineRewardSystemProps {
  onRewardTriggered?: (reward: DopamineReward) => void;
  className?: string;
}

export default function DopamineRewardSystem({ 
  onRewardTriggered,
  className = ""
}: DopamineRewardSystemProps) {
  const [activeRewards, setActiveRewards] = useState<DopamineReward[]>([]);
  const [particles, setParticles] = useState<ParticleEffect[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  // ============================================================================
  // REWARD TRIGGERING FUNCTIONS
  // ============================================================================

  const triggerReward = (templateKey: string, customData?: Partial<DopamineReward>) => {
    const template = REWARD_TEMPLATES[templateKey];
    if (!template) return;

    const reward: DopamineReward = {
      id: `reward-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...template,
      ...customData,
    } as DopamineReward;

    setActiveRewards(prev => [...prev, reward]);
    setTotalPoints(prev => prev + reward.points);
    onRewardTriggered?.(reward);

    // Create particle explosion
    createParticleExplosion(reward);

    // Auto-remove after duration
    setTimeout(() => {
      setActiveRewards(prev => prev.filter(r => r.id !== reward.id));
    }, reward.duration);
  };

  // ============================================================================
  // PARTICLE SYSTEM
  // ============================================================================

  const createParticleExplosion = (reward: DopamineReward) => {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const particleCount = reward.rarity === 'legendary' ? 30 : 
                          reward.rarity === 'epic' ? 20 : 
                          reward.rarity === 'rare' ? 15 : 10;

    const newParticles: ParticleEffect[] = [];
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const velocity = 2 + Math.random() * 3;
      
      newParticles.push({
        id: `particle-${Date.now()}-${i}`,
        x: centerX,
        y: centerY,
        velocityX: Math.cos(angle) * velocity,
        velocityY: Math.sin(angle) * velocity,
        life: 0,
        maxLife: 60 + Math.random() * 60,
        color: getParticleColor(reward.rarity),
        size: 2 + Math.random() * 4
      });
    }
    
    setParticles(prev => [...prev, ...newParticles]);
  };

  const createMassiveParticleExplosion = () => {
    const newParticles: ParticleEffect[] = [];
    
    // MASSIVE FULLSCREEN CELEBRATION!
    for (let burst = 0; burst < 5; burst++) {
      const centerX = (window.innerWidth / 5) * (burst + 1);
      const centerY = window.innerHeight / 2 + (Math.random() - 0.5) * 200;
      
      for (let i = 0; i < 50; i++) {
        const angle = (Math.PI * 2 * i) / 50;
        const velocity = 3 + Math.random() * 5;
        
        newParticles.push({
          id: `massive-particle-${Date.now()}-${burst}-${i}`,
          x: centerX,
          y: centerY,
          velocityX: Math.cos(angle) * velocity,
          velocityY: Math.sin(angle) * velocity - 1, // Slight upward bias
          life: 0,
          maxLife: 120 + Math.random() * 60, // Longer life
          color: ['#ec4899', '#f59e0b', '#8b5cf6', '#3b82f6', '#10b981'][Math.floor(Math.random() * 5)],
          size: 3 + Math.random() * 6
        });
      }
    }
    
    setParticles(prev => [...prev, ...newParticles]);
  };

  const getParticleColor = (rarity: string): string => {
    switch (rarity) {
      case 'legendary': return '#ec4899';
      case 'epic': return '#f59e0b';
      case 'rare': return '#8b5cf6';
      default: return '#3b82f6';
    }
  };

  // ============================================================================
  // ANIMATION LOOP
  // ============================================================================

  useEffect(() => {
    const animate = () => {
      setParticles(prevParticles => {
        return prevParticles
          .map(particle => ({
            ...particle,
            x: particle.x + particle.velocityX,
            y: particle.y + particle.velocityY,
            velocityY: particle.velocityY + 0.1, // gravity
            life: particle.life + 1
          }))
          .filter(particle => particle.life < particle.maxLife);
      });
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // ============================================================================
  // CANVAS RENDERING
  // ============================================================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(particle => {
      const alpha = 1 - (particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1;
  }, [particles]);

  // ============================================================================
  // PUBLIC API FUNCTIONS
  // ============================================================================

  // Expose trigger functions globally
  useEffect(() => {
    // @ts-ignore
    window.dopamineSystem = {
      triggerReward,
      triggerStreakReward: (days: number) => {
        if (days === 1) triggerReward('first_login');
        else if (days === 3) triggerReward('streak_3');
        else if (days === 7) triggerReward('streak_7');
        else if (days % 30 === 0) triggerReward('streak_7', {
          title: `${days} Day Legend!`,
          message: `${days} days of pure dedication! 🏆`,
          points: days * 10,
          rarity: 'legendary'
        });
      },
      triggerTaskCompletion: (isUrgent = false) => {
        if (isUrgent) {
          triggerReward('urgent_task_completed');
        } else {
          triggerReward('task_completed');
        }
      },
      triggerGoalMilestone: (progress: number) => {
        // FULLSCREEN CELEBRATION for goal achievements!
        if (progress >= 100) {
          triggerReward('perfect_day', {
            title: 'GOAL ACHIEVED! 🏆',
            message: 'LEGENDARY ACHIEVEMENT! You are UNSTOPPABLE! 🚀✨',
            points: 1000,
            rarity: 'legendary',
            duration: 8000 // Longer celebration
          });
          
          // Create MASSIVE particle explosion
          createMassiveParticleExplosion();
        } else {
          triggerReward('goal_milestone', {
            message: `${progress}% complete! Keep going! 🚀`,
            points: Math.floor(progress * 2)
          });
        }
      },
      triggerPerfectDay: () => {
        triggerReward('perfect_day');
      }
    };

    return () => {
      // @ts-ignore
      delete window.dopamineSystem;
    };
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <>
      {/* Particle Canvas */}
      <canvas 
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-50"
        style={{ mixBlendMode: 'screen' }}
      />

      {/* Rewards Display */}
      <div className={`fixed top-4 right-4 z-50 space-y-3 ${className}`}>
        {/* Points Counter */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 
                      rounded-full shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4" />
            <span className="font-bold">{totalPoints.toLocaleString()}</span>
            <span className="text-xs opacity-90">points</span>
          </div>
        </div>

        {/* Active Rewards */}
        {activeRewards.map((reward) => (
          <div
            key={reward.id}
            className={`reward-popup bg-gradient-to-r ${reward.color} text-white 
                       rounded-2xl p-4 shadow-2xl max-w-sm backdrop-blur-md
                       border border-white/20 ${
                         reward.rarity === 'legendary' ? 'animate-pulse' : ''
                       }`}
            style={{
              animation: `reward-appear 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55), 
                         ${reward.rarity === 'legendary' ? 'legendary-shimmer 3s ease-in-out infinite' : 'none'}`
            }}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="flex-shrink-0 w-12 h-12 bg-white/20 rounded-full 
                            flex items-center justify-center backdrop-blur-sm">
                {reward.icon}
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold text-lg truncate">{reward.title}</h4>
                  <div className="flex-shrink-0 bg-white/20 px-2 py-1 rounded-full">
                    <span className="text-xs font-bold">+{reward.points}</span>
                  </div>
                </div>
                <p className="text-sm text-white/90 leading-snug">{reward.message}</p>
                
                {/* Rarity Badge */}
                <div className="mt-2">
                  <span className={`inline-block px-2 py-1 rounded-full text-xs font-bold 
                                  uppercase tracking-wide ${
                                    reward.rarity === 'legendary' ? 'bg-pink-500/30 text-pink-100' :
                                    reward.rarity === 'epic' ? 'bg-yellow-500/30 text-yellow-100' :
                                    reward.rarity === 'rare' ? 'bg-purple-500/30 text-purple-100' :
                                    'bg-blue-500/30 text-blue-100'
                                  }`}>
                    {reward.rarity}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}