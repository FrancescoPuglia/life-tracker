'use client';

// 🔄 REAL-TIME ADAPTATION COMPONENT - Dynamic Schedule Intelligence


import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  AlertTriangle,
  BatteryLow,
  Check,
  Clock3,
  PauseCircle,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { rePlanningEngine } from '@/lib/rePlanningEngine';
import { RePlanningTrigger, RePlanningOptions, RePlanningResult, ScheduleChange } from '@/types/ai-enhanced';
import { TimeBlock, Task, Goal } from '@/types';
import { audioManager } from '@/lib/audioManager';

interface RealTimeAdaptationProps {
  currentSchedule: TimeBlock[];
  tasks: Task[];
  goals: Goal[];
  currentSession?: any;
  userEnergyLevel: number;
  onScheduleAdapted: (newSchedule: TimeBlock[], changes: ScheduleChange[]) => void;
  onEmergencyMode?: (active: boolean, reason: string) => void;
}

interface AdaptationState {
  isActive: boolean;
  isProcessing: boolean;
  lastTrigger: RePlanningTrigger | null;
  lastResult: RePlanningResult | null;
  adaptationHistory: Array<{
    timestamp: Date;
    trigger: string;
    confidence: number;
    changesCount: number;
  }>;
  emergencyMode: boolean;
}

interface DisruptionDetection {
  sessionOverrun: boolean;
  energyDrop: boolean;
  missedBlock: boolean;
  externalInterrupt: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export default function RealTimeAdaptation({
  currentSchedule,
  tasks,
  goals,
  currentSession,
  userEnergyLevel,
  onScheduleAdapted,
  onEmergencyMode
}: RealTimeAdaptationProps) {
  const [state, setState] = useState<AdaptationState>({
    isActive: true,
    isProcessing: false,
    lastTrigger: null,
    lastResult: null,
    adaptationHistory: [],
    emergencyMode: false
  });

  const [disruptions, setDisruptions] = useState<DisruptionDetection>({
    sessionOverrun: false,
    energyDrop: false,
    missedBlock: false,
    externalInterrupt: false,
    severity: 'low'
  });

  const [adaptationSettings, setAdaptationSettings] = useState({
    autoAdapt: true,
    strategy: 'balanced' as 'balanced' | 'save_day' | 'save_goal' | 'save_energy' | 'minimal_change',
    aggressiveness: 'moderate' as 'conservative' | 'moderate' | 'aggressive',
    energyThreshold: 0.3,
    overrunTolerance: 15, // minutes
  });

  const lastEnergyLevel = useRef(userEnergyLevel);
  const sessionStartTime = useRef<Date | null>(null);
  const disruptionTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // 🔄 REAL-TIME MONITORING
  useEffect(() => {
    const monitoringInterval = setInterval(() => {
      detectDisruptions();
    }, 30000); // Check every 30 seconds

    return () => clearInterval(monitoringInterval);
  }, [currentSchedule, currentSession, userEnergyLevel]);

  // 🎯 ENERGY LEVEL MONITORING
  useEffect(() => {
    const energyDrop = lastEnergyLevel.current - userEnergyLevel;
    
    if (energyDrop > adaptationSettings.energyThreshold) {
      console.log('⚡ ENERGY DROP DETECTED:', energyDrop);
      handleEnergyDrop(energyDrop);
    }
    
    lastEnergyLevel.current = userEnergyLevel;
  }, [userEnergyLevel]);

  // 📊 SESSION MONITORING
  useEffect(() => {
    if (currentSession?.status === 'active' && !sessionStartTime.current) {
      sessionStartTime.current = new Date();
      console.log('🎯 SESSION STARTED: Monitoring for overruns');
    } else if (currentSession?.status !== 'active') {
      sessionStartTime.current = null;
    }
  }, [currentSession]);

  // 🔍 DISRUPTION DETECTION ENGINE
  const detectDisruptions = async () => {
    const now = new Date();
    const newDisruptions: DisruptionDetection = {
      sessionOverrun: false,
      energyDrop: false,
      missedBlock: false,
      externalInterrupt: false,
      severity: 'low'
    };

    // 1. SESSION OVERRUN DETECTION
    if (currentSession?.status === 'active' && sessionStartTime.current) {
      const sessionDuration = (now.getTime() - sessionStartTime.current.getTime()) / (1000 * 60);
      const plannedDuration = currentSession.plannedDuration || 60; // Default 60 minutes
      
      if (sessionDuration > plannedDuration + adaptationSettings.overrunTolerance) {
        newDisruptions.sessionOverrun = true;
        newDisruptions.severity = 'medium';
        
        console.log('⏰ SESSION OVERRUN DETECTED:', sessionDuration - plannedDuration, 'minutes');
        
        if (adaptationSettings.autoAdapt) {
          await triggerAdaptation({
            type: 'session_end',
            timestamp: now,
            context: {
              overrunDuration: sessionDuration - plannedDuration,
              currentSchedule,
              remainingTasks: tasks
            }
          });
        }
      }
    }

    // 2. MISSED BLOCK DETECTION
    const currentBlock = getCurrentBlock(now);
    const shouldHaveBlock = shouldHaveActiveBlock(now);
    
    if (shouldHaveBlock && !currentBlock && !currentSession?.status) {
      newDisruptions.missedBlock = true;
      newDisruptions.severity = 'high';
      
      console.log('📅 MISSED BLOCK DETECTED at', now.toLocaleTimeString());
      
      if (adaptationSettings.autoAdapt) {
        await triggerAdaptation({
          type: 'missed_block',
          timestamp: now,
          affectedBlockId: getMissedBlockId(now),
          context: {
            currentSchedule,
            remainingTasks: tasks,
            missedTime: now
          }
        });
      }
    }

    // 3. ENERGY DROP DETECTION (handled in useEffect)
    
    // 4. EXTERNAL INTERRUPT DETECTION
    // This would typically be triggered by user input or external events
    
    setDisruptions(newDisruptions);
  };

  const handleEnergyDrop = async (drop: number) => {
    if (!adaptationSettings.autoAdapt) return;

    const severity = drop > 0.5 ? 'critical' : drop > 0.3 ? 'high' : 'medium';
    
    setDisruptions(prev => ({ 
      ...prev, 
      energyDrop: true, 
      severity: severity as any 
    }));

    await triggerAdaptation({
      type: 'energy_change',
      timestamp: new Date(),
      context: {
        energyDrop: drop,
        currentEnergy: userEnergyLevel,
        currentSchedule,
        remainingTasks: tasks
      }
    });
  };

  // 🚨 ADAPTATION TRIGGER ENGINE
  const triggerAdaptation = async (trigger: RePlanningTrigger) => {
    if (state.isProcessing) {
      console.log('🔄 RE-PLANNING: Already processing, skipping trigger');
      return;
    }

    setState(prev => ({ ...prev, isProcessing: true, lastTrigger: trigger }));

    try {
      console.log('🔄 TRIGGERING ADAPTATION:', trigger.type);

      const options: RePlanningOptions = {
        strategy: adaptationSettings.strategy === 'balanced' ? 'save_day' : adaptationSettings.strategy,
        aggressiveness: adaptationSettings.aggressiveness,
        priorityGoals: goals.filter(g => g.priority === 'high').map(g => g.id)
      };

      // 🧠 EXECUTE RE-PLANNING
      const result = await rePlanningEngine.handleTrigger(trigger, options);
      
      console.log('🔄 ADAPTATION RESULT:', result);

      setState(prev => ({ 
        ...prev, 
        isProcessing: false,
        lastResult: result,
        adaptationHistory: [
          ...prev.adaptationHistory.slice(-9), // Keep last 10
          {
            timestamp: new Date(),
            trigger: trigger.type,
            confidence: (result.changes.length / Math.max(1, currentSchedule.length)) * 100,
            changesCount: result.changes.length
          }
        ]
      }));

      // 🎮 PROVIDE FEEDBACK
      provideFeedbackToUser(result, trigger);

      // 🚨 CHECK FOR EMERGENCY MODE
      const confidenceScore = (result.changes.length / Math.max(1, currentSchedule.length)) * 100;
      if (confidenceScore < 30 || trigger.type === 'external_interrupt') {
        setState(prev => ({ ...prev, emergencyMode: true }));
        onEmergencyMode?.(true, `High impact adaptation: ${result.reasoning}`);
      }

      // The result remains a proposal. Structural schedule changes are sent
      // to the persistence owner only after the explicit Apply action below.

    } catch (error) {
      console.error('🔄 ADAPTATION ERROR:', error);
      setState(prev => ({ ...prev, isProcessing: false }));
      audioManager.play('error');
    }
  };

  // 🎮 USER FEEDBACK SYSTEM
  const provideFeedbackToUser = (result: RePlanningResult, trigger: RePlanningTrigger) => {
    const impactLevel = result.changes.length / Math.max(1, currentSchedule.length);
    
    // Audio feedback based on impact level
    if (impactLevel < 0.1) {
      audioManager.perfectDay();
    } else if (impactLevel < 0.3) {
      audioManager.taskCompleted();
    } else if (impactLevel < 0.5) {
      audioManager.buttonFeedback();
    } else {
      audioManager.play('error');
    }

    // Visual notification could be added here
    console.log(`🔄 ADAPTATION: ${trigger.type} → ${result.changes.length} changes (${Math.round(impactLevel * 100)}% impact)`);
  };

  // 🔧 MANUAL ADAPTATION TRIGGERS
  const handleManualAdaptation = async (triggerType: string) => {
    const now = new Date();
    
    let trigger: RePlanningTrigger;
    
    switch (triggerType) {
      case 'overrun':
        trigger = {
          type: 'overrun',
          timestamp: now,
          context: {
            overrunDuration: 30, // Assume 30 minutes
            currentSchedule,
            remainingTasks: tasks
          }
        };
        break;
        
      case 'energy_low':
        trigger = {
          type: 'energy_change',
          timestamp: now,
          context: {
            energyDrop: 0.4,
            currentEnergy: userEnergyLevel,
            currentSchedule,
            remainingTasks: tasks
          }
        };
        break;

      case 'missed':
        trigger = {
          type: 'missed_block',
          timestamp: now,
          affectedBlockId: getMissedBlockId(now),
          context: {
            currentSchedule,
            remainingTasks: tasks,
            missedTime: now,
          },
        };
        break;
        
      case 'interrupt':
        trigger = {
          type: 'external_interrupt',
          timestamp: now,
          context: {
            estimatedDuration: 60, // Assume 1 hour interrupt
            currentSchedule,
            remainingTasks: tasks
          }
        };
        break;
        
      default:
        return;
    }
    
    await triggerAdaptation(trigger);
  };

  // 🔍 UTILITY FUNCTIONS
  const getCurrentBlock = (time: Date): TimeBlock | null => {
    return currentSchedule.find(block => 
      new Date(block.startTime) <= time && 
      new Date(block.endTime) > time
    ) || null;
  };

  const shouldHaveActiveBlock = (time: Date): boolean => {
    const hour = time.getHours();
    return hour >= 9 && hour < 18; // Working hours
  };

  const getMissedBlockId = (time: Date): string | undefined => {
    const missedBlock = currentSchedule.find(block => 
      new Date(block.startTime) <= time && 
      new Date(block.endTime) > time &&
      block.status === 'planned'
    );
    return missedBlock?.id;
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-emerald-700';
    if (confidence >= 0.6) return 'text-amber-700';
    if (confidence >= 0.3) return 'text-orange-700';
    return 'text-red-700';
  };

  const applyLastProposal = () => {
    if (!state.lastResult || state.lastResult.changes.length === 0) return;
    onScheduleAdapted(state.lastResult.newSchedule, state.lastResult.changes);
    audioManager.buttonFeedback();
  };

  return (
    <div className="space-y-5" data-testid="adapt-plan-v3">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Esecuzione adattiva</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-950">Adatta il piano</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Dichiara cosa è cambiato, verifica il delta e applica soltanto la proposta che vuoi mantenere.
          </p>
        </div>
          
          <button
            type="button"
            onClick={() => setState(prev => ({ ...prev, isActive: !prev.isActive }))}
            className={`min-h-[40px] rounded-xl border px-4 text-sm font-semibold transition-colors ${
              state.isActive 
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${state.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {state.isActive ? 'Monitoraggio attivo' : 'Monitoraggio sospeso'}
          </button>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="adapt-change-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Input</p>
            <h3 id="adapt-change-title" className="mt-1 text-lg font-semibold text-slate-950">Cosa è cambiato?</h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            Energia {Math.round(userEnergyLevel * 100)}%
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdaptTriggerButton icon={<Clock3 size={18} />} label="Sessione più lunga" description="Recupera un overrun" active={disruptions.sessionOverrun} onClick={() => void handleManualAdaptation('overrun')} />
          <AdaptTriggerButton icon={<BatteryLow size={18} />} label="Energia bassa" description="Riduci il carico cognitivo" active={disruptions.energyDrop} onClick={() => void handleManualAdaptation('energy_low')} />
          <AdaptTriggerButton icon={<PauseCircle size={18} />} label="Blocco saltato" description="Ripara il tempo perso" active={disruptions.missedBlock} onClick={() => void handleManualAdaptation('missed')} />
          <AdaptTriggerButton icon={<AlertTriangle size={18} />} label="Interruzione esterna" description="Proteggi il resto del giorno" active={disruptions.externalInterrupt} onClick={() => void handleManualAdaptation('interrupt')} />
        </div>

        {/* PROCESSING INDICATOR */}
        {state.isProcessing && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center space-x-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
              <span className="text-sm font-medium text-blue-900">Calcolo del delta sicuro…</span>
            </div>
          </div>
        )}

        {/* EMERGENCY MODE */}
        {state.emergencyMode && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <AlertTriangle size={18} className="text-red-700" />
                <span className="font-semibold text-red-900">Impatto elevato: verifica ogni modifica</span>
              </div>
              <button
                onClick={() => {
                  setState(prev => ({ ...prev, emergencyMode: false }));
                  onEmergencyMode?.(false, '');
                }}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-800"
              >
                Chiudi
              </button>
            </div>
          </div>
        )}

      </section>

      {/* 🎯 LAST ADAPTATION RESULT */}
      {state.lastResult && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="adapt-proposal-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Preview</p>
              <h3 id="adapt-proposal-title" className="mt-1 text-lg font-semibold text-slate-950">Delta proposto</h3>
            </div>
            <button type="button" onClick={applyLastProposal} disabled={state.lastResult.changes.length === 0} className="lt-button-primary min-h-[42px] px-4 disabled:opacity-50">
              <Check size={16} aria-hidden="true" /> Applica delta
            </button>
          </div>
          
          <div className="my-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <div className="text-2xl font-semibold text-slate-950">{state.lastResult.changes.length}</div>
              <div className="text-sm text-slate-500">Modifiche proposte</div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <div className={`text-2xl font-semibold ${getConfidenceColor(state.lastResult.confidence || 0)}`}>
                {Math.round((state.lastResult.confidence || 0) * 100)}%
              </div>
              <div className="text-sm text-slate-500">Confidenza</div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <div className="truncate text-base font-semibold text-indigo-700">
                {friendlyTrigger(state.lastTrigger?.type)}
              </div>
              <div className="mt-1 text-sm text-slate-500">Evento</div>
            </div>
          </div>
          
          <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="text-sm leading-6 text-blue-950">{state.lastResult.reasoning}</div>
          </div>
          
          {state.lastResult.changes.length > 0 && (
            <details className="rounded-xl border border-slate-200 p-4 text-sm" open>
              <summary className="cursor-pointer font-semibold text-slate-900">
                Keep · Move · Drop · Repair ({state.lastResult.changes.length})
              </summary>
              <div className="mt-2 space-y-2">
                {state.lastResult.changes.slice(0, 5).map((change, index) => (
                  <div key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="font-semibold capitalize text-slate-900">{friendlyChange(change.type)}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-600">{change.reasoning}</div>
                  </div>
                ))}
                {state.lastResult.changes.length > 5 && (
                  <div className="text-xs text-slate-500">
                    Altre {state.lastResult.changes.length - 5} modifiche nella proposta completa
                  </div>
                )}
              </div>
            </details>
          )}
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><ShieldCheck size={14} /> Nessun TimeBlock viene modificato prima di Applica delta.</p>
        </section>
      )}

      {/* ⚙️ ADAPTATION SETTINGS */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <details>
          <summary className="mb-3 flex cursor-pointer items-center gap-2 font-semibold text-slate-900">
            <SlidersHorizontal size={17} /> Regole di adattamento
          </summary>
          
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Prepara automaticamente una Preview</label>
              <button
                onClick={() => setAdaptationSettings(prev => ({ ...prev, autoAdapt: !prev.autoAdapt }))}
                className={`px-3 py-1 rounded text-sm ${
                  adaptationSettings.autoAdapt 
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {adaptationSettings.autoAdapt ? 'Attiva' : 'Disattiva'}
              </button>
            </div>
            
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Strategia</label>
              <select
                value={adaptationSettings.strategy}
                onChange={(e) => setAdaptationSettings(prev => ({ ...prev, strategy: e.target.value as any }))}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              >
                <option value="balanced">Bilanciata</option>
                <option value="save_day">Proteggi la giornata</option>
                <option value="save_goal">Proteggi i Goal</option>
                <option value="save_energy">Proteggi l’energia</option>
                <option value="minimal_change">Cambiamento minimo</option>
              </select>
            </div>
            
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Ampiezza del cambiamento</label>
              <select
                value={adaptationSettings.aggressiveness}
                onChange={(e) => setAdaptationSettings(prev => ({ ...prev, aggressiveness: e.target.value as any }))}
                className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900"
              >
                <option value="conservative">Conservativa</option>
                <option value="moderate">Moderata</option>
                <option value="aggressive">Ampia</option>
              </select>
            </div>
          </div>
        </details>
      </div>

      {/* 📊 ADAPTATION HISTORY */}
      {state.adaptationHistory.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h4 className="mb-3 text-base font-semibold text-slate-950">Preview recenti</h4>
          <div className="space-y-2">
            {state.adaptationHistory.slice(-5).map((adaptation, index) => (
              <div key={index} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500">{adaptation.timestamp.toLocaleTimeString()}</span>
                  <span className="capitalize text-slate-800">{friendlyTrigger(adaptation.trigger)}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-slate-600">{adaptation.changesCount} modifiche</span>
                  <span className={getConfidenceColor(adaptation.confidence)}>
                    {Math.round(adaptation.confidence * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdaptTriggerButton({
  icon,
  label,
  description,
  active,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly description: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[92px] rounded-xl border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
        active
          ? 'border-amber-300 bg-amber-50 text-amber-950'
          : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-indigo-200 hover:bg-indigo-50/40'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">{icon}{label}</span>
      <span className="mt-2 block text-xs leading-5 text-slate-500">{description}</span>
    </button>
  );
}

function friendlyTrigger(value: string | undefined): string {
  const labels: Record<string, string> = {
    overrun: 'Sessione più lunga',
    session_end: 'Fine Sessione',
    energy_change: 'Energia bassa',
    missed_block: 'Blocco saltato',
    external_interrupt: 'Interruzione esterna',
  };
  return value ? labels[value] ?? value.replaceAll('_', ' ') : 'Non specificato';
}

function friendlyChange(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('move') || normalized.includes('reschedul')) return 'Move · Sposta';
  if (normalized.includes('delete') || normalized.includes('drop') || normalized.includes('cancel')) return 'Drop · Rimuovi';
  if (normalized.includes('add') || normalized.includes('repair') || normalized.includes('create')) return 'Repair · Ripara';
  return 'Keep · Mantieni';
}
