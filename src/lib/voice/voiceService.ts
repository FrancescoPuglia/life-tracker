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
  OPENAI_ROLE_DEFAULTS,
  ELEVENLABS_ROLE_DEFAULTS,
  type ProviderStatusType,
} from './voiceConfig';

// ============================================================================
// TYPES
// ============================================================================

export interface ProvidersStatus {
  openai: { status: ProviderStatusType; error?: string };
  elevenlabs: { status: ProviderStatusType; error?: string };
  browser: { status: ProviderStatusType };
}

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
  private currentAudio: HTMLAudioElement | null = null;
  private providersStatus: ProvidersStatus = {
    openai: { status: 'unknown' },
    elevenlabs: { status: 'unknown' },
    browser: { status: 'available' },
  };
  private statusFetched = false;

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
  // PROVIDER STATUS
  // ============================================================================

  /**
   * Fetch provider availability from backend API.
   * Results are cached — call refreshProviderStatus() to force re-check.
   */
  async fetchProviderStatus(): Promise<ProvidersStatus> {
    if (this.statusFetched) return this.providersStatus;

    try {
      this.providersStatus.openai = { status: 'checking' };
      this.providersStatus.elevenlabs = { status: 'checking' };

      const res = await fetch('/api/voice/status');
      if (!res.ok) throw new Error(`Status API returned ${res.status}`);

      const data = await res.json();

      this.providersStatus = {
        openai: data.openai || { status: 'unknown' },
        elevenlabs: data.elevenlabs || { status: 'unknown' },
        browser: { status: this.isBrowserAvailable() ? 'available' : 'error' },
      };
      this.statusFetched = true;
    } catch {
      // API not reachable (e.g. static export on GitHub Pages)
      this.providersStatus = {
        openai: { status: 'error', error: 'API not reachable (local dev only)' },
        elevenlabs: { status: 'error', error: 'API not reachable (local dev only)' },
        browser: { status: this.isBrowserAvailable() ? 'available' : 'error' },
      };
      this.statusFetched = true;
    }

    return this.providersStatus;
  }

  async refreshProviderStatus(): Promise<ProvidersStatus> {
    this.statusFetched = false;
    return this.fetchProviderStatus();
  }

  getProvidersStatus(): ProvidersStatus {
    return { ...this.providersStatus };
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
   */
  getVoicesForLanguage(lang?: VoiceLanguage): SpeechSynthesisVoice[] {
    const targetLang = lang || this.settings.language;
    const prefix = targetLang.split('-')[0];

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
    // For premium providers, check cached status
    const providerKey = this.settings.provider as 'openai' | 'elevenlabs';
    const status = this.providersStatus[providerKey]?.status;
    return status === 'available';
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

    // Route to the correct provider
    if (this.settings.provider === 'browser') {
      this.speakBrowser(text, role, options);
    } else {
      // Premium provider — async, with browser fallback on failure
      this.speakPremium(text, role, options);
    }
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

  // ============================================================================
  // BROWSER SPEECH
  // ============================================================================

  private speakBrowser(text: string, role: VoiceRole, options?: {
    force?: boolean;
    rateOverride?: number;
    pitchOverride?: number;
    onEnd?: () => void;
  }): void {
    if (!window.speechSynthesis) return;

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.settings.language;

      const roleConfig = VOICE_ROLES[role];
      utterance.rate = options?.rateOverride ?? (this.settings.speed * roleConfig.defaultRate);
      utterance.pitch = options?.pitchOverride ?? roleConfig.defaultPitch;
      utterance.volume = 0.9;

      // Select voice for this role
      const voiceName = this.settings.browserVoices[role];
      if (voiceName) {
        const voice = this.cachedVoices.find(v => v.name === voiceName);
        if (voice) utterance.voice = voice;
      } else {
        const langVoices = this.getVoicesForLanguage();
        if (langVoices.length > 0) {
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
      utterance.onerror = () => { this.speaking = false; };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.speaking = false;
    }
  }

  // ============================================================================
  // PREMIUM TTS (OpenAI / ElevenLabs)
  // ============================================================================

  /**
   * Speak via premium provider. Calls backend API, receives audio, plays it.
   * Falls back to browser on failure with console warning.
   */
  private async speakPremium(text: string, role: VoiceRole, options?: {
    force?: boolean;
    rateOverride?: number;
    pitchOverride?: number;
    onEnd?: () => void;
  }): Promise<void> {
    const provider = this.settings.provider;
    const voice = this.getVoiceIdForRole(role, provider);
    const model = provider === 'openai' ? this.settings.openaiModel : 'eleven_multilingual_v2';

    try {
      this.speaking = true;

      // Stop any currently playing premium audio
      this.stopPremiumAudio();

      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, provider, voice, model }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `TTS failed: ${res.status}`);
      }

      // Get audio blob and play it
      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      await this.playAudioBlob(audioUrl, options?.onEnd);
    } catch (err) {
      console.warn(`[VoiceService] Premium TTS failed (${provider}), falling back to browser:`, err);
      this.speaking = false;

      // Explicit fallback to browser
      if (this.isBrowserAvailable()) {
        this.speakBrowser(text, role, options);
      } else {
        options?.onEnd?.();
      }
    }
  }

  /**
   * Get the voice ID for a given role and provider.
   */
  private getVoiceIdForRole(role: VoiceRole, provider: VoiceProvider): string {
    if (provider === 'openai') {
      return this.settings.openaiVoices[role] || OPENAI_ROLE_DEFAULTS[role];
    }
    if (provider === 'elevenlabs') {
      return this.settings.elevenlabsVoices[role] || ELEVENLABS_ROLE_DEFAULTS[role];
    }
    return '';
  }

  /**
   * Play an audio blob URL via HTMLAudioElement.
   */
  private playAudioBlob(url: string, onEnd?: () => void): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onended = () => {
        this.speaking = false;
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        onEnd?.();
        resolve();
      };

      audio.onerror = () => {
        this.speaking = false;
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        onEnd?.();
        resolve();
      };

      audio.play().catch(() => {
        this.speaking = false;
        this.currentAudio = null;
        URL.revokeObjectURL(url);
        onEnd?.();
        resolve();
      });
    });
  }

  /**
   * Stop premium audio playback if active.
   */
  private stopPremiumAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
  }

  /**
   * Preview a premium voice via backend API.
   */
  async previewPremiumVoice(provider: VoiceProvider, voiceId: string, role: VoiceRole = 'system'): Promise<void> {
    const text = PREVIEW_TEXTS[this.settings.language][role];
    const model = provider === 'openai' ? this.settings.openaiModel : 'eleven_multilingual_v2';

    try {
      this.stopPremiumAudio();
      this.stopSpeech();

      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, provider, voice: voiceId, model }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `Preview failed: ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      await this.playAudioBlob(url);
    } catch (err) {
      console.warn('[VoiceService] Premium preview failed:', err);
      throw err; // Let UI handle the error
    }
  }

  // ============================================================================
  // ROLE-SPECIFIC CONVENIENCE METHODS
  // ============================================================================

  speakCoach(text: string, onEnd?: () => void): void {
    this.speakText(text, 'coach', { onEnd });
  }

  speakRitual(text: string, onEnd?: () => void): void {
    this.speakText(text, 'ritual', { onEnd });
  }

  speakSystem(text: string, onEnd?: () => void): void {
    this.speakText(text, 'system', { onEnd });
  }

  speakHero(text: string, onEnd?: () => void): void {
    this.speakText(text, 'hero', { onEnd });
  }

  speakAIResponse(text: string, onEnd?: () => void): void {
    if (!this.settings.enableAIResponses) return;
    const trimmed = text.length > 200 ? text.slice(0, 200) + '...' : text;
    this.speakText(trimmed, 'coach', { onEnd });
  }

  // ============================================================================
  // STRUCTURED SPEECH METHODS
  // ============================================================================

  speakCountdown(onComplete?: () => void): void {
    if (!this.settings.enableCountdown || !this.settings.enabled) {
      onComplete?.();
      return;
    }
    const texts = COUNTDOWN_TEXTS[this.settings.language];
    this.speakRitual(`${texts.go} ${texts.focus}`, onComplete);
  }

  speakBlockStart(blockTitle: string, goalTitle?: string, reason?: string): void {
    if (!this.settings.enableCountdown || !this.settings.enabled) return;

    const lang = this.settings.language;
    const parts: string[] = [];

    parts.push(COUNTDOWN_TEXTS[lang].go);
    parts.push(blockTitle + '.');

    if (goalTitle) {
      if (lang === 'it-IT') parts.push(`Per ${goalTitle}.`);
      else if (lang === 'en-US') parts.push(`For ${goalTitle}.`);
      else if (lang === 'es-ES') parts.push(`Para ${goalTitle}.`);
    }

    if (reason) parts.push(reason);

    this.speakRitual(parts.join(' '));
  }

  speakConfirmation(type: 'blockCompleted' | 'taskCompleted' | 'habitLogged' | 'goalProgress'): void {
    if (!this.settings.enableSystemConfirmations || !this.settings.enabled) return;
    const text = SYSTEM_TEXTS[this.settings.language][type];
    this.speakSystem(text);
  }

  speakHeroQuote(quote: string, heroName?: string): void {
    if (!this.settings.enableHeroQuotes || !this.settings.enabled) return;
    const text = heroName ? `${heroName}. ${quote}` : quote;
    this.speakHero(text);
  }

  /** Preview a specific browser voice for settings UI */
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
    if (voice) utterance.voice = voice;

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
    // Stop browser speech
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    // Stop premium audio
    this.stopPremiumAudio();
    this.speaking = false;
    this.queue = [];
  }

  isSpeaking(): boolean {
    if (this.currentAudio && !this.currentAudio.paused) return true;
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
