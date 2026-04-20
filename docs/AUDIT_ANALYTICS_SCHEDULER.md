# Analytics & Auto-Scheduler Audit Report

**Project**: Life Tracker
**Date**: 2026-01-14
**Auditor**: Claude Code (Senior Staff Engineer + Product Analytics Lead)
**Scope**: Complete audit of Analytics pipeline and Auto-Scheduler system

---

## Executive Summary

This audit reveals **critical gaps** in analytics data collection and calculation, along with timezone/reliability concerns in the Auto-Scheduler. The analytics dashboard is currently showing empty or minimal data despite user activity, indicating a **broken data pipeline** between data generation and analytics calculation.

### Critical Findings

1. **Analytics showing 0 hours despite completed time blocks** - Data exists but isn't being surfaced
2. **Plan vs Actual chart only showing 1 data point** (2026-01-06) instead of full date range
3. **No centralized event tracking** - analytics are calculated on-demand, not event-driven
4. **Auto-Scheduler lacks timezone awareness** - DST and timezone boundary bugs likely
5. **No observability** - debugging requires manual console.log archaeology
6. **Fragmented data sources** - Sessions vs TimeBlocks with inconsistent rollup logic

---

## A. CURRENT STATE OVERVIEW

### A1. Analytics Infrastructure

#### Providers & SDK Integration
- **No external analytics provider** (no GA4, PostHog, Mixpanel, etc.)
- **Custom implementation** using `src/lib/database.ts` analytics methods
- **Debug logging only** via `src/lib/analyticsDebug.ts` (dev-only console output)
- **No structured telemetry** or error tracking service (no Sentry, etc.)

#### Event Tracking Locations
Current "analytics" is **computed on-demand**, not event-based:

**File**: `src/components/MainApp.tsx:133-197`
- Loads analytics via `db.calculatePlanVsActualData()`
- Loads on mount + when `timeRange` changes
- **Problem**: Expensive recalculation every time, no event-driven updates

**File**: `src/lib/database.ts` (LifeTrackerDB class)
- `calculatePlanVsActualData()` - Line 512-653
- `calculateTimeAllocation()` - Line 655-726
- `calculateFocusTrend()` - Line 727-783
- `calculateCorrelations()` - Line 785-822
- `generateWeeklyReview()` - Line 872-954

**Hierarchical Rollup**: `src/lib/hierarchicalRollup.ts`
- `performHierarchicalRollup()` - calculates actual hours from TimeBlocks
- `rollupForCompletedTimeBlock()` - triggered when TimeBlock completed
- **Issue**: Rollup happens, but analytics don't immediately reflect it

#### Dashboard Components
- **Primary**: `src/components/AnalyticsDashboard.tsx` (599 lines)
- **Goal-specific**: `src/components/GoalAnalyticsDashboard.tsx`
- **Engine**: `src/lib/goalAnalyticsEngine.ts` (972 lines, comprehensive)

#### Web Vitals / Performance
- **None** - No Next.js performance monitoring
- **No RUM** (Real User Monitoring)
- **No Core Web Vitals tracking** (LCP, FID, CLS)

#### Error Logging
- **Console only** - `console.error()`, `console.warn()`
- **No structured logging**
- **No error aggregation service**
- **No error rate tracking**

---

### A2. Auto-Scheduler Infrastructure

#### Scheduling Engine
**File**: `src/lib/autoScheduler.ts` (857 lines)
- **Class**: `SuperSmartAutoScheduler` implements `AutoScheduler` interface
- **Optimization passes**:
  1. Deadline pressure optimization
  2. Energy optimization
  3. Goal alignment optimization
  4. User preference optimization
- **Score-based selection** - picks best schedule from multiple passes

#### Scheduling UI
**File**: `src/components/SmartScheduler.tsx` (518 lines)
- React component with state management
- **Auto-generation**: Runs 1 second after tasks load (line 246)
- **Constraint building**: `buildSchedulingConstraints()` at line 94
- **Energy profile**: Hardcoded hourly profile (line 48-51)

#### Scheduling Logic Flow
1. Tasks + constraints → `autoScheduler.schedule()`
2. Multiple optimization passes run in parallel
3. Best schedule selected by quality score
4. Alternatives generated
5. Result rendered in UI with confidence %

#### Current Decision Logic
- **Time slot generation**: 15-minute intervals within working hours
- **Slot quality scoring**: Energy match + deadline urgency + goal alignment
- **Conflict detection**: Overlap checking with existing blocks
- **Fallback**: Sequential 9 AM start if all optimization fails

---

## B. GAPS & RISKS (Prioritized)

### B1. Analytics - Critical Issues

#### ❌ CRITICAL: Broken Data Pipeline
**Location**: `src/lib/database.ts:512-653` (`calculatePlanVsActualData`)

**Problem**:
```typescript
// Line 563-650: Loops through date range but produces sparse results
for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
  // Calculates planned/actual for each day
  // BUT: Only returns data for days with TimeBlocks
  // Screenshot shows only 2026-01-06 has a data point
}
```

**Root Cause**: The function correctly iterates through the date range but may be:
1. Filtering out days with 0 hours (should still show them as 0)
2. TimeBlock date filtering logic may have timezone bugs
3. User's actual completed blocks may not match expected date range

**Impact**: Dashboard shows "no data" message despite user activity

**Evidence**: Screenshot shows:
- Date range: 2026-01-05 to 2026-01-12
- Only 1 data point visible (2026-01-06)
- Message: "Your analytics are empty because you haven't completed any time blocks yet!"
- But the message is misleading - user may have completed blocks

#### ❌ CRITICAL: Dual Data Sources (Sessions vs TimeBlocks)
**Location**: `src/lib/database.ts:620-638`

```typescript
// Lines 604-618: Calculate actual from TimeBlocks
let actualMinutes = dayTimeBlocks
  .filter(block => block.status === 'completed')
  .reduce((total, block) => { /* ... */ }, 0);

// Lines 620-638: ALSO calculate from Sessions
const allSessions = await this.getAll<Session>('sessions');
const daySessions = allSessions.filter(/* ... */);
const sessionMinutes = daySessions.reduce(/* ... */, 0);

// Line 636-638: Use whichever is higher (!)
if (sessionMinutes > actualMinutes) {
  actualMinutes = sessionMinutes;
}
```

**Problem**: Mixing two data sources with "take the max" logic is:
1. Non-deterministic - depends on which source user uses
2. Can double-count if both exist
3. Confusing for debugging
4. Violates single source of truth principle

**Fix**: Choose ONE authoritative source based on CLAUDE.md ("ORE REALI FATTE" = TimeBlocks completed)

#### ⚠️ HIGH: No Event-Driven Updates
**Location**: `src/components/MainApp.tsx:133-197`

```typescript
useEffect(() => {
  // Recalculates ALL analytics every time timeRange changes
  const loadAnalytics = async () => {
    const [planVsActual, timeAllocation, focusTrend, ...] = await Promise.all([
      db.calculatePlanVsActualData(data.userId, days),
      db.calculateTimeAllocation(data.userId, days),
      // ... expensive calculations
    ]);
  };
}, [timeRange, data.userId, data.status]);
```

**Problems**:
1. **Expensive**: Recalculates everything on every render
2. **Stale data**: Doesn't update when new TimeBlock completed
3. **No caching**: Same calculations repeated
4. **Performance**: Scales poorly with data growth

**Fix**: Event-driven architecture:
```typescript
// When TimeBlock completed:
1. Update rollup (already happens via hierarchicalRollup.ts)
2. Invalidate analytics cache
3. Re-render affected dashboards
```

#### ⚠️ HIGH: Inconsistent Event Naming
**Current "events" (manual console.logs)**:
- `📊 ANALYTICS DEBUG - Loading Analytics Data`
- `⚡ AUTO-SCHEDULER: Starting SUPREMO mode`
- `🎯 Hierarchical Rollup Complete:`
- `🔥 DEADLINE PRESSURE PASS`

**Problems**:
1. No standard naming convention
2. Mix of emoji, CAPS, and descriptions
3. Not structured for parsing/aggregation
4. Can't be disabled in production
5. No severity levels

#### ⚠️ HIGH: No Privacy Policy
**Current state**: No analytics privacy rules defined

**Risks**:
1. Could log sensitive user data (task titles, notes, etc.)
2. No redaction strategy
3. No consent mechanism
4. GDPR/CCPA compliance risk

#### 🔶 MEDIUM: Missing Key Product Events
**What's NOT tracked**:
- User onboarding flow completion
- Feature discovery (which tabs used)
- Error rates per feature
- Time to first value (TTFV)
- Retention cohorts
- Churn signals (long inactivity)
- Performance metrics (load times)

#### 🔶 MEDIUM: No A/B Test Infrastructure
**Current**: No way to:
- Run experiments
- Measure feature impact
- Compare variants
- Statistical significance testing

---

### B2. Auto-Scheduler - Critical Issues

#### ❌ CRITICAL: No Timezone Handling
**Location**: `src/lib/autoScheduler.ts` (entire file)

**Problems**:
```typescript
// Line 437-458: generateTimeSlotsForDay
const startTime = new Date(date);
startTime.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
// ❌ setHours uses LOCAL timezone, but date might be UTC
```

**Timezone bugs**:
1. **User in PST, server in UTC**: "9 AM" becomes "5 PM UTC"
2. **DST transitions**: March/November breaks slot generation
3. **"Today" boundary**: Midnight varies by timezone
4. **Cross-day scheduling**: Events can leak to wrong day

**Test case that fails**:
```typescript
// User in Tokyo (UTC+9) schedules 9 AM tomorrow
// Server in UTC generates slot for "tomorrow" but at wrong hour
// Result: Slot appears 9 hours off
```

#### ❌ CRITICAL: No Idempotency
**Location**: `src/lib/autoScheduler.ts:524-544` (`createTimeBlockFromSlot`)

```typescript
return {
  id: `auto-scheduled-${task.id}-${Date.now()}`,  // ❌ Always unique!
  // ...
};
```

**Problem**: Running scheduler twice creates duplicate blocks
- No deduplication logic
- No "already scheduled" check
- Can fill calendar with duplicates on retry

**Fix**: Use deterministic IDs:
```typescript
id: `auto-scheduled-${task.id}-${slot.start}-${slot.date}`
```

#### ⚠️ HIGH: Race Conditions
**Location**: `src/lib/autoScheduler.ts:50-104` (main schedule loop)

**Scenario**:
1. User triggers auto-schedule
2. While running, user manually creates TimeBlock
3. Auto-scheduler doesn't see it (stale `existingBlocks`)
4. Creates overlapping block

**Fix**: Lock mechanism or optimistic concurrency

#### ⚠️ HIGH: No Explainability
**Current**: Minimal reasoning

```typescript
reasoning: 'Optimized for deadline compliance with energy and preference consideration'
// ❌ Too vague - user can't understand WHY a specific slot was chosen
```

**Fix**: Detailed reasons:
```json
{
  "slot": "2026-01-15 10:00-11:00",
  "score": 0.87,
  "reasons": [
    "High energy time (0.9)",
    "Task has deadline in 3 days (urgency: 0.8)",
    "No conflicts",
    "Matches user preference: morning work"
  ]
}
```

#### 🔶 MEDIUM: Hardcoded Energy Profile
**Location**: `src/components/SmartScheduler.tsx:48-51`

```typescript
const [energyProfile, setEnergyProfile] = useState<Record<string, number>>({
  '9': 0.8, '10': 0.9, '11': 0.9, '12': 0.7,
  '13': 0.5, '14': 0.6, '15': 0.7, '16': 0.8, '17': 0.6
});
// ❌ Same for all users!
```

**Fix**: Learn from user's actual completion patterns:
- Track which hours have highest task completion
- Adjust energy profile over time
- Per-user, per-day-of-week profiles

#### 🔶 MEDIUM: No Recurrence Handling
**Missing**: Weekly/monthly recurring tasks logic
**Impact**: Can't auto-schedule "Every Monday standup"

---

### B3. Observability Gaps

#### ❌ CRITICAL: No Error Tracking
- **No Sentry** or error aggregation
- **Console only** - errors disappear
- **No error rates** - can't detect regressions
- **No alerting** - silent failures

#### ⚠️ HIGH: No Performance Monitoring
- **No APM** (Application Performance Monitoring)
- **No slow query detection**
- **No render time tracking**
- **No bundle size monitoring**

#### ⚠️ HIGH: Debug Logs in Production
**Location**: Throughout codebase

```typescript
if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEBUG_ANALYTICS === '1') {
  console.log('📊 ANALYTICS DEBUG:', ...);
}
```

**Problem**: Can be enabled in production via env var, leaking internal state

---

## C. PROPOSED PLAN (Phased)

### Phase 1: Emergency Triage (Week 1)

**Goal**: Fix broken analytics display and critical scheduler bugs

#### 1.1 Analytics Data Pipeline Fix
**File**: `src/lib/database.ts`

- [ ] **Fix date range iteration** - ensure all days returned, even with 0 hours
- [ ] **Fix timezone handling** in date comparisons
- [ ] **Remove dual source logic** - use TimeBlocks only (per CLAUDE.md)
- [ ] **Add debug endpoint** - `GET /api/debug/analytics?userId=X&days=7` returns raw data
- [ ] **Write tests** for `calculatePlanVsActualData`:
  ```typescript
  test('should return data for all days in range, including days with 0 hours')
  test('should use actualStartTime/actualEndTime when available')
  test('should handle timezone boundaries correctly')
  test('should exclude soft-deleted blocks')
  ```

#### 1.2 Scheduler Timezone Fix
**File**: `src/lib/autoScheduler.ts`

- [ ] **Add timezone parameter** to all scheduling functions
- [ ] **Use date-fns-tz** for timezone-aware date manipulation
  ```bash
  npm install date-fns date-fns-tz
  ```
- [ ] **Fix `generateTimeSlotsForDay`** - use timezone offsets
- [ ] **Add timezone tests**:
  ```typescript
  test('should generate correct slots for PST user')
  test('should handle DST transitions gracefully')
  test('should respect user locale for "today"')
  ```

#### 1.3 Idempotency Fix
- [ ] **Deterministic IDs** for auto-scheduled blocks
- [ ] **Deduplication check** before creating
- [ ] **Conflict resolution** strategy (keep manual > auto-scheduled)

#### 1.4 Safety Net
- [ ] **Add test coverage** - current: unknown%, target: 80%+
- [ ] **Add integration tests** for analytics pipeline:
  ```typescript
  test('completing a TimeBlock updates analytics within 1 second')
  test('analytics dashboard reflects completed TimeBlock')
  ```
- [ ] **Smoke tests** for scheduler:
  ```typescript
  test('scheduler does not create duplicate blocks on retry')
  test('scheduler respects existing manual blocks')
  ```

---

### Phase 2: Architecture Improvements (Week 2-3)

**Goal**: Event-driven analytics, typed events, scheduler refactor

#### 2.1 Centralized Event Tracking
**New file**: `src/lib/analytics/index.ts`

```typescript
// Event catalog (type-safe)
type AnalyticsEvent =
  | { name: 'timeblock_completed'; properties: { duration: number; taskId?: string } }
  | { name: 'goal_created'; properties: { goalId: string; priority: string } }
  | { name: 'scheduler_run'; properties: { blocksCreated: number; confidence: number } }
  | { name: 'error_occurred'; properties: { errorType: string; component: string } };

// Track function
export function track(event: AnalyticsEvent) {
  // 1. Validate event shape (compile-time type check)
  // 2. Enrich with common properties (userId, timestamp, environment)
  // 3. Redact sensitive data
  // 4. Send to provider(s)
  // 5. Log to console in dev
}

// Usage
track({
  name: 'timeblock_completed',
  properties: { duration: 3600, taskId: 'task-123' }
});
```

#### 2.2 Event-Driven Analytics Cache
**New file**: `src/lib/analytics/cache.ts`

```typescript
// Invalidate cache on relevant events
addEventListener('timeblock_completed', () => {
  analyticsCache.invalidate('planVsActual');
});

// Lazy recalculation
export async function getPlanVsActual(userId: string, days: number) {
  const cacheKey = `planVsActual:${userId}:${days}`;

  if (analyticsCache.has(cacheKey) && !analyticsCache.isStale(cacheKey)) {
    return analyticsCache.get(cacheKey);
  }

  const data = await db.calculatePlanVsActualData(userId, days);
  analyticsCache.set(cacheKey, data, { ttl: 60000 }); // 1 minute
  return data;
}
```

#### 2.3 Scheduler Pure Core Refactor
**New file**: `src/lib/autoScheduler/core.ts`

```typescript
// Pure function - no side effects
export function generateOptimalSchedule(
  tasks: Task[],
  constraints: SchedulingConstraints,
  existingBlocks: TimeBlock[],
  timezone: string // ✅ Explicit timezone
): SchedulingResult {
  // Deterministic scheduling logic
  // No database calls
  // No Date.now() - use constraints.currentTime
  // Fully testable
}

// Impure wrapper - handles side effects
export async function scheduleAndPersist(
  tasks: Task[],
  constraints: SchedulingConstraints,
  timezone: string
): Promise<{ schedule: TimeBlock[]; conflicts: Conflict[] }> {
  const existingBlocks = await db.getAll<TimeBlock>('timeBlocks');
  const result = generateOptimalSchedule(tasks, constraints, existingBlocks, timezone);

  // Deduplicate
  const newBlocks = result.schedule.filter(b => !existingBlocks.some(e => e.id === b.id));

  // Persist
  await Promise.all(newBlocks.map(b => db.create('timeBlocks', b)));

  return { schedule: newBlocks, conflicts: result.conflicts };
}
```

#### 2.4 Scheduler Explainability
```typescript
interface SchedulingDecision {
  timeBlock: TimeBlock;
  score: number;
  scoreBreakdown: {
    energyAlignment: number;
    deadlineUrgency: number;
    goalAlignment: number;
    contextSwitching: number;
  };
  reasoning: string[]; // Human-readable reasons
  alternatives: Array<{ slot: TimeSlot; score: number; whyNotChosen: string }>;
}
```

---

### Phase 3: Observability & Dashboards (Week 4)

**Goal**: Production-grade monitoring, debugging tools

#### 3.1 Error Tracking
- [ ] **Add Sentry** (or similar):
  ```bash
  npm install @sentry/nextjs
  ```
- [ ] **Configure error boundaries** in React
- [ ] **Track error rates** per feature
- [ ] **Alert on error spikes**

#### 3.2 Performance Monitoring
- [ ] **Add Next.js performance monitoring**:
  ```typescript
  // pages/_app.tsx
  export function reportWebVitals(metric: NextWebVitalsMetric) {
    track({ name: 'web_vital', properties: metric });
  }
  ```
- [ ] **Track API endpoint latency**
- [ ] **Monitor database query performance**

#### 3.3 Admin Debug Dashboard
**New page**: `/admin/debug`

- Analytics data inspector (raw JSON)
- Scheduler dry-run simulator
- Event log viewer (last 100 events)
- Performance metrics (p50, p95, p99)
- Error log aggregation

#### 3.4 Scheduler Simulation Harness
**New script**: `npm run scheduler:simulate`

```bash
# Simulate scheduler across date range
npm run scheduler:simulate -- --user=user123 --start=2026-01-15 --end=2026-01-31

# Output:
# - Schedule preview (no writes)
# - Conflict report
# - Energy alignment score
# - Alternative schedules
```

---

## D. SUCCESS METRICS

### Analytics
- [ ] **Data completeness**: 100% of date range shows in charts (even 0 hours)
- [ ] **Real-time updates**: Dashboard reflects TimeBlock completion within 1 second
- [ ] **Performance**: Analytics load < 500ms for 90 days of data
- [ ] **Test coverage**: 80%+ for analytics calculation functions

### Auto-Scheduler
- [ ] **Timezone correctness**: 100% pass rate on timezone tests (PST, EST, UTC, Tokyo)
- [ ] **Idempotency**: Running scheduler twice creates 0 duplicates
- [ ] **Conflict rate**: < 5% of scheduled blocks conflict with manual blocks
- [ ] **User satisfaction**: Avg confidence score > 70%

### Observability
- [ ] **Error detection**: All errors logged to Sentry
- [ ] **Performance monitoring**: Core Web Vitals tracked and alerting set up
- [ ] **Debug visibility**: < 5 minutes to diagnose analytics issues via admin dashboard

---

## E. CRITICAL FILES MAP

### Analytics
| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/lib/database.ts` | Analytics calculation engine | ~2000 | ⚠️ Needs timezone + dual-source fixes |
| `src/lib/analyticsDebug.ts` | Debug logging utilities | 81 | ✅ OK for dev, needs structured replacement |
| `src/components/AnalyticsDashboard.tsx` | Primary analytics UI | 599 | ⚠️ Needs event-driven updates |
| `src/lib/goalAnalyticsEngine.ts` | Goal-specific analytics | 972 | ✅ Well-structured, needs integration |
| `src/lib/hierarchicalRollup.ts` | Rollup calculation | 265 | ✅ Good, needs real-time cache invalidation |
| `src/components/MainApp.tsx` | Analytics loading orchestration | 150-197 | ⚠️ Needs event-driven refactor |

### Auto-Scheduler
| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/lib/autoScheduler.ts` | Scheduling engine core | 857 | ❌ CRITICAL: Needs timezone + idempotency fixes |
| `src/components/SmartScheduler.tsx` | Scheduler UI | 518 | ⚠️ Hardcoded energy profile, needs user learning |
| `src/types/ai-enhanced.ts` | Type definitions | Unknown | ✅ Assumed OK (not read) |

### Data Layer
| File | Role | Lines | Status |
|------|------|-------|--------|
| `src/providers/DataProvider.tsx` | React context for data | 200+ | ⚠️ Needs event emission on mutations |
| `src/lib/database.ts` | Database abstraction (Firebase/IndexedDB) | ~2000 | ⚠️ Analytics methods need refactor |

---

## F. NEXT STEPS

1. **Review this audit** with product/engineering team
2. **Prioritize Phase 1 items** - emergency fixes
3. **Allocate engineering time** - estimate 2-3 weeks for Phases 1-2
4. **Set up observability first** - can't fix what you can't see
5. **Write tests as you fix** - prevent regressions

---

## G. QUESTIONS FOR STAKEHOLDERS

1. **Analytics provider preference?** (Self-hosted vs SaaS like PostHog)
2. **Privacy requirements?** (GDPR, CCPA compliance needs)
3. **Error budget?** (Acceptable error rate, downtime tolerance)
4. **Scheduler behavior on conflict?** (Prefer manual, auto, or prompt user?)
5. **Timezone strategy?** (Infer from browser, ask user, or server-side detection?)

---

**End of Audit Report**

Generated by: Claude Code (Sonnet 4.5)
Version: 2026-01-14
