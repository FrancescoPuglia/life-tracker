'use client';

import { useState, useEffect } from 'react';
import {
  Volume2, VolumeX, Play, Globe, Mic2, Gauge,
  MessageSquare, Timer, Target, Quote, Bot, ChevronDown
} from 'lucide-react';
import {
  useVoice,
  SUPPORTED_LANGUAGES,
  VOICE_ROLES,
  VOICE_PROVIDERS,
  type VoiceRole,
  type VoiceLanguage,
  type VoiceProvider,
} from '@/lib/voice';

export default function VoiceSettings() {
  const {
    settings,
    updateSettings,
    voices,
    isAvailable,
    previewVoice,
    previewRole,
    stopSpeech,
  } = useVoice();

  const [expandedRole, setExpandedRole] = useState<VoiceRole | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  // Stop preview after a timeout
  useEffect(() => {
    if (previewing) {
      const timer = setTimeout(() => setPreviewing(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [previewing]);

  const handlePreviewVoice = (voiceName: string, role: VoiceRole) => {
    stopSpeech();
    setPreviewing(voiceName);
    previewVoice(voiceName, role);
  };

  const handlePreviewRole = (role: VoiceRole) => {
    stopSpeech();
    setPreviewing(role);
    previewRole(role);
  };

  if (!isAvailable) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <VolumeX className="w-6 h-6 text-red-400" />
          <h2 className="text-lg font-bold text-white">Voice System</h2>
        </div>
        <p className="text-sm text-gray-400">
          Il tuo browser non supporta la sintesi vocale. Prova Chrome o Edge per la migliore esperienza.
        </p>
      </div>
    );
  }

  const currentLang = SUPPORTED_LANGUAGES.find(l => l.code === settings.language)!;

  const roleIcons: Record<VoiceRole, React.ReactNode> = {
    coach: <Target className="w-4 h-4" />,
    ritual: <Timer className="w-4 h-4" />,
    system: <MessageSquare className="w-4 h-4" />,
    hero: <Quote className="w-4 h-4" />,
  };

  const roleColors: Record<VoiceRole, string> = {
    coach: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
    ritual: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
    system: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
    hero: 'text-purple-400 border-purple-500/30 bg-purple-500/10',
  };

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-gray-700/50 bg-gradient-to-r from-gray-900 to-gray-800">
        <div className="flex items-center gap-3">
          <Mic2 className="w-6 h-6 text-cyan-400" />
          <div>
            <h2 className="text-lg font-bold text-white">Voice System</h2>
            <p className="text-xs text-gray-500">Configura la voce della tua command center</p>
          </div>
        </div>
        <button
          onClick={() => updateSettings({ enabled: !settings.enabled })}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            settings.enabled
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
              : 'bg-gray-800 text-gray-500 border border-gray-700'
          }`}
        >
          {settings.enabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          {settings.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={`p-5 space-y-6 transition-opacity ${settings.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        {/* Language Selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            <Globe className="w-3.5 h-3.5 inline mr-1.5" />
            Lingua / Language
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SUPPORTED_LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => {
                  updateSettings({ language: lang.code, browserVoices: {} });
                }}
                className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all ${
                  settings.language === lang.code
                    ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300 ring-1 ring-cyan-500/30'
                    : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:border-gray-600'
                }`}
              >
                <span className="text-lg">{lang.flag}</span>
                <span>{lang.label}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-2">
            {voices.length} voci disponibili per {currentLang.label}
          </p>
        </div>

        {/* Speed Control */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            <Gauge className="w-3.5 h-3.5 inline mr-1.5" />
            Velocita: {settings.speed.toFixed(1)}x
          </label>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.1"
            value={settings.speed}
            onChange={(e) => updateSettings({ speed: parseFloat(e.target.value) })}
            className="w-full h-2 bg-gray-800 rounded-full appearance-none cursor-pointer accent-cyan-500"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>Lenta</span>
            <span>Normale</span>
            <span>Veloce</span>
          </div>
        </div>

        {/* Voice Roles */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Ruoli Vocali
          </label>
          <div className="space-y-2">
            {(Object.keys(VOICE_ROLES) as VoiceRole[]).map(role => {
              const config = VOICE_ROLES[role];
              const isExpanded = expandedRole === role;
              const selectedVoiceName = settings.browserVoices[role];

              return (
                <div key={role} className={`rounded-xl border transition-all ${roleColors[role]}`}>
                  {/* Role Header */}
                  <button
                    onClick={() => setExpandedRole(isExpanded ? null : role)}
                    className="w-full flex items-center justify-between p-3 text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      {roleIcons[role]}
                      <div>
                        <span className="text-sm font-semibold">{config.label}</span>
                        <p className="text-[10px] opacity-60">{config.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePreviewRole(role); }}
                        className={`p-1.5 rounded-lg transition-colors hover:bg-white/10 ${previewing === role ? 'text-white animate-pulse' : ''}`}
                        title="Preview"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <ChevronDown className={`w-4 h-4 opacity-40 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Expanded Voice List */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-1.5 max-h-48 overflow-y-auto">
                      {/* Auto option */}
                      <button
                        onClick={() => {
                          const updated = { ...settings.browserVoices };
                          delete updated[role];
                          updateSettings({ browserVoices: updated });
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                          !selectedVoiceName
                            ? 'bg-white/15 text-white font-semibold'
                            : 'bg-white/5 text-gray-400 hover:bg-white/10'
                        }`}
                      >
                        <span>Auto (migliore disponibile)</span>
                        {!selectedVoiceName && <span className="text-[10px] opacity-60">attivo</span>}
                      </button>

                      {voices.map(voice => (
                        <button
                          key={voice.name}
                          onClick={() => {
                            updateSettings({
                              browserVoices: { ...settings.browserVoices, [role]: voice.name },
                            });
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors ${
                            selectedVoiceName === voice.name
                              ? 'bg-white/15 text-white font-semibold'
                              : 'bg-white/5 text-gray-400 hover:bg-white/10'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{voice.name}</span>
                            {voice.localService && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex-shrink-0">locale</span>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreviewVoice(voice.name, role);
                            }}
                            className={`p-1 rounded hover:bg-white/10 flex-shrink-0 ${previewing === voice.name ? 'animate-pulse text-white' : ''}`}
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        </button>
                      ))}

                      {voices.length === 0 && (
                        <p className="text-[10px] text-gray-600 py-2 text-center">
                          Nessuna voce trovata per {currentLang.label}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Feature Toggles */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Momenti Vocali
          </label>
          <div className="space-y-2">
            {[
              { key: 'enableCountdown' as const, label: 'Countdown blocchi', desc: '3-2-1-GO al blocco', icon: <Timer className="w-4 h-4" /> },
              { key: 'enableMotivation' as const, label: 'Motivazione coach', desc: 'Reminders e coaching vocale', icon: <Target className="w-4 h-4" /> },
              { key: 'enableHeroQuotes' as const, label: 'Hero quotes', desc: 'Citazioni dell\'eroe del giorno', icon: <Quote className="w-4 h-4" /> },
              { key: 'enableSystemConfirmations' as const, label: 'Conferme sistema', desc: 'Task completato, blocco chiuso', icon: <MessageSquare className="w-4 h-4" /> },
              { key: 'enableAIResponses' as const, label: 'Risposte AI vocali', desc: 'Leggi ad alta voce le risposte AI', icon: <Bot className="w-4 h-4" /> },
            ].map(({ key, label, desc, icon }) => (
              <button
                key={key}
                onClick={() => updateSettings({ [key]: !settings[key] })}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                  settings[key]
                    ? 'bg-cyan-600/10 border-cyan-500/30 text-cyan-300'
                    : 'bg-gray-800/40 border-gray-700/30 text-gray-500'
                }`}
              >
                <span className={settings[key] ? 'text-cyan-400' : 'text-gray-600'}>{icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium block">{label}</span>
                  <span className="text-[10px] opacity-60 block">{desc}</span>
                </div>
                <div className={`w-10 h-5 rounded-full transition-colors relative ${settings[key] ? 'bg-cyan-600' : 'bg-gray-700'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Provider Info */}
        <div className="bg-gray-800/30 rounded-xl p-4 border border-gray-700/20">
          <div className="flex items-center gap-2 mb-2">
            <Volume2 className="w-4 h-4 text-gray-500" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Provider attivo</span>
          </div>
          <p className="text-sm text-gray-300 font-medium">
            {VOICE_PROVIDERS[settings.provider].label}
          </p>
          <p className="text-[10px] text-gray-500 mt-1">
            {VOICE_PROVIDERS[settings.provider].description}
          </p>
        </div>
      </div>
    </div>
  );
}
