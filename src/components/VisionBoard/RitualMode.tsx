"use client";

import { useState, useEffect, useRef } from 'react';
import { 
  X, Play, Pause, SkipForward, SkipBack, Maximize2, 
  Volume2, VolumeX, Timer, Sparkles, Target, 
  Zap, Star, Heart, Flame
} from 'lucide-react';
import type { VisionBoard, VisionItem, Goal } from '@/types';

// ============================================================================
// RITUAL MODE - Fullscreen Vision Board Experience
// ============================================================================

interface RitualModeProps {
  board: VisionBoard;
  visionItems?: VisionItem[];
  linkedGoal?: Goal;
  onClose: () => void;
  autoplayDuration?: number; // seconds per item
}

export function RitualMode({
  board,
  visionItems = [],
  linkedGoal,
  onClose,
  autoplayDuration = 5
}: RitualModeProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(autoplayDuration);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [sessionTime, setSessionTime] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Filter to pinned items if any, otherwise all items
  const displayItems = visionItems.filter(item => item.isPinned).length > 0 
    ? visionItems.filter(item => item.isPinned)
    : visionItems;

  // Auto-advance timer
  useEffect(() => {
    if (isPlaying && displayItems.length > 0) {
      intervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            setCurrentIndex(prevIndex => 
              prevIndex >= displayItems.length - 1 ? 0 : prevIndex + 1
            );
            return autoplayDuration;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, displayItems.length, autoplayDuration]);

  // Session timer
  useEffect(() => {
    const sessionInterval = setInterval(() => {
      setSessionTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(sessionInterval);
  }, []);

  // Auto-hide controls
  useEffect(() => {
    if (showControls) {
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
      hideControlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }

    return () => {
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
    };
  }, [showControls]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleNext();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleNext = () => {
    setCurrentIndex(prev => 
      prev >= displayItems.length - 1 ? 0 : prev + 1
    );
    setTimeRemaining(autoplayDuration);
  };

  const handlePrevious = () => {
    setCurrentIndex(prev => 
      prev <= 0 ? displayItems.length - 1 : prev - 1
    );
    setTimeRemaining(autoplayDuration);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentItem = displayItems[currentIndex];

  if (displayItems.length === 0) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
        <div className="text-center text-white">
          <Sparkles className="h-24 w-24 mx-auto mb-6 text-purple-400" />
          <h2 className="text-3xl font-bold mb-4">No Items for Ritual</h2>
          <p className="text-xl text-gray-300 mb-8">
            Add some pinned items to your vision board first
          </p>
          <button
            onClick={onClose}
            className="px-8 py-4 bg-white text-black rounded-lg hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 bg-black z-50 overflow-hidden"
      onMouseMove={() => setShowControls(true)}
      style={{
        background: board.backgroundColor ? 
          `linear-gradient(135deg, ${board.backgroundColor}22, black)` : 
          'black'
      }}
    >
      {/* Current Vision Item Display */}
      <div className="absolute inset-0 flex items-center justify-center">
        <RitualItemDisplay 
          item={currentItem} 
          board={board}
          linkedGoal={linkedGoal}
        />
      </div>

      {/* Ambient Particles */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-white rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 2}s`
            }}
          />
        ))}
      </div>

      {/* Header Info */}
      <div className={`absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/50 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">{board.title}</h1>
            {linkedGoal && (
              <div className="flex items-center gap-2 bg-blue-600/30 backdrop-blur-sm px-4 py-2 rounded-full">
                <Target className="h-5 w-5" />
                <span>{linkedGoal.title}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-purple-600/30 backdrop-blur-sm px-4 py-2 rounded-full">
              <Timer className="h-5 w-5" />
              <span>{formatTime(sessionTime)}</span>
            </div>

            <button
              onClick={onClose}
              className="p-3 bg-red-600/30 backdrop-blur-sm hover:bg-red-600/50 rounded-full transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Controls */}
      <div className={`absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/50 to-transparent transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <div className="text-white">
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-sm">
                {currentIndex + 1} of {displayItems.length}
              </span>
              <div className="flex-1 bg-white/20 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-white h-full transition-all duration-1000"
                  style={{
                    width: `${((autoplayDuration - timeRemaining) / autoplayDuration) * 100}%`
                  }}
                />
              </div>
              <span className="text-sm">
                {formatTime(timeRemaining)}
              </span>
            </div>

            {/* Item Navigation Dots */}
            <div className="flex items-center justify-center gap-2">
              {displayItems.map((_, index) => (
                <button
                  key={index}
                  onClick={() => {
                    setCurrentIndex(index);
                    setTimeRemaining(autoplayDuration);
                  }}
                  className={`w-3 h-3 rounded-full transition-all ${
                    index === currentIndex 
                      ? 'bg-white scale-125' 
                      : 'bg-white/40 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={handlePrevious}
              className="p-3 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full transition-colors"
            >
              <SkipBack className="h-6 w-6" />
            </button>

            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-4 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full transition-colors"
            >
              {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
            </button>

            <button
              onClick={handleNext}
              className="p-3 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full transition-colors"
            >
              <SkipForward className="h-6 w-6" />
            </button>

            <div className="mx-4 w-px h-8 bg-white/20" />

            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-3 bg-white/20 backdrop-blur-sm hover:bg-white/30 rounded-full transition-colors"
            >
              {isMuted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Floating Motivation */}
      <div className="absolute top-1/2 left-8 transform -translate-y-1/2 text-white">
        <div className="space-y-4">
          {[
            { icon: Star, text: "Believe" },
            { icon: Heart, text: "Feel" },
            { icon: Zap, text: "Manifest" },
            { icon: Flame, text: "Achieve" }
          ].map((item, index) => (
            <div 
              key={item.text}
              className="flex items-center gap-3 opacity-60 animate-pulse"
              style={{ animationDelay: `${index * 0.5}s` }}
            >
              <item.icon className="h-6 w-6" />
              <span className="text-lg font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Keyboard Shortcuts Help */}
      <div className={`absolute top-1/2 right-8 transform -translate-y-1/2 text-white text-sm transition-opacity duration-300 ${showControls ? 'opacity-60' : 'opacity-0'}`}>
        <div className="space-y-2">
          <p><kbd className="bg-white/20 px-2 py-1 rounded">Space</kbd> Play/Pause</p>
          <p><kbd className="bg-white/20 px-2 py-1 rounded">←/→</kbd> Navigate</p>
          <p><kbd className="bg-white/20 px-2 py-1 rounded">Esc</kbd> Exit</p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RITUAL ITEM DISPLAY COMPONENT
// ============================================================================

interface RitualItemDisplayProps {
  item: VisionItem;
  board: VisionBoard;
  linkedGoal?: Goal;
}

function RitualItemDisplay({ item, board, linkedGoal }: RitualItemDisplayProps) {
  switch (item.type) {
    case 'quote':
      return (
        <div className="max-w-4xl mx-auto text-center text-white p-8">
          <div className="relative">
            <Sparkles className="h-16 w-16 mx-auto mb-8 text-yellow-400 animate-pulse" />
            <blockquote className="text-4xl md:text-6xl font-bold leading-tight mb-8 animate-fade-in">
              "{item.text}"
            </blockquote>
            {item.caption && (
              <cite className="text-2xl text-gray-300 animate-fade-in delay-500">
                — {item.caption}
              </cite>
            )}
          </div>
        </div>
      );

    case 'image':
      return (
        <div className="max-w-5xl max-h-[80vh] mx-auto">
          {/* Placeholder for actual image */}
          <div className="relative bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl aspect-video flex items-center justify-center animate-fade-in">
            <div className="text-center text-white">
              <Star className="h-24 w-24 mx-auto mb-4" />
              <h3 className="text-2xl font-bold mb-2">{item.caption || 'Vision Image'}</h3>
              {linkedGoal && (
                <p className="text-lg text-blue-200">
                  Manifesting: {linkedGoal.title}
                </p>
              )}
            </div>
          </div>
        </div>
      );

    case 'video':
      return (
        <div className="max-w-5xl max-h-[80vh] mx-auto">
          {/* Placeholder for actual video */}
          <div className="relative bg-gradient-to-br from-red-500 to-pink-600 rounded-xl aspect-video flex items-center justify-center animate-fade-in">
            <div className="text-center text-white">
              <Play className="h-24 w-24 mx-auto mb-4" />
              <h3 className="text-2xl font-bold mb-2">{item.caption || 'Vision Video'}</h3>
              {linkedGoal && (
                <p className="text-lg text-pink-200">
                  Manifesting: {linkedGoal.title}
                </p>
              )}
            </div>
          </div>
        </div>
      );

    default:
      return (
        <div className="text-center text-white">
          <Sparkles className="h-24 w-24 mx-auto mb-8 text-purple-400" />
          <h3 className="text-3xl font-bold">Vision Item</h3>
        </div>
      );
  }
}

export default RitualMode;

// CSS for fade-in animation (add to global styles)
const styles = `
@keyframes fade-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-fade-in {
  animation: fade-in 1s ease-out forwards;
}

.delay-500 {
  animation-delay: 0.5s;
}
`;