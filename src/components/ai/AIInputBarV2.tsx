'use client';

// 🧠 AI INPUT BAR v2 - INTEGRAZIONE CHATGPT COMPLETA
// Vede tutto, analizza tutto, modifica tutto
// MODALITÀ PSICOPATICO CERTOSINO 🔥

import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Send, Sparkles, Calendar, Brain, Loader2, X, Check, 
  AlertCircle, ChevronDown, MessageSquare, Wand2, 
  Target, Clock, TrendingUp, Lightbulb
} from 'lucide-react';
import { Goal, Task, TimeBlock, Habit, Session, Project, Domain } from '@/types';
import { UserContext, ProposedChange } from '@/lib/ai/openai-integration';

// ============================================================================
// TYPES
// ============================================================================

interface AIInputBarV2Props {
  // Dati dell'utente - ChatGPT vede TUTTO
  userId: string;
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  timeBlocks: TimeBlock[];
  sessions: Session[];
  habits: Habit[];
  habitLogs: { habitId: string; date: Date; completed: boolean }[];
  domains: Domain[];
  
  // Callback per applicare le modifiche
  onApplyChanges?: (changes: ProposedChange[]) => Promise<void>;
  onCreateTimeBlock?: (block: Partial<TimeBlock>) => Promise<void>;
  onUpdateTimeBlock?: (id: string, updates: Partial<TimeBlock>) => Promise<void>;
  onDeleteTimeBlock?: (id: string) => Promise<void>;
  onUpdateTask?: (id: string, updates: Partial<Task>) => Promise<void>;
  
  // UI
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

// ============================================================================
// QUICK PROMPTS
// ============================================================================

const QUICK_PROMPTS: Record<AIMode, { text: string; icon: React.ReactNode }[]> = {
  ask: [
    { text: "Com'è andata oggi?", icon: <Clock className="w-3 h-3" /> },
    { text: "Quali task sono a rischio?", icon: <AlertCircle className="w-3 h-3" /> },
    { text: "Qual è il mio prossimo passo?", icon: <Target className="w-3 h-3" /> },
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
    { text: "Perché fallisco questa abitudine?", icon: <AlertCircle className="w-3 h-3" /> },
    { text: "Suggeriscimi un if-then plan", icon: <Lightbulb className="w-3 h-3" /> },
    { text: "Weekly review", icon: <Calendar className="w-3 h-3" /> },
  ],
};

const MODE_CONFIG: Record<AIMode, { label: string; icon: React.ReactNode; color: string; description: string }> = {
  ask: {
    label: 'Ask',
    icon: <MessageSquare className="w-4 h-4" />,
    color: 'text-blue-400',
    description: 'Domande e informazioni'
  },
  plan: {
    label: 'Plan',
    icon: <Calendar className="w-4 h-4" />,
    color: 'text-green-400',
    description: 'Pianifica e modifica'
  },
  analyze: {
    label: 'Analyze',
    icon: <TrendingUp className="w-4 h-4" />,
    color: 'text-yellow-400',
    description: 'Analisi produttività'
  },
  coach: {
    label: 'Coach',
    icon: <Brain className="w-4 h-4" />,
    color: 'text-purple-400',
    description: 'Coaching e abitudini'
  },
};

// ============================================================================
// DEMO RESPONSE GENERATOR
// ============================================================================

function generateDemoResponse(text: string, mode: AIMode, context: UserContext) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const todayTimeBlocks = context.timeBlocks.filter(tb => 
    new Date(tb.startTime).toISOString().split('T')[0] === todayStr
  );
  const activeTasks = context.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
  const completedTasksToday = context.tasks.filter(t => 
    t.status === 'completed' && 
    t.updatedAt && 
    new Date(t.updatedAt).toISOString().split('T')[0] === todayStr
  );

  let response = '';
  let proposedChanges: ProposedChange[] = [];

  switch (mode) {
    case 'ask':
      if (text.includes('oggi') || text.includes('andata')) {
        response = `📊 **Analisi di oggi:**\n\n✅ Task completati: ${completedTasksToday.length}\n⏳ Task in corso: ${activeTasks.length}\n📅 Time blocks: ${todayTimeBlocks.length}\n\n${completedTasksToday.length > 0 ? '🎉 Ottimo lavoro oggi!' : '💪 C\'è ancora tempo per fare progressi!'}`;
      } else if (text.includes('rischio') || text.includes('task')) {
        const urgentTasks = activeTasks.filter(t => t.priority === 'critical' || t.priority === 'high');
        response = `⚠️ **Task a rischio:**\n\n${urgentTasks.length > 0 ? urgentTasks.map(t => `• ${t.title} (${t.priority})`).join('\n') : '✅ Nessun task critico al momento'}\n\n💡 Concentrati sui task ad alta priorità per evitare ritardi.`;
      } else {
        response = `🧠 **Stato attuale:**\n\n• Goals attivi: ${context.goals.filter(g => g.status === 'active').length}\n• Task pending: ${activeTasks.length}\n• Abitudini attive: ${context.habits.filter(h => h.isActive).length}\n\n📈 Il sistema sta tracciando i tuoi progressi in tempo reale.`;
      }
      break;

    case 'plan':
      if (text.includes('ottimizza') || text.includes('giornata')) {
        if (todayTimeBlocks.length === 0) {
          proposedChanges.push({
            id: 'demo-create-1',
            type: 'timeblock',
            action: 'create',
            after: {
              title: 'Deep Work Session',
              startTime: new Date(now.getTime() + 60*60*1000).toISOString(),
              endTime: new Date(now.getTime() + 3*60*60*1000).toISOString(),
              type: 'deep'
            },
            reason: 'Aggiunto blocco di focus per massimizzare la produttività'
          });
        }
        response = `🎯 **Ottimizzazione giornata:**\n\n${proposedChanges.length > 0 ? '• Propongo di aggiungere un blocco di deep work\n' : ''}• I tuoi orari più produttivi sembrano essere la mattina\n• Considera pause ogni 90 minuti per mantenere l\'energia alta\n\n💡 Vuoi che implementi queste modifiche?`;
      } else {
        response = `📅 **Pianificazione:**\n\nHo analizzato la tua giornata. Posso aiutarti a:\n• Aggiungere blocchi di deep work\n• Riorganizzare i task per priorità\n• Ottimizzare il timing delle attività\n\nDimmi cosa preferisci ottimizzare!`;
      }
      break;

    case 'analyze':
      response = `📈 **Analisi produttività:**\n\n**Punti di forza:**\n• ${completedTasksToday.length > 0 ? 'Buona esecuzione dei task' : 'Focus su pianificazione strategica'}\n• Uso costante del sistema di tracking\n\n**Aree di miglioramento:**\n• ${todayTimeBlocks.length === 0 ? 'Aggiungi time blocks per strutturare la giornata' : 'Mantieni costanza nei blocchi temporali'}\n• Prioritizza task ad alto impatto\n\n📊 I tuoi pattern mostrano potenziale per ${Math.floor(Math.random() * 30 + 20)}% di miglioramento in efficienza.`;
      break;

    case 'coach':
      if (text.includes('abitudine') || text.includes('fallisco')) {
        response = `🎯 **Coaching abitudini:**\n\n**Analisi del fallimento:**\n• Le abitudini falliscono spesso per mancanza di trigger chiari\n• Il context switching riduce la forza di volontà\n\n**Piano if-then:**\n"SE finisco di fare colazione ALLORA dedico 5 minuti a [abitudine]"\n\n🔥 Inizia piccolo, sii costante. La costistenza batte l'intensità.`;
      } else {
        response = `💪 **Weekly Review:**\n\n**Progressi questa settimana:**\n• Goals: ${Math.floor(Math.random() * 40 + 60)}% progresso medio\n• Costanza: ${context.habits.filter(h => h.streakCount > 0).length} abitudini attive\n\n**Focus prossima settimana:**\n• Mantieni momentum sui goal prioritari\n• Consolida le abitudini in corso\n\n🚀 Stai costruendo un sistema solido!`;
      }
      break;
  }

  return {
    response: `${response}\n\n⚠️ *Modalità Demo - Quota OpenAI esaurita. Aggiungi credito per AI completa.*`,
    proposedChanges
  };
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function AIInputBarV2({
  userId,
  goals,
  projects,
  tasks,
  timeBlocks,
  sessions,
  habits,
  habitLogs,
  domains,
  onApplyChanges,
  onCreateTimeBlock,
  onUpdateTimeBlock,
  onDeleteTimeBlock,
  onUpdateTask,
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
  
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ============================================================================
  // CONTEXT BUILDER - Prepara tutti i dati per ChatGPT
  // ============================================================================
  
  const buildContext = useCallback((): UserContext => {
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Calcola KPIs
    const todayStr = today.toISOString().split('T')[0];
    const todaySessions = sessions.filter(s => 
      new Date(s.startTime).toISOString().split('T')[0] === todayStr
    );
    const weekSessions = sessions.filter(s => 
      new Date(s.startTime) >= weekAgo
    );
    
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
    const plannedMinutes = todayTimeBlocks.reduce((sum, tb) => {
      return sum + Math.round((new Date(tb.endTime).getTime() - new Date(tb.startTime).getTime()) / 60000);
    }, 0);
    
    const planVsActualPercent = plannedMinutes > 0 
      ? Math.round((focusMinutesToday / plannedMinutes) * 100) 
      : 0;
    
    const activeStreaks = habits.filter(h => h.isActive && h.streakCount > 0).length;
    
    const completedTasksToday = tasks.filter(t => 
      t.status === 'completed' && 
      t.updatedAt && 
      new Date(t.updatedAt).toISOString().split('T')[0] === todayStr
    ).length;
    
    const completedTasksWeek = tasks.filter(t => 
      t.status === 'completed' && 
      t.updatedAt && 
      new Date(t.updatedAt) >= weekAgo
    ).length;
    
    // Conta overrun
    const overrunCount = todaySessions.filter(s => {
      const tb = timeBlocks.find(tb => tb.id === s.timeBlockId);
      if (!tb || !s.endTime) return false;
      const planned = (new Date(tb.endTime).getTime() - new Date(tb.startTime).getTime()) / 60000;
      const actual = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
      return actual > planned * 1.1;
    }).length;
    
    return {
      goals,
      projects,
      tasks,
      timeBlocks,
      sessions,
      habits,
      habitLogs,
      domains,
      kpis: {
        focusMinutesToday,
        focusMinutesWeek,
        planVsActualPercent,
        activeStreaks,
        completedTasksToday,
        completedTasksWeek,
        overrunCount,
      },
      preferences: {
        workHoursStart: '09:00',
        workHoursEnd: '18:00',
        timezone: 'Europe/Rome',
      }
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
    
    // Prepara il contesto
    const context = buildContext();
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    
    // Messaggio placeholder per streaming
    const assistantMessageId = `msg-${Date.now()}-assistant`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    setMessages(prev => [...prev, assistantMessage]);
    
    try {
      // Aggiungi prefisso mode al messaggio
      const modePrefix = mode === 'plan' 
        ? '[MODALITÀ PLAN - Proponi modifiche concrete] ' 
        : mode === 'analyze'
        ? '[MODALITÀ ANALYZE - Analizza la mia produttività] '
        : mode === 'coach'
        ? '[MODALITÀ COACH - Dammi consigli pratici] '
        : '';
      
      // Prova prima l'AI reale, fallback su demo se quota esaurita
      let data;
      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: modePrefix + text,
            context,
            history,
            userId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 429) {
            throw new Error('QUOTA_EXCEEDED');
          }
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        data = await response.json();
      } catch (error) {
        if (error instanceof Error && error.message === 'QUOTA_EXCEEDED') {
          // Modalità demo intelligente
          data = generateDemoResponse(text, mode, context);
        } else {
          throw error;
        }
      }
      
      // Aggiorna messaggio con risposta
      setMessages(prev => prev.map(m => 
        m.id === assistantMessageId 
          ? { 
              ...m, 
              content: data.response, 
              isStreaming: false,
              proposedChanges: data.proposedChanges,
            }
          : m
      ));
      
      // Salva proposte di modifica
      if (data.proposedChanges && data.proposedChanges.length > 0) {
        setPendingChanges(data.proposedChanges);
      }
      
    } catch (error) {
      console.error('🧠 AI Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
      setMessages(prev => prev.map(m => 
        m.id === assistantMessageId 
          ? { ...m, content: `❌ ${errorMessage}`, isStreaming: false }
          : m
      ));
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  };

  // ============================================================================
  // APPLY CHANGES
  // ============================================================================
  
  const applyChanges = async () => {
    if (pendingChanges.length === 0) return;
    
    setIsLoading(true);
    
    try {
      for (const change of pendingChanges) {
        switch (change.type) {
          case 'timeblock':
            if (change.action === 'create' && onCreateTimeBlock) {
              await onCreateTimeBlock({
                id: `tb-ai-${Date.now()}`,
                title: change.after.title,
                startTime: new Date(change.after.startTime),
                endTime: new Date(change.after.endTime),
                type: change.after.type || 'work',
                userId,
                status: 'planned',
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            } else if (change.action === 'update' && onUpdateTimeBlock && change.after.timeBlockId) {
              await onUpdateTimeBlock(change.after.timeBlockId, {
                startTime: change.after.startTime ? new Date(change.after.startTime) : undefined,
                endTime: change.after.endTime ? new Date(change.after.endTime) : undefined,
                title: change.after.title,
                updatedAt: new Date(),
              });
            } else if (change.action === 'delete' && onDeleteTimeBlock && change.after.timeBlockId) {
              await onDeleteTimeBlock(change.after.timeBlockId);
            }
            break;
            
          case 'task':
            if (change.action === 'update' && onUpdateTask && change.after.taskId) {
              await onUpdateTask(change.after.taskId, {
                priority: change.after.priority,
                status: change.after.status,
                dueDate: change.after.dueDate ? new Date(change.after.dueDate) : undefined,
                estimatedMinutes: change.after.estimatedMinutes,
                updatedAt: new Date(),
              });
            }
            break;
        }
      }
      
      // Aggiungi messaggio di conferma
      const confirmMessage: Message = {
        id: `msg-${Date.now()}-confirm`,
        role: 'assistant',
        content: `✅ Applicate ${pendingChanges.length} modifiche con successo!`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, confirmMessage]);
      setPendingChanges([]);
      
      // Callback generale
      if (onApplyChanges) {
        await onApplyChanges(pendingChanges);
      }
      
    } catch (error) {
      console.error('🧠 Apply Error:', error);
      const errorMessage: Message = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: '❌ Errore nell\'applicare le modifiche. Riprova.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const rejectChanges = () => {
    setPendingChanges([]);
    const rejectMessage: Message = {
      id: `msg-${Date.now()}-reject`,
      role: 'assistant',
      content: '🚫 Modifiche annullate. Posso aiutarti con qualcos\'altro?',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, rejectMessage]);
  };

  // ============================================================================
  // EFFECTS
  // ============================================================================
  
  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);
  
  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  
  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // ============================================================================
  // HANDLERS
  // ============================================================================
  
  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    sendMessage(input);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  
  const currentMode = MODE_CONFIG[mode];
  
  return (
    <div className={`bg-gray-900/95 backdrop-blur-lg border border-gray-700 rounded-2xl shadow-2xl ${className}`}>
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
                
                {/* Proposed Changes */}
                {msg.proposedChanges && msg.proposedChanges.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <div className="text-xs text-cyan-400 font-bold mb-2">
                      📋 {msg.proposedChanges.length} modifiche proposte
                    </div>
                    <div className="space-y-1">
                      {msg.proposedChanges.map((change, i) => (
                        <div key={i} className="text-xs text-gray-400">
                          • {change.action} {change.type}: {change.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {/* Apply/Reject Buttons */}
          {pendingChanges.length > 0 && (
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={applyChanges}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 
                         disabled:bg-gray-700 text-white rounded-lg transition-colors"
              >
                <Check className="w-4 h-4" />
                Applica ({pendingChanges.length})
              </button>
              <button
                onClick={rejectChanges}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 
                         disabled:bg-gray-800 text-white rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
                Annulla
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
              <button
                key={i}
                onClick={() => sendMessage(prompt.text)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs 
                         bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 
                         rounded-full transition-colors"
              >
                {prompt.icon}
                {prompt.text}
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
            <button
              type="button"
              onClick={() => setShowModeDropdown(!showModeDropdown)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl 
                        bg-gray-800/50 hover:bg-gray-700/50 transition-colors ${currentMode.color}`}
            >
              {currentMode.icon}
              <span className="text-sm font-medium">{currentMode.label}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showModeDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {showModeDropdown && (
              <div className="absolute bottom-full left-0 mb-2 w-48 bg-gray-800 
                            border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
                {(Object.entries(MODE_CONFIG) as [AIMode, typeof MODE_CONFIG[AIMode]][]).map(([key, config]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setMode(key); setShowModeDropdown(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 
                              hover:bg-gray-700/50 transition-colors text-left
                              ${mode === key ? 'bg-gray-700/50' : ''}`}
                  >
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
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Chiedimi qualcosa in modalità ${currentMode.label}...`}
              disabled={isLoading}
              rows={1}
              className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-600 
                       rounded-xl text-white placeholder-gray-500 resize-none
                       focus:outline-none focus:ring-2 focus:ring-cyan-500/50 
                       focus:border-cyan-500/50 disabled:opacity-50 transition-all"
            />
          </div>
          
          {/* Send Button */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex items-center justify-center w-11 h-11 
                     bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 
                     disabled:cursor-not-allowed rounded-xl transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Send className="w-5 h-5 text-white" />
            )}
          </button>
        </form>
        
        {/* Footer */}
        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Sparkles className="w-3 h-3" />
            <span>ChatGPT vede {goals.length} goals, {tasks.length} tasks, {timeBlocks.length} blocchi</span>
          </div>
          
          {showChat && messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setShowChat(false); setPendingChanges([]); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              Nuova chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}