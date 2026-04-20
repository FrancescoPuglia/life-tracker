// src/lib/ai/openai-integration.ts
// AI Chat Integration - supports OpenAI and Ollama via provider abstraction

import OpenAI from 'openai';
import {
  Goal, Task, TimeBlock, Habit,
  Session, Project, Domain
} from '@/types';
import { getAIConfig } from './provider';

// ============================================================================
// TYPES
// ============================================================================

export interface UserContext {
  goals: Goal[];
  projects: Project[];
  tasks: Task[];
  timeBlocks: TimeBlock[];
  sessions: Session[];
  habits: Habit[];
  habitLogs: { habitId: string; date: Date; completed: boolean }[];
  domains: Domain[];

  kpis: {
    focusMinutesToday: number;
    focusMinutesWeek: number;
    planVsActualPercent: number;
    activeStreaks: number;
    completedTasksToday: number;
    completedTasksWeek: number;
    overrunCount: number;
  };

  preferences: {
    workHoursStart: string;
    workHoursEnd: string;
    timezone: string;
  };
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
// SYSTEM PROMPT
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

## REGOLE ASSOLUTE
- MAI inventare dati - usa solo ciò che vedi nel contesto
- MAI modificare senza spiegare perché
- SEMPRE collegare i suggerimenti ai goal dell'utente
- Rispondi in ITALIANO`;
}

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

export function buildContextMessage(context: UserContext): string {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const todayTimeBlocks = context.timeBlocks.filter(tb =>
    new Date(tb.startTime).toISOString().split('T')[0] === todayStr
  );
  const todaySessions = context.sessions.filter(s =>
    new Date(s.startTime).toISOString().split('T')[0] === todayStr
  );
  const todayTasks = context.tasks.filter(t =>
    t.status === 'pending' || t.status === 'in_progress'
  );

  const actualMinutesToday = todaySessions.reduce((sum, s) => {
    const end = s.endTime ? new Date(s.endTime) : new Date();
    return sum + Math.round((end.getTime() - new Date(s.startTime).getTime()) / 60000);
  }, 0);

  const plannedMinutesToday = todayTimeBlocks.reduce((sum, tb) => {
    return sum + Math.round((new Date(tb.endTime).getTime() - new Date(tb.startTime).getTime()) / 60000);
  }, 0);

  return `## STATO ATTUALE - ${today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}

### OGGI
- Pianificato: ${plannedMinutesToday} min (${Math.round(plannedMinutesToday/60)}h)
- Effettivo: ${actualMinutesToday} min (${Math.round(actualMinutesToday/60)}h)
- Plan vs Actual: ${plannedMinutesToday > 0 ? Math.round((actualMinutesToday/plannedMinutesToday)*100) : 0}%

### TIME BLOCKS OGGI (${todayTimeBlocks.length})
${todayTimeBlocks.map(tb => {
  const start = new Date(tb.startTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const end = new Date(tb.endTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const session = todaySessions.find(s => s.timeBlockId === tb.id);
  const status = session ? (session.endTime ? 'DONE' : 'IN CORSO') : 'PIANIFICATO';
  return `- [${status}] ${start}-${end}: ${tb.title} [${tb.type}]`;
}).join('\n') || '- Nessun time block pianificato'}

### TASK ATTIVI (${todayTasks.length})
${todayTasks.slice(0, 10).map(t => {
  const deadline = t.dueDate ? ` scade:${new Date(t.dueDate).toLocaleDateString('it-IT')}` : '';
  const goal = context.goals.find(g => g.id === t.goalId);
  return `- [${t.priority}] ${t.title}${deadline}${goal ? ` -> ${goal.title}` : ''}`;
}).join('\n') || '- Nessun task attivo'}

### GOALS ATTIVI (${context.goals.filter(g => g.status === 'active').length})
${context.goals.filter(g => g.status === 'active').map(g => {
  const tasks = context.tasks.filter(t => t.goalId === g.id);
  const completed = tasks.filter(t => t.status === 'completed').length;
  const progress = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;
  return `- ${g.title}: ${progress}% (${completed}/${tasks.length} task)`;
}).join('\n') || '- Nessun goal attivo'}

### HABITS
${context.habits.filter(h => h.isActive).map(h => {
  const todayLog = context.habitLogs.find(l =>
    l.habitId === h.id &&
    new Date(l.date).toISOString().split('T')[0] === todayStr
  );
  return `- ${todayLog?.completed ? '[FATTO]' : '[  ]'} ${h.name} (streak: ${h.streakCount} giorni)`;
}).join('\n') || '- Nessuna abitudine attiva'}

### KPIs
- Focus oggi: ${context.kpis.focusMinutesToday} min
- Focus settimana: ${context.kpis.focusMinutesWeek} min
- Task completati oggi: ${context.kpis.completedTasksToday}
- Streak attive: ${context.kpis.activeStreaks}
- Overrun questa settimana: ${context.kpis.overrunCount}`;
}

// ============================================================================
// TOOL DEFINITIONS (only used when provider supports tools)
// ============================================================================

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'propose_timeblock',
      description: 'Proponi di creare, modificare o eliminare un time block',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update', 'delete'] },
          timeBlockId: { type: 'string' },
          title: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          type: { type: 'string', enum: ['deep', 'shallow', 'meeting', 'break', 'personal'] },
          taskId: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['action', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_task_update',
      description: 'Proponi di modificare un task',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          updates: {
            type: 'object',
            properties: {
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
              status: { type: 'string', enum: ['pending', 'in-progress', 'completed', 'cancelled'] },
              dueDate: { type: 'string' },
              estimatedMinutes: { type: 'number' }
            }
          },
          reason: { type: 'string' }
        },
        required: ['taskId', 'updates', 'reason']
      }
    }
  }
];

// ============================================================================
// MAIN CHAT FUNCTION
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
  const config = getAIConfig();
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
    const requestParams: any = {
      model: config.chatModel,
      messages,
      max_tokens: config.maxTokens,
      temperature: 0.7,
    };

    // Only add tools for providers that support them
    if (config.supportsTools) {
      requestParams.tools = tools;
      requestParams.tool_choice = 'auto';
    }

    const completion = await config.client.chat.completions.create(requestParams);

    const assistantMessage = completion.choices[0].message;
    const rawToolCalls = assistantMessage.tool_calls || [];
    const proposedChanges: ProposedChange[] = [];

    for (const toolCall of rawToolCalls) {
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
            after: { taskId: args.taskId, ...args.updates },
            reason: args.reason
          });
          break;
      }
    }

    return {
      response: assistantMessage.content || '',
      toolCalls: rawToolCalls,
      proposedChanges
    };

  } catch (error: any) {
    // Provide helpful error messages based on provider
    if (config.provider === 'ollama' && error?.code === 'ECONNREFUSED') {
      throw new Error(
        'Ollama non raggiungibile. Assicurati che sia avviato: ollama serve'
      );
    }
    throw error;
  }
}
