'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Sparkles, Calendar, Brain, Loader2, X, Check,
  AlertCircle, ChevronDown, MessageSquare, Wand2,
  Target, Clock, TrendingUp, Lightbulb, Mic, MicOff,
  Wifi, WifiOff
} from 'lucide-react';
import { Goal, Task, TimeBlock, Habit, Session, Project, Domain } from '@/types';
import { UserContext, ProposedChange } from '@/lib/ai/openai-integration';

// ============================================================================
// TYPES
// ============================================================================

interface AIInputBarV2Props {
  userId: string;
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  timeBlocks: TimeBlock[];
  sessions: Session[];
  habits: Habit[];
  habitLogs: { habitId: string; date: Date; completed: boolean }[];
  domains: Domain[];
  onApplyChanges?: (changes: ProposedChange[]) => Promise<void>;
  onCreateTimeBlock?: (block: Partial<TimeBlock>) => Promise<void>;
  onUpdateTimeBlock?: (id: string, updates: Partial<TimeBlock>) => Promise<void>;
  onDeleteTimeBlock?: (id: string) => Promise<void>;
  onUpdateTask?: (id: string, updates: Partial<Task>) => Promise<void>;
  className?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  proposedChanges?: ProposedChange[];
  isStreaming?: boolean;
}

type AIMode = 'ask' | 'plan' | 'analyze' | 'coach';
type AIStatus = 'checking' | 'connected' | 'unavailable' | 'offline';

// ============================================================================
// QUICK PROMPTS
// ============================================================================

const QUICK_PROMPTS: Record<AIMode, { text: string; icon: React.ReactNode }[]> = {
  ask: [
    { text: "Com'e' andata oggi?", icon: <Clock className="w-3 h-3" /> },
    { text: "Quali task sono a rischio?", icon: <AlertCircle className="w-3 h-3" /> },
    { text: "Qual e' il mio prossimo passo?", icon: <Target className="w-3 h-3" /> },
  ],
  plan: [
    { text: "Ottimizza la mia giornata", icon: <Wand2 className="w-3 h-3" /> },
    { text: "Aggiungi 2h di deep work", icon: <Brain className="w-3 h-3" /> },
    { text: "Ripianifica domani", icon: <Calendar className="w-3 h-3" /> },
  ],
  analyze: [
    { text: "Dove sto andando bene?", icon: <TrendingUp className="w-3 h-3" /> },
    { text: "Dove sto perdendo tempo?", icon: <Clock className="w-3 h-3" /> },
    { text: "Analisi settimanale", icon: <Target className="w-3 h-3" /> },
  ],
  coach: [
    { text: "Perche' fallisco questa abitudine?", icon: <AlertCircle className="w-3 h-3" /> },
    { text: "Suggeriscimi un if-then plan", icon: <Lightbulb className="w-3 h-3" /> },
    { text: "Weekly review", icon: <Calendar className="w-3 h-3" /> },
  ],
};

const MODE_CONFIG: Record<AIMode, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  ask: { label: 'Ask', icon: <MessageSquare className="w-4 h-4" />, color: 'text-blue-400', description: 'Domande e informazioni' },
  plan: { label: 'Plan', icon: <Calendar className="w-4 h-4" />, color: 'text-green-400', description: 'Pianifica e modifica' },
  analyze: { label: 'Analyze', icon: <TrendingUp className="w-4 h-4" />, color: 'text-yellow-400', description: 'Analisi produttivita' },
  coach: { label: 'Coach', icon: <Brain className="w-4 h-4" />, color: 'text-purple-400', description: 'Coaching e abitudini' },
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function AIInputBarV2({
  userId, goals, projects, tasks, timeBlocks, sessions, habits, habitLogs, domains,
  onApplyChanges, onCreateTimeBlock, onUpdateTimeBlock, onDeleteTimeBlock, onUpdateTask,
  className = ''
}: AIInputBarV2Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<AIMode>('ask');
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<ProposedChange[]>([]);
  const [aiStatus, setAiStatus] = useState<AIStatus>('checking');

  // Voice state
  const [isListening, setIsListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ============================================================================
  // AI STATUS CHECK
  // ============================================================================

  useEffect(() => {
    const checkAI = async () => {
      try {
        const res = await fetch('/api/ai/chat', { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          setAiStatus(data.status === 'available' ? 'connected' : 'unavailable');
        } else {
          setAiStatus('unavailable');
        }
      } catch {
        setAiStatus('offline');
      }
    };
    checkAI();
    // Recheck every 30 seconds
    const interval = setInterval(checkAI, 30000);
    return () => clearInterval(interval);
  }, []);

  // ============================================================================
  // VOICE RECOGNITION
  // ============================================================================

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setVoiceSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'it-IT';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);
        if (event.results[event.results.length - 1].isFinal) {
          setIsListening(false);
        }
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleVoice = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  // ============================================================================
  // CONTEXT BUILDER
  // ============================================================================

  const buildContext = useCallback((): UserContext => {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const todayStr = today.toISOString().split('T')[0];

    const todaySessions = sessions.filter(s =>
      new Date(s.startTime).toISOString().split('T')[0] === todayStr
    );
    const weekSessions = sessions.filter(s => new Date(s.startTime) >= weekAgo);

    const focusMinutesToday = todaySessions.reduce((sum, s) => {
      const end = s.endTime ? new Date(s.endTime) : new Date();
      return sum + Math.round((end.getTime() - new Date(s.startTime).getTime()) / 60000);
    }, 0);
    const focusMinutesWeek = weekSessions.reduce((sum, s) => {
      const end = s.endTime ? new Date(s.endTime) : new Date();
      return sum + Math.round((end.getTime() - new Date(s.startTime).getTime()) / 60000);
    }, 0);

    const todayTimeBlocks = timeBlocks.filter(tb =>
      new Date(tb.startTime).toISOString().split('T')[0] === todayStr
    );
    const plannedMinutes = todayTimeBlocks.reduce((sum, tb) =>
      sum + Math.round((new Date(tb.endTime).getTime() - new Date(tb.startTime).getTime()) / 60000), 0);
    const planVsActualPercent = plannedMinutes > 0 ? Math.round((focusMinutesToday / plannedMinutes) * 100) : 0;
    const activeStreaks = habits.filter(h => h.isActive && h.streakCount > 0).length;
    const completedTasksToday = tasks.filter(t =>
      t.status === 'completed' && t.updatedAt && new Date(t.updatedAt).toISOString().split('T')[0] === todayStr
    ).length;
    const completedTasksWeek = tasks.filter(t =>
      t.status === 'completed' && t.updatedAt && new Date(t.updatedAt) >= weekAgo
    ).length;
    const overrunCount = todaySessions.filter(s => {
      const tb = timeBlocks.find(b => b.id === s.timeBlockId);
      if (!tb || !s.endTime) return false;
      const planned = (new Date(tb.endTime).getTime() - new Date(tb.startTime).getTime()) / 60000;
      const actual = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
      return actual > planned * 1.1;
    }).length;

    return {
      goals, projects, tasks, timeBlocks, sessions, habits, habitLogs, domains,
      kpis: { focusMinutesToday, focusMinutesWeek, planVsActualPercent, activeStreaks, completedTasksToday, completedTasksWeek, overrunCount },
      preferences: { workHoursStart: '09:00', workHoursEnd: '18:00', timezone: 'Europe/Rome' }
    };
  }, [goals, projects, tasks, timeBlocks, sessions, habits, habitLogs, domains]);

  // ============================================================================
  // SEND MESSAGE
  // ============================================================================

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setShowChat(true);
    setIsLoading(true);
    setIsStreaming(true);

    const context = buildContext();
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    const assistantMessageId = `msg-${Date.now()}-assistant`;
    setMessages(prev => [...prev, {
      id: assistantMessageId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true,
    }]);

    try {
      const modePrefix = mode === 'plan'
        ? '[MODALITA PLAN - Proponi modifiche concrete] '
        : mode === 'analyze'
        ? '[MODALITA ANALYZE - Analizza la mia produttivita] '
        : mode === 'coach'
        ? '[MODALITA COACH - Dammi consigli pratici] '
        : '';

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: modePrefix + text, context, history, userId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `HTTP ${response.status}`;
        throw new Error(errorMsg);
      }

      const data = await response.json();

      setMessages(prev => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: data.response, isStreaming: false, proposedChanges: data.proposedChanges }
          : m
      ));

      if (data.proposedChanges && data.proposedChanges.length > 0) {
        setPendingChanges(data.proposedChanges);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';

      // Show the real error - no fake fallback
      let displayError = errorMessage;
      if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
        displayError = 'AI non raggiungibile. Verifica che Ollama sia avviato: ollama serve';
        setAiStatus('offline');
      } else if (errorMessage.includes('API key')) {
        displayError = 'API key non configurata. Verifica .env.local';
        setAiStatus('unavailable');
      }

      setMessages(prev => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: `Errore: ${displayError}`, isStreaming: false }
          : m
      ));
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  // ============================================================================
  // APPLY / REJECT CHANGES
  // ============================================================================

  const applyChanges = async () => {
    if (pendingChanges.length === 0) return;
    setIsLoading(true);
    try {
      for (const change of pendingChanges) {
        if (change.type === 'timeblock') {
          if (change.action === 'create' && onCreateTimeBlock) {
            await onCreateTimeBlock({
              id: `tb-ai-${Date.now()}`, title: change.after.title,
              startTime: new Date(change.after.startTime), endTime: new Date(change.after.endTime),
              type: change.after.type || 'work', userId, status: 'planned',
              createdAt: new Date(), updatedAt: new Date(),
            });
          } else if (change.action === 'update' && onUpdateTimeBlock && change.after.timeBlockId) {
            await onUpdateTimeBlock(change.after.timeBlockId, {
              startTime: change.after.startTime ? new Date(change.after.startTime) : undefined,
              endTime: change.after.endTime ? new Date(change.after.endTime) : undefined,
              title: change.after.title, updatedAt: new Date(),
            });
          } else if (change.action === 'delete' && onDeleteTimeBlock && change.after.timeBlockId) {
            await onDeleteTimeBlock(change.after.timeBlockId);
          }
        } else if (change.type === 'task' && change.action === 'update' && onUpdateTask && change.after.taskId) {
          await onUpdateTask(change.after.taskId, {
            priority: change.after.priority, status: change.after.status,
            dueDate: change.after.dueDate ? new Date(change.after.dueDate) : undefined,
            estimatedMinutes: change.after.estimatedMinutes, updatedAt: new Date(),
          });
        }
      }

      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-confirm`, role: 'assistant',
        content: `Applicate ${pendingChanges.length} modifiche.`, timestamp: new Date(),
      }]);
      setPendingChanges([]);
      if (onApplyChanges) await onApplyChanges(pendingChanges);
    } catch {
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-error`, role: 'assistant',
        content: 'Errore nell\'applicare le modifiche.', timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const rejectChanges = () => {
    setPendingChanges([]);
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}-reject`, role: 'assistant',
      content: 'Modifiche annullate.', timestamp: new Date(),
    }]);
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowModeDropdown(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  const currentMode = MODE_CONFIG[mode];

  const statusConfig = {
    checking: { color: 'text-gray-500', label: 'Verifica...', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    connected: { color: 'text-green-400', label: 'AI connesso', icon: <Wifi className="w-3 h-3" /> },
    unavailable: { color: 'text-yellow-400', label: 'AI non configurato', icon: <WifiOff className="w-3 h-3" /> },
    offline: { color: 'text-red-400', label: 'AI offline', icon: <WifiOff className="w-3 h-3" /> },
  };
  const status = statusConfig[aiStatus];

  return (
    <div className={`bg-gray-900/95 backdrop-blur-lg border border-gray-700 rounded-2xl shadow-2xl ${className}`}>
      {/* AI Status Indicator */}
      <div className={`flex items-center gap-1.5 px-4 py-1.5 text-xs border-b border-gray-800 ${status.color}`}>
        {status.icon}
        <span>{status.label}</span>
        {aiStatus === 'offline' && (
          <span className="text-gray-600 ml-1">- Avvia Ollama: ollama serve</span>
        )}
      </div>

      {/* Chat Messages */}
      {showChat && messages.length > 0 && (
        <div ref={chatRef} className="max-h-[400px] overflow-y-auto p-4 space-y-4 border-b border-gray-700">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-4 py-3 rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-800 text-gray-100 rounded-bl-md'
              }`}>
                {msg.isStreaming ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-gray-400">Pensando...</span>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                )}

                {msg.proposedChanges && msg.proposedChanges.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <div className="text-xs text-cyan-400 font-bold mb-2">
                      {msg.proposedChanges.length} modifiche proposte
                    </div>
                    <div className="space-y-1">
                      {msg.proposedChanges.map((change, i) => (
                        <div key={i} className="text-xs text-gray-400">
                          - {change.action} {change.type}: {change.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {pendingChanges.length > 0 && (
            <div className="flex justify-center gap-3 pt-2">
              <button onClick={applyChanges} disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white rounded-lg transition-colors">
                <Check className="w-4 h-4" /> Applica ({pendingChanges.length})
              </button>
              <button onClick={rejectChanges} disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white rounded-lg transition-colors">
                <X className="w-4 h-4" /> Annulla
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quick Prompts */}
      {!showChat && (
        <div className="p-3 border-b border-gray-700">
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS[mode].map((prompt, i) => (
              <button key={i} onClick={() => sendMessage(prompt.text)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 rounded-full transition-colors">
                {prompt.icon} {prompt.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          {/* Mode Selector */}
          <div className="relative" ref={dropdownRef}>
            <button type="button" onClick={() => setShowModeDropdown(!showModeDropdown)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-800/50 hover:bg-gray-700/50 transition-colors ${currentMode.color}`}>
              {currentMode.icon}
              <span className="text-sm font-medium">{currentMode.label}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showModeDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showModeDropdown && (
              <div className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
                {(Object.entries(MODE_CONFIG) as [AIMode, typeof MODE_CONFIG[AIMode]][]).map(([key, config]) => (
                  <button key={key} type="button"
                    onClick={() => { setMode(key); setShowModeDropdown(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700/50 transition-colors text-left ${mode === key ? 'bg-gray-700/50' : ''}`}>
                    <span className={config.color}>{config.icon}</span>
                    <div>
                      <div className="text-sm font-medium text-white">{config.label}</div>
                      <div className="text-xs text-gray-400">{config.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Text Input */}
          <div className="flex-1">
            <textarea
              ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Chiedimi qualcosa in modalita ${currentMode.label}...`}
              disabled={isLoading} rows={1}
              className={`w-full px-4 py-2.5 bg-gray-800/50 border rounded-xl text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 disabled:opacity-50 transition-all ${
                isListening ? 'border-red-500 ring-2 ring-red-500/30' : 'border-gray-600'
              }`}
            />
          </div>

          {/* Voice Button */}
          {voiceSupported && (
            <button type="button" onClick={toggleVoice}
              className={`flex items-center justify-center w-11 h-11 rounded-xl transition-colors ${
                isListening
                  ? 'bg-red-600 hover:bg-red-500 animate-pulse'
                  : 'bg-gray-700 hover:bg-gray-600'
              }`}>
              {isListening ? <Mic className="w-5 h-5 text-white" /> : <MicOff className="w-5 h-5 text-gray-400" />}
            </button>
          )}

          {/* Send Button */}
          <button type="submit" disabled={!input.trim() || isLoading}
            className="flex items-center justify-center w-11 h-11 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl transition-colors">
            {isLoading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Send className="w-5 h-5 text-white" />}
          </button>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Sparkles className="w-3 h-3" />
            <span>{goals.length} goals, {tasks.length} tasks, {timeBlocks.length} blocchi</span>
          </div>

          {showChat && messages.length > 0 && (
            <button onClick={() => { setMessages([]); setShowChat(false); setPendingChanges([]); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              Nuova chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
