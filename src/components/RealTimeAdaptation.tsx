'use client';

// 🔄 REAL-TIME ADAPTATION COMPONENT - Dynamic Schedule Intelligence
// MODALITÀ PSICOPATICO ESTREMO 🔥🔥🔥🔥

import { useState, useEffect, useRef } from 'react';
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
        strategy: adaptationSettings.strategy,
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
            confidence: result.confidence || 0,
            changesCount: result.changes.length
          }
        ]
      }));

      // 🎮 PROVIDE FEEDBACK
      provideFeedbackToUser(result, trigger);

      // 🚨 CHECK FOR EMERGENCY MODE
      if (result.confidence < 0.3 || trigger.type === 'external_interrupt') {
        setState(prev => ({ ...prev, emergencyMode: true }));
        onEmergencyMode?.(true, `Low confidence adaptation: ${result.reasoning}`);
      }

      // 📡 APPLY CHANGES
      if (result.changes.length > 0) {
        onScheduleAdapted(result.newSchedule, result.changes);
      }

    } catch (error) {
      console.error('🔄 ADAPTATION ERROR:', error);
      setState(prev => ({ ...prev, isProcessing: false }));
      audioManager.play('error');
    }
  };

  // 🎮 USER FEEDBACK SYSTEM
  const provideFeedbackToUser = (result: RePlanningResult, trigger: RePlanningTrigger) => {
    // Audio feedback
    if (result.confidence > 0.8) {
      audioManager.perfectDay();
    } else if (result.confidence > 0.6) {
      audioManager.taskCompleted();
    } else if (result.confidence > 0.3) {
      audioManager.buttonFeedback();
    } else {
      audioManager.play('error');
    }

    // Visual notification could be added here
    console.log(`🔄 ADAPTATION: ${trigger.type} → ${result.changes.length} changes (${Math.round((result.confidence || 0) * 100)}% confidence)`);
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

  const getDisruptionColor = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'text-red-400 bg-red-900/20 border-red-400';
      case 'high': return 'text-orange-400 bg-orange-900/20 border-orange-400';
      case 'medium': return 'text-yellow-400 bg-yellow-900/20 border-yellow-400';
      case 'low': return 'text-green-400 bg-green-900/20 border-green-400';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-400';
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    if (confidence >= 0.3) return 'text-orange-400';
    return 'text-red-400';
  };

  return (
    <div className="real-time-adaptation space-y-4">
      {/* 🔄 ADAPTATION STATUS */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-bold holographic-text">🔄 Real-Time Adaptation</h3>
            <div className={`w-3 h-3 rounded-full ${state.isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
          </div>
          
          <button
            onClick={() => setState(prev => ({ ...prev, isActive: !prev.isActive }))}
            onMouseEnter={() => audioManager.buttonHover()}
            className={`btn-gaming text-sm px-4 py-2 ${
              state.isActive 
                ? 'bg-gradient-to-r from-green-600 to-green-700' 
                : 'bg-gradient-to-r from-gray-600 to-gray-700'
            }`}
          >
            {state.isActive ? '🟢 Active' : '⚪ Inactive'}
          </button>
        </div>

        {/* PROCESSING INDICATOR */}
        {state.isProcessing && (
          <div className="mb-4 p-3 border border-cyan-400/30 rounded-lg bg-cyan-900/10">
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-cyan-400 font-medium">Processing adaptation...</span>
            </div>
          </div>
        )}

        {/* EMERGENCY MODE */}
        {state.emergencyMode && (
          <div className="mb-4 p-3 border border-red-400 rounded-lg bg-red-900/20 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">🚨</span>
                <span className="text-red-400 font-bold">EMERGENCY MODE ACTIVE</span>
              </div>
              <button
                onClick={() => {
                  setState(prev => ({ ...prev, emergencyMode: false }));
                  onEmergencyMode?.(false, '');
                }}
                className="btn-gaming text-xs px-3 py-1 bg-red-600"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* CURRENT DISRUPTIONS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={`p-3 border rounded-lg text-center ${
            disruptions.sessionOverrun 
              ? getDisruptionColor('medium') 
              : 'border-gray-600/30 text-gray-400'
          }`}>
            <div className="text-lg">⏰</div>
            <div className="text-xs">Session Overrun</div>
          </div>
          
          <div className={`p-3 border rounded-lg text-center ${
            disruptions.energyDrop 
              ? getDisruptionColor('high') 
              : 'border-gray-600/30 text-gray-400'
          }`}>
            <div className="text-lg">⚡</div>
            <div className="text-xs">Energy Drop</div>
          </div>
          
          <div className={`p-3 border rounded-lg text-center ${
            disruptions.missedBlock 
              ? getDisruptionColor('high') 
              : 'border-gray-600/30 text-gray-400'
          }`}>
            <div className="text-lg">📅</div>
            <div className="text-xs">Missed Block</div>
          </div>
          
          <div className={`p-3 border rounded-lg text-center ${
            disruptions.externalInterrupt 
              ? getDisruptionColor('critical') 
              : 'border-gray-600/30 text-gray-400'
          }`}>
            <div className="text-lg">⚠️</div>
            <div className="text-xs">External Interrupt</div>
          </div>
        </div>
      </div>

      {/* 🎯 LAST ADAPTATION RESULT */}
      {state.lastResult && (
        <div className="glass-card p-4">
          <h4 className="font-bold text-cyan-400 mb-3">📊 Last Adaptation</h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400">{state.lastResult.changes.length}</div>
              <div className="text-sm text-gray-400">Changes Made</div>
            </div>
            
            <div className="text-center">
              <div className={`text-2xl font-bold ${getConfidenceColor(state.lastResult.confidence || 0)}`}>
                {Math.round((state.lastResult.confidence || 0) * 100)}%
              </div>
              <div className="text-sm text-gray-400">Confidence</div>
            </div>
            
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">
                {state.lastTrigger?.type || 'unknown'}
              </div>
              <div className="text-sm text-gray-400">Trigger</div>
            </div>
          </div>
          
          <div className="bg-gray-900/50 border border-gray-600/30 rounded-lg p-3 mb-4">
            <div className="text-sm text-gray-300">{state.lastResult.reasoning}</div>
          </div>
          
          {state.lastResult.changes.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-cyan-400 hover:text-cyan-300">
                View Changes ({state.lastResult.changes.length})
              </summary>
              <div className="mt-2 space-y-2">
                {state.lastResult.changes.slice(0, 5).map((change, index) => (
                  <div key={index} className="bg-gray-800/50 rounded p-2">
                    <div className="font-medium text-yellow-400 capitalize">{change.type}</div>
                    <div className="text-gray-300 text-xs">{change.reasoning}</div>
                  </div>
                ))}
                {state.lastResult.changes.length > 5 && (
                  <div className="text-gray-400 text-xs">
                    ... and {state.lastResult.changes.length - 5} more changes
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ⚙️ ADAPTATION SETTINGS */}
      <div className="glass-card p-4">
        <details>
          <summary className="cursor-pointer font-bold text-cyan-400 hover:text-cyan-300 mb-3">
            ⚙️ Adaptation Settings
          </summary>
          
          <div className="space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-300">Auto-Adaptation</label>
              <button
                onClick={() => setAdaptationSettings(prev => ({ ...prev, autoAdapt: !prev.autoAdapt }))}
                className={`px-3 py-1 rounded text-sm ${
                  adaptationSettings.autoAdapt 
                    ? 'bg-green-600 text-white' 
                    : 'bg-gray-600 text-gray-300'
                }`}
              >
                {adaptationSettings.autoAdapt ? 'ON' : 'OFF'}
              </button>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Strategy</label>
              <select
                value={adaptationSettings.strategy}
                onChange={(e) => setAdaptationSettings(prev => ({ ...prev, strategy: e.target.value as any }))}
                className="w-full bg-gray-900 border border-gray-600 rounded text-white p-2"
              >
                <option value="balanced">🎯 Balanced</option>
                <option value="save_day">💼 Save the Day</option>
                <option value="save_goal">🎖️ Save Goals</option>
                <option value="save_energy">⚡ Save Energy</option>
                <option value="minimal_change">🔧 Minimal Change</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Aggressiveness</label>
              <select
                value={adaptationSettings.aggressiveness}
                onChange={(e) => setAdaptationSettings(prev => ({ ...prev, aggressiveness: e.target.value as any }))}
                className="w-full bg-gray-900 border border-gray-600 rounded text-white p-2"
              >
                <option value="conservative">🐌 Conservative</option>
                <option value="moderate">⚖️ Moderate</option>
                <option value="aggressive">🚀 Aggressive</option>
              </select>
            </div>
          </div>
        </details>
      </div>

      {/* 🎮 MANUAL TRIGGERS */}
      <div className="glass-card p-4">
        <h4 className="font-bold text-cyan-400 mb-3">🎮 Manual Adaptation Triggers</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => handleManualAdaptation('overrun')}
            onMouseEnter={() => audioManager.buttonHover()}
            className="btn-gaming px-4 py-2 text-sm bg-gradient-to-r from-orange-600 to-red-600"
          >
            ⏰ Session Overrun
          </button>
          
          <button
            onClick={() => handleManualAdaptation('energy_low')}
            onMouseEnter={() => audioManager.buttonHover()}
            className="btn-gaming px-4 py-2 text-sm bg-gradient-to-r from-yellow-600 to-orange-600"
          >
            ⚡ Low Energy
          </button>
          
          <button
            onClick={() => handleManualAdaptation('interrupt')}
            onMouseEnter={() => audioManager.buttonHover()}
            className="btn-gaming px-4 py-2 text-sm bg-gradient-to-r from-red-600 to-pink-600"
          >
            ⚠️ External Interrupt
          </button>
        </div>
      </div>

      {/* 📊 ADAPTATION HISTORY */}
      {state.adaptationHistory.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="font-bold text-cyan-400 mb-3">📊 Recent Adaptations</h4>
          <div className="space-y-2">
            {state.adaptationHistory.slice(-5).map((adaptation, index) => (
              <div key={index} className="flex items-center justify-between text-sm bg-gray-800/30 rounded p-2">
                <div className="flex items-center space-x-2">
                  <span className="text-gray-400">{adaptation.timestamp.toLocaleTimeString()}</span>
                  <span className="text-cyan-400 capitalize">{adaptation.trigger}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-yellow-400">{adaptation.changesCount} changes</span>
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