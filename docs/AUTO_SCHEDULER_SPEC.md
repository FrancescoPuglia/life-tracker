# Auto-Scheduler Specification

**Project**: Life Tracker
**Version**: 2.0 (Deterministic, Timezone-Aware, Explainable)
**Date**: 2026-01-14
**Status**: Design Proposal

---

## Table of Contents

1. [Core Principles & Invariants](#core-principles--invariants)
2. [Architecture](#architecture)
3. [Scheduling Algorithm](#scheduling-algorithm)
4. [Timezone Handling](#timezone-handling)
5. [Conflict Resolution](#conflict-resolution)
6. [Explainability](#explainability)
7. [Edge Cases](#edge-cases)
8. [Testing Strategy](#testing-strategy)
9. [Performance Requirements](#performance-requirements)

---

## Core Principles & Invariants

### Non-Negotiable Invariants

#### 1. Determinism
**Same inputs → Same outputs**

```typescript
// MUST always produce identical schedule for identical inputs
const result1 = schedule(tasks, constraints, timezone, seed);
const result2 = schedule(tasks, constraints, timezone, seed);
assert(deepEqual(result1, result2));
```

**Implementation**:
- No `Date.now()` inside algorithm - use `constraints.currentTime`
- No `Math.random()` - use seeded PRNG
- Sort all arrays before iteration (stable ordering)

#### 2. Idempotency
**Repeated runs don't duplicate blocks**

```typescript
// Run twice with same inputs
schedule(tasks, constraints);
schedule(tasks, constraints);

// Should NOT create duplicate blocks
const blocks = await db.getAll('timeBlocks');
const autoblocks = blocks.filter(b => b.id.startsWith('auto-scheduled-'));
assert(autoblocks.length === expectedCount); // Not 2x
```

**Implementation**:
- Deterministic IDs: `auto-scheduled-${taskId}-${slotStart}-${date}`
- Deduplication check before creating blocks
- "Upsert" semantics - update if exists, create if not

#### 3. Timezone Correctness
**"9 AM" means 9 AM in user's timezone**

```typescript
// User in PST (UTC-8)
const slot = findSlot(task, { timezone: 'America/Los_Angeles', hour: 9 });

// Slot.startTime MUST be 9:00 AM PST (17:00 UTC)
assert(slot.startTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }).includes('9:00'));
```

**Implementation**:
- All scheduling uses IANA timezone strings (`America/Los_Angeles`, not `PST`)
- Use `date-fns-tz` for timezone-aware date arithmetic
- Never use `setHours()` without timezone context

#### 4. Conflict Avoidance
**No overlaps with existing blocks (unless explicitly allowed)**

```typescript
// Existing block: 2026-01-15 10:00-11:00
// Scheduled block MUST NOT overlap
const scheduled = schedule(tasks, { existingBlocks: [existingBlock] });

assert(!hasOverlap(scheduled.schedule, existingBlocks));
```

**Implementation**:
- Check all existing blocks before assigning slot
- Conflict detection: `(newStart < existingEnd) && (newEnd > existingStart)`
- Optional: Allow user-configurable overlap tolerance (e.g., 5 min buffer)

#### 5. Priority Respect
**Higher priority tasks get better slots**

```typescript
// High-priority task gets high-energy morning slot
// Low-priority task gets afternoon/evening slot

const result = schedule([highPriorityTask, lowPriorityTask], constraints);

const highSlotHour = result.schedule.find(b => b.taskId === highPriorityTask.id).startTime.getHours();
const lowSlotHour = result.schedule.find(b => b.taskId === lowPriorityTask.id).startTime.getHours();

assert(highSlotHour < lowSlotHour); // High priority earlier in day
```

---

## Architecture

### Current Architecture (v1.0)

```
User Input (Tasks, Constraints)
  ↓
SuperSmartAutoScheduler.schedule()
  ↓
Multiple Optimization Passes (Parallel)
  ├─ scheduleByDeadlinePressure()
  ├─ scheduleByEnergyOptimization()
  ├─ scheduleByGoalAlignment()
  └─ scheduleByUserPreferences()
  ↓
Select Best Schedule (Score-Based)
  ↓
Generate Alternatives
  ↓
Return SchedulingResult
  ↓
UI Renders + User Applies
  ↓
Direct DB Write (TimeBlocks created)
```

**Problems**:
- ❌ Timezone-naive date handling
- ❌ No idempotency (duplicates on retry)
- ❌ No explainability (why this slot?)
- ❌ Mixed pure/impure logic (hard to test)

---

### Proposed Architecture (v2.0)

```
User Input (Tasks, Constraints, Timezone)
  ↓
┌─────────────────────────────────────────────────┐
│ PURE CORE (No Side Effects)                     │
│                                                   │
│ generateOptimalSchedule(                         │
│   tasks: Task[],                                 │
│   constraints: SchedulingConstraints,            │
│   existingBlocks: TimeBlock[],                   │
│   timezone: string,                              │
│   currentTime: Date                               │
│ ): SchedulingResult                              │
│                                                   │
│ - Deterministic (seeded random)                  │
│ - Timezone-aware (date-fns-tz)                   │
│ - Explainable (reasoning trail)                  │
│ - Testable (no DB, no network)                   │
└─────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────┐
│ IMPURE WRAPPER (Side Effects)                   │
│                                                   │
│ scheduleAndPersist(                              │
│   tasks: Task[],                                 │
│   constraints: SchedulingConstraints,            │
│   timezone: string                               │
│ ): Promise<{ blocks: TimeBlock[], conflicts }>  │
│                                                   │
│ - Fetch existing blocks from DB                  │
│ - Call pure core                                 │
│ - Deduplicate results                            │
│ - Persist to DB                                  │
│ - Track analytics event                          │
└─────────────────────────────────────────────────┘
  ↓
UI Updates + User Review
```

**Benefits**:
- ✅ Easy to test (pure functions)
- ✅ Easy to reason about (no hidden state)
- ✅ Easy to simulate (dry-run without DB)
- ✅ Easy to debug (deterministic)

---

## Scheduling Algorithm

### Input

```typescript
interface SchedulingInput {
  tasks: Task[]; // Tasks to schedule
  constraints: SchedulingConstraints;
  existingBlocks: TimeBlock[]; // Already scheduled
  timezone: string; // IANA timezone (e.g., 'America/Los_Angeles')
  currentTime: Date; // For determinism
  seed?: number; // Random seed (for reproducibility)
}

interface SchedulingConstraints {
  userPreferences: UserPreferences;
  energyProfile: EnergyProfile;
  deadlines: Deadline[];
  bufferPreferences: BufferPreferences;
}
```

### Output

```typescript
interface SchedulingResult {
  schedule: TimeBlock[]; // Recommended blocks
  conflicts: SchedulingConflict[]; // Tasks that couldn't be scheduled
  alternatives: AlternativeSchedule[]; // Other options
  reasoning: SchedulingReasoning; // Why these decisions?
  confidence: number; // 0-100 score
}

interface SchedulingReasoning {
  decisions: SchedulingDecision[]; // One per scheduled block
  unscheduledReasons: Record<string, string>; // Why task X wasn't scheduled
}

interface SchedulingDecision {
  taskId: string;
  timeBlock: TimeBlock;
  slot: TimeSlot;
  score: number; // 0-1 quality score
  scoreBreakdown: {
    energyAlignment: number; // 0-1
    deadlineUrgency: number; // 0-1
    goalAlignment: number; // 0-1
    contextSwitching: number; // 0-1
    userPreference: number; // 0-1
  };
  reasoning: string[]; // Human-readable reasons
  alternatives: Array<{
    slot: TimeSlot;
    score: number;
    whyNotChosen: string;
  }>;
}
```

### Algorithm Overview

```typescript
function generateOptimalSchedule(input: SchedulingInput): SchedulingResult {
  const { tasks, constraints, existingBlocks, timezone, currentTime, seed } = input;

  // 1. Initialize PRNG with seed
  const rng = seedRandom(seed ?? 42);

  // 2. Sort tasks by priority (deterministic ordering)
  const sortedTasks = sortTasksByPriority(tasks);

  // 3. Generate candidate time slots (timezone-aware)
  const candidateSlots = generateTimeSlots(constraints, timezone, currentTime);

  // 4. For each task, find optimal slot
  const decisions: SchedulingDecision[] = [];
  const unscheduled: Record<string, string> = {};

  for (const task of sortedTasks) {
    // Score all available slots for this task
    const slotsWithScores = candidateSlots
      .filter(slot => isSlotAvailable(slot, existingBlocks, decisions))
      .map(slot => ({
        slot,
        score: scoreSlot(task, slot, constraints, timezone),
        scoreBreakdown: scoreSlotDetailed(task, slot, constraints, timezone)
      }))
      .sort((a, b) => b.score - a.score);

    if (slotsWithScores.length === 0) {
      // Cannot schedule this task
      unscheduled[task.id] = determineUnscheduledReason(task, candidateSlots, constraints);
      continue;
    }

    // Pick best slot
    const best = slotsWithScores[0];

    // Create decision record
    decisions.push({
      taskId: task.id,
      timeBlock: createTimeBlock(task, best.slot, timezone),
      slot: best.slot,
      score: best.score,
      scoreBreakdown: best.scoreBreakdown,
      reasoning: generateReasoning(task, best, slotsWithScores.slice(1, 4)),
      alternatives: slotsWithScores.slice(1, 4).map(alt => ({
        slot: alt.slot,
        score: alt.score,
        whyNotChosen: `Lower score (${alt.score.toFixed(2)} vs ${best.score.toFixed(2)})`
      }))
    });
  }

  // 5. Generate conflicts for unscheduled tasks
  const conflicts = generateConflicts(unscheduled, tasks);

  // 6. Generate alternative schedules (different optimization modes)
  const alternatives = generateAlternativeSchedules(input, decisions, rng);

  // 7. Calculate overall confidence
  const confidence = calculateConfidence(decisions, conflicts);

  return {
    schedule: decisions.map(d => d.timeBlock),
    conflicts,
    alternatives,
    reasoning: {
      decisions,
      unscheduledReasons: unscheduled
    },
    confidence
  };
}
```

### Slot Scoring

**Weighted formula**:
```
slotScore =
  w1 * energyAlignment +
  w2 * deadlineUrgency +
  w3 * goalAlignment +
  w4 * contextSwitchingPenalty +
  w5 * userPreferenceMatch

Default weights:
  w1 = 0.25 (Energy)
  w2 = 0.30 (Deadline)
  w3 = 0.20 (Goal)
  w4 = 0.10 (Context)
  w5 = 0.15 (Preference)
```

**Energy Alignment**:
```typescript
function scoreEnergyAlignment(task: Task, slot: TimeSlot, energyProfile: EnergyProfile): number {
  const slotHour = getHourInTimezone(slot.start, timezone);
  const userEnergyAtHour = energyProfile.hourlyProfile[slotHour] ?? 0.5;

  const taskEnergyRequirement = estimateTaskEnergyRequirement(task);
  // taskEnergyRequirement: 0-1 (0=low, 1=high)

  // Perfect match = 1.0, mismatch = 0.0
  return 1 - Math.abs(userEnergyAtHour - taskEnergyRequirement);
}
```

**Deadline Urgency**:
```typescript
function scoreDeadlineUrgency(task: Task, slot: TimeSlot, currentTime: Date): number {
  if (!task.dueDate) return 0;

  const slotTime = parseSlotTime(slot.start);
  const daysUntilDeadline = daysBetween(slotTime, task.dueDate);

  if (daysUntilDeadline < 0) return 0; // Deadline passed
  if (daysUntilDeadline <= 1) return 1.0; // Very urgent
  if (daysUntilDeadline <= 3) return 0.8;
  if (daysUntilDeadline <= 7) return 0.6;
  if (daysUntilDeadline <= 14) return 0.4;

  return 0.2; // Low urgency
}
```

**Goal Alignment**:
```typescript
function scoreGoalAlignment(task: Task, goals: Goal[]): number {
  if (!task.goalId) return 0.4; // No goal = neutral

  const goal = goals.find(g => g.id === task.goalId);
  if (!goal) return 0.4;

  // Higher priority goals get better slots
  const priorityScore = {
    critical: 1.0,
    high: 0.8,
    medium: 0.6,
    low: 0.4
  }[goal.priority] ?? 0.5;

  return priorityScore;
}
```

---

## Timezone Handling

### Problem Statement

**Scenario**: User in Tokyo (UTC+9) schedules tasks for "tomorrow 9 AM"

**Without timezone awareness**:
```typescript
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(9, 0, 0, 0); // ❌ 9 AM in SERVER timezone (might be UTC)
// Stored: 2026-01-16T09:00:00.000Z (9 AM UTC)
// User sees: 2026-01-16 18:00 (6 PM Tokyo time) ❌ WRONG
```

**With timezone awareness**:
```typescript
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);

// Create "9 AM Tokyo time"
const tokyoTime = zonedTimeToUtc(
  new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0),
  'Asia/Tokyo'
);
// Stored: 2026-01-16T00:00:00.000Z (9 AM Tokyo = midnight UTC)
// User sees: 2026-01-16 09:00 (9 AM Tokyo time) ✅ CORRECT
```

### Implementation

**Dependency**: `date-fns` + `date-fns-tz`

```bash
npm install date-fns date-fns-tz
```

**Core Functions**:

```typescript
import { zonedTimeToUtc, utcToZonedTime, format } from 'date-fns-tz';
import { addDays, startOfDay } from 'date-fns';

// Convert user's "9 AM tomorrow" to UTC timestamp
export function createScheduledTimeInUserTimezone(
  date: Date, // Calendar date
  hour: number, // 0-23
  minute: number, // 0-59
  timezone: string // IANA timezone
): Date {
  // Create date in user's timezone
  const localDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hour,
    minute,
    0,
    0
  );

  // Convert to UTC
  return zonedTimeToUtc(localDate, timezone);
}

// Get hour of day in user's timezone
export function getHourInTimezone(utcDate: Date, timezone: string): number {
  const zonedDate = utcToZonedTime(utcDate, timezone);
  return zonedDate.getHours();
}

// Check if two dates are on same day in user's timezone
export function isSameDayInTimezone(date1: Date, date2: Date, timezone: string): boolean {
  const zoned1 = utcToZonedTime(date1, timezone);
  const zoned2 = utcToZonedTime(date2, timezone);

  return (
    zoned1.getFullYear() === zoned2.getFullYear() &&
    zoned1.getMonth() === zoned2.getMonth() &&
    zoned1.getDate() === zoned2.getDate()
  );
}
```

**Generate Slots (Timezone-Aware)**:

```typescript
function generateTimeSlots(
  constraints: SchedulingConstraints,
  timezone: string,
  currentTime: Date
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const workStart = parseTime(constraints.userPreferences.workingHours.start); // e.g., "09:00" → 9
  const workEnd = parseTime(constraints.userPreferences.workingHours.end); // e.g., "17:00" → 17

  const schedulingDays = 14; // 2 weeks ahead

  for (let dayOffset = 0; dayOffset < schedulingDays; dayOffset++) {
    // Get start of day in user's timezone
    const dayStart = utcToZonedTime(addDays(currentTime, dayOffset), timezone);
    dayStart.setHours(0, 0, 0, 0);

    // Generate slots for working hours
    for (let hour = workStart; hour < workEnd; hour++) {
      for (let minute of [0, 30]) { // 30-min intervals
        const slotStart = createScheduledTimeInUserTimezone(
          dayStart,
          hour,
          minute,
          timezone
        );

        const slotEnd = addMinutes(slotStart, 30);

        slots.push({
          start: slotStart,
          end: slotEnd,
          timezone
        });
      }
    }
  }

  return slots;
}
```

### DST Handling

**Problem**: Daylight Saving Time transitions create ambiguous or non-existent hours

**Example**: In PST, on March 10, 2024:
- 2:00 AM → 3:00 AM (2:30 AM doesn't exist!)

**Solution**: `date-fns-tz` handles this automatically
```typescript
// Non-existent time (2:30 AM on DST transition day)
const slotStart = createScheduledTimeInUserTimezone(
  new Date(2024, 2, 10), // March 10, 2024
  2,
  30,
  'America/Los_Angeles'
);
// date-fns-tz returns 3:30 AM (after "spring forward")
```

---

## Conflict Resolution

### Conflict Types

1. **Hard Conflict**: Complete overlap
   ```
   Existing: [10:00 ───────── 11:00]
   Proposed: [10:30 ─── 11:30]
   ```

2. **Soft Conflict**: Partial overlap
   ```
   Existing: [10:00 ──── 10:45]
   Proposed:           [10:30 ─── 11:00]
   ```

3. **Buffer Conflict**: Within buffer zone
   ```
   Existing: [10:00 ─── 11:00] (15 min buffer before/after)
   Proposed:     [11:05 ─── 11:35] (only 5 min gap)
   ```

### Resolution Strategy

**Priority Order** (user-configurable):
1. Manual blocks > Auto-scheduled blocks
2. High-priority tasks > Low-priority tasks
3. Earlier deadlines > Later deadlines
4. Existing blocks > New blocks (don't move what's already there)

**Algorithm**:
```typescript
function resolveConflict(
  existingBlock: TimeBlock,
  proposedBlock: TimeBlock,
  strategy: 'prefer_manual' | 'prefer_deadline' | 'prefer_priority'
): 'keep_existing' | 'keep_proposed' | 'split' | 'move_proposed' {
  // 1. Never override manual blocks
  if (existingBlock.source !== 'auto_scheduler') {
    return 'keep_existing';
  }

  // 2. Check deadline urgency
  if (strategy === 'prefer_deadline') {
    if (isMoreUrgent(proposedBlock, existingBlock)) {
      return 'move_proposed'; // Move proposed to another slot, keep existing
    }
  }

  // 3. Check priority
  if (strategy === 'prefer_priority') {
    if (hasHigherPriority(proposedBlock, existingBlock)) {
      return 'move_proposed';
    }
  }

  // 4. Default: Keep existing
  return 'keep_existing';
}
```

---

## Explainability

### Why Explainability Matters

Users need to understand **why** the scheduler made specific decisions to:
1. Trust the system
2. Override bad decisions
3. Learn their own patterns

### Decision Record Structure

```typescript
interface SchedulingDecision {
  taskId: string;
  taskTitle: string; // For display only
  timeBlock: TimeBlock;
  score: number; // Overall quality score (0-1)

  scoreBreakdown: {
    energyAlignment: number; // 0-1
    deadlineUrgency: number; // 0-1
    goalAlignment: number; // 0-1
    contextSwitching: number; // 0-1
    userPreference: number; // 0-1
  };

  reasoning: string[]; // Human-readable explanations
  // Example:
  // [
  //   "High energy time (9 AM, user energy: 90%)",
  //   "Deadline in 2 days (urgency: high)",
  //   "Aligned with 'Launch Product' goal (priority: critical)",
  //   "No conflicts with existing schedule"
  // ]

  alternatives: Array<{
    slot: TimeSlot;
    score: number;
    whyNotChosen: string;
    // Example: "Lower energy time (2 PM, user energy: 50%)"
  }>;
}
```

### UI Display

```typescript
// Explainability Card (shown when user clicks on auto-scheduled block)
<div className="explainability-card">
  <h4>Why this time slot?</h4>

  <div className="score-breakdown">
    <div className="score-item">
      <span className="label">Energy Match</span>
      <ProgressBar value={decision.scoreBreakdown.energyAlignment} />
      <span className="value">{Math.round(decision.scoreBreakdown.energyAlignment * 100)}%</span>
    </div>
    <div className="score-item">
      <span className="label">Deadline Urgency</span>
      <ProgressBar value={decision.scoreBreakdown.deadlineUrgency} />
      <span className="value">{Math.round(decision.scoreBreakdown.deadlineUrgency * 100)}%</span>
    </div>
    {/* ... more scores ... */}
  </div>

  <div className="reasoning">
    <h5>Reasons:</h5>
    <ul>
      {decision.reasoning.map((reason, i) => (
        <li key={i}>{reason}</li>
      ))}
    </ul>
  </div>

  <details>
    <summary>See alternative slots</summary>
    <ul>
      {decision.alternatives.map((alt, i) => (
        <li key={i}>
          <strong>{formatTimeSlot(alt.slot)}</strong>
          <span className="score">(score: {alt.score.toFixed(2)})</span>
          <span className="reason">{alt.whyNotChosen}</span>
        </li>
      ))}
    </ul>
  </details>
</div>
```

---

## Edge Cases

### Test Coverage Requirements

All edge cases below **MUST** have automated tests.

#### 1. Timezone Boundaries

**Test**: User in UTC-8 (PST), schedule for midnight
```typescript
test('should handle midnight boundary correctly in PST', () => {
  const result = generateOptimalSchedule({
    tasks: [createTask({ title: 'Midnight task' })],
    constraints: createConstraints({
      workingHours: { start: '00:00', end: '01:00' }
    }),
    timezone: 'America/Los_Angeles',
    currentTime: new Date('2026-01-15T08:00:00Z') // 2026-01-15 00:00 PST
  });

  const block = result.schedule[0];
  const blockHourPST = getHourInTimezone(block.startTime, 'America/Los_Angeles');

  expect(blockHourPST).toBe(0); // Midnight PST
});
```

#### 2. DST Transitions

**Test**: Schedule during "spring forward" (2:00 AM → 3:00 AM)
```typescript
test('should handle DST spring forward gracefully', () => {
  const result = generateOptimalSchedule({
    tasks: [createTask()],
    constraints: createConstraints({
      workingHours: { start: '02:00', end: '03:00' } // Non-existent hour
    }),
    timezone: 'America/Los_Angeles',
    currentTime: new Date('2026-03-08T00:00:00Z') // DST transition day
  });

  // Should schedule at 3:00 AM (after spring forward)
  const blockHour = getHourInTimezone(result.schedule[0].startTime, 'America/Los_Angeles');
  expect(blockHour).toBe(3);
});
```

**Test**: Schedule during "fall back" (1:00 AM → 2:00 AM → 1:00 AM)
```typescript
test('should handle DST fall back gracefully', () => {
  // Implementation: Always use second occurrence of 1:00 AM
});
```

#### 3. Concurrent Scheduler Runs

**Test**: Two scheduler runs at same time shouldn't create duplicates
```typescript
test('should be idempotent under concurrent runs', async () => {
  const input = createSchedulingInput();

  const [result1, result2] = await Promise.all([
    scheduleAndPersist(input.tasks, input.constraints, input.timezone),
    scheduleAndPersist(input.tasks, input.constraints, input.timezone)
  ]);

  // Both should succeed, but total blocks = expected count (not 2x)
  const allBlocks = await db.getAll<TimeBlock>('timeBlocks');
  const autoBlocks = allBlocks.filter(b => b.id.startsWith('auto-scheduled-'));

  expect(autoBlocks.length).toBe(input.tasks.length); // Not 2x
});
```

#### 4. Empty Task List

**Test**: Scheduling with no tasks should return empty schedule
```typescript
test('should handle empty task list gracefully', () => {
  const result = generateOptimalSchedule({
    tasks: [],
    constraints: createConstraints(),
    timezone: 'UTC',
    currentTime: new Date()
  });

  expect(result.schedule).toEqual([]);
  expect(result.conflicts).toEqual([]);
  expect(result.confidence).toBe(1.0); // Perfect confidence (nothing to schedule)
});
```

#### 5. All Slots Occupied

**Test**: No available slots should report conflicts
```typescript
test('should report conflicts when all slots occupied', () => {
  const existingBlocks = createFullDayBlocks(); // 9 AM - 5 PM completely booked

  const result = generateOptimalSchedule({
    tasks: [createTask()],
    constraints: createConstraints(),
    existingBlocks,
    timezone: 'UTC',
    currentTime: new Date()
  });

  expect(result.schedule).toEqual([]);
  expect(result.conflicts.length).toBe(1);
  expect(result.conflicts[0].type).toBe('no_available_slots');
});
```

#### 6. Task Longer Than Working Day

**Test**: 10-hour task in 8-hour workday should split or extend
```typescript
test('should handle task longer than working day', () => {
  const longTask = createTask({ estimatedMinutes: 600 }); // 10 hours

  const result = generateOptimalSchedule({
    tasks: [longTask],
    constraints: createConstraints({
      workingHours: { start: '09:00', end: '17:00' } // 8 hours
    }),
    timezone: 'UTC',
    currentTime: new Date()
  });

  // Should either:
  // 1. Split into 2 days (Day 1: 8h, Day 2: 2h)
  // 2. Report as conflict (cannot fit)

  if (result.schedule.length > 0) {
    const totalScheduled = result.schedule.reduce((sum, block) => {
      return sum + (block.endTime.getTime() - block.startTime.getTime()) / 3600000;
    }, 0);

    expect(totalScheduled).toBe(10); // Full 10 hours scheduled
  } else {
    expect(result.conflicts.length).toBe(1);
  }
});
```

#### 7. Recurrence (Future Feature)

**Test**: Weekly recurring task should schedule every Monday
```typescript
test('should schedule recurring task every week', () => {
  const recurringTask = createTask({
    recurrence: { frequency: 'weekly', dayOfWeek: 'monday' }
  });

  const result = generateOptimalSchedule({
    tasks: [recurringTask],
    constraints: createConstraints(),
    timezone: 'UTC',
    currentTime: new Date('2026-01-12T00:00:00Z'), // Monday
    schedulingWindow: 28 // 4 weeks
  });

  // Should create 4 blocks (one per Monday)
  expect(result.schedule.length).toBe(4);

  result.schedule.forEach(block => {
    const dayOfWeek = getHourInTimezone(block.startTime, 'UTC');
    expect(dayOfWeek).toBe(1); // Monday
  });
});
```

---

## Testing Strategy

### Unit Tests (Pure Functions)

**File**: `src/lib/autoScheduler/core.test.ts`

```typescript
describe('Scheduler Core', () => {
  describe('generateOptimalSchedule', () => {
    it('should be deterministic given same seed', () => {
      const input = createInput();

      const result1 = generateOptimalSchedule({ ...input, seed: 42 });
      const result2 = generateOptimalSchedule({ ...input, seed: 42 });

      expect(result1).toEqual(result2);
    });

    it('should return all days in range for planVsActual', () => {
      // Test all 7 edge cases above
    });
  });

  describe('scoreSlot', () => {
    it('should give higher score to high-energy slots for high-energy tasks', () => {
      const highEnergyTask = createTask({ title: 'Deep work: Design system' });
      const slot9AM = createSlot({ hour: 9 });
      const slot2PM = createSlot({ hour: 14 });

      const score9AM = scoreSlot(highEnergyTask, slot9AM, constraints, 'UTC');
      const score2PM = scoreSlot(highEnergyTask, slot2PM, constraints, 'UTC');

      expect(score9AM).toBeGreaterThan(score2PM);
    });
  });
});
```

### Integration Tests (With DB)

**File**: `src/lib/autoScheduler/integration.test.ts`

```typescript
describe('Scheduler Integration', () => {
  it('should not create duplicate blocks on retry', async () => {
    const tasks = [createTask()];
    const constraints = createConstraints();

    await scheduleAndPersist(tasks, constraints, 'UTC');
    await scheduleAndPersist(tasks, constraints, 'UTC'); // Retry

    const blocks = await db.getAll<TimeBlock>('timeBlocks');
    const autoBlocks = blocks.filter(b => b.id.startsWith('auto-scheduled-'));

    expect(autoBlocks.length).toBe(tasks.length); // Not 2x
  });
});
```

### Simulation Tests (Golden Test)

**File**: `src/lib/autoScheduler/simulation.test.ts`

```typescript
describe('Scheduler Simulation', () => {
  it('should match golden output for standard scenario', () => {
    const input = loadGoldenInput('standard-scenario.json');
    const result = generateOptimalSchedule(input);

    const expectedOutput = loadGoldenOutput('standard-scenario-expected.json');

    expect(result).toMatchObject(expectedOutput);
  });
});
```

### Property-Based Tests (Optional, Advanced)

**File**: `src/lib/autoScheduler/properties.test.ts`

```typescript
import { fc } from 'fast-check';

describe('Scheduler Properties', () => {
  it('should never create overlapping blocks', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryTask(), { minLength: 1, maxLength: 10 }),
        fc.record({
          timezone: fc.constantFrom('UTC', 'America/Los_Angeles', 'Asia/Tokyo'),
          currentTime: fc.date()
        }),
        (tasks, { timezone, currentTime }) => {
          const result = generateOptimalSchedule({
            tasks,
            constraints: createConstraints(),
            existingBlocks: [],
            timezone,
            currentTime
          });

          // Property: No two blocks should overlap
          for (let i = 0; i < result.schedule.length; i++) {
            for (let j = i + 1; j < result.schedule.length; j++) {
              const block1 = result.schedule[i];
              const block2 = result.schedule[j];

              expect(hasOverlap(block1, block2)).toBe(false);
            }
          }
        }
      )
    );
  });
});
```

---

## Performance Requirements

### Target Metrics

| Scenario | Target | Acceptance |
|----------|--------|------------|
| **Small** (< 10 tasks) | < 100ms | < 200ms |
| **Medium** (10-50 tasks) | < 500ms | < 1s |
| **Large** (50-200 tasks) | < 2s | < 5s |
| **Huge** (200+ tasks) | < 5s | < 10s |

### Optimization Strategies

1. **Slot generation**: Cache reusable slots per day
2. **Scoring**: Memoize task energy requirements
3. **Conflict detection**: Use interval tree (O(log n) instead of O(n))
4. **Parallel optimization passes**: Already implemented
5. **Web Worker**: Offload scheduling to background thread (future)

### Performance Tests

```typescript
describe('Scheduler Performance', () => {
  it('should schedule 100 tasks in under 2 seconds', async () => {
    const tasks = Array.from({ length: 100 }, () => createTask());

    const startTime = Date.now();
    const result = generateOptimalSchedule({
      tasks,
      constraints: createConstraints(),
      existingBlocks: [],
      timezone: 'UTC',
      currentTime: new Date()
    });
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(2000); // 2 seconds
    expect(result.schedule.length).toBeGreaterThan(0);
  });
});
```

---

## Migration Path

### Phase 1: Critical Fixes (Week 1)

- [ ] Add timezone parameter to all scheduling functions
- [ ] Use `date-fns-tz` for date manipulation
- [ ] Implement deterministic IDs
- [ ] Add deduplication logic
- [ ] Write timezone edge case tests

### Phase 2: Pure Core Refactor (Week 2)

- [ ] Extract pure `generateOptimalSchedule` function
- [ ] Move DB logic to impure wrapper
- [ ] Add explainability (SchedulingDecision records)
- [ ] Write simulation harness

### Phase 3: Advanced Features (Week 3+)

- [ ] Recurrence support
- [ ] User energy learning (adaptive profiles)
- [ ] Conflict resolution UI
- [ ] Performance optimizations (interval tree, memoization)

---

## Success Criteria

- [ ] **Timezone correctness**: 100% pass rate on timezone edge cases
- [ ] **Idempotency**: 0 duplicates on retry (integration test)
- [ ] **Determinism**: Same seed → same output (unit test)
- [ ] **Performance**: < 2s for 100 tasks (performance test)
- [ ] **Explainability**: Every scheduled block has reasoning
- [ ] **Test coverage**: 90%+ for scheduler core

---

**End of Auto-Scheduler Specification**

Next steps:
1. Review with team
2. Begin Phase 1 implementation (timezone fixes)
3. Set up test infrastructure
4. Deploy simulation harness for QA

Generated by: Claude Code (Sonnet 4.5)
