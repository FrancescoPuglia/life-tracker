// src/lib/voice/useVoice.ts
// React hook for voice system integration

import { useState, useEffect, useCallback } from 'react';
import { getVoiceService } from './voiceService';
import type { VoiceSettings, VoiceRole, VoiceLanguage } from './voiceConfig';
import { DEFAULT_VOICE_SETTINGS } from './voiceConfig';

export function useVoice() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);

  // Load settings and voices on mount
  useEffect(() => {
    const svc = getVoiceService();
    if (!svc) return;

    setSettings(svc.getSettings());
    setIsAvailable(svc.isBrowserAvailable());

    // Load voices (may be async in Chrome)
    const loadVoices = () => {
      if (!svc) return;
      const langVoices = svc.getVoicesForLanguage();
      setVoices(langVoices);
    };

    loadVoices();

    // Chrome fires voiceschanged asynchronously
    if (typeof window !== 'undefined' && window.speechSynthesis?.onvoiceschanged !== undefined) {
      const handler = () => loadVoices();
      window.speechSynthesis.onvoiceschanged = handler;
      return () => { window.speechSynthesis.onvoiceschanged = null; };
    }

    // Fallback poll
    const timer = setTimeout(loadVoices, 600);
    return () => clearTimeout(timer);
  }, []);

  // Reload voices when language changes
  useEffect(() => {
    const svc = getVoiceService();
    if (!svc) return;
    const langVoices = svc.getVoicesForLanguage(settings.language);
    setVoices(langVoices);
  }, [settings.language]);

  const updateSettings = useCallback((updates: Partial<VoiceSettings>) => {
    const svc = getVoiceService();
    if (!svc) return;
    svc.updateSettings(updates);
    setSettings(svc.getSettings());
  }, []);

  const speakText = useCallback((text: string, role?: VoiceRole) => {
    const svc = getVoiceService();
    svc?.speakText(text, role);
  }, []);

  const speakCoach = useCallback((text: string) => {
    getVoiceService()?.speakCoach(text);
  }, []);

  const speakRitual = useCallback((text: string) => {
    getVoiceService()?.speakRitual(text);
  }, []);

  const speakSystem = useCallback((text: string) => {
    getVoiceService()?.speakSystem(text);
  }, []);

  const speakHero = useCallback((text: string) => {
    getVoiceService()?.speakHero(text);
  }, []);

  const previewVoice = useCallback((voiceName: string, role: VoiceRole = 'system') => {
    getVoiceService()?.previewVoice(voiceName, role);
  }, []);

  const previewRole = useCallback((role: VoiceRole) => {
    getVoiceService()?.previewRole(role);
  }, []);

  const stopSpeech = useCallback(() => {
    getVoiceService()?.stopSpeech();
  }, []);

  const speakConfirmation = useCallback((type: 'blockCompleted' | 'taskCompleted' | 'habitLogged' | 'goalProgress') => {
    getVoiceService()?.speakConfirmation(type);
  }, []);

  const speakHeroQuote = useCallback((quote: string, heroName?: string) => {
    getVoiceService()?.speakHeroQuote(quote, heroName);
  }, []);

  const speakBlockStart = useCallback((blockTitle: string, goalTitle?: string, reason?: string) => {
    getVoiceService()?.speakBlockStart(blockTitle, goalTitle, reason);
  }, []);

  return {
    settings,
    updateSettings,
    voices,
    isAvailable,
    speakText,
    speakCoach,
    speakRitual,
    speakSystem,
    speakHero,
    previewVoice,
    previewRole,
    stopSpeech,
    speakConfirmation,
    speakHeroQuote,
    speakBlockStart,
  };
}
