// src/lib/goalArchitect/parserTypes.ts
// AST types produced by the parser and consumed by the normalizer/compiler.
//
// The parsed AST is intentionally *loose*: titles are strings, priority/unit
// arrive as free-form strings, dates are pre-normalized to YYYY-MM-DD if the
// parser was confident enough but stay undefined when they could not be
// resolved. The normalized AST is the strongly-typed counterpart: priority is
// a `DraftPriority`, KR `unit` is a `KeyResultUnit`, dates are validated.

import type { DraftPriority, KeyResultUnit } from './types';

// ============================================================================
// PARSE ISSUE
// ============================================================================

export type GoalArchitectParseIssueSeverity = 'info' | 'warning' | 'error';

export interface GoalArchitectParseIssue {
  code: string;
  severity: GoalArchitectParseIssueSeverity;
  message: string;
  sourceText?: string;
  line?: number;
  segment?: string;
  suggestion?: string;
}

// ============================================================================
// SPAN
// ============================================================================

export interface ParsedTextSpan {
  raw: string;
  normalized: string;
  start?: number;
  end?: number;
}

// ============================================================================
// PARSED NODES (loose strings for priority / unit)
// ============================================================================

export interface ParsedGoalNode {
  title?: string;
  description?: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: string;
  sourceText?: string;
  confidence: number;
}

export interface ParsedProjectNode {
  title: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: string;
  sourceText?: string;
  confidence: number;
}

export interface ParsedTaskNode {
  title: string;
  projectTitle?: string;
  estimatedHours?: number;
  dueDateISO?: string;
  priority?: string;
  sourceText?: string;
  confidence: number;
}

export interface ParsedKeyResultNode {
  title: string;
  targetValue?: number;
  currentValue?: number;
  unit?: string;
  sourceText?: string;
  confidence: number;
}

// ============================================================================
// AST
// ============================================================================

export interface GoalArchitectParsedAst {
  sourceText: string;
  normalizedText: string;
  goal?: ParsedGoalNode;
  projects: ParsedProjectNode[];
  tasks: ParsedTaskNode[];
  keyResults: ParsedKeyResultNode[];
  issues: GoalArchitectParseIssue[];
  confidence: number;
}

// ============================================================================
// NORMALIZED AST (typed priority / unit)
// ============================================================================

export interface NormalizedGoalNode {
  title?: string;
  description?: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
  sourceText?: string;
  confidence: number;
}

export interface NormalizedProjectNode {
  title: string;
  targetHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
  sourceText?: string;
  confidence: number;
}

export interface NormalizedTaskNode {
  title: string;
  projectTitle?: string;
  estimatedHours?: number;
  dueDateISO?: string;
  priority?: DraftPriority;
  sourceText?: string;
  confidence: number;
}

export interface NormalizedKeyResultNode {
  title: string;
  targetValue?: number;
  currentValue?: number;
  unit?: KeyResultUnit;
  customUnit?: string;
  sourceText?: string;
  confidence: number;
}

export interface NormalizedGoalArchitectAst {
  sourceText: string;
  normalizedText: string;
  goal?: NormalizedGoalNode;
  projects: NormalizedProjectNode[];
  tasks: NormalizedTaskNode[];
  keyResults: NormalizedKeyResultNode[];
  issues: GoalArchitectParseIssue[];
  confidence: number;
}
