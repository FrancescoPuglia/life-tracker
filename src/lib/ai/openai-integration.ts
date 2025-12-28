// src/lib/ai/openai-integration.ts
// 🧠 INTEGRAZIONE CHATGPT COMPLETA - Vede tutto, analizza tutto, modifica tutto
// MODALITÀ PSICOPATICO CERTOSINO 🔥

import OpenAI from 'openai';
import { 
  Goal, Task, TimeBlock, Habit, 
  Session, Project, Domain 
} from '@/types';

// ============================================================================
// CONFIGURAZIONE
// ============================================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const MODEL = 'gpt-3.5-turbo'; // Modello più economico
const MAX_TOKENS = 4000;

// ============================================================================
// TIPI PER IL CONTESTO
// ============================================================================

export interface UserContext {
  // Dati completi dell'utente
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  timeBlocks: TimeBlock[];
  sessions: Session[];
  habits: Habit[];
  habitLogs: { habitId: string; date: Date; completed: boolean }[];
  domains: Domain[];
  
  // KPIs calcolati
  kpis: {
    focusMinutesToday: number;
    focusMinutesWeek: number;
    planVsActualPercent: number;
    activeStreaks: number;
    completedTasksToday: number;
    completedTasksWeek: number;
    overrunCount: number;
  };
  
  // Preferenze utente
  preferences: {
    workHoursStart: string;
    workHoursEnd: string;
    timezone: string;
  };
}

export interface AIResponse {
  message: string;
  suggestions?: Suggestion[];
  analysis?: Analysis;
  proposedChanges?: ProposedChange[];
}

export interface Suggestion {
  type: 'task' | 'timeblock' | 'habit' | 'goal';
  action: 'create' | 'update' | 'delete' | 'move';
  data: any;
  reason: string;
}

export interface Analysis {
  strengths: string[];
  weaknesses: string[];
  patterns: string[];
  recommendations: string[];
}

export interface ProposedChange {
  id: string;
  type: 'timeblock' | 'task' | 'habit' | 'goal';
  action: 'create' | 'update' | 'delete';
  before?: any;
  after: any;
  reason: string;
}

// ============================================================================
// SYSTEM PROMPT - Il cervello di ChatGPT
// ============================================================================

function buildSystemPrompt(): string {
  return `Sei il Life Tracker AI Coach, un assistente personale ossessionato dalla produttività REALE.

## IL TUO RUOLO
Hai accesso COMPLETO ai dati dell'utente:
- Goals e Key Results con progresso
- Projects e Tasks con stato e priorità
- TimeBlocks pianificati
- Sessions effettive (tempo REALE lavorato)
- Habits con streak
- KPIs in tempo reale

## COME ANALIZZARE
1. **Tempo REALE vs Pianificato**: Confronta sempre sessions (actual) con timeBlocks (planned)
2. **Allineamento Goal**: Ogni attività deve collegarsi a un obiettivo
3. **Pattern**: Identifica orari produttivi, cause di overrun, abitudini che falliscono
4. **Rischi**: Deadline vicine senza progresso, goal trascurati, streak a rischio

## COME RISPONDERE
- Sii DIRETTO e ACTIONABLE
- Usa i DATI, non opinioni generiche
- Formato: [Analisi breve] + [Perché] + [Cosa fare ORA]
- In italiano

## QUANDO PROPONI MODIFICHE
Genera un JSON strutturato con:
- type: 'timeblock' | 'task' | 'habit' | 'goal'
- action: 'create' | 'update' | 'delete'
- data: i dati specifici
- reason: perché suggerisci questo

## REGOLE ASSOLUTE
- MAI inventare dati - usa solo ciò che vedi nel contesto
- MAI modificare senza spiegare perché
- SEMPRE collegare i suggerimenti ai goal dell'utente
- Rispondi in ITALIANO`;
}

// ============================================================================
// COSTRUTTORE CONTESTO - Prepara tutti i dati per ChatGPT
// ============================================================================

export function buildContextMessage(context: UserContext): string {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  // Filtra dati di oggi
  const todayTimeBlocks = context.timeBlocks.filter(tb => 
    new Date(tb.startTime).toISOString().split('T')[0] === todayStr
  );
  const todaySessions = context.sessions.filter(s =>
    new Date(s.startTime).toISOString().split('T')[0] === todayStr
  );
  const todayTasks = context.tasks.filter(t => 
    t.status === 'pending' || t.status === 'in_progress'
  );
  
  // Calcola minuti effettivi oggi
  const actualMinutesToday = todaySessions.reduce((sum, s) => {
    const end = s.endTime ? new Date(s.endTime) : new Date();
    return sum + Math.round((end.getTime() - new Date(s.startTime).getTime()) / 60000);
  }, 0);
  
  // Calcola minuti pianificati oggi
  const plannedMinutesToday = todayTimeBlocks.reduce((sum, tb) => {
    return sum + Math.round((new Date(tb.endTime).getTime() - new Date(tb.startTime).getTime()) / 60000);
  }, 0);

  return `## 📊 STATO ATTUALE - ${today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}

### ⏱️ OGGI
- Pianificato: ${plannedMinutesToday} minuti (${Math.round(plannedMinutesToday/60)}h)
- Effettivo: ${actualMinutesToday} minuti (${Math.round(actualMinutesToday/60)}h)  
- Plan vs Actual: ${plannedMinutesToday > 0 ? Math.round((actualMinutesToday/plannedMinutesToday)*100) : 0}%

### 📅 TIME BLOCKS OGGI (${todayTimeBlocks.length})
${todayTimeBlocks.map(tb => {
  const start = new Date(tb.startTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const end = new Date(tb.endTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const session = todaySessions.find(s => s.timeBlockId === tb.id);
  const status = session ? (session.endTime ? '✅' : '🔄') : '⏳';
  return `- ${status} ${start}-${end}: ${tb.title} [${tb.type}]`;
}).join('\n') || '- Nessun time block pianificato'}

### 📋 TASK ATTIVI (${todayTasks.length})
${todayTasks.slice(0, 10).map(t => {
  const deadline = t.dueDate ? ` ⏰${new Date(t.dueDate).toLocaleDateString('it-IT')}` : '';
  const goal = context.goals.find(g => g.id === t.goalId);
  return `- [${t.priority}] ${t.title}${deadline}${goal ? ` → ${goal.title}` : ''}`;
}).join('\n') || '- Nessun task attivo'}

### 🎯 GOALS ATTIVI (${context.goals.filter(g => g.status === 'active').length})
${context.goals.filter(g => g.status === 'active').map(g => {
  const tasks = context.tasks.filter(t => t.goalId === g.id);
  const completed = tasks.filter(t => t.status === 'completed').length;
  const progress = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  return `- ${g.title}: ${progress}% (${completed}/${tasks.length} task)`;
}).join('\n') || '- Nessun goal attivo'}

### 🔥 HABITS
${context.habits.filter(h => h.isActive).map(h => {
  const todayLog = context.habitLogs.find(l => 
    l.habitId === h.id && 
    new Date(l.date).toISOString().split('T')[0] === todayStr
  );
  return `- ${todayLog?.completed ? '✅' : '⬜'} ${h.name} (streak: ${h.streakCount} giorni)`;
}).join('\n') || '- Nessuna abitudine attiva'}

### 📈 KPIs
- Focus oggi: ${context.kpis.focusMinutesToday} min
- Focus settimana: ${context.kpis.focusMinutesWeek} min
- Task completati oggi: ${context.kpis.completedTasksToday}
- Streak attive: ${context.kpis.activeStreaks}
- Overrun questa settimana: ${context.kpis.overrunCount}`;
}

// ============================================================================
// TOOL DEFINITIONS - Cosa può fare ChatGPT
// ============================================================================

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'analyze_productivity',
      description: 'Analizza la produttività dell\'utente identificando punti di forza, debolezze e pattern',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', 'week', 'month'],
            description: 'Periodo da analizzare'
          }
        },
        required: ['period']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_timeblock',
      description: 'Proponi di creare, modificare o eliminare un time block',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'delete'],
            description: 'Azione da eseguire'
          },
          timeBlockId: {
            type: 'string',
            description: 'ID del time block (per update/delete)'
          },
          title: {
            type: 'string',
            description: 'Titolo del time block'
          },
          startTime: {
            type: 'string',
            description: 'Ora di inizio ISO'
          },
          endTime: {
            type: 'string',
            description: 'Ora di fine ISO'
          },
          type: {
            type: 'string',
            enum: ['deep', 'shallow', 'meeting', 'break', 'personal'],
            description: 'Tipo di blocco'
          },
          taskId: {
            type: 'string',
            description: 'ID del task collegato'
          },
          reason: {
            type: 'string',
            description: 'Motivazione della proposta'
          }
        },
        required: ['action', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_task_update',
      description: 'Proponi di modificare un task (priorità, deadline, stato)',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'ID del task'
          },
          updates: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              status: { type: 'string', enum: ['pending', 'in-progress', 'completed', 'cancelled'] },
              dueDate: { type: 'string', description: 'Nuova deadline ISO' },
              estimatedMinutes: { type: 'number' }
            }
          },
          reason: {
            type: 'string',
            description: 'Motivazione'
          }
        },
        required: ['taskId', 'updates', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_schedule_optimization',
      description: 'Proponi un\'ottimizzazione completa della giornata',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Data da ottimizzare (ISO)'
          },
          strategy: {
            type: 'string',
            enum: ['maximize_deep_work', 'balance', 'deadline_focus', 'energy_based'],
            description: 'Strategia di ottimizzazione'
          },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['create', 'move', 'delete'] },
                timeBlockId: { type: 'string' },
                newStartTime: { type: 'string' },
                newEndTime: { type: 'string' },
                title: { type: 'string' },
                blockType: { type: 'string' }
              }
            },
            description: 'Lista di modifiche proposte'
          },
          reason: {
            type: 'string',
            description: 'Spiegazione dell\'ottimizzazione'
          }
        },
        required: ['date', 'strategy', 'changes', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'suggest_habit_improvement',
      description: 'Suggerisci miglioramenti per le abitudini',
      parameters: {
        type: 'object',
        properties: {
          habitId: {
            type: 'string',
            description: 'ID dell\'abitudine'
          },
          suggestion: {
            type: 'string',
            description: 'Suggerimento specifico'
          },
          ifThenPlan: {
            type: 'string',
            description: 'Piano if-then: "SE [trigger] ALLORA [azione]"'
          },
          reason: {
            type: 'string'
          }
        },
        required: ['habitId', 'suggestion', 'reason']
      }
    }
  }
];

// ============================================================================
// CHIAMATA PRINCIPALE A OPENAI
// ============================================================================

export async function chat(
  userMessage: string,
  context: UserContext,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<{
  response: string;
  toolCalls: any[];
  proposedChanges: ProposedChange[];
}> {
  const systemPrompt = buildSystemPrompt();
  const contextMessage = buildContextMessage(context);
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: contextMessage },
    ...conversationHistory.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message;
    const toolCalls = assistantMessage.tool_calls || [];
    const proposedChanges: ProposedChange[] = [];

    // Processa tool calls
    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'function') continue;
      const args = JSON.parse(toolCall.function.arguments);
      
      switch (toolCall.function.name) {
        case 'propose_timeblock':
          proposedChanges.push({
            id: `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'timeblock',
            action: args.action,
            after: {
              title: args.title,
              startTime: args.startTime,
              endTime: args.endTime,
              type: args.type,
              taskId: args.taskId
            },
            reason: args.reason
          });
          break;
          
        case 'propose_task_update':
          proposedChanges.push({
            id: `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'task',
            action: 'update',
            after: {
              taskId: args.taskId,
              ...args.updates
            },
            reason: args.reason
          });
          break;
          
        case 'propose_schedule_optimization':
          for (const change of args.changes || []) {
            proposedChanges.push({
              id: `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'timeblock',
              action: change.type,
              after: {
                timeBlockId: change.timeBlockId,
                title: change.title,
                startTime: change.newStartTime,
                endTime: change.newEndTime,
                type: change.blockType
              },
              reason: args.reason
            });
          }
          break;
          
        case 'suggest_habit_improvement':
          proposedChanges.push({
            id: `change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'habit',
            action: 'update',
            after: {
              habitId: args.habitId,
              suggestion: args.suggestion,
              ifThenPlan: args.ifThenPlan
            },
            reason: args.reason
          });
          break;
      }
    }

    return {
      response: assistantMessage.content || '',
      toolCalls,
      proposedChanges
    };
    
  } catch (error) {
    console.error('🧠 OpenAI Error:', error);
    throw error;
  }
}

// ============================================================================
// STREAMING VERSION
// ============================================================================

export async function* chatStream(
  userMessage: string,
  context: UserContext,
  conversationHistory: { role: 'user' | 'assistant'; content: string }[] = []
): AsyncGenerator<{ type: 'content' | 'tool' | 'done'; data: any }> {
  const systemPrompt = buildSystemPrompt();
  const contextMessage = buildContextMessage(context);
  
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: contextMessage },
    ...conversationHistory.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];

  const stream = await openai.chat.completions.create({
    model: MODEL,
    messages,
    tools,
    tool_choice: 'auto',
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    stream: true,
  });

  let toolCalls: any[] = [];
  let currentToolCall: any = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    
    // Contenuto testuale
    if (delta?.content) {
      yield { type: 'content', data: delta.content };
    }
    
    // Tool calls
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.index !== undefined) {
          if (!toolCalls[tc.index]) {
            toolCalls[tc.index] = {
              id: tc.id || '',
              function: { name: '', arguments: '' }
            };
          }
          if (tc.id) toolCalls[tc.index].id = tc.id;
          if (tc.function?.name) toolCalls[tc.index].function.name = tc.function.name;
          if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
        }
      }
    }
    
    // Fine stream
    if (chunk.choices[0]?.finish_reason) {
      // Processa tool calls finali
      for (const tc of toolCalls) {
        if (tc.function.name && tc.function.arguments) {
          yield { 
            type: 'tool', 
            data: {
              name: tc.function.name,
              arguments: JSON.parse(tc.function.arguments)
            }
          };
        }
      }
      yield { type: 'done', data: null };
    }
  }
}