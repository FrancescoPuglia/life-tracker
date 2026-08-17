'use client';

import { useEffect, useRef, useState } from 'react';
import {
  parseLifePlanActionResponse,
  parseLifePlanPreview,
} from '@life-tracker/ai-contract';
import {
  AlertCircle,
  Brain,
  Calendar,
  ChevronDown,
  Clock,
  Lightbulb,
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldCheck,
  Target,
  TrendingUp,
  Wand2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuthContext } from '@/providers/AuthProvider';
import {
  AIClientError,
  applyAIPlan,
  createIdempotencyKey,
  isAIBackendConfigured,
  requestAIChat,
  rollbackAIExecution,
  type AIChatMode,
  type AIPlanActionResult,
  type AIPlanPreview,
} from '@/lib/ai/client';
import { getVoiceService } from '@/lib/voice/voiceService';

interface AIInputBarV2Props {
  className?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  plan?: AIPlanPreview;
  execution?: AIPlanActionResult;
  isStreaming?: boolean;
  actionStatus?: 'applying' | 'rolling_back';
  actionNotice?: string;
  actionRecoveryPending?: boolean;
  planRejected?: boolean;
  planStale?: boolean;
}

const ACTION_SESSION_VERSION = 1;
const ACTION_SESSION_PREFIX = 'life-tracker:secure-ai-actions:';
const MAX_PERSISTED_ACTIONS = 8;

type AIStatus =
  | 'checking'
  | 'ready'
  | 'not_configured'
  | 'signed_out'
  | 'offline'
  | 'forbidden'
  | 'rate_limited';

const QUICK_PROMPTS: Record<AIChatMode, { text: string; icon: React.ReactNode }[]> = {
  ask: [
    { text: "Com'e' andata oggi?", icon: <Clock className="w-3 h-3" /> },
    { text: 'Quali task sono a rischio?', icon: <AlertCircle className="w-3 h-3" /> },
    { text: "Qual e' il mio prossimo passo?", icon: <Target className="w-3 h-3" /> },
  ],
  plan: [
    { text: 'Ottimizza la mia giornata', icon: <Wand2 className="w-3 h-3" /> },
    { text: 'Aggiungi 2h di deep work', icon: <Brain className="w-3 h-3" /> },
    { text: 'Ripianifica domani', icon: <Calendar className="w-3 h-3" /> },
  ],
  analyze: [
    { text: 'Dove sto andando bene?', icon: <TrendingUp className="w-3 h-3" /> },
    { text: 'Dove sto perdendo tempo?', icon: <Clock className="w-3 h-3" /> },
    { text: 'Analisi settimanale', icon: <Target className="w-3 h-3" /> },
  ],
  coach: [
    { text: "Perche' fallisco questa abitudine?", icon: <AlertCircle className="w-3 h-3" /> },
    { text: 'Suggeriscimi un if-then plan', icon: <Lightbulb className="w-3 h-3" /> },
    { text: 'Weekly review', icon: <Calendar className="w-3 h-3" /> },
  ],
};

const MODE_CONFIG: Record<AIChatMode, {
  label: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}> = {
  ask: {
    label: 'Ask',
    icon: <MessageSquare className="w-4 h-4" />,
    color: 'text-blue-400',
    description: 'Domande e informazioni',
  },
  plan: {
    label: 'Plan',
    icon: <Calendar className="w-4 h-4" />,
    color: 'text-green-400',
    description: 'Pianifica con anteprima',
  },
  analyze: {
    label: 'Analyze',
    icon: <TrendingUp className="w-4 h-4" />,
    color: 'text-yellow-400',
    description: 'Analisi produttivita',
  },
  coach: {
    label: 'Coach',
    icon: <Brain className="w-4 h-4" />,
    color: 'text-purple-400',
    description: 'Coaching e abitudini',
  },
};

const STATUS_CONFIG: Record<AIStatus, {
  color: string;
  label: string;
  icon: React.ReactNode;
}> = {
  checking: {
    color: 'text-gray-500',
    label: 'Verifica autenticazione...',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  ready: {
    color: 'text-green-400',
    label: 'Backend AI autenticato',
    icon: <Wifi className="w-3 h-3" />,
  },
  not_configured: {
    color: 'text-amber-400',
    label: 'Backend AI non configurato',
    icon: <WifiOff className="w-3 h-3" />,
  },
  signed_out: {
    color: 'text-amber-400',
    label: 'Accedi per usare l’AI cloud',
    icon: <ShieldCheck className="w-3 h-3" />,
  },
  offline: {
    color: 'text-red-400',
    label: 'Backend AI non raggiungibile',
    icon: <WifiOff className="w-3 h-3" />,
  },
  forbidden: {
    color: 'text-red-400',
    label: 'Operazione non autorizzata',
    icon: <AlertCircle className="w-3 h-3" />,
  },
  rate_limited: {
    color: 'text-amber-400',
    label: 'Limite richieste raggiunto',
    icon: <Clock className="w-3 h-3" />,
  },
};

export default function AIInputBarV2({ className = '' }: AIInputBarV2Props) {
  const { user, status: authStatus } = useAuthContext();
  const configured = isAIBackendConfigured();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<AIChatMode>('ask');
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [requestStatus, setRequestStatus] = useState<AIStatus | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const planActionKeysRef = useRef(new Map<string, string>());
  const [actionKeysVersion, setActionKeysVersion] = useState(0);
  const [hydratedUid, setHydratedUid] = useState<string | null>(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  const status: AIStatus = authStatus === 'unknown'
    ? 'checking'
    : !configured
      ? 'not_configured'
      : !user
        ? 'signed_out'
        : requestStatus ?? 'ready';
  const canSend = status === 'ready';

  useEffect(() => {
    if (authStatus === 'unknown') return;
    const uid = user?.uid ?? null;
    if (!uid) {
      planActionKeysRef.current.clear();
      setMessages([]);
      setShowChat(false);
      setHydratedUid(null);
      setActionKeysVersion((version) => version + 1);
      return;
    }
    const restored = restoreActionSession(uid);
    planActionKeysRef.current = restored.actionKeys;
    setMessages(restored.messages);
    setShowChat(restored.messages.length > 0);
    setHydratedUid(uid);
    setActionKeysVersion((version) => version + 1);
  }, [authStatus, user?.uid]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || hydratedUid !== uid) return;
    persistActionSession(uid, messages, planActionKeysRef.current, clockNowMs);
  }, [actionKeysVersion, clockNowMs, hydratedUid, messages, user?.uid]);

  useEffect(() => {
    const nextExpiry = nextActionExpiry(messages, clockNowMs);
    if (nextExpiry === null) return;
    const delay = Math.max(1, Math.min(nextExpiry - Date.now() + 1, 60_000));
    const timer = window.setTimeout(() => setClockNowMs(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [clockNowMs, messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition
      || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    setVoiceSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = getVoiceService()?.getLanguage() || 'it-IT';
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setInput(transcript);
      if (event.results[event.results.length - 1].isFinal) setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;

    return () => {
      recognition.abort?.();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowModeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
  }, [input]);

  const sendMessage = async (text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText || isLoading || !canSend) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: normalizedText,
    };
    const assistantMessageId = `assistant-${Date.now()}`;
    const history = messages
      .filter((message) => !message.isStreaming)
      .map(({ role, content }) => ({ role, content }));

    setMessages((previous) => [
      ...previous,
      userMessage,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        isStreaming: true,
      },
    ]);
    setInput('');
    setShowChat(true);
    setIsLoading(true);

    try {
      const result = await requestAIChat({
        message: normalizedText,
        mode,
        history,
      });
      setMessages((previous) => previous.map((message) => (
        message.id === assistantMessageId
          ? {
            ...message,
            content: result.message,
            plan: result.plan,
            isStreaming: false,
          }
          : message
      )));
      setRequestStatus(null);

      // Keep the static client self-contained: cloud TTS routes were removed,
      // so AI replies are spoken only by the local browser provider.
      const voiceService = getVoiceService();
      if (voiceService?.getSettings().provider === 'browser') {
        voiceService.speakAIResponse(result.message);
      }
    } catch (error) {
      const safeMessage = getSafeClientMessage(error);
      setRequestStatus(getRequestStatus(error));
      setMessages((previous) => previous.map((message) => (
        message.id === assistantMessageId
          ? { ...message, content: safeMessage, isStreaming: false }
          : message
      )));
    } finally {
      setIsLoading(false);
    }
  };

  const runPlanAction = async (
    messageId: string,
    plan: AIPlanPreview,
    action: 'apply' | 'rollback',
    execution?: AIPlanActionResult,
  ) => {
    const actionId = action === 'apply' ? plan.id : execution?.executionId;
    if (!actionId || (action === 'rollback' && !execution?.rollback)) return;
    const mapKey = `${action}:${actionId}`;
    let idempotencyKey = planActionKeysRef.current.get(mapKey);
    if (!idempotencyKey) {
      idempotencyKey = createIdempotencyKey();
      planActionKeysRef.current.set(mapKey, idempotencyKey);
      setActionKeysVersion((version) => version + 1);
    }

    setMessages((previous) => previous.map((message) => (
      message.id === messageId
        ? {
          ...message,
          actionStatus: action === 'apply' ? 'applying' : 'rolling_back',
          actionNotice: undefined,
          actionRecoveryPending: false,
        }
        : message
    )));

    try {
      const result = action === 'apply'
        ? await applyAIPlan(plan, idempotencyKey)
        : await rollbackAIExecution(
          execution!.executionId,
          execution!.rollback!.capability,
          idempotencyKey,
          { planId: plan.id, hash: plan.hash },
        );
      const nextPlan: AIPlanPreview = {
        ...plan,
        status: action === 'apply' ? 'applied' : 'rolled_back',
      };
      setMessages((previous) => previous.map((message) => (
        message.id === messageId
          ? {
            ...message,
            plan: nextPlan,
            execution: result,
            actionStatus: undefined,
            actionNotice: result.message,
            actionRecoveryPending: false,
          }
          : message
      )));
      planActionKeysRef.current.delete(mapKey);
      setActionKeysVersion((version) => version + 1);
      setRequestStatus(null);
    } catch (error) {
      setRequestStatus(getRequestStatus(error));
      const errorCode = error instanceof AIClientError ? error.code : null;
      const planStale = errorCode !== null && [
        'state_changed',
        'approval_expired',
        'approval_replayed',
        'conflict',
      ].includes(errorCode);
      const recoveryPending = errorCode === null || [
        'committed_unverified',
        // This code is raised only after a successful 2xx action response
        // cannot be parsed or bound. The mutation outcome is therefore
        // uncertain and must be reconciled with the exact same key.
        'invalid_response',
        'unavailable',
        'session_expired',
      ].includes(errorCode);
      if (!recoveryPending) {
        planActionKeysRef.current.delete(mapKey);
        setActionKeysVersion((version) => version + 1);
      }
      setMessages((previous) => previous.map((message) => (
        message.id === messageId
          ? {
            ...message,
            actionStatus: undefined,
            actionNotice: getSafeClientMessage(error),
            actionRecoveryPending: recoveryPending,
            planStale: message.planStale || planStale,
          }
          : message
      )));
    }
  };

  const rejectPlan = (messageId: string) => {
    const target = messages.find((message) => message.id === messageId);
    // An uncertain request may already have committed. Its exact key must be
    // retained until reconciliation; it is no longer safe to call this a
    // rejection or claim that no data changed.
    if (target?.actionStatus || target?.actionRecoveryPending) return;
    const plan = target?.plan;
    if (plan) {
      planActionKeysRef.current.delete(`apply:${plan.id}`);
      setActionKeysVersion((version) => version + 1);
    }
    setMessages((previous) => previous.map((message) => (
      message.id === messageId
        ? {
          ...message,
          planRejected: true,
          actionNotice: 'Piano rifiutato. Nessuna modifica è stata applicata.',
        }
        : message
    )));
    inputRef.current?.focus();
  };

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const currentMode = MODE_CONFIG[mode];
  const statusConfig = STATUS_CONFIG[status];
  const hasProtectedActionState = messages.some((message) => (
    messageNeedsProtectedStorage(message, clockNowMs)
  ));

  return (
    <div className={`bg-gray-900/95 backdrop-blur-lg border border-gray-700 rounded-2xl shadow-2xl ${className}`}>
      <div
        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs border-b border-gray-800 ${statusConfig.color}`}
        role="status"
      >
        {statusConfig.icon}
        <span>{statusConfig.label}</span>
        {(status === 'offline' || status === 'rate_limited') && (
          <button
            type="button"
            aria-label="Riprova connessione AI"
            onClick={() => {
              setRequestStatus(null);
              inputRef.current?.focus();
            }}
            className="ml-auto rounded border border-current/40 px-2 py-0.5 font-medium hover:bg-white/10"
          >
            Riprova
          </button>
        )}
      </div>

      {showChat && messages.length > 0 && (
        <div ref={chatRef} className="max-h-[400px] overflow-y-auto p-4 space-y-4 border-b border-gray-700">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-800 text-gray-100 rounded-bl-md'
              }`}>
                {message.isStreaming ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-gray-400">Elaborazione sicura...</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                )}

                {message.plan && (
                  <PlanPreviewCard
                    messageId={message.id}
                    plan={message.plan}
                    execution={message.execution}
                    actionStatus={message.actionStatus}
                    actionNotice={message.actionNotice}
                    actionRecoveryPending={message.actionRecoveryPending}
                    rejected={message.planRejected}
                    stale={message.planStale}
                    nowMs={clockNowMs}
                    onAction={runPlanAction}
                    onReject={rejectPlan}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!showChat && (
        <div className="p-3 border-b border-gray-700">
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS[mode].map((prompt) => (
              <button
                key={prompt.text}
                type="button"
                onClick={() => sendMessage(prompt.text)}
                disabled={!canSend || isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {prompt.icon} {prompt.text}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-4">
        {(status === 'not_configured' || status === 'signed_out') && (
          <p className="mb-3 rounded-lg border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            {status === 'not_configured'
              ? 'Configura NEXT_PUBLIC_AI_API_BASE_URL durante la build per collegare il backend autenticato.'
              : 'La modalità guest non invia dati al cloud. Accedi per usare l’assistente AI.'}
          </p>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage(input);
          }}
          className="flex items-end gap-3"
        >
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              disabled={!canSend || isLoading}
              aria-label="Seleziona modalità AI"
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800/50 hover:bg-gray-700/50 transition-colors disabled:opacity-40 ${currentMode.color}`}
            >
              {currentMode.icon}
              <span className="text-sm font-medium">{currentMode.label}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showModeDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showModeDropdown && (
              <div className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
                {(Object.entries(MODE_CONFIG) as [AIChatMode, typeof MODE_CONFIG[AIChatMode]][]).map(([key, config]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setMode(key);
                      setShowModeDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700/50 transition-colors text-left ${mode === key ? 'bg-gray-700/50' : ''}`}
                  >
                    <span className={config.color}>{config.icon}</span>
                    <span>
                      <span className="block text-sm font-medium text-white">{config.label}</span>
                      <span className="block text-xs text-gray-400">{config.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage(input);
                }
              }}
              aria-label="Messaggio per l’assistente AI"
              placeholder={canSend
                ? `Chiedimi qualcosa in modalita ${currentMode.label}...`
                : 'AI cloud non disponibile'}
              disabled={!canSend || isLoading}
              maxLength={4_000}
              rows={1}
              className={`w-full px-4 py-2.5 bg-gray-800/50 border rounded-xl text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 disabled:opacity-50 transition-all ${
                isListening ? 'border-red-500 ring-2 ring-red-500/30' : 'border-gray-600'
              }`}
            />
          </div>

          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={!canSend || isLoading}
              aria-label={isListening ? 'Interrompi dettatura' : 'Avvia dettatura'}
              className={`flex items-center justify-center w-11 h-11 rounded-xl transition-colors disabled:opacity-40 ${
                isListening
                  ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {isListening
                ? <Mic className="w-5 h-5 text-white" />
                : <MicOff className="w-5 h-5 text-gray-400" />}
            </button>
          )}

          <button
            type="submit"
            disabled={!canSend || !input.trim() || isLoading}
            aria-label="Invia messaggio AI"
            className="flex items-center justify-center w-11 h-11 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl transition-colors"
          >
            {isLoading
              ? <Loader2 className="w-5 h-5 text-white animate-spin" />
              : <Send className="w-5 h-5 text-white" />}
          </button>
        </form>

        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <ShieldCheck className="w-3 h-3" />
            <span>Identità verificata dal backend; anteprima prima delle modifiche</span>
          </div>
          {showChat && messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setShowChat(false);
                setRequestStatus(null);
                planActionKeysRef.current.clear();
                setActionKeysVersion((version) => version + 1);
              }}
              disabled={hasProtectedActionState}
              title={hasProtectedActionState
                ? 'Completa, riconcilia o rifiuta il piano prima di cancellare questa sessione.'
                : undefined}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Nuova chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanPreviewCard({
  messageId,
  plan,
  execution,
  actionStatus,
  actionNotice,
  actionRecoveryPending,
  rejected,
  stale,
  nowMs,
  onAction,
  onReject,
}: {
  messageId: string;
  plan: AIPlanPreview;
  execution?: AIPlanActionResult;
  actionStatus?: Message['actionStatus'];
  actionNotice?: string;
  actionRecoveryPending?: boolean;
  rejected?: boolean;
  stale?: boolean;
  nowMs: number;
  onAction: (
    messageId: string,
    plan: AIPlanPreview,
    action: 'apply' | 'rollback',
    execution?: AIPlanActionResult,
  ) => Promise<void>;
  onReject: (messageId: string) => void;
}) {
  const expired = Date.parse(plan.expiresAt) <= nowMs;
  const applied = plan.status === 'applied';
  const rolledBack = plan.status === 'rolled_back';
  const hasConflicts = plan.conflicts.length > 0;
  const busy = Boolean(actionStatus);
  const rollbackAvailable = applied
    && execution?.receipt.rollbackAvailable === true
    && Boolean(execution.rollback);
  const rollbackUnexpired = rollbackAvailable
    && Date.parse(execution!.rollback!.expiresAt) > nowMs;

  return (
    <div
      data-testid={`ai-plan-${plan.id}`}
      className="mt-3 rounded-xl border border-cyan-700/60 bg-cyan-950/30 p-3 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-cyan-200">Anteprima piano immutabile</span>
        <span className="rounded bg-gray-900/60 px-2 py-0.5 text-gray-300">{plan.status}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-gray-300">
        <dt>Operazioni</dt><dd className="text-right">{plan.operations.length}</dd>
        <dt>Versione</dt><dd className="text-right font-mono">{plan.hash.slice(0, 12)}</dd>
        <dt>Scadenza</dt>
        <dd className="text-right">{new Date(plan.expiresAt).toLocaleString('it-IT')}</dd>
      </dl>
      <div className="mt-2 rounded border border-gray-700/60 bg-gray-900/30 px-2.5 py-2 text-gray-300">
        <span className="font-semibold text-gray-200">Motivo: </span>
        <span>{plan.reason}</span>
      </div>

      <div className="mt-3">
        <p className="font-semibold text-gray-200">Diff da approvare</p>
        <div className="mt-1 space-y-2">
          {(['create', 'update', 'move', 'delete'] as const).map((action) => {
            const entries = plan.diff.filter((entry) => entry.action === action);
            if (!entries.length) return null;
            return (
              <section key={action} aria-label={`Modifiche ${diffActionLabel(action)}`}>
                <h4 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-cyan-300">
                  {diffActionLabel(action)} ({entries.length})
                </h4>
                <ol className="space-y-1.5">
                  {entries.map((entry, index) => {
                    const detailFields = previewDetailFields(entry);
                    return (
                      <li
                        key={`${entry.entityType}:${entry.entityId ?? index}:${entry.action}`}
                        className="rounded-lg border border-gray-700/70 bg-gray-900/40 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-cyan-900/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-cyan-200">
                            {entry.action}
                          </span>
                          <span className="font-medium text-gray-200">{entry.entityType}</span>
                          {entry.entityId && (
                            <span className="font-mono text-[10px] text-gray-500">
                              {entry.entityId}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-gray-300">{entry.summary}</p>
                        {detailFields.length > 0 && (
                          <dl className="mt-2 space-y-1 border-t border-gray-700/60 pt-1.5 text-[10px]">
                            {detailFields.map((field) => (
                              <div key={field} className="grid grid-cols-[minmax(4rem,0.5fr)_1fr] gap-x-2">
                                <dt className="font-medium text-gray-400">{field}</dt>
                                <dd className="min-w-0 break-words text-gray-300">
                                  <span aria-label={`Valore precedente ${field}`}>
                                    {formatPreviewValue(entry.before?.[field])}
                                  </span>
                                  <span aria-hidden="true" className="mx-1 text-gray-500">→</span>
                                  <span aria-label={`Valore proposto ${field}`}>
                                    {formatPreviewValue(entry.after?.[field])}
                                  </span>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      </div>

      {plan.warnings.length > 0 && (
        <div className="mt-2 text-amber-200">
          <p className="font-semibold">Avvisi</p>
          <ul className="mt-1 list-disc pl-4">
            {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
      {hasConflicts && (
        <div className="mt-2 text-red-200">
          <p className="font-semibold">Conflitti</p>
          <ul className="mt-1 list-disc pl-4">
            {plan.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
          </ul>
        </div>
      )}
      {plan.assumptions.length > 0 && (
        <div className="mt-2 text-blue-100">
          <p className="font-semibold">Assunzioni</p>
          <ul className="mt-1 list-disc pl-4">
            {plan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
          </ul>
        </div>
      )}
      {plan.expectedImpact.length > 0 && (
        <div className="mt-2 text-green-100">
          <p className="font-semibold">Impatto atteso</p>
          <ul className="mt-1 list-disc pl-4">
            {plan.expectedImpact.map((impact) => <li key={impact}>{impact}</li>)}
          </ul>
        </div>
      )}
      {expired && !applied && !rolledBack && (
        <p className="mt-2 text-amber-200">Anteprima scaduta: richiedi un nuovo piano.</p>
      )}
      {stale && (
        <p className="mt-2 text-amber-200" role="alert">
          Lo stato è cambiato: questa anteprima non può più essere applicata. Richiedine una nuova.
        </p>
      )}
      {rejected && (
        <p className="mt-2 text-gray-300">Piano rifiutato senza modificare i dati.</p>
      )}
      {execution && (
        <dl className="mt-2 rounded bg-gray-900/50 px-2 py-1.5 text-gray-300">
          <dt className="inline font-semibold">Ricevuta: </dt>
          <dd className="inline font-mono">{execution.executionId}</dd>
          <dt className="ml-2 inline font-semibold">Verifica: </dt>
          <dd className="inline">{execution.verified ? 'completata' : 'in sospeso'}</dd>
        </dl>
      )}
      {actionNotice && (
        <p className="mt-2 rounded bg-gray-900/50 px-2 py-1.5 text-gray-200" role="status">
          {actionNotice}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {!applied && !rolledBack && !rejected && (
          <button
            type="button"
            onClick={() => onAction(messageId, plan, 'apply')}
            disabled={busy || (expired && !actionRecoveryPending) || hasConflicts || stale}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-gray-700"
          >
            {actionStatus === 'applying'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ShieldCheck className="w-3.5 h-3.5" />}
            {actionRecoveryPending ? 'Riconcilia applicazione' : 'Applica piano'}
          </button>
        )}
        {!applied && !rolledBack && !rejected && !actionRecoveryPending && (
          <button
            type="button"
            onClick={() => onReject(messageId)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-600 px-3 py-1.5 font-medium text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rifiuta
          </button>
        )}
        {(rollbackUnexpired || (applied && actionRecoveryPending && Boolean(execution?.rollback))) && (
          <button
            type="button"
            onClick={() => onAction(messageId, plan, 'rollback', execution)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:bg-gray-700"
          >
            {actionStatus === 'rolling_back'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RotateCcw className="w-3.5 h-3.5" />}
            {actionRecoveryPending ? 'Riconcilia rollback' : 'Annulla modifiche'}
          </button>
        )}
        {applied && !rollbackUnexpired && !actionRecoveryPending && (
          <span className="text-gray-400">Rollback non disponibile</span>
        )}
        {rolledBack && (
          <span className="inline-flex items-center gap-1.5 text-gray-300">
            <RotateCcw className="w-3.5 h-3.5" /> Rollback completato
          </span>
        )}
      </div>
    </div>
  );
}

function diffActionLabel(action: AIPlanPreview['diff'][number]['action']): string {
  const labels = {
    create: 'Creazioni',
    update: 'Aggiornamenti',
    move: 'Spostamenti',
    delete: 'Eliminazioni',
  } as const;
  return labels[action];
}

function previewDetailFields(entry: AIPlanPreview['diff'][number]): readonly string[] {
  const fields = new Set([
    ...entry.changedFields,
    ...Object.keys(entry.before ?? {}),
    ...Object.keys(entry.after ?? {}),
  ]);
  return [...fields]
    .filter((field) => !['id', 'createdAt', 'updatedAt'].includes(field))
    .sort();
}

function formatPreviewValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'string') {
    const normalized = value;
    if (/^\d{4}-\d{2}-\d{2}T/.test(normalized) && Number.isFinite(Date.parse(normalized))) {
      return `${new Date(normalized).toLocaleString('it-IT')} (${normalized})`;
    }
    return normalized;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[valore non visualizzabile]';
  }
}

function getSafeClientMessage(error: unknown): string {
  return error instanceof AIClientError
    ? error.message
    : 'Il servizio AI non è raggiungibile in questo momento. Riprova più tardi.';
}

function getRequestStatus(error: unknown): AIStatus | null {
  if (!(error instanceof AIClientError)) return 'offline';
  if (error.code === 'rate_limited') return 'rate_limited';
  if (error.code === 'forbidden') return 'forbidden';
  if (error.code === 'not_configured') return 'not_configured';
  if (error.code === 'auth_required' || error.code === 'session_expired') return 'signed_out';
  if (error.code === 'unavailable') return 'offline';
  // A rejected domain action (for example STATE_CHANGED) does not make the
  // authenticated backend unavailable. Keep the global status ready while
  // the plan card renders the action-specific recovery message.
  return null;
}

function actionStorageKey(uid: string): string {
  return `${ACTION_SESSION_PREFIX}${uid}`;
}

function persistActionSession(
  uid: string,
  messages: readonly Message[],
  actionKeys: ReadonlyMap<string, string>,
  nowMs: number,
): void {
  if (typeof window === 'undefined') return;
  const entries = messages
    .filter((message) => messageNeedsProtectedStorage(message, nowMs))
    .slice(-MAX_PERSISTED_ACTIONS)
    .map((message) => ({
      plan: message.plan,
      execution: message.execution,
      recoveryPending: Boolean(message.actionStatus || message.actionRecoveryPending),
    }));
  if (!entries.length) {
    window.sessionStorage.removeItem(actionStorageKey(uid));
    return;
  }
  // Capabilities remain only in this tab's session storage and are scoped by
  // authenticated UID. They expire server-side and never enter logs or URLs.
  window.sessionStorage.setItem(actionStorageKey(uid), JSON.stringify({
    version: ACTION_SESSION_VERSION,
    entries,
    actionKeys: [...actionKeys.entries()],
  }));
}

function restoreActionSession(uid: string): {
  messages: Message[];
  actionKeys: Map<string, string>;
} {
  if (typeof window === 'undefined') return { messages: [], actionKeys: new Map() };
  const key = actionStorageKey(uid);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return { messages: [], actionKeys: new Map() };
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    const record = value as Record<string, unknown>;
    if (record.version !== ACTION_SESSION_VERSION || !Array.isArray(record.entries)) throw new Error('invalid');
    const nowMs = Date.now();
    const messages = record.entries.slice(-MAX_PERSISTED_ACTIONS).map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid');
      const stored = entry as Record<string, unknown>;
      const plan = parseLifePlanPreview(stored.plan);
      const execution = stored.execution === undefined
        ? undefined
        : parseLifePlanActionResponse(stored.execution);
      if (execution && (execution.planId !== plan.id || execution.hash !== plan.hash)) throw new Error('invalid');
      const recoveryPending = stored.recoveryPending === true;
      return {
        id: `recovered-${plan.id}-${index}`,
        role: 'assistant' as const,
        content: 'Sessione di modifica sicura ripristinata.',
        plan,
        ...(execution ? { execution } : {}),
        ...(recoveryPending
          ? {
              actionRecoveryPending: true,
              actionNotice: 'L’esito della richiesta precedente non è certo. Riconcilia usando la stessa chiave idempotente.',
            }
          : {}),
      };
    }).filter((message) => messageNeedsProtectedStorage(message, nowMs));
    const allowedActionIds = new Set(messages.flatMap((message) => [
      `apply:${message.plan!.id}`,
      ...(message.execution ? [`rollback:${message.execution.executionId}`] : []),
    ]));
    const actionKeys = new Map<string, string>();
    if (Array.isArray(record.actionKeys)) {
      for (const item of record.actionKeys) {
        if (!Array.isArray(item) || item.length !== 2) continue;
        const [actionId, idempotencyKey] = item;
        if (
          typeof actionId === 'string'
          && allowedActionIds.has(actionId)
          && typeof idempotencyKey === 'string'
          && idempotencyKey.length >= 8
          && idempotencyKey.length <= 200
        ) {
          actionKeys.set(actionId, idempotencyKey);
        }
      }
    }
    return { messages, actionKeys };
  } catch {
    window.sessionStorage.removeItem(key);
    return { messages: [], actionKeys: new Map() };
  }
}

function messageNeedsProtectedStorage(message: Message, nowMs: number): boolean {
  const plan = message.plan;
  if (!plan) return false;
  if (message.actionStatus || message.actionRecoveryPending) return true;
  if (message.planRejected || message.planStale) return false;
  if (plan.status === 'previewed') return Date.parse(plan.expiresAt) > nowMs;
  if (plan.status !== 'applied') return false;
  const rollback = message.execution?.rollback;
  return message.execution?.receipt.rollbackAvailable === true
    && Boolean(rollback)
    && Date.parse(rollback!.expiresAt) > nowMs;
}

function nextActionExpiry(messages: readonly Message[], nowMs: number): number | null {
  const expirations = messages.flatMap((message) => {
    if (!message.plan) return [];
    const values = [Date.parse(message.plan.expiresAt)];
    if (message.execution?.rollback) values.push(Date.parse(message.execution.rollback.expiresAt));
    return values.filter((value) => Number.isFinite(value) && value > nowMs);
  });
  return expirations.length ? Math.min(...expirations) : null;
}
