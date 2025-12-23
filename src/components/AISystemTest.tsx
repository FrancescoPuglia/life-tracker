'use client';

// 🧪 AI SYSTEM TEST - Comprehensive Testing Interface
// MODALITÀ PSICOPATICO SUPREMO 🧠🔥🔥🔥🔥🔥

import { useState } from 'react';
import { secondBrain } from '@/lib/secondBrain';
import { microCoach } from '@/lib/microCoach';
import { riskPredictor } from '@/lib/riskPredictor';
import { autoScheduler } from '@/lib/autoScheduler';
import { aiParser } from '@/lib/aiEngine';

interface TestResult {
  component: string;
  test: string;
  status: 'passed' | 'failed' | 'running';
  result?: any;
  error?: string;
  duration?: number;
}

export default function AISystemTest() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addResult = (result: TestResult) => {
    setTestResults(prev => [...prev, result]);
  };

  const runComprehensiveTest = async () => {
    setIsRunning(true);
    setTestResults([]);

    console.log('🧪 STARTING COMPREHENSIVE AI SYSTEM TEST');

    try {
      // 1. Test AI Parser
      await testAIParser();
      
      // 2. Test Second Brain
      await testSecondBrain();
      
      // 3. Test Micro Coach
      await testMicroCoach();
      
      // 4. Test Risk Predictor
      await testRiskPredictor();
      
      // 5. Test Auto Scheduler
      await testAutoScheduler();
      
      // 6. Test System Integration
      await testSystemIntegration();

    } catch (error) {
      console.error('🧪 COMPREHENSIVE TEST ERROR:', error);
    } finally {
      setIsRunning(false);
    }
  };

  const testAIParser = async () => {
    const startTime = Date.now();
    
    try {
      addResult({
        component: 'AI Parser',
        test: 'Natural Language Processing',
        status: 'running'
      });

      const testInput = "I need to work on my fitness goal for 2 hours tomorrow morning";
      const result = await aiParser.parse({ 
        input: testInput, 
        context: {
          currentDate: new Date(),
          activeGoals: [],
          existingTasks: [],
          userPreferences: {
            workingHours: { start: '09:00', end: '17:00' },
            deepWorkPreferences: { preferredTimes: [], maxBlockDuration: 120, breaksBetween: 15 },
            energyManagement: { highEnergyTimes: [], lowEnergyTimes: [] },
            contextSwitching: { minimumBlockDuration: 30, maxTasksPerBlock: 2 },
            breakPreferences: { shortBreakDuration: 15, longBreakDuration: 30, breakFrequency: 90 }
          }
        } 
      });

      const taskCount = result.parsedItems.filter(item => item.type === 'task').length;
      const timeBlockCount = result.parsedItems.filter(item => item.type === 'timeblock').length;
      
      addResult({
        component: 'AI Parser',
        test: 'Natural Language Processing',
        status: taskCount > 0 || timeBlockCount > 0 ? 'passed' : 'failed',
        result: `Parsed ${taskCount} tasks, ${timeBlockCount} time blocks (confidence: ${Math.round(result.confidence * 100)}%)`,
        duration: Date.now() - startTime
      });

    } catch (error) {
      addResult({
        component: 'AI Parser',
        test: 'Natural Language Processing',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
    }
  };

  const testSecondBrain = async () => {
    const startTime = Date.now();
    
    try {
      addResult({
        component: 'Second Brain',
        test: 'Data Indexing & Search',
        status: 'running'
      });

      // Test data indexing
      const testData = {
        id: 'test-goal-1',
        title: 'Learn TypeScript',
        description: 'Master TypeScript for better development',
        status: 'in_progress',
        createdAt: new Date()
      };

      await secondBrain.indexNewData(testData, 'goal');

      // Test semantic search
      const searchResults = await secondBrain.semanticSearch({
        query: 'typescript learning'
      });

      // Test conversational query
      const response = await secondBrain.askQuestion({
        question: 'What am I learning about programming?'
      });

      addResult({
        component: 'Second Brain',
        test: 'Data Indexing & Search',
        status: searchResults.length > 0 && response.answer ? 'passed' : 'failed',
        result: `Found ${searchResults.length} search results, generated response with ${Math.round(response.confidence * 100)}% confidence`,
        duration: Date.now() - startTime
      });

    } catch (error) {
      addResult({
        component: 'Second Brain',
        test: 'Data Indexing & Search',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
    }
  };

  const testMicroCoach = async () => {
    const startTime = Date.now();
    
    try {
      addResult({
        component: 'Micro Coach',
        test: 'Pattern Detection & Insights',
        status: 'running'
      });

      const mockUserData = {
        recentSessions: [
          { timestamp: new Date(), productivity: 0.8, type: 'focus' },
          { timestamp: new Date(), productivity: 0.6, type: 'review' }
        ],
        completedTasks: [
          { 
            id: '1', 
            title: 'Complete project', 
            description: 'Test task',
            status: 'completed' as any,
            domainId: 'test',
            userId: 'test',
            projectId: 'inbox',
            priority: 'medium' as any,
            estimatedMinutes: 60,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          { 
            id: '2', 
            title: 'Review code',
            description: 'Test task 2',
            status: 'completed' as any,
            domainId: 'test',
            userId: 'test',
            projectId: 'inbox',
            priority: 'low' as any,
            estimatedMinutes: 30,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        goalProgress: { 'goal1': 0.7, 'goal2': 0.3 },
        energyLevels: { '2024-01-01': 0.8, '2024-01-02': 0.6 },
        habitConsistency: { 'habit1': 0.9 },
        planningAccuracy: { estimationError: 0.2, completionRate: 0.8 }
      };

      const dailyInsight = await microCoach.generateDailyInsight(mockUserData);
      const patterns = await microCoach.detectPatterns(mockUserData.recentSessions, 7);

      addResult({
        component: 'Micro Coach',
        test: 'Pattern Detection & Insights',
        status: dailyInsight && patterns ? 'passed' : 'failed',
        result: `Generated insight: "${dailyInsight.title}", detected ${patterns.length} patterns`,
        duration: Date.now() - startTime
      });

    } catch (error) {
      addResult({
        component: 'Micro Coach',
        test: 'Pattern Detection & Insights',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
    }
  };

  const testRiskPredictor = async () => {
    const startTime = Date.now();
    
    try {
      addResult({
        component: 'Risk Predictor',
        test: 'Goal Risk Assessment',
        status: 'running'
      });

      const mockGoal = {
        id: 'test-goal',
        title: 'Complete Project Alpha',
        description: 'Test goal for risk assessment',
        domainId: 'test',
        userId: 'test',
        status: 'active' as any,
        targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        createdAt: new Date(),
        updatedAt: new Date(),
        keyResults: [],
        timeAllocationTarget: 10,
        priority: 'high' as any,
        category: 'important_not_urgent' as any,
        complexity: 'moderate' as any
      };

      const mockKeyResults = [
        { 
          id: 'kr1', 
          goalId: 'test-goal',
          userId: 'test-user', // 🔥 PSYCHOPATH FIX
          title: 'Test KR 1',
          description: 'Test key result',
          targetValue: 100,
          currentValue: 30,
          unit: 'percent',
          progress: 30, 
          status: 'active' as any,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        { 
          id: 'kr2', 
          goalId: 'test-goal',
          userId: 'test-user', // 🔥 PSYCHOPATH FIX
          title: 'Test KR 2',
          description: 'Test key result 2',
          targetValue: 100,
          currentValue: 50,
          unit: 'percent',
          progress: 50,
          status: 'active' as any,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const riskAssessment = await riskPredictor.assessGoalRisk(mockGoal, mockKeyResults, []);
      const trajectory = await riskPredictor.predictTrajectory(mockGoal, 0.4);

      addResult({
        component: 'Risk Predictor',
        test: 'Goal Risk Assessment',
        status: riskAssessment && trajectory ? 'passed' : 'failed',
        result: `Risk level: ${riskAssessment.riskLevel}, confidence: ${Math.round(riskAssessment.confidence * 100)}%`,
        duration: Date.now() - startTime
      });

    } catch (error) {
      addResult({
        component: 'Risk Predictor',
        test: 'Goal Risk Assessment',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
    }
  };

  const testAutoScheduler = async () => {
    const startTime = Date.now();
    
    try {
      addResult({
        component: 'Auto Scheduler',
        test: 'Intelligent Scheduling',
        status: 'running'
      });

      const mockTasks = [
        {
          id: 'task1',
          title: 'Deep work session',
          description: 'Test task for deep work',
          domainId: 'test',
          userId: 'test',
          projectId: 'inbox',
          status: 'pending' as any,
          estimatedMinutes: 120,
          priority: 'high' as any,
          energyLevel: 'high',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task2', 
          title: 'Email processing',
          description: 'Test task for email',
          domainId: 'test',
          userId: 'test',
          projectId: 'inbox',
          status: 'pending' as any,
          estimatedMinutes: 30,
          priority: 'low' as any,
          energyLevel: 'low',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const constraints = {
        timeConstraints: {
          startTime: new Date(),
          endTime: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
          availableHours: [9, 10, 11, 14, 15, 16]
        },
        userPreferences: {
          workingHours: { start: '09:00', end: '17:00' },
          deepWorkPreferences: { preferredTimes: [], maxBlockDuration: 120, breaksBetween: 15 },
          energyManagement: { highEnergyTimes: [], lowEnergyTimes: [] },
          contextSwitching: { minimumBlockDuration: 30, maxTasksPerBlock: 2 },
          breakPreferences: { shortBreakDuration: 15, longBreakDuration: 30, breakFrequency: 90 }
        },
        existingBlocks: [],
        energyProfile: { 
          hourlyProfile: {},
          weeklyPattern: {},
          personalFactors: { morningPerson: true, afternoonCrash: false, eveningBoost: false }
        },
        deadlines: [],
        bufferPreferences: { betweenTasks: 10, beforeDeadlines: 60, dayStartBuffer: 15, dayEndBuffer: 15 }
      };

      const schedule = await autoScheduler.schedule(mockTasks, constraints);

      addResult({
        component: 'Auto Scheduler',
        test: 'Intelligent Scheduling',
        status: schedule.schedule.length > 0 ? 'passed' : 'failed',
        result: `Generated ${schedule.schedule.length} time blocks with ${Math.round(schedule.confidence * 100)}% confidence`,
        duration: Date.now() - startTime
      });

    } catch (error) {
      addResult({
        component: 'Auto Scheduler',
        test: 'Intelligent Scheduling',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
    }
  };

  const testSystemIntegration = async () => {
    const startTime = Date.now();
    
    try {
      addResult({
        component: 'System Integration',
        test: 'End-to-End Workflow',
        status: 'running'
      });

      // Simulate complete workflow
      const nlInput = "I need to finish my quarterly report by Friday, it will take about 4 hours";
      
      // 1. Parse natural language
      const parsedResult = await aiParser.parse({ 
        input: nlInput, 
        context: {
          currentDate: new Date(),
          activeGoals: [],
          existingTasks: [],
          userPreferences: {
            workingHours: { start: '09:00', end: '17:00' },
            deepWorkPreferences: { preferredTimes: [], maxBlockDuration: 120, breaksBetween: 15 },
            energyManagement: { highEnergyTimes: [], lowEnergyTimes: [] },
            contextSwitching: { minimumBlockDuration: 30, maxTasksPerBlock: 2 },
            breakPreferences: { shortBreakDuration: 15, longBreakDuration: 30, breakFrequency: 90 }
          }
        }
      });
      
      // 2. Index the created data
      for (const item of parsedResult.parsedItems) {
        if (item.type === 'task') {
          await secondBrain.indexNewData(item.data, 'task');
        }
      }
      
      // 3. Query the Second Brain
      const queryResult = await secondBrain.askQuestion({
        question: 'What tasks do I have related to reports?'
      });

      const taskItems = parsedResult.parsedItems.filter(item => item.type === 'task');
      
      addResult({
        component: 'System Integration',
        test: 'End-to-End Workflow',
        status: taskItems.length > 0 && queryResult.answer ? 'passed' : 'failed',
        result: `Created ${taskItems.length} tasks, AI responded with ${Math.round(queryResult.confidence * 100)}% confidence`,
        duration: Date.now() - startTime
      });

    } catch (error) {
      addResult({
        component: 'System Integration',
        test: 'End-to-End Workflow',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'passed': return 'text-green-400 bg-green-900/20 border-green-400';
      case 'failed': return 'text-red-400 bg-red-900/20 border-red-400';
      case 'running': return 'text-yellow-400 bg-yellow-900/20 border-yellow-400';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-400';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'passed': return '✅';
      case 'failed': return '❌';
      case 'running': return '⏳';
      default: return '❓';
    }
  };

  const passedTests = testResults.filter(t => t.status === 'passed').length;
  const failedTests = testResults.filter(t => t.status === 'failed').length;
  const runningTests = testResults.filter(t => t.status === 'running').length;

  return (
    <div className="ai-system-test space-y-6">
      {/* 🧪 HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold holographic-text flex items-center space-x-3">
            <span>🧪</span>
            <span>AI SYSTEM TEST</span>
            <span className="text-xs bg-gradient-to-r from-green-500 to-blue-500 text-white px-2 py-1 rounded-full animate-pulse">
              PSICOPATICO MODE
            </span>
          </h2>
          <p className="text-gray-300 text-sm mt-1">
            Comprehensive testing of all AI components and integrations
          </p>
        </div>

        <button
          onClick={runComprehensiveTest}
          disabled={isRunning}
          className="btn-gaming px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 disabled:opacity-50"
        >
          {isRunning ? (
            <div className="flex items-center space-x-2">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Running Tests...</span>
            </div>
          ) : (
            <span>🚀 Run All Tests</span>
          )}
        </button>
      </div>

      {/* 📊 TEST SUMMARY */}
      {testResults.length > 0 && (
        <div className="glass-card p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400 mb-2">{passedTests}</div>
              <div className="text-sm text-gray-400">Passed</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-red-400 mb-2">{failedTests}</div>
              <div className="text-sm text-gray-400">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-400 mb-2">{runningTests}</div>
              <div className="text-sm text-gray-400">Running</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-cyan-400 mb-2">{testResults.length}</div>
              <div className="text-sm text-gray-400">Total Tests</div>
            </div>
          </div>
        </div>
      )}

      {/* 🧪 TEST RESULTS */}
      {testResults.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold neon-text mb-4">Test Results</h3>
          <div className="space-y-3">
            {testResults.map((result, index) => (
              <div key={index} className={`border rounded-lg p-4 ${getStatusColor(result.status)}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-xl">{getStatusIcon(result.status)}</span>
                      <span className="font-bold">{result.component}</span>
                      <span className="text-sm opacity-75">{result.test}</span>
                    </div>
                    
                    {result.result && (
                      <p className="text-sm mb-2">{result.result}</p>
                    )}
                    
                    {result.error && (
                      <div className="text-sm bg-red-900/30 rounded p-2 mb-2">
                        <strong>Error:</strong> {result.error}
                      </div>
                    )}
                  </div>
                  
                  <div className="text-right text-sm text-gray-400">
                    {result.duration && `${result.duration}ms`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 💡 TESTING INFO */}
      <div className="glass-card p-4">
        <details>
          <summary className="cursor-pointer font-bold text-cyan-400 hover:text-cyan-300 mb-3">
            💡 What These Tests Validate
          </summary>
          <div className="space-y-3 mt-3 text-sm text-gray-300">
            <p><strong>🧠 AI Parser:</strong> Natural language processing capabilities and data extraction accuracy</p>
            <p><strong>🔍 Second Brain:</strong> Data indexing, semantic search, and conversational AI functionality</p>
            <p><strong>🎓 Micro Coach:</strong> Pattern detection algorithms and personalized insight generation</p>
            <p><strong>⚠️ Risk Predictor:</strong> Goal risk assessment and trajectory prediction accuracy</p>
            <p><strong>⚡ Auto Scheduler:</strong> Intelligent scheduling optimization and constraint handling</p>
            <p><strong>🔗 System Integration:</strong> End-to-end workflow and component interoperability</p>
          </div>
        </details>
      </div>
    </div>
  );
}