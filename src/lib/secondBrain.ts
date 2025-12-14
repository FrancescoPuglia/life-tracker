// 🔍 SECOND BRAIN - RAG System per Intelligence sui Dati Utente  
// MODALITÀ PSICOPATICO SUPREMO 🧠🔥🔥🔥🔥🔥

import {
  SecondBrain, SemanticSearch, SearchResult, ConversationalQuery, ConversationalResponse
} from '@/types/ai-enhanced';
import { Goal, KeyResult, Task, TimeBlock, Session, HabitLog } from '@/types';

interface DataIndex {
  id: string;
  type: 'task' | 'goal' | 'session' | 'note' | 'insight' | 'habit' | 'timeblock';
  content: string;
  metadata: Record<string, any>;
  embeddings: number[]; // Vector embeddings for semantic search
  timestamp: Date;
  keywords: string[];
  entities: string[];
  sentiment: number; // -1 to 1
  importance: number; // 0 to 1
}

interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  clusters: Map<string, string[]>; // cluster_id -> node_ids
}

interface GraphNode {
  id: string;
  type: 'concept' | 'entity' | 'goal' | 'task' | 'habit' | 'pattern';
  properties: Record<string, any>;
  connections: string[]; // connected node IDs
  weight: number; // importance/frequency
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'relates_to' | 'depends_on' | 'blocks' | 'enables' | 'similar_to';
  weight: number;
  properties: Record<string, any>;
}

interface SemanticContext {
  userProjects: string[];
  activeGoals: string[];
  workingPatterns: string[];
  preferences: Record<string, any>;
  expertise: string[];
  challenges: string[];
}

interface IntelligenceLevel {
  dataPoints: number;
  connections: number;
  patterns: number;
  confidence: number;
  coverage: number; // How much of user's life is understood
}

export class UltraIntelligentSecondBrain implements SecondBrain {
  private dataIndex: Map<string, DataIndex> = new Map();
  private knowledgeGraph: KnowledgeGraph = {
    nodes: new Map(),
    edges: new Map(),
    clusters: new Map()
  };
  private semanticContext: SemanticContext = {
    userProjects: [],
    activeGoals: [],
    workingPatterns: [],
    preferences: {},
    expertise: [],
    challenges: []
  };
  private intelligenceLevel: IntelligenceLevel = {
    dataPoints: 0,
    connections: 0,
    patterns: 0,
    confidence: 0,
    coverage: 0
  };
  private searchHistory: ConversationalQuery[] = [];
  private embeddings: Map<string, number[]> = new Map(); // Simple embedding cache

  constructor() {
    this.initializeSemanticEngine();
  }

  // 🔍 MAIN SEMANTIC SEARCH ENGINE
  async semanticSearch(query: SemanticSearch): Promise<SearchResult[]> {
    console.log('🔍 SECOND BRAIN: Semantic search for:', query.query);

    try {
      // 🧠 GENERATE QUERY EMBEDDINGS  
      const queryEmbedding = await this.generateEmbedding(query.query);
      
      // 🎯 EXTRACT QUERY INTENT & ENTITIES
      const queryIntent = this.analyzeQueryIntent(query.query);
      const queryEntities = this.extractEntities(query.query);
      
      // 📊 SEARCH INDEXED DATA
      const candidates = Array.from(this.dataIndex.values())
        .filter(item => this.matchesFilters(item, query.filters))
        .map(item => ({
          item,
          relevance: this.calculateRelevance(item, queryEmbedding, queryIntent, queryEntities)
        }))
        .filter(result => result.relevance > (query.filters?.relevanceThreshold || 0.3))
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 20); // Top 20 results

      // 🔗 ENHANCE WITH KNOWLEDGE GRAPH
      const enhancedResults = await this.enhanceWithKnowledgeGraph(candidates, queryIntent);
      
      // 📈 BUILD SEARCH RESULTS
      const searchResults: SearchResult[] = enhancedResults.map(result => ({
        id: result.item.id,
        type: result.item.type,
        content: result.item.content,
        relevanceScore: result.relevance,
        context: {
          ...result.item.metadata,
          queryIntent,
          connectedConcepts: this.getConnectedConcepts(result.item.id),
          temporalContext: this.getTemporalContext(result.item.timestamp)
        },
        timestamp: result.item.timestamp
      }));

      console.log('🔍 SEMANTIC SEARCH COMPLETE:', searchResults.length, 'results');
      return searchResults;

    } catch (error) {
      console.error('🔍 SEMANTIC SEARCH ERROR:', error);
      return [];
    }
  }

  // 🗣️ CONVERSATIONAL QUESTION ANSWERING
  async askQuestion(query: ConversationalQuery): Promise<ConversationalResponse> {
    console.log('🗣️ SECOND BRAIN: Answering question:', query.question);

    try {
      // 📚 RETRIEVE RELEVANT CONTEXT
      const searchResults = await this.semanticSearch({
        query: query.question,
        filters: { relevanceThreshold: 0.4 }
      });

      // 🧠 ANALYZE QUESTION TYPE
      const questionType = this.classifyQuestion(query.question);
      
      // 🎯 GENERATE CONTEXTUAL RESPONSE
      const response = await this.generateIntelligentResponse(
        query.question,
        searchResults,
        questionType,
        query.context
      );

      // 📊 EXTRACT DATA INSIGHTS
      const dataInsights = this.extractDataInsights(searchResults, questionType);
      
      // ❓ GENERATE FOLLOW-UP QUESTIONS
      const followUpQuestions = this.generateFollowUpQuestions(
        query.question,
        searchResults,
        questionType
      );

      const conversationalResponse: ConversationalResponse = {
        answer: response.answer,
        confidence: response.confidence,
        sources: searchResults,
        followUpQuestions,
        dataInsights
      };

      // 📝 LEARN FROM INTERACTION
      this.learnFromInteraction(query, conversationalResponse);

      console.log('🗣️ CONVERSATION RESPONSE:', response.confidence, 'confidence');
      return conversationalResponse;

    } catch (error) {
      console.error('🗣️ CONVERSATIONAL ERROR:', error);
      return {
        answer: "I'm having trouble accessing your data right now. Please try again.",
        confidence: 0.1,
        sources: [],
        followUpQuestions: ["What would you like to know about your productivity?"],
        dataInsights: []
      };
    }
  }

  // 📚 INDEX NEW DATA FOR SEARCH
  async indexNewData(data: any, type: string): Promise<void> {
    try {
      console.log('📚 INDEXING:', type, data.id || 'new data');

      // 🔥 EXTRACT CONTENT FOR INDEXING
      const content = this.extractSearchableContent(data, type);
      const keywords = this.extractKeywords(content);
      const entities = this.extractEntities(content);
      
      // 🧠 GENERATE EMBEDDINGS
      const embeddings = await this.generateEmbedding(content);
      
      // 📊 CALCULATE METADATA
      const sentiment = this.analyzeSentiment(content);
      const importance = this.calculateImportance(data, type);

      // 💾 CREATE INDEX ENTRY
      const indexEntry: DataIndex = {
        id: data.id || `${type}_${Date.now()}`,
        type: type as any,
        content,
        metadata: {
          originalData: data,
          type,
          title: data.title || data.name || content.substring(0, 50),
          status: data.status,
          priority: data.priority,
          tags: data.tags || [],
          duration: data.duration || data.actualMinutes,
          completedAt: data.completedAt,
          createdAt: data.createdAt
        },
        embeddings,
        timestamp: new Date(data.createdAt || data.timestamp || Date.now()),
        keywords,
        entities,
        sentiment,
        importance
      };

      // 🗃️ STORE IN INDEX
      this.dataIndex.set(indexEntry.id, indexEntry);

      // 🔗 UPDATE KNOWLEDGE GRAPH
      await this.updateKnowledgeGraph(indexEntry);
      
      // 🧠 UPDATE SEMANTIC CONTEXT
      this.updateSemanticContext(indexEntry);
      
      // 📊 RECALCULATE INTELLIGENCE LEVEL
      this.updateIntelligenceLevel();

      console.log('📚 INDEXED SUCCESSFULLY:', indexEntry.id);

    } catch (error) {
      console.error('📚 INDEXING ERROR:', error);
    }
  }

  // 📋 GENERATE INTELLIGENT SUMMARIES
  async generateSummary(timeframe: { start: Date; end: Date }): Promise<string> {
    console.log('📋 GENERATING SUMMARY:', timeframe.start.toDateString(), '-', timeframe.end.toDateString());

    try {
      // 📊 FILTER DATA BY TIMEFRAME
      const relevantData = Array.from(this.dataIndex.values())
        .filter(item => 
          item.timestamp >= timeframe.start && 
          item.timestamp <= timeframe.end
        );

      if (relevantData.length === 0) {
        return "No significant activity found in this timeframe.";
      }

      // 🎯 ANALYZE DIFFERENT ASPECTS
      const productivity = this.analyzeProductivitySummary(relevantData);
      const goals = this.analyzeGoalsSummary(relevantData);
      const patterns = this.analyzePatternsSummary(relevantData);
      const achievements = this.analyzeAchievementsSummary(relevantData);
      const challenges = this.analyzeChallengesSummary(relevantData);

      // 🔥 GENERATE COMPREHENSIVE SUMMARY
      const summary = `
## 📊 Period Summary (${timeframe.start.toLocaleDateString()} - ${timeframe.end.toLocaleDateString()})

### 🚀 Productivity Overview
${productivity}

### 🎯 Goals & Progress  
${goals}

### 📈 Key Patterns Detected
${patterns}

### 🏆 Notable Achievements
${achievements}

### ⚠️ Challenges & Areas for Improvement
${challenges}

### 🧠 AI Insights
Based on your data, I've identified ${relevantData.length} significant activities. Your productivity patterns show ${this.getProductivityTrend(relevantData)}, and your goal completion rate is ${this.getGoalCompletionRate(relevantData)}%.
      `.trim();

      console.log('📋 SUMMARY GENERATED:', summary.length, 'characters');
      return summary;

    } catch (error) {
      console.error('📋 SUMMARY ERROR:', error);
      return "Unable to generate summary at this time.";
    }
  }

  // 🧠 PRIVATE INTELLIGENCE METHODS

  private async initializeSemanticEngine(): Promise<void> {
    console.log('🧠 INITIALIZING SECOND BRAIN ENGINE');
    
    // Initialize with basic semantic understanding
    this.seedKnowledgeGraph();
    this.loadCommonPatterns();
  }

  private generateEmbedding(text: string): Promise<number[]> {
    // Simplified embedding generation (in real implementation, would use actual AI model)
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(100).fill(0);
    
    words.forEach((word, index) => {
      const hash = this.simpleHash(word) % 100;
      embedding[hash] += 1 / (index + 1); // Position weighting
    });
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return Promise.resolve(embedding.map(val => magnitude > 0 ? val / magnitude : 0));
  }

  private analyzeQueryIntent(query: string): string {
    const queryLower = query.toLowerCase();
    
    if (queryLower.includes('how') || queryLower.includes('why')) return 'explanation';
    if (queryLower.includes('what') || queryLower.includes('which')) return 'information';
    if (queryLower.includes('when') || queryLower.includes('time')) return 'temporal';
    if (queryLower.includes('should') || queryLower.includes('recommend')) return 'recommendation';
    if (queryLower.includes('trend') || queryLower.includes('pattern')) return 'analysis';
    if (queryLower.includes('compare') || queryLower.includes('difference')) return 'comparison';
    
    return 'general';
  }

  private extractEntities(text: string): string[] {
    // Simple entity extraction (in real implementation, would use NER model)
    const entities = [];
    const words = text.split(/\s+/);
    
    words.forEach(word => {
      // Detect potential goal/project names (capitalized words)
      if (/^[A-Z][a-z]+/.test(word)) {
        entities.push(word);
      }
      
      // Detect dates
      if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(word)) {
        entities.push(word);
      }
      
      // Detect times
      if (/\d{1,2}:\d{2}/.test(word)) {
        entities.push(word);
      }
    });
    
    return [...new Set(entities)];
  }

  private calculateRelevance(
    item: DataIndex,
    queryEmbedding: number[],
    queryIntent: string,
    queryEntities: string[]
  ): number {
    // 🎯 SEMANTIC SIMILARITY (40%)
    const semanticScore = this.cosineSimilarity(item.embeddings, queryEmbedding);
    
    // 🔑 KEYWORD MATCH (25%)
    const keywordScore = this.calculateKeywordMatch(item.keywords, queryEntities);
    
    // 📅 TEMPORAL RELEVANCE (15%)
    const temporalScore = this.calculateTemporalRelevance(item.timestamp);
    
    // ⭐ IMPORTANCE (10%)
    const importanceScore = item.importance;
    
    // 🎭 INTENT ALIGNMENT (10%)
    const intentScore = this.calculateIntentAlignment(item, queryIntent);
    
    return (
      semanticScore * 0.4 +
      keywordScore * 0.25 +
      temporalScore * 0.15 +
      importanceScore * 0.1 +
      intentScore * 0.1
    );
  }

  private async enhanceWithKnowledgeGraph(
    candidates: Array<{ item: DataIndex; relevance: number }>,
    queryIntent: string
  ): Promise<Array<{ item: DataIndex; relevance: number }>> {
    
    // Add connected concepts for better context
    const enhanced = [...candidates];
    
    candidates.forEach(candidate => {
      const connections = this.getConnectedConcepts(candidate.item.id);
      connections.slice(0, 3).forEach(connectionId => {
        const connectedItem = this.dataIndex.get(connectionId);
        if (connectedItem && !enhanced.find(e => e.item.id === connectionId)) {
          enhanced.push({
            item: connectedItem,
            relevance: candidate.relevance * 0.7 // Connected items get reduced relevance
          });
        }
      });
    });
    
    return enhanced.sort((a, b) => b.relevance - a.relevance);
  }

  private classifyQuestion(question: string): string {
    const q = question.toLowerCase();
    
    if (q.includes('productive') || q.includes('efficiency')) return 'productivity';
    if (q.includes('goal') || q.includes('objective')) return 'goals';
    if (q.includes('time') || q.includes('schedule')) return 'time_management';
    if (q.includes('habit') || q.includes('routine')) return 'habits';
    if (q.includes('pattern') || q.includes('trend')) return 'patterns';
    if (q.includes('energy') || q.includes('tired')) return 'energy';
    if (q.includes('focus') || q.includes('concentration')) return 'focus';
    if (q.includes('challenge') || q.includes('problem')) return 'challenges';
    
    return 'general';
  }

  private async generateIntelligentResponse(
    question: string,
    sources: SearchResult[],
    questionType: string,
    context?: SearchResult[]
  ): Promise<{ answer: string; confidence: number }> {
    
    if (sources.length === 0) {
      return {
        answer: "I don't have enough data to answer that question yet. As you use the app more, I'll learn about your patterns and be able to provide better insights.",
        confidence: 0.2
      };
    }

    // 🎯 GENERATE RESPONSE BASED ON QUESTION TYPE
    let answer = '';
    let confidence = 0.8;

    switch (questionType) {
      case 'productivity':
        answer = this.generateProductivityResponse(question, sources);
        break;
      case 'goals':
        answer = this.generateGoalsResponse(question, sources);
        break;
      case 'patterns':
        answer = this.generatePatternsResponse(question, sources);
        break;
      case 'time_management':
        answer = this.generateTimeResponse(question, sources);
        break;
      case 'habits':
        answer = this.generateHabitsResponse(question, sources);
        break;
      default:
        answer = this.generateGeneralResponse(question, sources);
        confidence = 0.6;
    }

    // 📊 ADD DATA-DRIVEN INSIGHTS
    if (sources.length > 5) {
      answer += `\n\n💡 *This insight is based on analysis of ${sources.length} data points from your activity.*`;
      confidence = Math.min(confidence + 0.1, 0.95);
    }

    return { answer, confidence };
  }

  private generateProductivityResponse(question: string, sources: SearchResult[]): string {
    const completedTasks = sources.filter(s => s.type === 'task' && s.context.status === 'completed');
    const sessions = sources.filter(s => s.type === 'session');
    
    const avgTasksPerDay = completedTasks.length / 7; // Assume week timeframe
    const totalFocusTime = sessions.reduce((sum, s) => sum + (s.context.duration || 0), 0);

    return `Based on your recent activity, you're completing about ${avgTasksPerDay.toFixed(1)} tasks per day with ${Math.round(totalFocusTime / 60)} hours of focused work time. ${
      avgTasksPerDay > 3 
        ? "You're maintaining good productivity momentum!" 
        : "Consider breaking down larger tasks into smaller, manageable chunks to increase your completion rate."
    }`;
  }

  private generateGoalsResponse(question: string, sources: SearchResult[]): string {
    const goals = sources.filter(s => s.type === 'goal');
    const completedGoals = goals.filter(g => g.context.status === 'completed');
    
    const completionRate = goals.length > 0 ? (completedGoals.length / goals.length) * 100 : 0;

    return `You have ${goals.length} goals in your system with a ${completionRate.toFixed(0)}% completion rate. ${
      completionRate > 70 
        ? "Excellent goal achievement rate!" 
        : completionRate > 40
        ? "You're making steady progress on your goals. Consider focusing on your top 2-3 priorities for better results."
        : "Your goals might benefit from being broken down into smaller, more achievable milestones."
    }`;
  }

  private generatePatternsResponse(question: string, sources: SearchResult[]): string {
    const workDays = this.analyzeWorkingDays(sources);
    const bestPerformanceTime = this.analyzeBestPerformanceTime(sources);
    
    return `Your data shows you're most productive during ${bestPerformanceTime} and work consistently ${workDays.length} days per week. ${
      workDays.includes('Monday') && workDays.includes('Friday')
        ? "You maintain good consistency throughout the week."
        : "Consider establishing more consistent working patterns for better results."
    }`;
  }

  private generateTimeResponse(question: string, sources: SearchResult[]): string {
    const timeBlocks = sources.filter(s => s.type === 'session' || s.context.duration);
    const avgDuration = timeBlocks.reduce((sum, t) => sum + (t.context.duration || 60), 0) / timeBlocks.length;
    
    return `Your average work session lasts ${Math.round(avgDuration)} minutes. ${
      avgDuration > 90 
        ? "You're good at maintaining focus for extended periods. Consider adding short breaks to optimize performance."
        : avgDuration > 45
        ? "Your session length is optimal for sustained focus."
        : "Consider extending your focus sessions to 45-90 minutes for deeper work."
    }`;
  }

  private generateHabitsResponse(question: string, sources: SearchResult[]): string {
    const habits = sources.filter(s => s.type === 'habit');
    const consistentHabits = habits.filter(h => h.context.consistency > 0.8);
    
    return `You're tracking ${habits.length} habits with ${consistentHabits.length} showing strong consistency (>80%). ${
      consistentHabits.length / habits.length > 0.5
        ? "Great habit consistency! You're building strong routines."
        : "Focus on consolidating your current habits before adding new ones."
    }`;
  }

  private generateGeneralResponse(question: string, sources: SearchResult[]): string {
    const dataTypes = [...new Set(sources.map(s => s.type))];
    
    return `I found ${sources.length} relevant data points across ${dataTypes.join(', ')} to help answer your question. ${
      sources.length > 10 
        ? "There's a lot of relevant information in your data - would you like me to focus on a specific aspect?"
        : "Based on this data, I can provide more specific insights if you ask about particular areas like productivity, goals, or patterns."
    }`;
  }

  private extractDataInsights(sources: SearchResult[], questionType: string): string[] {
    const insights = [];
    
    if (sources.length > 10) {
      insights.push(`Rich data available: ${sources.length} relevant entries found`);
    }
    
    const recentSources = sources.filter(s => 
      s.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    
    if (recentSources.length > sources.length * 0.7) {
      insights.push("Most relevant data is from the past week");
    }
    
    const highConfidenceSources = sources.filter(s => s.relevanceScore > 0.8);
    if (highConfidenceSources.length > 3) {
      insights.push(`${highConfidenceSources.length} highly relevant matches found`);
    }
    
    return insights.slice(0, 3);
  }

  private generateFollowUpQuestions(
    question: string,
    sources: SearchResult[],
    questionType: string
  ): string[] {
    const questions = [];
    
    switch (questionType) {
      case 'productivity':
        questions.push(
          "What time of day are you most productive?",
          "Which types of tasks do you complete fastest?",
          "How has your productivity changed over time?"
        );
        break;
      case 'goals':
        questions.push(
          "Which goals are at risk of missing their deadlines?",
          "What's blocking progress on your current goals?",
          "How can you improve your goal completion rate?"
        );
        break;
      case 'patterns':
        questions.push(
          "What are your most consistent habits?",
          "When do you typically have energy dips?",
          "What patterns lead to your best performance?"
        );
        break;
      default:
        questions.push(
          "What would you like to know about your productivity patterns?",
          "How are you progressing on your current goals?",
          "What insights can I provide about your work habits?"
        );
    }
    
    return questions.slice(0, 3);
  }

  // 🔧 UTILITY METHODS

  private matchesFilters(item: DataIndex, filters?: SemanticSearch['filters']): boolean {
    if (!filters) return true;
    
    if (filters.dateRange) {
      if (item.timestamp < filters.dateRange.start || item.timestamp > filters.dateRange.end) {
        return false;
      }
    }
    
    if (filters.dataTypes && !filters.dataTypes.includes(item.type)) {
      return false;
    }
    
    return true;
  }

  private extractSearchableContent(data: any, type: string): string {
    let content = '';
    
    switch (type) {
      case 'task':
        content = `${data.title || ''} ${data.description || ''} ${data.notes || ''}`;
        break;
      case 'goal':
        content = `${data.title || ''} ${data.description || ''}`;
        break;
      case 'session':
        content = `${data.notes || ''} ${data.type || ''}`;
        break;
      case 'habit':
        content = `${data.name || ''} ${data.description || ''}`;
        break;
      case 'timeblock':
        content = `${data.title || ''} ${data.description || ''} ${data.type || ''}`;
        break;
      default:
        content = JSON.stringify(data).toLowerCase();
    }
    
    return content.trim();
  }

  private extractKeywords(text: string): string[] {
    const words = text.toLowerCase().split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !this.isStopWord(word));
    
    return [...new Set(words)];
  }

  private isStopWord(word: string): boolean {
    const stopWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use'];
    return stopWords.includes(word);
  }

  private analyzeSentiment(text: string): number {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'awesome', 'completed', 'achieved', 'success'];
    const negativeWords = ['bad', 'terrible', 'awful', 'failed', 'missed', 'delayed', 'problem', 'issue'];
    
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    
    words.forEach(word => {
      if (positiveWords.includes(word)) score += 1;
      if (negativeWords.includes(word)) score -= 1;
    });
    
    return Math.max(-1, Math.min(1, score / words.length));
  }

  private calculateImportance(data: any, type: string): number {
    let importance = 0.5; // Base importance
    
    if (data.priority === 'high' || data.priority === 'critical') importance += 0.3;
    if (data.status === 'completed') importance += 0.2;
    if (type === 'goal') importance += 0.2;
    if (data.deadline && new Date(data.deadline) < new Date()) importance += 0.2;
    
    return Math.min(1, importance);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
  }

  private calculateKeywordMatch(itemKeywords: string[], queryEntities: string[]): number {
    if (queryEntities.length === 0) return 0;
    
    const matches = queryEntities.filter(entity => 
      itemKeywords.some(keyword => 
        keyword.includes(entity.toLowerCase()) || entity.toLowerCase().includes(keyword)
      )
    );
    
    return matches.length / queryEntities.length;
  }

  private calculateTemporalRelevance(timestamp: Date): number {
    const now = Date.now();
    const age = now - timestamp.getTime();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    return Math.max(0, 1 - (age / maxAge));
  }

  private calculateIntentAlignment(item: DataIndex, queryIntent: string): number {
    const itemType = item.type;
    
    const alignments: Record<string, Record<string, number>> = {
      'explanation': { 'session': 0.8, 'note': 0.9, 'insight': 0.9 },
      'information': { 'task': 0.9, 'goal': 0.9, 'habit': 0.8 },
      'temporal': { 'session': 0.9, 'timeblock': 0.9 },
      'recommendation': { 'insight': 0.9, 'goal': 0.7 },
      'analysis': { 'session': 0.8, 'task': 0.8, 'goal': 0.8 }
    };
    
    return alignments[queryIntent]?.[itemType] || 0.5;
  }

  private async updateKnowledgeGraph(item: DataIndex): Promise<void> {
    // Create nodes for entities
    item.entities.forEach(entity => {
      if (!this.knowledgeGraph.nodes.has(entity)) {
        this.knowledgeGraph.nodes.set(entity, {
          id: entity,
          type: 'entity',
          properties: { name: entity },
          connections: [],
          weight: 0
        });
      }
      const node = this.knowledgeGraph.nodes.get(entity)!;
      node.weight += 1;
    });
    
    // Create connections between co-occurring entities
    for (let i = 0; i < item.entities.length; i++) {
      for (let j = i + 1; j < item.entities.length; j++) {
        const edgeId = `${item.entities[i]}-${item.entities[j]}`;
        if (!this.knowledgeGraph.edges.has(edgeId)) {
          this.knowledgeGraph.edges.set(edgeId, {
            id: edgeId,
            source: item.entities[i],
            target: item.entities[j],
            type: 'relates_to',
            weight: 1,
            properties: {}
          });
        } else {
          this.knowledgeGraph.edges.get(edgeId)!.weight += 1;
        }
      }
    }
  }

  private updateSemanticContext(item: DataIndex): void {
    if (item.type === 'goal') {
      this.semanticContext.activeGoals.push(item.content);
    }
    
    // Extract working patterns
    if (item.type === 'session') {
      const hour = new Date(item.timestamp).getHours();
      if (hour < 12) this.semanticContext.workingPatterns.push('morning');
      else if (hour < 17) this.semanticContext.workingPatterns.push('afternoon');
      else this.semanticContext.workingPatterns.push('evening');
    }
  }

  private updateIntelligenceLevel(): void {
    this.intelligenceLevel = {
      dataPoints: this.dataIndex.size,
      connections: this.knowledgeGraph.edges.size,
      patterns: this.knowledgeGraph.nodes.size,
      confidence: Math.min(0.95, this.dataIndex.size / 100),
      coverage: Math.min(1, this.dataIndex.size / 500)
    };
  }

  private getConnectedConcepts(itemId: string): string[] {
    // Find items connected through knowledge graph
    const connections = [];
    const item = this.dataIndex.get(itemId);
    
    if (item) {
      item.entities.forEach(entity => {
        const node = this.knowledgeGraph.nodes.get(entity);
        if (node) {
          connections.push(...node.connections);
        }
      });
    }
    
    return [...new Set(connections)].slice(0, 5);
  }

  private getTemporalContext(timestamp: Date): string {
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - timestamp.getTime()) / (24 * 60 * 60 * 1000));
    
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return 'this week';
    if (diffDays < 30) return 'this month';
    return 'older';
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private seedKnowledgeGraph(): void {
    // Add common concepts
    const concepts = ['productivity', 'goals', 'habits', 'focus', 'energy', 'time management'];
    concepts.forEach(concept => {
      this.knowledgeGraph.nodes.set(concept, {
        id: concept,
        type: 'concept',
        properties: { name: concept },
        connections: [],
        weight: 1
      });
    });
  }

  private loadCommonPatterns(): void {
    // Initialize with common productivity patterns
    console.log('🧠 Loading common productivity patterns...');
  }

  private learnFromInteraction(query: ConversationalQuery, response: ConversationalResponse): void {
    this.searchHistory.push(query);
    // Could implement reinforcement learning here
  }

  // 📊 ANALYSIS HELPER METHODS

  private analyzeProductivitySummary(data: DataIndex[]): string {
    const tasks = data.filter(d => d.type === 'task');
    const completedTasks = tasks.filter(t => t.metadata.status === 'completed');
    const sessions = data.filter(d => d.type === 'session');
    
    return `Completed ${completedTasks.length}/${tasks.length} tasks across ${sessions.length} focus sessions.`;
  }

  private analyzeGoalsSummary(data: DataIndex[]): string {
    const goals = data.filter(d => d.type === 'goal');
    const completedGoals = goals.filter(g => g.metadata.status === 'completed');
    
    return goals.length > 0 
      ? `${completedGoals.length}/${goals.length} goals completed with active progress on ongoing objectives.`
      : 'No goals tracked in this period.';
  }

  private analyzePatternsSummary(data: DataIndex[]): string {
    const workDays = this.analyzeWorkingDays(data.map(d => ({ context: d.metadata, timestamp: d.timestamp } as SearchResult)));
    return `Worked ${workDays.length} days with consistent ${this.analyzeBestPerformanceTime(data.map(d => ({ context: d.metadata, timestamp: d.timestamp } as SearchResult)))} productivity patterns.`;
  }

  private analyzeAchievementsSummary(data: DataIndex[]): string {
    const achievements = data.filter(d => 
      d.metadata.status === 'completed' || 
      d.sentiment > 0.5
    );
    
    return achievements.length > 0 
      ? `${achievements.length} significant achievements and positive outcomes recorded.`
      : 'Focus on celebrating small wins to build momentum.';
  }

  private analyzeChallengesSummary(data: DataIndex[]): string {
    const challenges = data.filter(d => 
      d.metadata.status === 'failed' ||
      d.sentiment < -0.2 ||
      d.content.includes('problem') ||
      d.content.includes('difficult')
    );
    
    return challenges.length > 0
      ? `${challenges.length} challenges identified with opportunities for process improvement.`
      : 'No significant challenges detected - maintain current momentum.';
  }

  private analyzeWorkingDays(sources: SearchResult[]): string[] {
    const days = [...new Set(sources.map(s => 
      new Date(s.timestamp).toLocaleDateString('en', { weekday: 'long' })
    ))];
    return days;
  }

  private analyzeBestPerformanceTime(sources: SearchResult[]): string {
    const timeDistribution = { morning: 0, afternoon: 0, evening: 0 };
    
    sources.forEach(s => {
      const hour = new Date(s.timestamp).getHours();
      if (hour < 12) timeDistribution.morning++;
      else if (hour < 17) timeDistribution.afternoon++;
      else timeDistribution.evening++;
    });
    
    const maxTime = Object.entries(timeDistribution).reduce((a, b) => a[1] > b[1] ? a : b);
    return maxTime[0];
  }

  private getProductivityTrend(data: DataIndex[]): string {
    const recentData = data.filter(d => 
      d.timestamp > new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    );
    const olderData = data.filter(d => 
      d.timestamp <= new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    );
    
    if (recentData.length > olderData.length) return 'increasing activity';
    if (recentData.length < olderData.length) return 'decreasing activity';
    return 'stable activity levels';
  }

  private getGoalCompletionRate(data: DataIndex[]): number {
    const goals = data.filter(d => d.type === 'goal');
    const completed = goals.filter(g => g.metadata.status === 'completed');
    
    return goals.length > 0 ? Math.round((completed.length / goals.length) * 100) : 0;
  }
}

// 🏭 EXPORT SINGLETON INSTANCE
export const secondBrain = new UltraIntelligentSecondBrain();