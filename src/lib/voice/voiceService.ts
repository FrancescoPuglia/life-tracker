// src/lib/voice/voiceService.ts
// Centralized voice service — single source of truth for all speech output.
// No component should call SpeechSynthesis directly. Use this service.

import {
  VoiceLanguage,
  VoiceRole,
  VoiceProvider,
  VoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  VOICE_SETTINGS_KEY,
  VOICE_ROLES,
  COUNTDOWN_TEXTS,
  SYSTEM_TEXTS,
  PREVIEW_TEXTS,
} from './voiceConfig';

// ============================================================================
// VOICE SERVICE SINGLETON
// ============================================================================

class VoiceService {
  private static instance: VoiceService;
  private settings: VoiceSettings;
  private cachedVoices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private speaking = false;
  private queue: Array<{ text: string; role: VoiceRole; priority: number }> = [];

  private constructor() {
    this.settings = this.loadSettings();
    this.initVoices();
  }

  static getInstance(): VoiceService {
    if (!VoiceService.instance) {
      VoiceService.instance = new VoiceService();
    }
    return VoiceService.instance;
  }

  // ============================================================================
  // SETTINGS PERSISTENCE
  // ============================================================================

  private loadSettings(): VoiceSettings {
    if (typeof window === 'undefined') return DEFAULT_VOICE_SETTINGS;
    try {
      const stored = localStorage.getItem(VOICE_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_VOICE_SETTINGS, ...parsed };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_VOICE_SETTINGS };
  }

  private saveSettings(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* ignore */ }
  }

  getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<VoiceSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
  }

  // ============================================================================
  // BROWSER VOICE DISCOVERY
  // ============================================================================

  private initVoices(): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      this.cachedVoices = window.speechSynthesis.getVoices();
      this.voicesLoaded = this.cachedVoices.length > 0;
    };

    loadVoices();

    // Chrome loads voices asynchronously
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Fallback: poll once after 500ms
    if (!this.voicesLoaded) {
      setTimeout(loadVoices, 500);
    }
  }

  /**
   * Get browser voices filtered by current language.
   * Returns voices whose lang starts with the language BCP47 prefix.
   */
  getVoicesForLanguage(lang?: VoiceLanguage): SpeechSynthesisVoice[] {
    const targetLang = lang || this.settings.language;
    const prefix = targetLang.split('-')[0]; // 'it', 'en', 'es'

    if (!this.voicesLoaded) {
      this.initVoices();
    }

    return this.cachedVoices.filter(v => v.lang.startsWith(prefix));
  }

  /**
   * Get all available browser voices (unfiltered).
   */
  getAllVoices(): SpeechSynthesisVoice[] {
    if (!this.voicesLoaded) {
      this.initVoices();
    }
    return [...this.cachedVoices];
  }

  /**
   * Check if browser speech synthesis is available.
   */
  isBrowserAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.speechSynthesis;
  }

  /**
   * Check if voice output is operational (master enabled + provider works).
   */
  isOperational(): boolean {
    if (!this.settings.enabled) return false;
    if (this.settings.provider === 'browser') {
      return this.isBrowserAvailable();
    }
    // For external providers, we'd check API key availability
    return false;
  }

  // ============================================================================
  // CORE SPEAK API
  // ============================================================================

  /**
   * Central speak function. All voice output flows through here.
   */
  speakText(text: string, role: VoiceRole = 'system', options?: {
    force?: boolean;
    rateOverride?: number;
    pitchOverride?: number;
    onEnd?: () => void;
  }): void {
    if (!this.settings.enabled && !options?.force) return;
    if (!text.trim()) return;

    // Check role-specific toggles
    if (!this.isRoleEnabled(role) && !options?.force) return;

    // Currently only browser provider implemented
    if (this.settings.provider === 'browser') {
      this.speakBrowser(text, role, options);
    }
    // Future: openai, elevenlabs providers would be called here
  }

  private isRoleEnabled(role: VoiceRole): boolean {
    switch (role) {
      case 'coach': return this.settings.enableMotivation;
      case 'ritual': return this.settings.enableCountdown;
      case 'system': return this.settings.enableSystemConfirmations;
      case 'hero': return this.settings.enableHeroQuotes;
      default: return true;
    }
  }

  private speakBrowser(text: string, role: VoiceRole, options?: {
    force?: boolean;
    rateOverride?: number;
    pitchOverride?: number;
    onEnd?: () => void;
  }): void {
    if (!window.speechSynthesis) return;

    try {
      // Cancel any ongoing speech for non-queue scenarios
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.settings.language;

      // Apply role-specific rate & pitch
      const roleConfig = VOICE_ROLES[role];
      utterance.rate = options?.rateOverride ?? (this.settings.speed * roleConfig.defaultRate);
      utterance.pitch = options?.pitchOverride ?? roleConfig.defaultPitch;
      utterance.volume = 0.9;

      // Select voice for this role
      const voiceName = this.settings.browserVoices[role];
      if (voiceName) {
        const voice = this.cachedVoices.find(v => v.name === voiceName);
        if (voice) {
          utterance.voice = voice;
        }
      } else {
        // Auto-select best voice for language
        const langVoices = this.getVoicesForLanguage();
        if (langVoices.length > 0) {
          // Prefer non-compact, local voices
          const preferred = langVoices.find(v => !v.name.includes('Compact') && v.localService)
            || langVoices.find(v => !v.name.includes('Compact'))
            || langVoices[0];
          utterance.voice = preferred;
        }
      }

      utterance.onstart = () => { this.speaking = true; };
      utterance.onend = () => {
        this.speaking = false;
        options?.onEnd?.();
      };
      utterance.onerror = () => {
        this.speaking = false;
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.speaking = false;
    }
  }

  // ============================================================================
  // ROLE-SPECIFIC CONVENIENCE METHODS
  // ============================================================================

  /** Coach voice — motivational, direct, sharp */
  speakCoach(text: string, onEnd?: () => void): void {
    this.speakText(text, 'coach', { onEnd });
  }

  /** Ritual voice — countdown, block start, operational commands */
  speakRitual(text: string, onEnd?: () => void): void {
    this.speakText(text, 'ritual', { onEnd });
  }

  /** System voice — neutral, brief confirmations */
  speakSystem(text: string, onEnd?: () => void): void {
    this.speakText(text, 'system', { onEnd });
  }

  /** Hero voice — dramatic quotes, premium motivation */
  speakHero(text: string, onEnd?: () => void): void {
    this.speakText(text, 'hero', { onEnd });
  }

  /** Speak AI response (only if enabled) */
  speakAIResponse(text: string, onEnd?: () => void): void {
    if (!this.settings.enableAIResponses) return;
    // Trim long AI responses
    const trimmed = text.length > 200 ? text.slice(0, 200) + '...' : text;
    this.speakText(trimmed, 'coach', { onEnd });
  }

  // ============================================================================
  // STRUCTURED SPEECH METHODS
  // ============================================================================

  /** Countdown sequence: 3-2-1-GO */
  speakCountdown(onComplete?: () => void): void {
    if (!this.settings.enableCountdown || !this.settings.enabled) {
      onComplete?.();
      return;
    }

    const texts = COUNTDOWN_TEXTS[this.settings.language];
    // We speak "GO" — the numbers are handled visually + sound effects.
    // Only the final GO + focus is spoken for sharpness.
    this.speakRitual(`${texts.go} ${texts.focus}`, onComplete);
  }

  /** Speak block start info */
  speakBlockStart(blockTitle: string, goalTitle?: string, reason?: string): void {
    if (!this.settings.enableCountdown || !this.settings.enabled) return;

    const lang = this.settings.language;
    const parts: string[] = [];

    // GO
    parts.push(COUNTDOWN_TEXTS[lang].go);

    // Block title
    parts.push(blockTitle + '.');

    // Goal connection
    if (goalTitle) {
      if (lang === 'it-IT') parts.push(`Per ${goalTitle}.`);
      else if (lang === 'en-US') parts.push(`For ${goalTitle}.`);
      else if (lang === 'es-ES') parts.push(`Para ${goalTitle}.`);
    }

    // Reason
    if (reason) parts.push(reason);

    this.speakRitual(parts.join(' '));
  }

  /** Speak system confirmation */
  speakConfirmation(type: 'blockCompleted' | 'taskCompleted' | 'habitLogged' | 'goalProgress'): void {
    if (!this.settings.enableSystemConfirmations || !this.settings.enabled) return;
    const text = SYSTEM_TEXTS[this.settings.language][type];
    this.speakSystem(text);
  }

  /** Speak hero quote */
  speakHeroQuote(quote: string, heroName?: string): void {
    if (!this.settings.enableHeroQuotes || !this.settings.enabled) return;
    const text = heroName ? `${heroName}. ${quote}` : quote;
    this.speakHero(text);
  }

  /** Preview a specific voice for settings UI */
  previewVoice(voiceName: string, role: VoiceRole = 'system'): void {
    const text = PREVIEW_TEXTS[this.settings.language][role];

    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.settings.language;

    const roleConfig = VOICE_ROLES[role];
    utterance.rate = this.settings.speed * roleConfig.defaultRate;
    utterance.pitch = roleConfig.defaultPitch;
    utterance.volume = 0.9;

    const voice = this.cachedVoices.find(v => v.name === voiceName);
    if (voice) {
      utterance.voice = voice;
    }

    window.speechSynthesis.speak(utterance);
  }

  /** Preview current settings for a role */
  previewRole(role: VoiceRole): void {
    const text = PREVIEW_TEXTS[this.settings.language][role];
    this.speakText(text, role, { force: true });
  }

  // ============================================================================
  // CONTROL
  // ============================================================================

  stopSpeech(): void {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.speaking = false;
    this.queue = [];
  }

  isSpeaking(): boolean {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      return window.speechSynthesis.speaking;
    }
    return this.speaking;
  }

  getLanguage(): VoiceLanguage {
    return this.settings.language;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const voiceService = typeof window !== 'undefined'
  ? VoiceService.getInstance()
  : (null as unknown as VoiceService);

/**
 * Safe access to voiceService — returns null on server side.
 * Components should use the useVoice() hook instead when possible.
 */
export function getVoiceService(): VoiceService | null {
  if (typeof window === 'undefined') return null;
  return VoiceService.getInstance();
}
