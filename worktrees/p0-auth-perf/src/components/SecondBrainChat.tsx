'use client';

// 🔍 SECOND BRAIN CHAT - Conversational AI Interface
// MODALITÀ PSICOPATICO SUPREMO 🧠🔥🔥🔥🔥🔥

import { useState, useEffect, useRef } from 'react';
import { secondBrain } from '@/lib/secondBrain';
import { ConversationalQuery, ConversationalResponse, SearchResult } from '@/types/ai-enhanced';
import { Goal, KeyResult, Task, Session, HabitLog, TimeBlock } from '@/types';
import { audioManager } from '@/lib/audioManager';

interface SecondBrainChatProps {
  goals: Goal[];
  keyResults: KeyResult[];
  tasks: Task[];
  sessions: Session[];
  habitLogs: HabitLog[];
  timeBlocks: TimeBlock[];
}

interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
  sources?: SearchResult[];
  followUpQuestions?: string[];
  dataInsights?: string[];
  confidence?: number;
  isTyping?: boolean;
}

interface BrainStats {
  dataPoints: number;
  intelligenceLevel: number;
  lastIndexed: Date | null;
  coverage: number;
}

export default function SecondBrainChat({
  goals,
  keyResults,
  tasks,
  sessions,
  habitLogs,
  timeBlocks
}: SecondBrainChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [brainStats, setBrainStats] = useState<BrainStats>({
    dataPoints: 0,
    intelligenceLevel: 0,
    lastIndexed: null,
    coverage: 0
  });
  const [isIndexing, setIsIndexing] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [chatMode, setChatMode] = useState<'chat' | 'search' | 'summary'>('chat');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 🧠 INITIALIZE SECOND BRAIN
  useEffect(() => {
    initializeSecondBrain();
  }, [goals, keyResults, tasks, sessions, habitLogs, timeBlocks]);

  // 📜 AUTO-SCROLL TO BOTTOM
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 🔥 INITIALIZE AND INDEX USER DATA
  const initializeSecondBrain = async () => {
    if (isIndexing) return;
    
    setIsIndexing(true);
    console.log('🔍 INITIALIZING SECOND BRAIN...');

    try {
      // 📚 INDEX ALL USER DATA
      const allData = [
        ...goals.map(g => ({ data: g, type: 'goal' })),
        ...keyResults.map(kr => ({ data: kr, type: 'keyresult' })),
        ...tasks.map(t => ({ data: t, type: 'task' })),
        ...sessions.map(s => ({ data: s, type: 'session' })),
        ...habitLogs.map(h => ({ data: h, type: 'habit' })),
        ...timeBlocks.map(tb => ({ data: tb, type: 'timeblock' }))
      ];

      let indexedCount = 0;
      for (const { data, type } of allData) {
        await secondBrain.indexNewData(data, type);
        indexedCount++;
      }

      setBrainStats({
        dataPoints: indexedCount,
        intelligenceLevel: Math.min(0.95, indexedCount / 100),
        lastIndexed: new Date(),
        coverage: Math.min(1, indexedCount / 200)
      });

      // 🎉 WELCOME MESSAGE
      if (messages.length === 0) {
        const welcomeMessage: ChatMessage = {
          id: `welcome-${Date.now()}`,
          type: 'ai',
          content: `🧠 **Second Brain Activated!** 

I've analyzed ${indexedCount} data points from your productivity system and I'm ready to help you unlock insights about your work patterns, goals, and habits.

My intelligence level: **${Math.round(brainStats.intelligenceLevel * 100)}%**
Data coverage: **${Math.round(brainStats.coverage * 100)}%**

What would you like to know about your productivity journey?`,
          timestamp: new Date(),
          followUpQuestions: [
            "What are my most productive patterns?",
            "How am I progressing on my goals?", 
            "What habits are working best for me?",
            "When do I have the most energy?"
          ],
          confidence: 0.9
        };
        
        setMessages([welcomeMessage]);
        audioManager.perfectDay();
      }

      console.log('🔍 SECOND BRAIN READY:', indexedCount, 'items indexed');

    } catch (error) {
      console.error('🔍 SECOND BRAIN INIT ERROR:', error);
    } finally {
      setIsIndexing(false);
    }
  };

  // 💬 HANDLE USER MESSAGE
  const handleSendMessage = async () => {
    if (!currentInput.trim() || isProcessing) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: currentInput,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setCurrentInput('');
    setIsProcessing(true);
    setShowSuggestions(false);

    // 🤖 SHOW TYPING INDICATOR
    const typingMessage: ChatMessage = {
      id: `typing-${Date.now()}`,
      type: 'ai',
      content: '',
      timestamp: new Date(),
      isTyping: true
    };
    setMessages(prev => [...prev, typingMessage]);

    try {
      // 🧠 PROCESS QUERY WITH SECOND BRAIN
      const query: ConversationalQuery = {
        question: currentInput,
        followUp: messages.length > 1
      };

      const response: ConversationalResponse = await secondBrain.askQuestion(query);

      // 🎯 CREATE AI RESPONSE MESSAGE
      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        type: 'ai',
        content: response.answer,
        timestamp: new Date(),
        sources: response.sources,
        followUpQuestions: response.followUpQuestions,
        dataInsights: response.dataInsights,
        confidence: response.confidence
      };

      // 🔄 REPLACE TYPING MESSAGE WITH ACTUAL RESPONSE
      setMessages(prev => prev.filter(m => !m.isTyping).concat(aiMessage));

      // 🎮 AUDIO FEEDBACK
      if (response.confidence > 0.8) {
        audioManager.taskCompleted();
      } else if (response.confidence > 0.5) {
        audioManager.buttonFeedback();
      }

      console.log('🧠 AI RESPONSE:', response.confidence, 'confidence');

    } catch (error) {
      console.error('🧠 CHAT ERROR:', error);
      
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        type: 'ai',
        content: "I'm having trouble processing your request right now. Please try again or ask something else.",
        timestamp: new Date(),
        confidence: 0.1
      };

      setMessages(prev => prev.filter(m => !m.isTyping).concat(errorMessage));
      audioManager.play('error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 🎯 HANDLE SUGGESTION CLICK
  const handleSuggestionClick = (suggestion: string) => {
    setCurrentInput(suggestion);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // ⌨️ HANDLE KEY PRESS
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 📊 GENERATE SUMMARY
  const generateSummary = async (timeframe: 'week' | 'month' | 'quarter') => {
    setIsProcessing(true);

    try {
      const endDate = new Date();
      const startDate = new Date();
      
      switch (timeframe) {
        case 'week':
          startDate.setDate(endDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(endDate.getMonth() - 1);
          break;
        case 'quarter':
          startDate.setMonth(endDate.getMonth() - 3);
          break;
      }

      const summary = await secondBrain.generateSummary({ start: startDate, end: endDate });

      const summaryMessage: ChatMessage = {
        id: `summary-${Date.now()}`,
        type: 'ai',
        content: summary,
        timestamp: new Date(),
        confidence: 0.9
      };

      setMessages(prev => [...prev, summaryMessage]);
      audioManager.perfectDay();

    } catch (error) {
      console.error('📊 SUMMARY ERROR:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // 🎨 STYLING HELPERS
  const getConfidenceColor = (confidence: number): string => {
    if (confidence > 0.8) return 'text-green-400';
    if (confidence > 0.6) return 'text-yellow-400';
    if (confidence > 0.3) return 'text-orange-400';
    return 'text-red-400';
  };

  const formatTimestamp = (timestamp: Date): string => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="second-brain-chat h-full flex flex-col">
      {/* 🧠 HEADER */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🔍</span>
            <h3 className="text-xl font-bold holographic-text">Second Brain</h3>
            <span className="text-xs bg-gradient-to-r from-purple-500 to-blue-500 text-white px-2 py-1 rounded-full animate-pulse">
              AI SUPREMO
            </span>
          </div>
          
          {brainStats.intelligenceLevel > 0 && (
            <div className="flex items-center space-x-2 text-sm">
              <span className="text-gray-400">Intelligence:</span>
              <span className={getConfidenceColor(brainStats.intelligenceLevel)}>
                {Math.round(brainStats.intelligenceLevel * 100)}%
              </span>
              <span className="text-gray-400">•</span>
              <span className="text-cyan-400">{brainStats.dataPoints} data points</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* MODE SELECTOR */}
          <div className="flex bg-gray-900 rounded-lg p-1">
            <button
              onClick={() => setChatMode('chat')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                chatMode === 'chat' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              💬 Chat
            </button>
            <button
              onClick={() => setChatMode('search')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                chatMode === 'search' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              🔍 Search
            </button>
            <button
              onClick={() => setChatMode('summary')}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                chatMode === 'summary' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              📊 Summary
            </button>
          </div>

          {isIndexing && (
            <div className="flex items-center space-x-2 text-sm text-yellow-400">
              <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
              <span>Indexing...</span>
            </div>
          )}
        </div>
      </div>

      {/* 💬 CHAT MESSAGES */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-4xl ${message.type === 'user' ? 'mr-4' : 'ml-4'}`}>
              {/* MESSAGE CONTENT */}
              <div className={`rounded-lg p-4 ${
                message.type === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                  : 'bg-gray-800 border border-gray-600'
              }`}>
                {message.isTyping ? (
                  <div className="flex items-center space-x-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                    <span className="text-gray-400 text-sm">AI is thinking...</span>
                  </div>
                ) : (
                  <div className="prose prose-invert max-w-none">
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </div>
                )}

                {/* MESSAGE METADATA */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-600">
                  <span className="text-xs text-gray-400">
                    {formatTimestamp(message.timestamp)}
                  </span>
                  
                  {message.confidence && (
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-400">Confidence:</span>
                      <span className={`text-xs ${getConfidenceColor(message.confidence)}`}>
                        {Math.round(message.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* DATA INSIGHTS */}
              {message.dataInsights && message.dataInsights.length > 0 && (
                <div className="mt-2 p-3 bg-blue-900/20 border border-blue-400/30 rounded-lg">
                  <h5 className="text-sm font-bold text-blue-400 mb-2">📊 Data Insights:</h5>
                  <div className="space-y-1">
                    {message.dataInsights.map((insight, index) => (
                      <div key={index} className="text-sm text-blue-300">• {insight}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* SOURCES */}
              {message.sources && message.sources.length > 0 && (
                <div className="mt-2">
                  <details className="group">
                    <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-300">
                      📚 View Sources ({message.sources.length})
                    </summary>
                    <div className="mt-2 space-y-2">
                      {message.sources.slice(0, 5).map((source, index) => (
                        <div key={index} className="p-2 bg-gray-900/50 rounded text-sm border border-gray-700">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-cyan-400 capitalize">{source.type}</span>
                            <span className="text-xs text-yellow-400">
                              {Math.round(source.relevanceScore * 100)}% relevant
                            </span>
                          </div>
                          <div className="text-gray-300 truncate">{source.content}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {source.timestamp.toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* FOLLOW-UP QUESTIONS */}
              {message.followUpQuestions && message.followUpQuestions.length > 0 && (
                <div className="mt-3">
                  <h5 className="text-sm font-bold text-purple-400 mb-2">💡 Follow-up Questions:</h5>
                  <div className="flex flex-wrap gap-2">
                    {message.followUpQuestions.map((question, index) => (
                      <button
                        key={index}
                        onClick={() => handleSuggestionClick(question)}
                        className="text-xs px-3 py-1 bg-purple-900/30 border border-purple-400/30 rounded-full text-purple-300 hover:bg-purple-900/50 transition-colors"
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 📊 SUMMARY MODE SHORTCUTS */}
      {chatMode === 'summary' && (
        <div className="p-4 border-t border-gray-700">
          <h4 className="text-sm font-bold text-cyan-400 mb-2">📊 Quick Summaries:</h4>
          <div className="flex space-x-2">
            <button
              onClick={() => generateSummary('week')}
              disabled={isProcessing}
              className="btn-gaming text-sm px-4 py-2 bg-gradient-to-r from-green-600 to-green-700"
            >
              📅 Last Week
            </button>
            <button
              onClick={() => generateSummary('month')}
              disabled={isProcessing}
              className="btn-gaming text-sm px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700"
            >
              📊 Last Month
            </button>
            <button
              onClick={() => generateSummary('quarter')}
              disabled={isProcessing}
              className="btn-gaming text-sm px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700"
            >
              📈 Last Quarter
            </button>
          </div>
        </div>
      )}

      {/* 🔍 SEARCH MODE SUGGESTIONS */}
      {chatMode === 'search' && showSuggestions && (
        <div className="p-4 border-t border-gray-700">
          <h4 className="text-sm font-bold text-cyan-400 mb-2">🔍 Popular Searches:</h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              "Show me my most completed tasks this week",
              "What goals am I behind on?", 
              "When am I most productive?",
              "Which habits have I been consistent with?",
              "What patterns lead to my best days?",
              "How is my energy throughout the week?"
            ].map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion)}
                className="text-left text-sm p-2 bg-gray-800 border border-gray-600 rounded hover:bg-gray-700 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ⌨️ INPUT AREA */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex space-x-3">
          <input
            ref={inputRef}
            type="text"
            value={currentInput}
            onChange={(e) => setCurrentInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about your productivity data..."
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-cyan-400"
            disabled={isProcessing}
          />
          
          <button
            onClick={handleSendMessage}
            disabled={!currentInput.trim() || isProcessing}
            onMouseEnter={() => audioManager.buttonHover()}
            className="btn-gaming px-6 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span>🧠 Ask</span>
            )}
          </button>
        </div>

        {/* QUICK ACTIONS */}
        <div className="flex justify-center mt-2">
          <div className="flex space-x-4 text-xs text-gray-400">
            <span>💡 Tip: Ask about patterns, goals, or productivity insights</span>
            <span>•</span>
            <span>⌨️ Press Enter to send</span>
          </div>
        </div>
      </div>
    </div>
  );
}