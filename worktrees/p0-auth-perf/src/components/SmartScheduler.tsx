'use client';

// ⚡ SMART SCHEDULER COMPONENT - AI-Powered Schedule Optimization
// MODALITÀ PSICOPATICO SUPREMO 🔥🔥🔥

import { useState, useEffect } from 'react';
import { autoScheduler } from '@/lib/autoScheduler';
import { SchedulingConstraints, SchedulingResult, SchedulingConflict, AlternativeSchedule } from '@/types/ai-enhanced';
import { Task, TimeBlock, Goal } from '@/types';
import { audioManager } from '@/lib/audioManager';

interface SmartSchedulerProps {
  tasks: Task[];
  existingTimeBlocks: TimeBlock[];
  goals: Goal[];
  onScheduleGenerated: (schedule: TimeBlock[]) => void;
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
  onScheduleGenerated,
  onTimeBlocksCreated,
  userPreferences = {}
}: SmartSchedulerProps) {
  const [state, setState] = useState<SchedulingState>({
    isGenerating: false,
    result: null,
    selectedAlternative: 0,
    showAdvanced: false,
    constraints: {}
  });

  const [optimizationMode, setOptimizationMode] = useState<'balanced' | 'deadline' | 'energy' | 'goals'>('balanced');
  const [schedulingWindow, setSchedulingWindow] = useState<number>(7); // Days
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

      // 🔥 PSYCHOPATH MODE: Generate optimal schedule
      const result = await autoScheduler.schedule(tasks, constraints);
      
      console.log('⚡ SCHEDULER RESULT:', result);

      setState(prev => ({ 
        ...prev, 
        result, 
        isGenerating: false,
        selectedAlternative: 0 
      }));

      // 🎮 SUCCESS FEEDBACK
      audioManager.perfectDay();
      
      // Auto-apply the primary schedule
      onScheduleGenerated(result.schedule);

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
    if (!state.result?.alternatives[index]) return;
    
    setState(prev => ({ ...prev, selectedAlternative: index }));
    audioManager.buttonFeedback();
    
    const selectedSchedule = index === -1 
      ? state.result!.schedule 
      : state.result!.alternatives[index].schedule;
    
    onScheduleGenerated(selectedSchedule);
  };

  // 📊 SCHEDULE ANALYSIS
  const analyzeScheduleQuality = (schedule: TimeBlock[]): { score: number; insights: string[] } => {
    const insights: string[] = [];
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
      insights.push('🔋 Excellent energy alignment - tasks scheduled during peak hours');
    } else if (energyScore < 0.4) {
      insights.push('⚠️ Poor energy alignment - consider rescheduling for better productivity');
    }

    // Goal alignment analysis
    const goalAlignedBlocks = schedule.filter(block => block.goalIds && block.goalIds.length > 0);
    const goalScore = goalAlignedBlocks.length / schedule.length;
    score += goalScore * 0.15;
    
    if (goalScore > 0.6) {
      insights.push('🎯 Strong goal alignment - most tasks contribute to objectives');
    }

    // Deadline compliance
    const urgentBlocks = schedule.filter(block => {
      const task = tasks.find(t => t.id === block.taskId);
      return task?.dueDate && new Date(task.dueDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    });
    if (urgentBlocks.length > 0) {
      insights.push(`⏰ ${urgentBlocks.length} urgent tasks scheduled within 3 days`);
    }

    // Schedule density
    const totalMinutes = schedule.reduce((sum, block) => {
      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
      return sum + duration / (1000 * 60);
    }, 0);
    const averageBlockSize = totalMinutes / schedule.length;
    
    if (averageBlockSize < 30) {
      insights.push('⚠️ Very short blocks - may increase context switching');
      score -= 0.1;
    } else if (averageBlockSize > 120) {
      insights.push('🔥 Long focus blocks - great for deep work');
      score += 0.1;
    }

    return { score: Math.max(0, Math.min(1, score)), insights };
  };

  const getConflictSeverityColor = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'text-red-400 bg-red-900/20 border-red-400';
      case 'high': return 'text-orange-400 bg-orange-900/20 border-orange-400';
      case 'medium': return 'text-yellow-400 bg-yellow-900/20 border-yellow-400';
      case 'low': return 'text-blue-400 bg-blue-900/20 border-blue-400';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-400';
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Auto-run when tasks change
  useEffect(() => {
    if (tasks.length > 0 && !state.isGenerating) {
      // Auto-generate schedule when tasks are available
      const timer = setTimeout(generateOptimalSchedule, 1000);
      return () => clearTimeout(timer);
    }
  }, [tasks.length]); // Only depend on task count to avoid infinite loops

  return (
    <div className="smart-scheduler space-y-6">
      {/* 🎮 HEADER & CONTROLS */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold holographic-text flex items-center space-x-3">
            <span>⚡</span>
            <span>SMART SCHEDULER</span>
            <span className="text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white px-2 py-1 rounded-full animate-pulse">
              SUPREMO MODE
            </span>
          </h2>
          <p className="text-gray-300 text-sm mt-1">
            AI-powered optimization with constraint-based scheduling
          </p>
        </div>

        <button
          onClick={generateOptimalSchedule}
          disabled={state.isGenerating || tasks.length === 0}
          onMouseEnter={() => audioManager.buttonHover()}
          className="btn-gaming px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {state.isGenerating ? (
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Optimizing...</span>
            </div>
          ) : (
            <span>⚡ Generate Optimal Schedule</span>
          )}
        </button>
      </div>

      {/* 🔧 OPTIMIZATION CONTROLS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <label className="block text-sm font-bold text-cyan-400 mb-2">Optimization Mode</label>
          <select
            value={optimizationMode}
            onChange={(e) => setOptimizationMode(e.target.value as any)}
            className="w-full bg-gray-900 border border-cyan-400/30 rounded text-white p-2"
          >
            <option value="balanced">🎯 Balanced</option>
            <option value="deadline">⏰ Deadline-Focused</option>
            <option value="energy">⚡ Energy-Optimized</option>
            <option value="goals">🎖️ Goal-Aligned</option>
          </select>
        </div>

        <div className="glass-card p-4">
          <label className="block text-sm font-bold text-cyan-400 mb-2">Scheduling Window</label>
          <select
            value={schedulingWindow}
            onChange={(e) => setSchedulingWindow(Number(e.target.value))}
            className="w-full bg-gray-900 border border-cyan-400/30 rounded text-white p-2"
          >
            <option value={3}>3 Days</option>
            <option value={7}>1 Week</option>
            <option value={14}>2 Weeks</option>
            <option value={30}>1 Month</option>
          </select>
        </div>

        <div className="glass-card p-4">
          <label className="block text-sm font-bold text-cyan-400 mb-2">Working Hours</label>
          <div className="flex space-x-2">
            <input
              type="time"
              value={workingHours.start}
              onChange={(e) => setWorkingHours(prev => ({ ...prev, start: e.target.value }))}
              className="flex-1 bg-gray-900 border border-cyan-400/30 rounded text-white p-2"
            />
            <input
              type="time"
              value={workingHours.end}
              onChange={(e) => setWorkingHours(prev => ({ ...prev, end: e.target.value }))}
              className="flex-1 bg-gray-900 border border-cyan-400/30 rounded text-white p-2"
            />
          </div>
        </div>
      </div>

      {/* 📊 SCHEDULING RESULT */}
      {state.result && (
        <div className="space-y-6">
          {/* PRIMARY SCHEDULE */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold neon-text">Generated Schedule</h3>
              <div className="flex items-center space-x-4">
                <div className={`text-sm font-mono ${getConfidenceColor(state.result.confidence)}`}>
                  {Math.round(state.result.confidence * 100)}% confidence
                </div>
                <button
                  onClick={() => onTimeBlocksCreated?.(state.result!.schedule)}
                  onMouseEnter={() => audioManager.buttonHover()}
                  className="btn-gaming px-4 py-2 text-sm bg-gradient-to-r from-green-600 to-green-700"
                >
                  ✅ Apply Schedule
                </button>
              </div>
            </div>

            {/* SCHEDULE OVERVIEW */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-900/20 border border-blue-400/30 rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-400">{state.result.schedule.length}</div>
                <div className="text-sm text-gray-300">Time Blocks</div>
              </div>
              <div className="bg-green-900/20 border border-green-400/30 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-400">
                  {Math.round(
                    state.result.schedule.reduce((sum, block) => {
                      const duration = new Date(block.endTime).getTime() - new Date(block.startTime).getTime();
                      return sum + duration / (1000 * 60 * 60);
                    }, 0) * 10
                  ) / 10}h
                </div>
                <div className="text-sm text-gray-300">Total Time</div>
              </div>
              <div className="bg-purple-900/20 border border-purple-400/30 rounded-lg p-4">
                <div className="text-2xl font-bold text-purple-400">{state.result.conflicts.length}</div>
                <div className="text-sm text-gray-300">Conflicts</div>
              </div>
            </div>

            {/* SCHEDULE QUALITY ANALYSIS */}
            {(() => {
              const analysis = analyzeScheduleQuality(state.result.schedule);
              return (
                <div className="bg-gray-900/50 border border-gray-600/30 rounded-lg p-4 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-bold text-cyan-400">Schedule Quality Analysis</h4>
                    <div className="flex items-center space-x-2">
                      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500"
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
                      <div key={index} className="text-sm text-gray-300">
                        {insight}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* REASONING */}
            <div className="bg-blue-900/10 border border-blue-400/20 rounded-lg p-4 mb-4">
              <h4 className="font-bold text-blue-400 mb-2">🧠 AI Reasoning</h4>
              <p className="text-gray-300 text-sm">{state.result.reasoning}</p>
            </div>

            {/* CONFLICTS */}
            {state.result.conflicts.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-bold text-red-400">⚠️ Scheduling Conflicts</h4>
                {state.result.conflicts.map((conflict, index) => (
                  <div key={index} className={`border rounded-lg p-3 ${getConflictSeverityColor(conflict.severity)}`}>
                    <div className="font-medium">{conflict.description}</div>
                    <div className="text-sm mt-2 space-y-1">
                      <div className="font-medium">Suggestions:</div>
                      {conflict.suggestions.map((suggestion, i) => (
                        <div key={i} className="text-sm opacity-90">• {suggestion}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ALTERNATIVE SCHEDULES */}
          {state.result.alternatives.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-xl font-bold neon-text mb-4">Alternative Schedules</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {state.result.alternatives.map((alt, index) => (
                  <div 
                    key={index}
                    className={`border rounded-lg p-4 cursor-pointer transition-all duration-300 ${
                      state.selectedAlternative === index
                        ? 'border-cyan-400 bg-cyan-900/20'
                        : 'border-gray-600/30 hover:border-cyan-400/50'
                    }`}
                    onClick={() => selectAlternative(index)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-cyan-400">{alt.name}</h4>
                      <div className={`text-sm ${getConfidenceColor(alt.confidence)}`}>
                        {Math.round(alt.confidence * 100)}%
                      </div>
                    </div>
                    <p className="text-gray-300 text-sm mb-3">{alt.description}</p>
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-gray-400">Tradeoffs:</div>
                      {alt.tradeoffs.map((tradeoff, i) => (
                        <div key={i} className="text-xs text-gray-400">• {tradeoff}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 📈 STATISTICS */}
      {tasks.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold neon-text mb-4">📈 Scheduling Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{tasks.length}</div>
              <div className="text-sm text-gray-400">Tasks to Schedule</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">
                {Math.round(tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 60), 0) / 60 * 10) / 10}h
              </div>
              <div className="text-sm text-gray-400">Total Work</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">
                {tasks.filter(t => t.dueDate).length}
              </div>
              <div className="text-sm text-gray-400">With Deadlines</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400">
                {tasks.filter(t => t.priority === 'high').length}
              </div>
              <div className="text-sm text-gray-400">High Priority</div>
            </div>
          </div>
        </div>
      )}

      {/* 💡 HELP & TIPS */}
      <div className="glass-card p-4">
        <details className="text-sm">
          <summary className="cursor-pointer font-bold text-cyan-400 hover:text-cyan-300">
            💡 Smart Scheduling Tips
          </summary>
          <div className="mt-3 space-y-2 text-gray-300">
            <p>• <strong>Balanced Mode:</strong> Considers all factors equally for optimal overall schedule</p>
            <p>• <strong>Deadline-Focused:</strong> Prioritizes urgent tasks and deadline compliance</p>
            <p>• <strong>Energy-Optimized:</strong> Schedules demanding tasks during your peak energy hours</p>
            <p>• <strong>Goal-Aligned:</strong> Groups related tasks for focused progress on objectives</p>
            <p>• Longer scheduling windows provide more optimization opportunities but may feel less immediate</p>
            <p>• The AI considers your energy patterns, task complexity, and contextual constraints automatically</p>
          </div>
        </details>
      </div>
    </div>
  );
}