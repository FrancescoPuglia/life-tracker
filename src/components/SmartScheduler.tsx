'use client';

// ⚡ SMART SCHEDULER COMPONENT - AI-Powered Schedule Optimization


import { useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  Check,
  Clock3,
  Gauge,
  Layers3,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { autoScheduler } from '@/lib/autoScheduler';
import { SchedulingConstraints, SchedulingResult, SchedulingConflict, AlternativeSchedule } from '@/types/ai-enhanced';
import { Task, TimeBlock, Goal } from '@/types';
import { audioManager } from '@/lib/audioManager';

interface SmartSchedulerProps {
  tasks: Task[];
  existingTimeBlocks: TimeBlock[];
  goals: Goal[];
  onTimeBlocksCreated?: (blocks: TimeBlock[]) => void;
  userPreferences?: any;
}

interface SchedulingState {
  isGenerating: boolean;
  result: SchedulingResult | null;
  selectedAlternative: number;
  showAdvanced: boolean;
  constraints: Partial<SchedulingConstraints>;
}

export default function SmartScheduler({
  tasks,
  existingTimeBlocks,
  goals,
  onTimeBlocksCreated,
  userPreferences = {}
}: SmartSchedulerProps) {
  const [state, setState] = useState<SchedulingState>({
    isGenerating: false,
    result: null,
    selectedAlternative: -1,
    showAdvanced: false,
    constraints: {}
  });

  const [workingHours, setWorkingHours] = useState({ start: '09:00', end: '17:00' });
  const [energyProfile, setEnergyProfile] = useState<Record<string, number>>({
    '9': 0.8, '10': 0.9, '11': 0.9, '12': 0.7,
    '13': 0.5, '14': 0.6, '15': 0.7, '16': 0.8, '17': 0.6
  });

  // 🎯 MAIN SCHEDULING ENGINE
  const generateOptimalSchedule = async () => {
    if (tasks.length === 0) {
      audioManager.play('error');
      return;
    }

    setState(prev => ({ ...prev, isGenerating: true }));
    audioManager.play('taskCompleted'); // Start sound

    try {
      console.log('⚡ SMART SCHEDULER: Starting optimization for', tasks.length, 'tasks');

      // Build comprehensive constraints
      const constraints: SchedulingConstraints = buildSchedulingConstraints();

      // Generate optimal schedule with REAL GOALS DATA
      const result = await autoScheduler.schedule(tasks, constraints, goals);
      
      console.log('⚡ SCHEDULER RESULT:', result);

      setState(prev => ({ 
        ...prev, 
        result, 
        isGenerating: false,
        selectedAlternative: -1
      }));

      // 🎮 SUCCESS FEEDBACK
      audioManager.perfectDay();
      
    } catch (error) {
      console.error('⚡ SMART SCHEDULER ERROR:', error);
      setState(prev => ({ ...prev, isGenerating: false }));
      audioManager.play('error');
    }
  };

  const buildSchedulingConstraints = (): SchedulingConstraints => {
    // Build deadlines from tasks
    const deadlines = tasks
      .filter(task => task.dueDate)
      .map(task => ({
        taskId: task.id,
        date: new Date(task.dueDate!),
        type: task.priority === 'high' ? 'hard' as const : 'soft' as const,
        importance: task.priority as 'low' | 'medium' | 'high'
      }));

    return {
      userPreferences: {
        workingHours: workingHours,
        deepWorkPreferences: {
          preferredTimes: [
            { start: '09:00', end: '11:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }
          ],
          maxBlockDuration: 120,
          breaksBetween: 15
        },
        energyManagement: {
          highEnergyTimes: [
            { start: '09:00', end: '11:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }
          ],
          lowEnergyTimes: [
            { start: '13:00', end: '14:00', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }
          ]
        },
        contextSwitching: {
          minimumBlockDuration: 30,
          maxTasksPerBlock: 3
        },
        breakPreferences: {
          shortBreakDuration: 15,
          longBreakDuration: 30,
          breakFrequency: 90
        }
      },
      existingBlocks: existingTimeBlocks,
      energyProfile: {
        hourlyProfile: energyProfile,
        weeklyPattern: {
          'monday': 0.9, 'tuesday': 0.9, 'wednesday': 0.8,
          'thursday': 0.8, 'friday': 0.7, 'saturday': 0.6, 'sunday': 0.5
        },
        personalFactors: {
          morningPerson: true,
          afternoonCrash: true,
          eveningBoost: false
        }
      },
      deadlines,
      bufferPreferences: {
        betweenTasks: 15,
        beforeDeadlines: 2,
        dayStartBuffer: 30,
        dayEndBuffer: 30
      }
    };
  };

  // 🔄 ALTERNATIVE SCHEDULE SELECTION
  const selectAlternative = (index: number) => {
    if (!state.result || (index >= 0 && !state.result.alternatives[index])) return;
    
    setState(prev => ({ ...prev, selectedAlternative: index }));
    audioManager.buttonFeedback();
    
  };

  // 📊 SCHEDULE ANALYSIS
  const analyzeScheduleQuality = (schedule: TimeBlock[]): { score: number; insights: string[] } => {
    const insights: string[] = [];
    if (schedule.length === 0) {
      return { score: 0, insights: ['Nessun blocco applicabile nella proposta corrente.'] };
    }
    let score = 0.7; // Base score

    // Energy alignment analysis
    const energyAlignedBlocks = schedule.filter(block => {
      const hour = new Date(block.startTime).getHours();
      const energyLevel = energyProfile[hour.toString()] || 0.5;
      return energyLevel > 0.6;
    });
    const energyScore = energyAlignedBlocks.length / schedule.length;
    score += energyScore * 0.2;
    
    if (energyScore > 0.7) {
      insights.push('Buon allineamento energetico: i task cadono nelle ore a maggiore capacità.');
    } else if (energyScore < 0.4) {
      insights.push('Allineamento energetico debole: valuta una delle alternative proposte.');
    }

    // Goal alignment analysis
    const goalAlignedBlocks = schedule.filter(block => block.goalIds && block.goalIds.length > 0);
    const goalScore = goalAlignedBlocks.length / schedule.length;
    score += goalScore * 0.15;
    
    if (goalScore > 0.6) {
      insights.push('La maggior parte dei blocchi contribuisce direttamente agli obiettivi.');
    }

    // Deadline compliance
    const urgentBlocks = schedule.filter(block => {
      const task = tasks.find(t => t.id === block.taskId);
      return task?.dueDate && new Date(task.dueDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    });
    if (urgentBlocks.length > 0) {
      insights.push(`${urgentBlocks.length} task urgenti pianificati entro tre giorni.`);
    }

    // Schedule density
    const totalMinutes = schedule.reduce((sum, block) => {
      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
      return sum + duration / (1000 * 60);
    }, 0);
    const averageBlockSize = totalMinutes / schedule.length;
    
    if (averageBlockSize < 30) {
      insights.push('Blocchi molto brevi: il cambio di contesto potrebbe aumentare.');
      score -= 0.1;
    } else if (averageBlockSize > 120) {
      insights.push('Blocchi lunghi adatti al lavoro profondo.');
      score += 0.1;
    }

    return { score: Math.max(0, Math.min(1, score)), insights };
  };

  const getConflictSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'border-red-200 bg-red-50 text-red-900';
      case 'high': return 'border-orange-200 bg-orange-50 text-orange-900';
      case 'medium': return 'border-amber-200 bg-amber-50 text-amber-900';
      case 'low': return 'border-blue-200 bg-blue-50 text-blue-900';
      default: return 'border-slate-200 bg-slate-50 text-slate-800';
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-emerald-700';
    if (confidence >= 0.6) return 'text-amber-700';
    return 'text-red-700';
  };

  const previewSchedule = state.result
    ? state.selectedAlternative === -1
      ? state.result.schedule
      : state.result.alternatives[state.selectedAlternative]?.schedule ?? state.result.schedule
    : [];

  return (
    <div className="space-y-5" data-testid="smart-scheduler-v3">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
            Precision Performance OS
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">Pianificatore intelligente</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Genera una proposta vincolata da disponibilità, scadenze, energia e Goal. Nulla viene
            salvato prima della tua verifica e dell’azione Applica.
          </p>
        </div>
        <button
          type="button"
          onClick={generateOptimalSchedule}
          disabled={state.isGenerating || tasks.length === 0}
          className="lt-button-primary min-h-[44px] px-5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.isGenerating ? (
            <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Generazione…</>
          ) : (
            <><Sparkles size={17} aria-hidden="true" /> Genera proposta</>
          )}
        </button>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="scheduler-config-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Configurazione</p>
            <h3 id="scheduler-config-title" className="mt-1 text-lg font-semibold text-slate-950">Vincoli della proposta</h3>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            {tasks.length} task eleggibili
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Target size={14} /> Strategia</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">Bilanciata multi-vincolo</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Scadenze, energia, Goal e preferenze.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CalendarRange size={14} /> Periodo</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">Prossimi 14 giorni</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Orizzonte deterministico del motore attuale.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2 xl:col-span-1">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Clock3 size={14} /> Disponibilità</p>
            <div className="mt-2 flex items-center gap-2">
              <input aria-label="Disponibilità dalle" type="time" value={workingHours.start} onChange={(event) => setWorkingHours((current) => ({ ...current, start: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" />
              <span className="text-slate-400">–</span>
              <input aria-label="Disponibilità alle" type="time" value={workingHours.end} onChange={(event) => setWorkingHours((current) => ({ ...current, end: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm" />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><ShieldCheck size={14} /> Vincoli</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{existingTimeBlocks.length} blocchi protetti</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Buffer e conflitti restano visibili.</p>
          </div>
        </div>
      </section>

      {tasks.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
          <h3 className="text-base font-semibold text-slate-900">Nessun task da pianificare</h3>
          <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-slate-600">
            I dati esistenti sono al sicuro. Crea o riapri un task e torna qui per generare una Preview.
          </p>
        </div>
      )}

      {/* 📊 SCHEDULING RESULT */}
      {state.result && (
        <div className="space-y-6">
          {/* PRIMARY SCHEDULE */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="scheduler-proposal-title">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Proposta</p>
                <h3 id="scheduler-proposal-title" className="mt-1 text-xl font-semibold text-slate-950">Anteprima del piano</h3>
              </div>
              <div className="flex items-center space-x-4">
                <div className={`text-sm font-semibold ${getConfidenceColor(state.result.confidence)}`}>
                  {Math.round(state.result.confidence * 100)}% confidenza
                </div>
                <button
                  type="button"
                  onClick={() => onTimeBlocksCreated?.(previewSchedule)}
                  disabled={previewSchedule.length === 0}
                  className="lt-button-primary min-h-[42px] px-4 disabled:opacity-50"
                >
                  <Check size={16} aria-hidden="true" /> Applica piano
                </button>
              </div>
            </div>

            {/* SCHEDULE OVERVIEW */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="text-2xl font-semibold text-blue-800">{previewSchedule.length}</div>
                <div className="text-sm text-blue-700">Blocchi proposti</div>
              </div>
              <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4">
                <div className="text-2xl font-semibold text-cyan-800">
                  {Math.round(
                    previewSchedule.reduce((sum, block) => {
                      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
                      return sum + duration / (1000 * 60 * 60);
                    }, 0) * 10
                  ) / 10}h
                </div>
                <div className="text-sm text-cyan-700">Ore pianificate</div>
              </div>
              <div className={`rounded-xl border p-4 ${state.result.conflicts.length > 0 ? 'border-amber-100 bg-amber-50' : 'border-emerald-100 bg-emerald-50'}`}>
                <div className={`text-2xl font-semibold ${state.result.conflicts.length > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>{state.result.conflicts.length}</div>
                <div className={`text-sm ${state.result.conflicts.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Conflitti rilevati</div>
              </div>
            </div>

            {/* SCHEDULE QUALITY ANALYSIS */}
            {(() => {
              const analysis = analyzeScheduleQuality(previewSchedule);
              return (
                <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-slate-900">Qualità della proposta</h4>
                    <div className="flex items-center space-x-2">
                      <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-indigo-600"
                          style={{ width: `${analysis.score * 100}%` }}
                        ></div>
                      </div>
                      <span className={`text-sm font-mono ${getConfidenceColor(analysis.score)}`}>
                        {Math.round(analysis.score * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {analysis.insights.map((insight, index) => (
                      <div key={index} className="flex gap-2 text-sm text-slate-700">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" /> {insight}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* REASONING */}
            <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
              <h4 className="mb-2 flex items-center gap-2 font-semibold text-indigo-950"><Gauge size={16} /> Criterio della proposta</h4>
              <p className="text-sm leading-6 text-indigo-900">{state.result.reasoning}</p>
            </div>

            {/* CONFLICTS */}
            {state.result.conflicts.length > 0 && (
              <div className="space-y-3">
                <h4 className="flex items-center gap-2 font-semibold text-slate-950"><AlertTriangle size={16} className="text-amber-600" /> Conflitti da risolvere</h4>
                {state.result.conflicts.map((conflict, index) => (
                  <div key={index} className={`border rounded-lg p-3 ${getConflictSeverityColor(conflict.severity)}`}>
                    <div className="font-medium">{conflict.description}</div>
                    <div className="text-sm mt-2 space-y-1">
                      <div className="font-medium">Suggerimenti:</div>
                      {conflict.suggestions.map((suggestion, i) => (
                        <div key={i} className="text-sm opacity-90">• {suggestion}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ALTERNATIVE SCHEDULES */}
          {state.result.alternatives.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="scheduler-alternatives-title">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alternative</p>
                  <h3 id="scheduler-alternatives-title" className="mt-1 text-lg font-semibold text-slate-950">Confronta prima di applicare</h3>
                </div>
                <button type="button" onClick={() => selectAlternative(-1)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${state.selectedAlternative === -1 ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-700'}`}>Piano principale</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {state.result.alternatives.map((alt, index) => (
                  <div
                    key={index}
                    className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                      state.selectedAlternative === index
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                    }`}
                    onClick={() => selectAlternative(index)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-slate-950">{alt.name}</h4>
                      <div className={`text-sm ${getConfidenceColor(alt.confidence)}`}>
                        {Math.round(alt.confidence * 100)}%
                      </div>
                    </div>
                    <p className="mb-3 text-sm leading-5 text-slate-600">{alt.description}</p>
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-500">Compromessi</div>
                      {alt.tradeoffs.map((tradeoff, i) => (
                        <div key={i} className="text-xs leading-5 text-slate-600">• {tradeoff}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 📈 STATISTICS */}
      {tasks.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-950"><Layers3 size={18} /> Carico da pianificare</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-semibold text-slate-950">{tasks.length}</div>
              <div className="text-sm text-slate-500">Task da pianificare</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-cyan-700">
                {Math.round(tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 60), 0) / 60 * 10) / 10}h
              </div>
              <div className="text-sm text-slate-500">Lavoro stimato</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-indigo-700">
                {tasks.filter(t => t.dueDate).length}
              </div>
              <div className="text-sm text-slate-500">Con scadenza</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-semibold text-amber-700">
                {tasks.filter(t => t.priority === 'high' || t.priority === 'critical').length}
              </div>
              <div className="text-sm text-slate-500">Priorità alta</div>
            </div>
          </div>
        </section>
      )}

      {/* 💡 HELP & TIPS */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <details className="text-sm text-slate-700">
          <summary className="cursor-pointer font-semibold text-slate-900">
            Come viene costruita la proposta
          </summary>
          <div className="mt-3 grid gap-2 leading-6 md:grid-cols-2">
            <p>• Le scadenze aumentano l’urgenza senza nascondere i conflitti.</p>
            <p>• I task più impegnativi cercano le ore a energia maggiore.</p>
            <p>• I task collegati vengono raggruppati per ridurre il cambio di contesto.</p>
            <p>• Ogni alternativa resta una Preview finché non scegli Applica piano.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
