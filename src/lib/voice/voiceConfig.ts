// src/lib/voice/voiceConfig.ts
// Centralized voice configuration — languages, roles, defaults, preview texts

// ============================================================================
// LANGUAGES
// ============================================================================

export type VoiceLanguage = 'it-IT' | 'en-US' | 'es-ES';

export interface LanguageConfig {
  code: VoiceLanguage;
  label: string;
  flag: string;
  bcp47: string; // for SpeechSynthesis matching
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
  { code: 'it-IT', label: 'Italiano', flag: '\u{1F1EE}\u{1F1F9}', bcp47: 'it' },
  { code: 'en-US', label: 'English', flag: '\u{1F1FA}\u{1F1F8}', bcp47: 'en' },
  { code: 'es-ES', label: 'Espanol', flag: '\u{1F1EA}\u{1F1F8}', bcp47: 'es' },
];

// ============================================================================
// VOICE ROLES
// ============================================================================

export type VoiceRole = 'coach' | 'ritual' | 'system' | 'hero';

export interface VoiceRoleConfig {
  id: VoiceRole;
  label: string;
  description: string;
  /** Ideal speech rate for this role (0.5 - 2.0) */
  defaultRate: number;
  /** Ideal pitch for this role (0.0 - 2.0) */
  defaultPitch: number;
}

export const VOICE_ROLES: Record<VoiceRole, VoiceRoleConfig> = {
  coach: {
    id: 'coach',
    label: 'Coach',
    description: 'Motivational reminders, sharp and direct',
    defaultRate: 1.0,
    defaultPitch: 1.0,
  },
  ritual: {
    id: 'ritual',
    label: 'Ritual',
    description: 'Countdown, block start, operational commands',
    defaultRate: 0.95,
    defaultPitch: 1.05,
  },
  system: {
    id: 'system',
    label: 'System',
    description: 'Neutral confirmations, brief status updates',
    defaultRate: 1.1,
    defaultPitch: 1.0,
  },
  hero: {
    id: 'hero',
    label: 'Hero',
    description: 'Quotes, motivation, dramatic and premium',
    defaultRate: 0.85,
    defaultPitch: 0.95,
  },
};

// ============================================================================
// PROVIDERS
// ============================================================================

export type VoiceProvider = 'browser' | 'openai' | 'elevenlabs';
export type ProviderStatusType = 'available' | 'missing_key' | 'error' | 'checking' | 'unknown';

export interface ProviderInfo {
  id: VoiceProvider;
  label: string;
  description: string;
  requiresApiKey: boolean;
  envKey?: string;
  supportedLanguages: VoiceLanguage[];
}

export const VOICE_PROVIDERS: Record<VoiceProvider, ProviderInfo> = {
  browser: {
    id: 'browser',
    label: 'Browser (Built-in)',
    description: 'Free, instant, works offline. Quality varies by OS/browser.',
    requiresApiKey: false,
    supportedLanguages: ['it-IT', 'en-US', 'es-ES'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI TTS',
    description: 'Premium neural voices. Requires API key.',
    requiresApiKey: true,
    envKey: 'OPENAI_API_KEY',
    supportedLanguages: ['it-IT', 'en-US', 'es-ES'],
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Ultra-realistic voices. Requires API key.',
    requiresApiKey: true,
    envKey: 'ELEVENLABS_API_KEY',
    supportedLanguages: ['it-IT', 'en-US', 'es-ES'],
  },
};

// ============================================================================
// OPENAI TTS VOICES
// ============================================================================

export interface PremiumVoiceOption {
  id: string;
  label: string;
  description: string;
}

/** OpenAI TTS models */
export type OpenAITTSModel = 'tts-1' | 'tts-1-hd';

export const OPENAI_VOICES: PremiumVoiceOption[] = [
  { id: 'alloy', label: 'Alloy', description: 'Neutral, balanced' },
  { id: 'echo', label: 'Echo', description: 'Warm, male' },
  { id: 'fable', label: 'Fable', description: 'Expressive, British' },
  { id: 'onyx', label: 'Onyx', description: 'Deep, authoritative' },
  { id: 'nova', label: 'Nova', description: 'Warm, female' },
  { id: 'shimmer', label: 'Shimmer', description: 'Clear, bright' },
];

/** Default OpenAI voice per role — curated for character */
export const OPENAI_ROLE_DEFAULTS: Record<VoiceRole, string> = {
  coach: 'onyx',      // Deep, authoritative — perfect for coaching
  ritual: 'echo',     // Warm, steady — good for countdown/operational
  system: 'alloy',    // Neutral — ideal for confirmations
  hero: 'fable',      // Expressive — great for dramatic quotes
};

// ============================================================================
// ELEVENLABS VOICES
// ============================================================================

export const ELEVENLABS_VOICES: PremiumVoiceOption[] = [
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', description: 'Soft, young female' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', description: 'Calm, female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel', description: 'Deep, authoritative male' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', description: 'Deep, male narrator' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam', description: 'Raspy, male' },
  { id: 'jBpfuIE2acCO8z3wKNLl', label: 'Gigi', description: 'Animated, young female' },
];

/** Default ElevenLabs voice per role */
export const ELEVENLABS_ROLE_DEFAULTS: Record<VoiceRole, string> = {
  coach: 'onwK4e9ZLuTAKqWW03F9',   // Daniel — authoritative
  ritual: 'pNInz6obpgDQGcFmaJgB',   // Adam — steady narrator
  system: 'EXAVITQu4vr4xnSDxMaL',   // Sarah — neutral
  hero: '21m00Tcm4TlvDq8ikWAM',     // Rachel — calm, dramatic
};

// ============================================================================
// PREVIEW TEXTS (per language, per role)
// ============================================================================

export const PREVIEW_TEXTS: Record<VoiceLanguage, Record<VoiceRole, string>> = {
  'it-IT': {
    coach: 'Smetti di rimandare. Hai un piano, eseguilo adesso.',
    ritual: 'Tre, due, uno. Via. Concentrazione massima.',
    system: 'Blocco completato. Ottimo lavoro.',
    hero: 'La disciplina e il ponte tra i tuoi obiettivi e i tuoi risultati.',
  },
  'en-US': {
    coach: 'Stop delaying. You have a plan, execute it now.',
    ritual: 'Three, two, one. Go. Maximum focus.',
    system: 'Block completed. Well done.',
    hero: 'Discipline is the bridge between your goals and your results.',
  },
  'es-ES': {
    coach: 'Deja de postergar. Tienes un plan, ejecutalo ahora.',
    ritual: 'Tres, dos, uno. Ya. Concentracion maxima.',
    system: 'Bloque completado. Buen trabajo.',
    hero: 'La disciplina es el puente entre tus metas y tus resultados.',
  },
};

// ============================================================================
// COUNTDOWN TEXTS (per language)
// ============================================================================

export const COUNTDOWN_TEXTS: Record<VoiceLanguage, { numbers: string[]; go: string; focus: string }> = {
  'it-IT': {
    numbers: ['Tre', 'Due', 'Uno'],
    go: 'Via!',
    focus: 'Concentrazione.',
  },
  'en-US': {
    numbers: ['Three', 'Two', 'One'],
    go: 'Go!',
    focus: 'Focus.',
  },
  'es-ES': {
    numbers: ['Tres', 'Dos', 'Uno'],
    go: 'Ya!',
    focus: 'Concentracion.',
  },
};

// ============================================================================
// SYSTEM CONFIRMATION TEXTS
// ============================================================================

export const SYSTEM_TEXTS: Record<VoiceLanguage, {
  blockCompleted: string;
  taskCompleted: string;
  habitLogged: string;
  goalProgress: string;
}> = {
  'it-IT': {
    blockCompleted: 'Blocco completato.',
    taskCompleted: 'Task completato.',
    habitLogged: 'Abitudine registrata.',
    goalProgress: 'Progresso aggiornato.',
  },
  'en-US': {
    blockCompleted: 'Block completed.',
    taskCompleted: 'Task completed.',
    habitLogged: 'Habit logged.',
    goalProgress: 'Progress updated.',
  },
  'es-ES': {
    blockCompleted: 'Bloque completado.',
    taskCompleted: 'Tarea completada.',
    habitLogged: 'Habito registrado.',
    goalProgress: 'Progreso actualizado.',
  },
};

// ============================================================================
// USER SETTINGS (persisted shape)
// ============================================================================

export interface VoiceSettings {
  language: VoiceLanguage;
  provider: VoiceProvider;
  speed: number; // 0.5 - 2.0
  /** Browser voice name (from SpeechSynthesis.getVoices()) per role */
  browserVoices: Partial<Record<VoiceRole, string>>;
  /** OpenAI voice ID per role (e.g. 'alloy', 'onyx') */
  openaiVoices: Partial<Record<VoiceRole, string>>;
  /** OpenAI TTS model */
  openaiModel: OpenAITTSModel;
  /** ElevenLabs voice ID per role */
  elevenlabsVoices: Partial<Record<VoiceRole, string>>;
  /** Feature toggles */
  enableMotivation: boolean;
  enableCountdown: boolean;
  enableSystemConfirmations: boolean;
  enableAIResponses: boolean;
  enableHeroQuotes: boolean;
  /** Master voice toggle */
  enabled: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  language: 'it-IT',
  provider: 'browser',
  speed: 1.0,
  browserVoices: {},
  openaiVoices: {},
  openaiModel: 'tts-1',
  elevenlabsVoices: {},
  enableMotivation: true,
  enableCountdown: true,
  enableSystemConfirmations: false,
  enableAIResponses: false,
  enableHeroQuotes: true,
  enabled: true,
};

export const VOICE_SETTINGS_KEY = 'life_tracker_voice_settings';
