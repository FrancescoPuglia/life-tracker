// 🧠 AI ENGINE - Natural Language Parser Implementation
// MODALITÀ PSICOPATICO CERTOSINO ACTIVATED 🔥

import { 
  NaturalLanguageParser, NLParseRequest, NLParseResult, ParsedItem, 
  ParsedTask, ParsedTimeBlock, ParsedGoal, ParsedHabit, ClarificationRequest
} from '@/types/ai-enhanced';
import { TimeBlock, Task, Goal, Habit } from '@/types';

interface AIConfig {
  apiKey?: string;
  endpoint?: string;
  model: string;
  maxTokens: number;
}

// 🎯 CORE NATURAL LANGUAGE PARSER
export class SmartNLParser implements NaturalLanguageParser {
  private config: AIConfig;

  constructor(config: AIConfig = {
    model: 'gpt-3.5-turbo',
    maxTokens: 1000
  }) {
    this.config = config;
  }

  async parse(request: NLParseRequest): Promise<NLParseResult> {
    console.log('🧠 AI PARSER: Processing input:', request.input);
    
    try {
      // 🔥 PSYCHOPATH MODE: Try multiple parsing strategies
      const strategies = [
        this.parseWithPatternMatching.bind(this),
        this.parseWithAIFallback.bind(this),
        this.parseWithHeuristics.bind(this)
      ];

      for (const strategy of strategies) {
        try {
          const result = await strategy(request);
          if (result.confidence > 0.7) {
            console.log('🧠 AI PARSER SUCCESS:', result);
            return result;
          }
        } catch (error) {
          console.warn('🧠 AI PARSER: Strategy failed, trying next:', error);
          continue;
        }
      }

      // Fallback to low-confidence generic parsing
      return this.createFallbackResult(request);

    } catch (error) {
      console.error('🧠 AI PARSER CRITICAL ERROR:', error);
      return this.createErrorResult(request);
    }
  }

  // 🎯 PATTERN MATCHING STRATEGY
  private async parseWithPatternMatching(request: NLParseRequest): Promise<NLParseResult> {
    const input = request.input.toLowerCase();
    const parsedItems: ParsedItem[] = [];

    // TASK PATTERNS
    const taskPatterns = [
      /(?:task|todo|do|work on|complete)\s*:?\s*(.+?)(?:\s+(?:for|in)\s+(\d+)\s*(min|minutes|hour|hours))?/gi,
      /^(.+?)\s+(?:for|in)\s+(\d+)\s*(min|minutes|hour|hours)/gi,
      /^(.+?)\s+(?:by|before|deadline)\s+(.+)/gi,
      /finish\s+(.+)/gi,
      /complete\s+(.+)/gi
    ];

    for (const pattern of taskPatterns) {
      const matches = [...input.matchAll(pattern)];
      for (const match of matches) {
        const task = this.createParsedTask(match, request);
        if (task) {
          parsedItems.push({
            type: 'task',
            data: task,
            confidence: this.calculateTaskConfidence(match, input)
          });
        }
      }
    }

    // TIME BLOCK PATTERNS
    const timeBlockPatterns = [
      /(?:from|at)\s+(\d{1,2}):?(\d{2})?\s*(?:am|pm)?\s+(?:to|until|\-)\s+(\d{1,2}):?(\d{2})?\s*(?:am|pm)?\s*(.+)/gi,
      /(\d{1,2}):?(\d{2})?\s*(?:am|pm)?\s*\-\s*(\d{1,2}):?(\d{2})?\s*(?:am|pm)?\s+(.+)/gi,
      /block\s+(.+?)\s+(?:from|at)\s+(\d{1,2}):?(\d{2})?/gi
    ];

    for (const pattern of timeBlockPatterns) {
      const matches = [...input.matchAll(pattern)];
      for (const match of matches) {
        const timeBlock = this.createParsedTimeBlock(match, request);
        if (timeBlock) {
          parsedItems.push({
            type: 'timeblock',
            data: timeBlock,
            confidence: this.calculateTimeBlockConfidence(match, input)
          });
        }
      }
    }

    // GOAL PATTERNS
    const goalPatterns = [
      /(?:goal|objective|target)\s*:?\s*(.+?)(?:\s+by\s+(.+))?/gi,
      /achieve\s+(.+?)(?:\s+by\s+(.+))?/gi,
      /want\s+to\s+(.+?)(?:\s+by\s+(.+))?/gi
    ];

    for (const pattern of goalPatterns) {
      const matches = [...input.matchAll(pattern)];
      for (const match of matches) {
        const goal = this.createParsedGoal(match, request);
        if (goal) {
          parsedItems.push({
            type: 'goal',
            data: goal,
            confidence: this.calculateGoalConfidence(match, input)
          });
        }
      }
    }

    // HABIT PATTERNS
    const habitPatterns = [
      /(?:habit|routine|daily|weekly)\s*:?\s*(.+)/gi,
      /every\s+(?:day|morning|evening|week)\s+(.+)/gi,
      /consistently\s+(.+)/gi
    ];

    for (const pattern of habitPatterns) {
      const matches = [...input.matchAll(pattern)];
      for (const match of matches) {
        const habit = this.createParsedHabit(match, request);
        if (habit) {
          parsedItems.push({
            type: 'habit',
            data: habit,
            confidence: this.calculateHabitConfidence(match, input)
          });
        }
      }
    }

    const overallConfidence = parsedItems.length > 0 
      ? parsedItems.reduce((sum, item) => sum + item.confidence, 0) / parsedItems.length
      : 0.1;

    return {
      confidence: overallConfidence,
      parsedItems,
      clarificationNeeded: this.generateClarifications(parsedItems, request),
      rawInput: request.input
    };
  }

  // 🔥 CREATE PARSED ITEMS
  private createParsedTask(match: RegExpMatchArray, request: NLParseRequest): ParsedTask | null {
    const title = match[1]?.trim();
    if (!title || title.length < 2) return null;

    const duration = match[2] ? parseInt(match[2]) : undefined;
    const unit = match[3]?.toLowerCase();
    
    let estimatedDuration = duration;
    if (unit && (unit.includes('hour') || unit === 'h')) {
      estimatedDuration = duration ? duration * 60 : undefined;
    }

    const priority = this.inferPriority(title, request.input);
    const type = this.inferTaskType(title);

    return {
      title,
      estimatedDuration,
      priority,
      context: this.extractContext(request.input),
      energyRequired: this.inferEnergyLevel(title),
      type,
      deadline: this.extractDeadline(request.input, request.context?.currentDate)
    };
  }

  private createParsedTimeBlock(match: RegExpMatchArray, request: NLParseRequest): ParsedTimeBlock | null {
    const currentDate = request.context?.currentDate || new Date();
    
    try {
      const startHour = parseInt(match[1]);
      const startMin = parseInt(match[2] || '0');
      const endHour = parseInt(match[3]);
      const endMin = parseInt(match[4] || '0');
      
      if (isNaN(startHour) || isNaN(endHour)) return null;

      const startTime = new Date(currentDate);
      startTime.setHours(startHour, startMin, 0, 0);
      
      const endTime = new Date(currentDate);
      endTime.setHours(endHour, endMin, 0, 0);
      
      // Handle next day
      if (endTime <= startTime) {
        endTime.setDate(endTime.getDate() + 1);
      }

      const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      const type = this.inferBlockType(match[5] || '');

      return {
        startTime,
        endTime,
        duration,
        type,
        energyLevel: this.inferEnergyLevel(match[5] || ''),
        flexibility: this.inferFlexibility(match[5] || '')
      };
    } catch (error) {
      console.warn('Failed to create time block:', error);
      return null;
    }
  }

  private createParsedGoal(match: RegExpMatchArray, request: NLParseRequest): ParsedGoal | null {
    const title = match[1]?.trim();
    if (!title || title.length < 3) return null;

    const deadlineText = match[2];
    const deadline = deadlineText ? this.parseDate(deadlineText) : undefined;

    return {
      title,
      deadline,
      category: this.inferGoalCategory(title),
      priority: this.inferPriority(title, request.input),
      measurable: this.isMeasurable(title)
    };
  }

  private createParsedHabit(match: RegExpMatchArray, request: NLParseRequest): ParsedHabit | null {
    const title = match[1]?.trim();
    if (!title || title.length < 2) return null;

    const frequency = this.inferFrequency(request.input);
    const timeOfDay = this.inferTimeOfDay(request.input);

    return {
      title,
      frequency,
      category: this.inferHabitCategory(title),
      timeOfDay,
      estimatedDuration: this.estimateHabitDuration(title)
    };
  }

  // 🧠 AI FALLBACK STRATEGY (Simulated)
  private async parseWithAIFallback(request: NLParseRequest): Promise<NLParseResult> {
    // In a real implementation, this would call OpenAI/Anthropic API
    // For now, we'll use advanced heuristics
    
    const confidence = this.calculateOverallConfidence(request.input);
    if (confidence < 0.3) {
      throw new Error('Low confidence in AI parsing');
    }

    return this.parseWithHeuristics(request);
  }

  // 🔍 HEURISTICS STRATEGY
  private async parseWithHeuristics(request: NLParseRequest): Promise<NLParseResult> {
    const input = request.input;
    const words = input.toLowerCase().split(/\s+/);
    
    const taskKeywords = ['do', 'complete', 'finish', 'work', 'task', 'todo', 'make', 'create', 'build'];
    const timeKeywords = ['at', 'from', 'until', 'to', 'block', 'schedule', 'time'];
    const goalKeywords = ['goal', 'achieve', 'want', 'objective', 'target', 'aim'];
    const habitKeywords = ['daily', 'every', 'routine', 'habit', 'consistently', 'regularly'];

    const scores = {
      task: this.calculateKeywordScore(words, taskKeywords),
      timeblock: this.calculateKeywordScore(words, timeKeywords),
      goal: this.calculateKeywordScore(words, goalKeywords),
      habit: this.calculateKeywordScore(words, habitKeywords)
    };

    const bestType = Object.entries(scores).reduce((a, b) => scores[a[0] as keyof typeof scores] > scores[b[0] as keyof typeof scores] ? a : b)[0];
    
    const parsedItems: ParsedItem[] = [];
    
    if (scores[bestType as keyof typeof scores] > 0.3) {
      switch (bestType) {
        case 'task':
          const taskData = this.createGenericTask(input, request);
          if (taskData) {
            parsedItems.push({ type: 'task', data: taskData, confidence: scores.task });
          }
          break;
        case 'timeblock':
          const blockData = this.createGenericTimeBlock(input, request);
          if (blockData) {
            parsedItems.push({ type: 'timeblock', data: blockData, confidence: scores.timeblock });
          }
          break;
        case 'goal':
          const goalData = this.createGenericGoal(input, request);
          if (goalData) {
            parsedItems.push({ type: 'goal', data: goalData, confidence: scores.goal });
          }
          break;
        case 'habit':
          const habitData = this.createGenericHabit(input, request);
          if (habitData) {
            parsedItems.push({ type: 'habit', data: habitData, confidence: scores.habit });
          }
          break;
      }
    }

    return {
      confidence: scores[bestType as keyof typeof scores],
      parsedItems,
      clarificationNeeded: this.generateClarifications(parsedItems, request),
      rawInput: request.input
    };
  }

  // 🔄 HELPER METHODS
  private calculateKeywordScore(words: string[], keywords: string[]): number {
    const matches = words.filter(word => keywords.some(keyword => word.includes(keyword)));
    return matches.length / Math.max(words.length, 1);
  }

  private inferPriority(text: string, fullInput: string): 'low' | 'medium' | 'high' | 'critical' {
    const urgentWords = ['urgent', 'asap', 'immediately', 'critical', 'emergency', 'now'];
    const highWords = ['important', 'priority', 'must', 'need', 'deadline'];
    const lowWords = ['maybe', 'when', 'if', 'consider', 'think about'];

    const lowerText = (text + ' ' + fullInput).toLowerCase();
    
    if (urgentWords.some(word => lowerText.includes(word))) return 'critical';
    if (highWords.some(word => lowerText.includes(word))) return 'high';
    if (lowWords.some(word => lowerText.includes(word))) return 'low';
    
    return 'medium';
  }

  private inferTaskType(title: string): 'deep' | 'shallow' | 'admin' | 'creative' {
    const deepWords = ['analyze', 'research', 'design', 'develop', 'write', 'study', 'plan', 'strategy'];
    const shallowWords = ['email', 'call', 'message', 'check', 'review', 'update', 'quick'];
    const adminWords = ['paperwork', 'form', 'document', 'file', 'organize', 'schedule', 'book'];
    const creativeWords = ['create', 'design', 'brainstorm', 'ideate', 'sketch', 'prototype'];

    const lowerTitle = title.toLowerCase();
    
    if (creativeWords.some(word => lowerTitle.includes(word))) return 'creative';
    if (deepWords.some(word => lowerTitle.includes(word))) return 'deep';
    if (adminWords.some(word => lowerTitle.includes(word))) return 'admin';
    if (shallowWords.some(word => lowerTitle.includes(word))) return 'shallow';
    
    return 'shallow';
  }

  private inferEnergyLevel(text: string): 'low' | 'medium' | 'high' {
    const highEnergyWords = ['workout', 'exercise', 'meeting', 'presentation', 'creative', 'brainstorm'];
    const lowEnergyWords = ['email', 'organize', 'file', 'admin', 'paperwork', 'break'];
    
    const lowerText = text.toLowerCase();
    
    if (highEnergyWords.some(word => lowerText.includes(word))) return 'high';
    if (lowEnergyWords.some(word => lowerText.includes(word))) return 'low';
    
    return 'medium';
  }

  private extractContext(input: string): string[] {
    const context: string[] = [];
    const contextWords = ['at', 'with', 'for', 'on', 'using', 'via'];
    
    for (const word of contextWords) {
      const regex = new RegExp(`\\b${word}\\s+([\\w\\s]+?)(?:\\.|$|,|;)`, 'gi');
      const matches = input.match(regex);
      if (matches) {
        context.push(...matches.map(m => m.trim()));
      }
    }
    
    return context;
  }

  private extractDeadline(input: string, currentDate?: Date): Date | undefined {
    const deadlinePatterns = [
      /by\s+(\w+day)\s+(\d{1,2})/gi,
      /deadline\s+(\d{1,2}\/\d{1,2})/gi,
      /due\s+(.+?)(?:\.|$)/gi,
      /by\s+(.+?)(?:\.|$)/gi
    ];

    for (const pattern of deadlinePatterns) {
      const match = input.match(pattern);
      if (match) {
        const parsed = this.parseDate(match[1]);
        if (parsed) return parsed;
      }
    }

    return undefined;
  }

  private parseDate(dateStr: string): Date | undefined {
    try {
      const today = new Date();
      const lowerStr = dateStr.toLowerCase().trim();
      
      if (lowerStr === 'today') {
        return today;
      }
      
      if (lowerStr === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow;
      }

      if (lowerStr.includes('next week')) {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek;
      }

      // Try parsing as date
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private calculateTaskConfidence(match: RegExpMatchArray, fullInput: string): number {
    let confidence = 0.6; // Base confidence
    
    if (match[1] && match[1].length > 5) confidence += 0.2; // Good title length
    if (match[2]) confidence += 0.1; // Has duration
    if (fullInput.includes('priority') || fullInput.includes('important')) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  private calculateTimeBlockConfidence(match: RegExpMatchArray, fullInput: string): number {
    let confidence = 0.7; // Higher base for time patterns
    
    if (match[1] && match[3]) confidence += 0.2; // Has both start and end times
    if (match[5] && match[5].length > 3) confidence += 0.1; // Has description
    
    return Math.min(confidence, 1.0);
  }

  private calculateGoalConfidence(match: RegExpMatchArray, fullInput: string): number {
    let confidence = 0.5;
    
    if (match[1] && match[1].length > 10) confidence += 0.2; // Detailed goal
    if (match[2]) confidence += 0.2; // Has deadline
    if (fullInput.includes('achieve') || fullInput.includes('reach')) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  private calculateHabitConfidence(match: RegExpMatchArray, fullInput: string): number {
    let confidence = 0.6;
    
    if (fullInput.includes('daily') || fullInput.includes('every')) confidence += 0.2;
    if (fullInput.includes('routine')) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  private calculateOverallConfidence(input: string): number {
    const wordCount = input.split(/\s+/).length;
    const hasVerbs = /\b(do|make|create|complete|finish|start|begin|work|write|read)\b/i.test(input);
    const hasTimeIndicators = /\b(\d{1,2}:\d{2}|\d+\s*(am|pm|minutes?|hours?))\b/i.test(input);
    
    let confidence = 0.3; // Base
    if (wordCount >= 3) confidence += 0.2;
    if (hasVerbs) confidence += 0.3;
    if (hasTimeIndicators) confidence += 0.2;
    
    return Math.min(confidence, 1.0);
  }

  private generateClarifications(items: ParsedItem[], request: NLParseRequest): ClarificationRequest[] {
    const clarifications: ClarificationRequest[] = [];
    
    for (const item of items) {
      if (item.type === 'task') {
        const task = item.data as ParsedTask;
        if (!task.estimatedDuration) {
          clarifications.push({
            field: 'estimatedDuration',
            question: `How long do you estimate "${task.title}" will take?`,
            options: ['15 minutes', '30 minutes', '1 hour', '2+ hours'],
            required: false
          });
        }
      }
      
      if (item.type === 'timeblock') {
        const block = item.data as ParsedTimeBlock;
        if (!block.startTime) {
          clarifications.push({
            field: 'startTime',
            question: 'What time should this time block start?',
            required: true
          });
        }
      }
    }
    
    return clarifications;
  }

  private createFallbackResult(request: NLParseRequest): NLParseResult {
    // Create a generic task from any input
    const genericTask: ParsedTask = {
      title: request.input.substring(0, 100),
      priority: 'medium',
      context: [],
      energyRequired: 'medium',
      type: 'shallow'
    };

    return {
      confidence: 0.3,
      parsedItems: [{
        type: 'task',
        data: genericTask,
        confidence: 0.3
      }],
      clarificationNeeded: [{
        field: 'type',
        question: 'What type of item is this?',
        options: ['Task', 'Time Block', 'Goal', 'Habit'],
        required: true
      }],
      rawInput: request.input
    };
  }

  private createErrorResult(request: NLParseRequest): NLParseResult {
    return {
      confidence: 0,
      parsedItems: [],
      clarificationNeeded: [{
        field: 'input',
        question: 'Could you rephrase your request more clearly?',
        required: true
      }],
      rawInput: request.input
    };
  }

  private createGenericTask(input: string, request: NLParseRequest): ParsedTask {
    return {
      title: input.substring(0, 100),
      priority: this.inferPriority(input, input),
      context: this.extractContext(input),
      energyRequired: this.inferEnergyLevel(input),
      type: this.inferTaskType(input),
      estimatedDuration: this.estimateGenericDuration(input)
    };
  }

  private createGenericTimeBlock(input: string, request: NLParseRequest): ParsedTimeBlock {
    const currentDate = request.context?.currentDate || new Date();
    const startTime = new Date(currentDate);
    startTime.setMinutes(0, 0, 0);
    
    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + 1);

    return {
      startTime,
      endTime,
      duration: 60,
      type: 'shallow',
      energyLevel: this.inferEnergyLevel(input),
      flexibility: 0.5
    };
  }

  private createGenericGoal(input: string, request: NLParseRequest): ParsedGoal {
    return {
      title: input.substring(0, 100),
      category: this.inferGoalCategory(input),
      priority: this.inferPriority(input, input),
      measurable: this.isMeasurable(input)
    };
  }

  private createGenericHabit(input: string, request: NLParseRequest): ParsedHabit {
    return {
      title: input.substring(0, 100),
      frequency: this.inferFrequency(input),
      category: this.inferHabitCategory(input),
      timeOfDay: this.inferTimeOfDay(input)
    };
  }

  private inferBlockType(text: string): 'deep' | 'shallow' | 'break' | 'meeting' | 'admin' {
    const deepWords = ['focus', 'deep', 'think', 'analyze', 'create'];
    const meetingWords = ['meeting', 'call', 'discussion', 'sync'];
    const breakWords = ['break', 'lunch', 'rest', 'pause'];
    const adminWords = ['admin', 'paperwork', 'email', 'organize'];
    
    const lowerText = text.toLowerCase();
    
    if (meetingWords.some(w => lowerText.includes(w))) return 'meeting';
    if (breakWords.some(w => lowerText.includes(w))) return 'break';
    if (adminWords.some(w => lowerText.includes(w))) return 'admin';
    if (deepWords.some(w => lowerText.includes(w))) return 'deep';
    
    return 'shallow';
  }

  private inferFlexibility(text: string): number {
    const rigidWords = ['meeting', 'appointment', 'deadline', 'fixed'];
    const flexibleWords = ['whenever', 'flexible', 'anytime', 'maybe'];
    
    const lowerText = text.toLowerCase();
    
    if (rigidWords.some(w => lowerText.includes(w))) return 0.2;
    if (flexibleWords.some(w => lowerText.includes(w))) return 0.9;
    
    return 0.5;
  }

  private inferGoalCategory(text: string): string {
    const categories = {
      'work': ['work', 'career', 'job', 'professional', 'business'],
      'health': ['health', 'fitness', 'workout', 'diet', 'exercise', 'wellness'],
      'learning': ['learn', 'study', 'read', 'course', 'skill', 'education'],
      'personal': ['personal', 'life', 'relationship', 'family', 'hobby']
    };

    const lowerText = text.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        return category;
      }
    }
    
    return 'general';
  }

  private isMeasurable(text: string): boolean {
    const measurableWords = ['%', 'percent', 'number', 'count', 'times', 'hours', 'minutes', 'days', 'kg', 'lbs', 'miles', 'km'];
    const numberPattern = /\d+/;
    
    const lowerText = text.toLowerCase();
    
    return measurableWords.some(word => lowerText.includes(word)) || numberPattern.test(text);
  }

  private inferFrequency(text: string): 'daily' | 'weekly' | 'monthly' {
    const dailyWords = ['daily', 'every day', 'each day'];
    const weeklyWords = ['weekly', 'every week', 'once a week'];
    const monthlyWords = ['monthly', 'every month', 'once a month'];
    
    const lowerText = text.toLowerCase();
    
    if (monthlyWords.some(w => lowerText.includes(w))) return 'monthly';
    if (weeklyWords.some(w => lowerText.includes(w))) return 'weekly';
    
    return 'daily'; // Default
  }

  private inferTimeOfDay(text: string): 'morning' | 'afternoon' | 'evening' | 'any' {
    const morningWords = ['morning', 'am', 'early', 'wake up', 'breakfast'];
    const afternoonWords = ['afternoon', 'lunch', 'midday', 'noon'];
    const eveningWords = ['evening', 'night', 'pm', 'dinner', 'before bed'];
    
    const lowerText = text.toLowerCase();
    
    if (morningWords.some(w => lowerText.includes(w))) return 'morning';
    if (afternoonWords.some(w => lowerText.includes(w))) return 'afternoon';
    if (eveningWords.some(w => lowerText.includes(w))) return 'evening';
    
    return 'any';
  }

  private inferHabitCategory(text: string): string {
    const categories = {
      'health': ['exercise', 'workout', 'run', 'gym', 'diet', 'water', 'sleep'],
      'productivity': ['plan', 'organize', 'review', 'journal', 'schedule'],
      'learning': ['read', 'study', 'practice', 'learn', 'course'],
      'mindfulness': ['meditate', 'breathe', 'mindful', 'gratitude', 'reflect']
    };

    const lowerText = text.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        return category;
      }
    }
    
    return 'general';
  }

  private estimateHabitDuration(text: string): number {
    const durationPatterns = /(\d+)\s*(min|minutes|hour|hours|h|m)/gi;
    const match = text.match(durationPatterns);
    
    if (match) {
      const num = parseInt(match[0]);
      const unit = match[0].toLowerCase();
      
      if (unit.includes('h')) return num * 60;
      return num;
    }
    
    // Default estimates based on habit type
    const shortHabits = ['water', 'vitamin', 'stretch', 'breathe'];
    const longHabits = ['workout', 'exercise', 'study', 'read'];
    
    const lowerText = text.toLowerCase();
    
    if (shortHabits.some(h => lowerText.includes(h))) return 5;
    if (longHabits.some(h => lowerText.includes(h))) return 30;
    
    return 15; // Default
  }

  private estimateGenericDuration(text: string): number {
    const wordCount = text.split(/\s+/).length;
    const complexWords = ['research', 'analyze', 'create', 'develop', 'design'];
    const simpleWords = ['check', 'email', 'call', 'update', 'quick'];
    
    const lowerText = text.toLowerCase();
    let baseDuration = 30; // minutes
    
    if (simpleWords.some(w => lowerText.includes(w))) baseDuration = 15;
    if (complexWords.some(w => lowerText.includes(w))) baseDuration = 60;
    
    // Adjust based on length
    if (wordCount > 10) baseDuration *= 1.5;
    
    return baseDuration;
  }

  async processClarification(originalRequest: NLParseRequest, answers: Record<string, any>): Promise<NLParseResult> {
    // Re-parse with additional context from clarifications
    const enhancedRequest: NLParseRequest = {
      ...originalRequest,
      context: originalRequest.context || {
        currentDate: new Date(),
        activeGoals: [],
        existingTasks: [],
        userPreferences: {
          workingHours: { start: "09:00", end: "17:00" },
          deepWorkPreferences: {
            preferredTimes: [],
            maxBlockDuration: 120,
            breaksBetween: 15
          },
          energyManagement: {
            highEnergyTimes: [],
            lowEnergyTimes: []
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
        }
      }
    };
    
    return this.parse(enhancedRequest);
  }
}

// 🔥 EXPORT SINGLETON
export const aiParser = new SmartNLParser();