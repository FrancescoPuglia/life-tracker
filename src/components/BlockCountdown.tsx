'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Volume2, VolumeX } from 'lucide-react';
import { useDataContext } from '@/providers/DataProvider';
import { audioManager } from '@/lib/audioManager';

interface BlockCountdownSettings {
  enabled: boolean;
  voiceEnabled: boolean;
  soundEnabled: boolean;
  leadTimeSeconds: number;
}

const SETTINGS_KEY = 'life_tracker_countdown_settings';

function loadSettings(): BlockCountdownSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return { enabled: true, voiceEnabled: true, soundEnabled: true, leadTimeSeconds: 60 };
}

function saveSettings(s: BlockCountdownSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Track which blocks we've already shown countdown for
const shownBlocks = new Set<string>();

export default function BlockCountdown() {
  const data = useDataContext();
  const [settings, setSettings] = useState<BlockCountdownSettings>(loadSettings);
  const [activeBlock, setActiveBlock] = useState<{ id: string; title: string; goalTitle?: string; reason: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [phase, setPhase] = useState<'waiting' | 'countdown' | 'go' | 'done'>('waiting');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const updateSettings = useCallback((updates: Partial<BlockCountdownSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      return next;
    });
  }, []);

  // Speak using SpeechSynthesis
  const speak = useCallback((text: string) => {
    if (!settings.voiceEnabled) return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'it-IT';
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.volume = 0.9;
      window.speechSynthesis.speak(utterance);
    } catch { /* voice not available */ }
  }, [settings.voiceEnabled]);

  // Check for upcoming blocks
  useEffect(() => {
    if (data.status !== 'ready' || !settings.enabled) return;

    const check = () => {
      const now = new Date();
      const leadMs = settings.leadTimeSeconds * 1000;

      for (const block of data.timeBlocks) {
        if (block.deleted || block.status === 'completed' || block.status === 'cancelled') continue;
        if (shownBlocks.has(block.id)) continue;

        const blockStart = new Date(block.startTime);
        const diff = blockStart.getTime() - now.getTime();

        // Block is within lead time window and not yet past
        if (diff >= -5000 && diff <= leadMs) {
          shownBlocks.add(block.id);

          const goal = block.goalId ? data.goals.find(g => g.id === block.goalId) : null;
          let reason = '';
          if (goal) {
            reason = `Questo blocco muove "${goal.title}" in avanti.`;
            if (goal.targetDate) {
              const daysLeft = Math.ceil((new Date(goal.targetDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              if (daysLeft > 0 && daysLeft <= 30) {
                reason += ` ${daysLeft} giorni alla scadenza.`;
              }
            }
          } else {
            reason = 'Ogni blocco completato conta.';
          }

          setActiveBlock({
            id: block.id,
            title: block.title,
            goalTitle: goal?.title,
            reason,
          });
          setPhase('countdown');
          setCountdown(3);
          break;
        }
      }
    };

    check();
    checkIntervalRef.current = setInterval(check, 10000);
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
    };
  }, [data.status, data.timeBlocks, data.goals, settings.enabled, settings.leadTimeSeconds]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'countdown' || countdown === null) return;

    if (countdown > 0) {
      if (settings.soundEnabled) {
        audioManager.buttonFeedback();
      }
      intervalRef.current = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
    } else {
      // GO!
      setPhase('go');
      if (settings.soundEnabled) {
        audioManager.taskCompleted();
      }
      if (activeBlock) {
        const voiceText = `Via. ${activeBlock.title}.${activeBlock.goalTitle ? ` Per ${activeBlock.goalTitle}.` : ''} ${activeBlock.reason}`;
        speak(voiceText);
      }
      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        setPhase('done');
        setActiveBlock(null);
      }, 4000);
    }

    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current);
    };
  }, [phase, countdown, settings.soundEnabled, activeBlock, speak]);

  const dismiss = () => {
    setPhase('done');
    setActiveBlock(null);
    if (intervalRef.current) clearTimeout(intervalRef.current);
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  // Render nothing if no active countdown
  if (phase === 'waiting' || phase === 'done' || !activeBlock) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md">
      {/* Dismiss button */}
      <button onClick={dismiss} className="absolute top-6 right-6 text-gray-500 hover:text-white z-10">
        <X className="w-6 h-6" />
      </button>

      <div className="text-center space-y-8 max-w-lg px-6">
        {/* Countdown number or GO */}
        {phase === 'countdown' && countdown !== null && countdown > 0 && (
          <div className="relative">
            <div className="text-[180px] font-black text-white leading-none animate-pulse">
              {countdown}
            </div>
            <div className="absolute inset-0 text-[180px] font-black text-cyan-500/20 leading-none blur-xl">
              {countdown}
            </div>
          </div>
        )}

        {(phase === 'go' || (phase === 'countdown' && countdown === 0)) && (
          <div className="relative">
            <div className="text-[120px] font-black text-cyan-400 leading-none tracking-wider">
              GO
            </div>
            <div className="absolute inset-0 text-[120px] font-black text-cyan-500/30 leading-none blur-2xl tracking-wider">
              GO
            </div>
          </div>
        )}

        {/* Block info */}
        <div className="space-y-3">
          <h2 className="text-2xl font-bold text-white">
            {activeBlock.title}
          </h2>
          {activeBlock.goalTitle && (
            <p className="text-lg text-cyan-400 font-medium">
              {activeBlock.goalTitle}
            </p>
          )}
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            {activeBlock.reason}
          </p>
        </div>

        {/* Sound/Voice indicators */}
        <div className="flex items-center justify-center gap-4 text-gray-600">
          <button
            onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
            className={`p-2 rounded-lg transition-colors ${settings.soundEnabled ? 'text-gray-400' : 'text-gray-600'}`}
          >
            {settings.soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// Settings toggle component for use in MainApp sidebar
export function BlockCountdownToggle() {
  const [settings, setSettings] = useState<BlockCountdownSettings>(loadSettings);

  const toggle = (key: keyof BlockCountdownSettings) => {
    setSettings(prev => {
      const next = { ...prev, [key]: !prev[key] };
      saveSettings(next);
      return next;
    });
  };

  return (
    <div className="flex items-center gap-3 text-xs">
      <button
        onClick={() => toggle('enabled')}
        className={`px-2 py-1 rounded text-xs transition-colors ${
          settings.enabled ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'
        }`}
      >
        3-2-1 {settings.enabled ? 'ON' : 'OFF'}
      </button>
      <button
        onClick={() => toggle('voiceEnabled')}
        className={`px-2 py-1 rounded text-xs transition-colors ${
          settings.voiceEnabled ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30' : 'bg-gray-800 text-gray-500 border border-gray-700'
        }`}
      >
        Voce {settings.voiceEnabled ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
