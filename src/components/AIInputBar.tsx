'use client';

// 🧠 AI INPUT BAR - Natural Language Interface
// MODALITÀ PSICOPATICO CERTOSINO 🔥

import { useState, useRef, useEffect } from 'react';
import { aiParser } from '@/lib/aiEngine';
import { NLParseRequest, NLParseResult, ParsedItem } from '@/types/ai-enhanced';
import { TimeBlock, Task, Goal, Habit } from '@/types';
import { audioManager } from '@/lib/audioManager';

interface AIInputBarProps {
  onCreateTimeBlock?: (block: Partial<TimeBlock>) => void;
  onCreateTask?: (task: Partial<Task>) => void;
  onCreateGoal?: (goal: Partial<Goal>) => void;
  onCreateHabit?: (habit: Partial<Habit>) => void;
  goals?: Goal[];
  existingTasks?: Task[];
  userPreferences?: any;
  className?: string;
}

interface ProcessingState {
  isProcessing: boolean;
  confidence: number;
  preview: string;
}

export default function AIInputBar({
  onCreateTimeBlock,
  onCreateTask,
  onCreateGoal,
  onCreateHabit,
  goals = [],
  existingTasks = [],
  userPreferences = {},
  className = ''
}: AIInputBarProps) {
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState<ProcessingState>({
    isProcessing: false,
    confidence: 0,
    preview: ''
  });
  const [lastResult, setLastResult] = useState<NLParseResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [suggestions] = useState([
    "Plan 2 hours of deep work tomorrow 9-11am",
    "Add daily meditation habit at 7am for 10 minutes",
    "Goal: Complete project by Friday",
    "Task: Review quarterly report in 30 minutes",
    "Schedule lunch meeting with team at 1pm",
    "Create workout routine 3x per week"
  ]);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus on mount
    inputRef.current?.focus();
  }, []);

  // 🧠 REAL-TIME PROCESSING
  useEffect(() => {
    if (input.length < 3) {
      setProcessing({ isProcessing: false, confidence: 0, preview: '' });
      setShowPreview(false);
      return;
    }

    const debounceTimer = setTimeout(async () => {
      await processInput(input, true);
    }, 500);

    return () => clearTimeout(debounceTimer);
  }, [input]);

  const processInput = async (inputText: string, isPreview: boolean = false) => {
    if (!inputText.trim()) return;

    try {
      setProcessing({ isProcessing: true, confidence: 0, preview: '' });

      const request: NLParseRequest = {
        input: inputText,
        context: {
          currentDate: new Date(),
          activeGoals: goals.filter(g => g.status === 'active'),
          existingTasks,
          userPreferences
        }
      };

      console.log('🧠 AI INPUT: Processing:', request);
      
      const result = await aiParser.parse(request);
      setLastResult(result);

      console.log('🧠 AI INPUT: Result:', result);

      if (isPreview) {
        // Update preview
        const preview = generatePreview(result);
        setProcessing({
          isProcessing: false,
          confidence: result.confidence,
          preview
        });
        setShowPreview(result.parsedItems.length > 0);
      } else {
        // Execute the parsed items
        await executeResult(result);
        setInput('');
        setShowPreview(false);
        setProcessing({ isProcessing: false, confidence: 0, preview: '' });
        
        // 🎮 SUCCESS SOUND
        audioManager.taskCompleted();
      }

    } catch (error) {
      console.error('🧠 AI INPUT ERROR:', error);
      setProcessing({
        isProcessing: false,
        confidence: 0,
        preview: 'Error processing input'
      });
      
      // 🎮 ERROR SOUND
      audioManager.play('error');
    }
  };

  const generatePreview = (result: NLParseResult): string => {
    if (result.parsedItems.length === 0) return 'No items detected';

    const previews = result.parsedItems.map(item => {
      switch (item.type) {
        case 'task':
          const task = item.data as any;
          return `📋 Task: "${task.title}" (${task.estimatedDuration || '?'}min, ${task.priority} priority)`;
        case 'timeblock':
          const block = item.data as any;
          return `⏰ Time Block: ${block.startTime ? new Date(block.startTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '?'} - ${block.endTime ? new Date(block.endTime).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '?'}`;
        case 'goal':
          const goal = item.data as any;
          return `🎯 Goal: "${goal.title}" (${goal.priority} priority)`;
        case 'habit':
          const habit = item.data as any;
          return `🔥 Habit: "${habit.title}" (${habit.frequency})`;
        default:
          return `Unknown item: ${item.type}`;
      }
    });

    return previews.join(' • ');
  };

  const executeResult = async (result: NLParseResult) => {
    console.log('🧠 AI EXECUTE: Processing', result.parsedItems.length, 'items');

    for (const item of result.parsedItems) {
      try {
        switch (item.type) {
          case 'task':
            if (onCreateTask) {
              const taskData = item.data as any;
              console.log('🧠 Creating task:', taskData);
              await onCreateTask({
                id: `task-ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: taskData.title,
                description: `Created by AI from: "${result.rawInput}"`,
                estimatedMinutes: taskData.estimatedDuration || 60,
                priority: taskData.priority,
                status: 'pending',
                userId: 'user-1',
                projectId: undefined,
                goalId: taskData.goalId,
                tags: taskData.context || [],
                createdAt: new Date(),
                updatedAt: new Date(),
                dueDate: taskData.deadline
              });
            }
            break;

          case 'timeblock':
            if (onCreateTimeBlock) {
              const blockData = item.data as any;
              console.log('🧠 Creating time block:', blockData);
              await onCreateTimeBlock({
                title: `AI Block from: ${result.rawInput.substring(0, 50)}...`,
                description: `Auto-created from: "${result.rawInput}"`,
                startTime: blockData.startTime,
                endTime: blockData.endTime,
                type: blockData.type || 'work',
                status: 'planned',
                userId: 'user-1',
                domainId: 'domain-1'
              });
            }
            break;

          case 'goal':
            if (onCreateGoal) {
              const goalData = item.data as any;
              console.log('🧠 Creating goal:', goalData);
              await onCreateGoal({
                id: `goal-ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: goalData.title,
                description: `AI-generated goal from: "${result.rawInput}"`,
                category: goalData.category || 'general',
                priority: goalData.priority,
                status: 'active',
                userId: 'user-1',
                targetDate: goalData.deadline || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
                createdAt: new Date(),
                updatedAt: new Date()
              });
            }
            break;

          case 'habit':
            if (onCreateHabit) {
              const habitData = item.data as any;
              console.log('🧠 Creating habit:', habitData);
              await onCreateHabit({
                id: `habit-ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: habitData.title,
                description: `AI habit from: "${result.rawInput}"`,
                // category: habitData.category || 'general', // Not in schema
                frequency: habitData.frequency || 'daily',
                targetValue: 1,
                unit: 'completion',
                userId: 'user-1',
                isActive: true,
                streakCount: 0,
                bestStreak: 0,
                // timeOfDay: habitData.timeOfDay, // Not in schema
                // estimatedDuration: habitData.estimatedDuration, // Not in schema
                createdAt: new Date(),
                updatedAt: new Date()
              });
            }
            break;
        }
      } catch (error) {
        console.error('🧠 AI EXECUTE ERROR for', item.type, ':', error);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || processing.isProcessing) return;

    await processInput(input, false);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    audioManager.buttonFeedback();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setInput('');
      setShowPreview(false);
      audioManager.buttonFeedback();
    }
    
    if (e.key === 'Tab' && showPreview && lastResult?.parsedItems.length) {
      e.preventDefault();
      // Auto-complete with first suggestion
      const firstItem = lastResult.parsedItems[0];
      if (firstItem.type === 'task') {
        const task = firstItem.data as any;
        setInput(task.title);
      }
    }
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-400 border-green-400';
    if (confidence >= 0.6) return 'text-yellow-400 border-yellow-400';
    if (confidence >= 0.4) return 'text-orange-400 border-orange-400';
    return 'text-red-400 border-red-400';
  };

  return (
    <div className={`ai-input-bar ${className}`}>
      {/* Main Input */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative">
          <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-2xl">
            🧠
          </div>
          
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell me what you want to do... (e.g., 'Plan 2 hours of deep work tomorrow 9-11am')"
            className="w-full pl-16 pr-32 py-4 bg-gradient-to-r from-gray-900 to-gray-800 border-2 border-cyan-400/30 rounded-xl text-white text-lg placeholder-gray-400 focus:border-cyan-400 focus:outline-none transition-all duration-300 font-mono"
            disabled={processing.isProcessing}
          />

          {/* Confidence Indicator */}
          {input.length > 2 && (
            <div className={`absolute right-20 top-1/2 transform -translate-y-1/2 px-3 py-1 rounded-full text-xs border ${getConfidenceColor(processing.confidence)} bg-black/50`}>
              {processing.isProcessing ? (
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"></div>
                  <span>Processing...</span>
                </div>
              ) : (
                <span>{Math.round(processing.confidence * 100)}% confidence</span>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!input.trim() || processing.isProcessing}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 font-bold text-sm"
            onMouseEnter={() => audioManager.buttonHover()}
            onClick={() => audioManager.buttonFeedback()}
          >
            {processing.isProcessing ? '🧠' : '🚀'}
          </button>
        </div>

        {/* Live Preview */}
        {showPreview && processing.preview && (
          <div className="mt-3 p-4 bg-gradient-to-r from-green-900/20 to-blue-900/20 border border-cyan-400/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider">
                🎯 AI Preview
              </span>
              <span className={`text-xs ${getConfidenceColor(processing.confidence)}`}>
                {Math.round(processing.confidence * 100)}% confidence
              </span>
            </div>
            <div className="text-sm text-gray-300">
              {processing.preview}
            </div>
            {lastResult?.clarificationNeeded && lastResult.clarificationNeeded.length > 0 && (
              <div className="mt-2 text-xs text-yellow-400">
                ⚠️ {lastResult.clarificationNeeded.length} clarification(s) needed after creation
              </div>
            )}
          </div>
        )}
      </form>

      {/* Suggestions */}
      {input.length === 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">
            🎯 Try these examples:
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion)}
                onMouseEnter={() => audioManager.buttonHover()}
                className="text-left p-3 bg-gray-800/50 border border-gray-600/30 rounded-lg text-sm text-gray-300 hover:bg-gray-700/50 hover:border-cyan-400/30 transition-all duration-300 group"
              >
                <span className="group-hover:text-cyan-300 transition-colors">
                  {suggestion}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="mt-4 text-xs text-gray-500 text-center">
        💡 Use natural language like "Plan 2 hours work tomorrow 9am" • ESC to clear • TAB to autocomplete
      </div>

      {/* Debug Info (Development) */}
      {process.env.NODE_ENV === 'development' && lastResult && (
        <details className="mt-4 p-3 bg-gray-900 border border-gray-700 rounded text-xs">
          <summary className="cursor-pointer text-gray-400">🔧 Debug Info</summary>
          <pre className="mt-2 text-gray-500 overflow-auto">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}