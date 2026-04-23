// src/lib/voice/index.ts
// Public API for the voice system

export { voiceService, getVoiceService, type ProvidersStatus } from './voiceService';
export { useVoice } from './useVoice';
export {
  type VoiceLanguage,
  type VoiceRole,
  type VoiceProvider,
  type VoiceSettings,
  type ProviderStatusType,
  type PremiumVoiceOption,
  type OpenAITTSModel,
  SUPPORTED_LANGUAGES,
  VOICE_ROLES,
  VOICE_PROVIDERS,
  PREVIEW_TEXTS,
  COUNTDOWN_TEXTS,
  SYSTEM_TEXTS,
  DEFAULT_VOICE_SETTINGS,
  OPENAI_VOICES,
  ELEVENLABS_VOICES,
  OPENAI_ROLE_DEFAULTS,
  ELEVENLABS_ROLE_DEFAULTS,
} from './voiceConfig';
