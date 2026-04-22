// src/lib/voice/index.ts
// Public API for the voice system

export { voiceService, getVoiceService } from './voiceService';
export { useVoice } from './useVoice';
export {
  type VoiceLanguage,
  type VoiceRole,
  type VoiceProvider,
  type VoiceSettings,
  SUPPORTED_LANGUAGES,
  VOICE_ROLES,
  VOICE_PROVIDERS,
  PREVIEW_TEXTS,
  COUNTDOWN_TEXTS,
  SYSTEM_TEXTS,
  DEFAULT_VOICE_SETTINGS,
} from './voiceConfig';
