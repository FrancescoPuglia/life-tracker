# Analytics Specification

**Project**: Life Tracker
**Version**: 2.0 (Event-Driven Architecture)
**Date**: 2026-01-14
**Status**: Design Proposal

---

## Table of Contents

1. [Philosophy & Goals](#philosophy--goals)
2. [Event Taxonomy](#event-taxonomy)
3. [Canonical Event List](#canonical-event-list)
4. [Event Properties Schema](#event-properties-schema)
5. [Privacy & Security Rules](#privacy--security-rules)
6. [Questions We Can Answer](#questions-we-can-answer)
7. [Implementation Guide](#implementation-guide)

---

## Philosophy & Goals

### North Star Principle
**"ORE REALI FATTE" (Real Hours Done) - Track actual time spent, not just planned time.**

From CLAUDE.md:
> La metrica primaria è: ORE REALI FATTE (actual), non ore pianificate.

### Analytics Goals
1. **Understand user behavior** - What features drive value?
2. **Measure goal progress** - Is the hierarchical rollup working?
3. **Optimize retention** - Why do users return (or churn)?
4. **Validate product hypotheses** - Does auto-scheduler increase completion rate?
5. **Detect issues early** - Error rates, performance regressions

### Design Principles
- **Privacy-first**: No sensitive user data in events
- **Type-safe**: Compile-time event validation
- **Minimal**: Track only what's actionable
- **Deterministic**: Same action = same event
- **Fast**: Zero impact on user experience (async, batched)

---

## Event Taxonomy

### Naming Convention: `snake_case`

**Format**: `<object>_<action>`

Examples:
- `timeblock_created`
- `goal_completed`
- `scheduler_run`
- `error_occurred`

### Event Categories

| Category | Description | Examples |
|----------|-------------|----------|
| **Lifecycle** | User journey milestones | `user_signed_up`, `onboarding_completed` |
| **Core Actions** | Primary user interactions | `timeblock_completed`, `task_created` |
| **Feature Usage** | Specific feature adoption | `scheduler_run`, `analytics_viewed` |
| **Engagement** | Retention signals | `daily_login`, `streak_achieved` |
| **Performance** | System health | `page_loaded`, `api_slow` |
| **Errors** | Failures & bugs | `error_occurred`, `sync_failed` |

---

## Canonical Event List

### Lifecycle Events

#### `user_signed_up`
**When**: New user completes registration
**Properties**:
```typescript
{
  auth_method: 'google' | 'email' | 'guest',
  referral_source?: string,
  device_type: 'mobile' | 'desktop' | 'tablet'
}
```
**Why**: Understand acquisition channels

#### `onboarding_completed`
**When**: User finishes first-time setup flow
**Properties**:
```typescript
{
  steps_completed: number,
  duration_seconds: number,
  first_goal_created: boolean,
  first_timeblock_created: boolean
}
```
**Why**: Optimize onboarding conversion

---

### Core Actions - TimeBlocks (Primary Data Source)

#### `timeblock_created`
**When**: User creates a new time block (planned or manual)
**Properties**:
```typescript
{
  block_id: string, // Redacted (not shown to analysts)
  source: 'manual' | 'auto_scheduler' | 'recurring',
  duration_minutes: number,
  has_task: boolean,
  has_project: boolean,
  has_goal: boolean,
  domain_type: string, // e.g., 'work', 'health', 'learning'
}
```
**Why**: Measure planning behavior

#### `timeblock_started`
**When**: Time block status changes to 'in_progress'
**Properties**:
```typescript
{
  block_id: string,
  started_on_time: boolean, // Did user start within 5 min of planned start?
  delay_minutes?: number
}
```
**Why**: Understand adherence patterns

#### `timeblock_completed`
**When**: Time block status changes to 'completed'
**Properties**:
```typescript
{
  block_id: string,
  planned_duration_minutes: number,
  actual_duration_minutes: number,
  adherence_percentage: number, // (actual / planned) * 100
  has_actual_times: boolean, // Did user track actual start/end?
  overrun_minutes?: number // If went over planned time
}
```
**Why**: **MOST CRITICAL EVENT** - This drives all analytics (per CLAUDE.md)

#### `timeblock_deleted`
**When**: User deletes a time block
**Properties**:
```typescript
{
  block_id: string,
  status_at_deletion: TimeBlockStatus,
  reason: 'manual' | 'cascade' // Cascade = parent goal/project deleted
}
```
**Why**: Detect planning churn

---

### Core Actions - Goals / Projects / Tasks

#### `goal_created`
**When**: New goal created
**Properties**:
```typescript
{
  goal_id: string,
  priority: 'low' | 'medium' | 'high' | 'critical',
  complexity: 'simple' | 'moderate' | 'complex' | 'expert',
  has_target_hours: boolean,
  domain_type: string
}
```
**Why**: Understand goal-setting patterns

#### `goal_completed`
**When**: Goal reaches 100% progress or marked complete
**Properties**:
```typescript
{
  goal_id: string,
  days_to_complete: number,
  planned_hours: number,
  actual_hours: number,
  adherence_percentage: number
}
```
**Why**: Measure goal success rate

#### `project_created`
**When**: New project created
**Properties**:
```typescript
{
  project_id: string,
  goal_id?: string, // Parent goal
  estimated_hours?: number
}
```

#### `task_created`
**When**: New task created
**Properties**:
```typescript
{
  task_id: string,
  project_id?: string,
  goal_id?: string,
  has_due_date: boolean,
  estimated_minutes?: number
}
```

#### `task_completed`
**When**: Task marked as complete
**Properties**:
```typescript
{
  task_id: string,
  days_since_created: number,
  completed_on_time: boolean,
  actual_hours_spent: number
}
```

---

### Feature Usage

#### `scheduler_run`
**When**: Auto-scheduler generates a schedule
**Properties**:
```typescript
{
  tasks_input: number,
  blocks_created: number,
  conflicts_detected: number,
  confidence_score: number, // 0-100
  optimization_mode: 'balanced' | 'deadline' | 'energy' | 'goals',
  duration_ms: number // Scheduler execution time
}
```
**Why**: Measure auto-scheduler adoption and quality

#### `scheduler_block_accepted`
**When**: User accepts auto-scheduled block (doesn't delete it within 24h)
**Properties**:
```typescript
{
  block_id: string,
  acceptance_latency_seconds: number, // Time from creation to acceptance
  completed_as_scheduled: boolean
}
```
**Why**: Validate scheduler effectiveness

#### `analytics_viewed`
**When**: User opens Analytics Dashboard
**Properties**:
```typescript
{
  tab: 'overview' | 'planvsactual' | 'allocation' | 'rankings' | 'correlations',
  time_range: '7d' | '30d' | '90d',
  data_points_shown: number // Non-zero data points
}
```
**Why**: Understand which analytics are valuable

#### `habit_logged`
**When**: User logs a habit for a day
**Properties**:
```typescript
{
  habit_id: string,
  frequency: 'daily' | 'weekly' | 'custom',
  current_streak: number
}
```
**Why**: Track habit engagement

#### `streak_milestone`
**When**: User achieves a streak milestone (7, 30, 100 days)
**Properties**:
```typescript
{
  streak_days: number,
  activity_type: 'timeblock_completion' | 'habit_logging' | 'task_completion'
}
```
**Why**: Gamification effectiveness

---

### Engagement Signals

#### `daily_login`
**When**: User's first activity of the day (any mutation or view)
**Properties**:
```typescript
{
  hour_of_day: number, // 0-23
  day_of_week: 'monday' | 'tuesday' | ...,
  consecutive_days: number, // Current streak
}
```
**Why**: Retention metric

#### `session_duration`
**When**: User closes app or goes inactive for 30+ minutes
**Properties**:
```typescript
{
  duration_seconds: number,
  pages_viewed: number,
  actions_taken: number, // Mutation count (creates, updates, deletes)
}
```
**Why**: Engagement depth

---

### Performance Events

#### `page_loaded`
**When**: Main app mounts
**Properties**:
```typescript
{
  page_type: 'planner' | 'analytics' | 'okr' | 'habits',
  load_time_ms: number,
  data_load_time_ms: number, // Time to fetch from DB
  initial_render_time_ms: number
}
```
**Why**: Performance monitoring

#### `api_call`
**When**: Any API call (if using external APIs)
**Properties**:
```typescript
{
  endpoint: string, // Redacted path params
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  duration_ms: number,
  status_code: number,
  error?: string
}
```
**Why**: API performance and reliability

---

### Error Events

#### `error_occurred`
**When**: Any caught error (React Error Boundary, try-catch, etc.)
**Properties**:
```typescript
{
  error_type: string, // e.g., 'TypeError', 'NetworkError'
  error_message: string, // Redacted (no user data)
  component: string, // React component name or file path
  severity: 'low' | 'medium' | 'high' | 'critical',
  user_action: string, // What user was doing
  stack_trace?: string // First 500 chars, redacted
}
```
**Why**: Detect and fix bugs

#### `sync_failed`
**When**: Firebase/IndexedDB sync fails
**Properties**:
```typescript
{
  sync_direction: 'upload' | 'download',
  data_type: 'timeBlocks' | 'goals' | 'tasks' | 'habits',
  error_code: string,
  retry_count: number
}
```
**Why**: Data integrity monitoring

---

## Event Properties Schema

### Required Common Properties

**Every event must include**:

```typescript
interface BaseEventProperties {
  // Automatically added by tracking system
  event_id: string; // UUID for deduplication
  timestamp: number; // Unix timestamp (ms)
  user_id: string; // Redacted user ID (hashed)
  session_id: string; // Session UUID

  // Environment context
  app_version: string; // e.g., '1.2.0'
  environment: 'development' | 'staging' | 'production';
  platform: 'web' | 'mobile';
  browser: string; // e.g., 'Chrome 120'
  os: string; // e.g., 'macOS 14.2'

  // User context
  user_state: 'guest' | 'logged_in';
  user_timezone: string; // IANA timezone (e.g., 'America/Los_Angeles')
  user_locale: string; // e.g., 'en-US'
  days_since_signup: number; // User cohort

  // Optional performance markers
  page_url?: string; // Current page
  referrer_url?: string;
}
```

### Domain-Specific Properties

**Each event adds its own properties** (documented above in Canonical Event List).

### Property Naming Rules

- `snake_case` for all properties
- Boolean properties: `is_*` or `has_*` (e.g., `is_completed`, `has_deadline`)
- Duration properties: Always include unit suffix (e.g., `duration_ms`, `delay_minutes`)
- Percentages: Always `0-100` range, suffix with `_percentage`
- IDs: Suffix with `_id` (e.g., `task_id`, `goal_id`)

---

## Privacy & Security Rules

### Data Minimization Principle
**Track the minimum data needed to answer product questions.**

### What MUST NEVER Be Logged

❌ **Forbidden Data**:
- Task titles, descriptions, or notes (free-form text)
- Goal titles or descriptions
- Habit names
- User email addresses or names
- IP addresses (unless for fraud detection)
- Geolocation (unless explicitly consented)
- Session recordings without consent
- Personally identifiable information (PII)

### Redaction Policy

✅ **Allowed with Redaction**:
- **User IDs**: Hash with SHA-256 salt (deterministic per environment)
  ```typescript
  user_id: hashUserId(actualUserId) // 'user_a3f2b9c...'
  ```
- **Entity IDs**: Use opaque identifiers
  ```typescript
  task_id: 'task_123' // Don't include title in ID
  ```
- **Error messages**: Strip user data
  ```typescript
  // Before: "Failed to save task 'Buy groceries' for user@example.com"
  // After: "Failed to save task [REDACTED] for user [REDACTED]"
  ```

### User Consent

**Required for**:
- Detailed error logs (stack traces)
- Performance profiling (detailed timing)
- Feature usage tracking

**UI**:
```typescript
// Settings > Privacy
[x] Help improve Life Tracker by sharing anonymous usage data
[ ] Share detailed error reports (helps us fix bugs faster)
```

### GDPR/CCPA Compliance

**User Rights**:
1. **Right to Access**: Export all tracked events via `/api/analytics/export`
2. **Right to Delete**: Purge all events via `/api/analytics/delete`
3. **Right to Opt-Out**: Disable tracking entirely

**Implementation**:
```typescript
if (!userConsent.analytics_enabled) {
  return; // Don't track
}

track({ name: 'timeblock_completed', properties: { /* ... */ } });
```

---

## Questions We Can Answer

### Product Questions

| Question | Events Used | Metric |
|----------|-------------|--------|
| **Does the auto-scheduler increase task completion rate?** | `scheduler_run`, `timeblock_completed`, `scheduler_block_accepted` | Completion rate: auto-scheduled vs manual blocks |
| **Which features drive retention?** | `daily_login`, all feature usage events | DAU/WAU ratio, feature correlation with retention |
| **What's the time-to-first-value (TTFV)?** | `user_signed_up`, `timeblock_completed` | Time from signup to first completed block |
| **Where do users drop off in onboarding?** | `user_signed_up`, `onboarding_completed` | Funnel analysis |
| **Which analytics tabs are most valuable?** | `analytics_viewed` | View counts, time spent per tab |
| **Do streaks improve engagement?** | `streak_milestone`, `daily_login` | Login frequency before/after milestone |

### Operational Questions

| Question | Events Used | Metric |
|----------|-------------|--------|
| **What's the error rate?** | `error_occurred` | Errors per session, error % by component |
| **Are there performance regressions?** | `page_loaded`, `api_call` | p95 load time trend over time |
| **Is sync working reliably?** | `sync_failed`, `timeblock_created` | Sync failure rate, retry success rate |

### User Behavior Questions

| Question | Events Used | Metric |
|----------|-------------|--------|
| **When are users most productive?** | `timeblock_completed` | Completion rate by hour of day |
| **How do users structure their goals?** | `goal_created`, `project_created`, `task_created` | Avg tasks per project, projects per goal |
| **What's the typical planning horizon?** | `timeblock_created` | Avg days between creation and scheduled start |

---

## Implementation Guide

### Step 1: Create Type-Safe Event Catalog

**File**: `src/lib/analytics/events.ts`

```typescript
// Event definitions (compile-time type checking)
export type AnalyticsEvent =
  | { name: 'timeblock_completed'; properties: TimeBlockCompletedProperties }
  | { name: 'goal_created'; properties: GoalCreatedProperties }
  | { name: 'error_occurred'; properties: ErrorOccurredProperties }
  // ... add all events

interface TimeBlockCompletedProperties {
  block_id: string;
  planned_duration_minutes: number;
  actual_duration_minutes: number;
  adherence_percentage: number;
  has_actual_times: boolean;
  overrun_minutes?: number;
}

// ... define all property interfaces
```

### Step 2: Implement Tracking Wrapper

**File**: `src/lib/analytics/index.ts`

```typescript
import { AnalyticsEvent } from './events';

// Config
const ANALYTICS_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true';
const ENVIRONMENT = process.env.NODE_ENV;

// Track function (main entry point)
export function track(event: AnalyticsEvent): void {
  // 1. Check consent
  if (!ANALYTICS_ENABLED || !getUserConsent()) {
    return;
  }

  // 2. Enrich with common properties
  const enrichedEvent = enrichEvent(event);

  // 3. Redact sensitive data
  const redactedEvent = redactEvent(enrichedEvent);

  // 4. Validate schema (dev only)
  if (ENVIRONMENT === 'development') {
    validateEvent(redactedEvent);
  }

  // 5. Send to provider(s)
  sendToProviders(redactedEvent);

  // 6. Log in dev
  if (ENVIRONMENT === 'development') {
    console.log('[Analytics]', event.name, redactedEvent.properties);
  }
}

// Enrich with common properties
function enrichEvent(event: AnalyticsEvent): EnrichedEvent {
  return {
    ...event,
    event_id: generateUUID(),
    timestamp: Date.now(),
    user_id: hashUserId(getCurrentUserId()),
    session_id: getSessionId(),
    app_version: getAppVersion(),
    environment: ENVIRONMENT,
    platform: 'web',
    browser: navigator.userAgent,
    user_state: isGuestUser() ? 'guest' : 'logged_in',
    user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    // ... add all common properties
  };
}

// Redact sensitive data
function redactEvent(event: EnrichedEvent): RedactedEvent {
  // Example: Truncate error messages
  if (event.name === 'error_occurred') {
    event.properties.error_message = event.properties.error_message.slice(0, 100);
    event.properties.stack_trace = redactStackTrace(event.properties.stack_trace);
  }

  return event;
}

// Send to analytics providers
function sendToProviders(event: RedactedEvent): void {
  // Option 1: Send to external provider (PostHog, Mixpanel, etc.)
  // posthog.capture(event.name, event.properties);

  // Option 2: Send to custom endpoint
  // fetch('/api/analytics/track', { method: 'POST', body: JSON.stringify(event) });

  // Option 3: Batch and send every N events or M seconds
  eventBatcher.add(event);
}
```

### Step 3: Add Tracking Callsites

**Example: TimeBlock completion**

**File**: `src/providers/DataProvider.tsx`

```typescript
import { track } from '@/lib/analytics';

async updateTimeBlock(id: string, updates: Partial<TimeBlock>): Promise<void> {
  const oldBlock = this.timeBlocks.find(b => b.id === id);

  // Update in DB
  await db.update('timeBlocks', { id, ...updates, updatedAt: new Date() });

  // Refresh data
  await this.loadTimeBlocks();

  // 🎯 TRACK EVENT
  if (updates.status === 'completed' && oldBlock?.status !== 'completed') {
    const block = this.timeBlocks.find(b => b.id === id)!;

    track({
      name: 'timeblock_completed',
      properties: {
        block_id: block.id,
        planned_duration_minutes: (block.endTime.getTime() - block.startTime.getTime()) / 60000,
        actual_duration_minutes: block.actualEndTime && block.actualStartTime
          ? (block.actualEndTime.getTime() - block.actualStartTime.getTime()) / 60000
          : (block.endTime.getTime() - block.startTime.getTime()) / 60000,
        adherence_percentage: /* calculate */,
        has_actual_times: !!(block.actualStartTime && block.actualEndTime),
        overrun_minutes: /* calculate if relevant */
      }
    });

    // Also invalidate analytics cache
    analyticsCache.invalidate('planVsActual');
  }
}
```

### Step 4: Set Up Event-Driven Analytics Updates

**File**: `src/lib/analytics/cache.ts`

```typescript
// Subscribe to relevant events
addEventListener('timeblock_completed', () => {
  analyticsCache.invalidate(['planVsActual', 'timeAllocation']);
});

addEventListener('goal_completed', () => {
  analyticsCache.invalidate(['goalAnalytics']);
});

// Lazy recalculation with cache
export async function getPlanVsActual(userId: string, days: number) {
  const cacheKey = `planVsActual:${userId}:${days}`;

  if (analyticsCache.has(cacheKey)) {
    return analyticsCache.get(cacheKey);
  }

  const data = await db.calculatePlanVsActualData(userId, days);
  analyticsCache.set(cacheKey, data, { ttl: 60000 }); // 1 min TTL
  return data;
}
```

### Step 5: Add Tests

**File**: `src/lib/analytics/__tests__/tracking.test.ts`

```typescript
import { track } from '../index';

describe('Analytics Tracking', () => {
  it('should enrich events with common properties', () => {
    const mockSend = vi.fn();
    vi.mock('../providers', () => ({ sendToProviders: mockSend }));

    track({ name: 'timeblock_completed', properties: { /* ... */ } });

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      event_id: expect.any(String),
      timestamp: expect.any(Number),
      user_id: expect.any(String),
      app_version: expect.any(String),
    }));
  });

  it('should redact sensitive data from error messages', () => {
    // Test redaction logic
  });

  it('should not track when consent is not given', () => {
    // Test consent check
  });
});
```

---

## Migration Plan

### Immediate Actions (Week 1)
1. ✅ Create this spec document
2. ✅ Get stakeholder buy-in
3. ⚠️ Choose analytics provider (or build custom endpoint)
4. ⚠️ Implement tracking wrapper (`src/lib/analytics/`)
5. ⚠️ Add consent UI

### Phase 1 (Week 2)
**Focus**: Core events only
- `timeblock_completed`
- `goal_created`, `goal_completed`
- `task_completed`
- `error_occurred`
- `daily_login`

### Phase 2 (Week 3)
**Focus**: Feature usage + engagement
- `scheduler_run`, `scheduler_block_accepted`
- `analytics_viewed`
- `habit_logged`, `streak_milestone`
- `session_duration`

### Phase 3 (Week 4)
**Focus**: Performance + observability
- `page_loaded`, `api_call`
- `sync_failed`
- Admin debug dashboard

---

## Success Criteria

- [ ] **Type safety**: All events compile with TypeScript strict mode
- [ ] **Test coverage**: 80%+ for tracking logic
- [ ] **Performance**: Tracking adds < 10ms overhead per event
- [ ] **Privacy**: Zero PII leakage (audit with sample data export)
- [ ] **Adoption**: 100% of critical user actions tracked
- [ ] **Retention**: Can answer "Which features predict 30-day retention?" with data

---

**End of Analytics Specification**

Next steps:
1. Review with team
2. Choose analytics provider
3. Begin Phase 1 implementation
4. Set up monitoring dashboard

Generated by: Claude Code (Sonnet 4.5)
