# Life Tracker scientific report metrics

Status: deterministic domain contract implemented locally; provider delivery,
scheduling, persistence, rendering, and live acceptance are separate gates.

- Metric schema: `life-tracker-scientific-metrics-v1`
- Report schema: `life-tracker-scientific-report-v1`
- Formula version: `life-tracker-report-formulas-2026-08-25`

## Truth and period rules

- The persisted planning timezone is authoritative. Invalid or absent values use
  the product fallback `Europe/Rome` and surface a data-quality flag.
- A Daily period is one local calendar day. A Weekly period is Monday 00:00 to
  the following Monday 00:00. Both are half-open intervals `[from, to)` resolved
  with Temporal, so Europe/Rome DST days can contain 23 or 25 elapsed hours.
- Planned time comes from valid productive TimeBlocks, clipped to the report
  interval. Deleted, cancelled, break, and buffer blocks are excluded.
- Actual time comes only from completed persisted Sessions and explicit
  `actualStartTime`/`actualEndTime` intervals. `Session.duration` is seconds.
  A linked completed Session wins over the block's explicit actual interval, so
  the same execution cannot be counted twice.
- A completed TimeBlock without a valid completed Session or explicit actual
  interval contributes no actual minutes and creates an explicit missing-actual
  flag. Its planned window is never used as actual time.
- Active and paused Sessions are excluded from finalized totals and reported as
  open Sessions. Missing or truncated Session data is `partial`/`unavailable`,
  never silently converted to zero productivity.
- Time, goal, habit, and task calculations ignore Notes/descriptions as
  instructions. User-authored labels are control-character stripped, length
  bounded, and marked as untrusted display data.

Every metric carries `availability`, `sampleSize`, `missingCount`, `numerator`,
`denominator`, `formula`, and `source`. A partial numeric result means only that
the displayed amount is known; it must not be presented as a complete total.
The pure builder also rejects fixed per-dataset limits (1,000 Goals/Habits,
2,000 Projects, and 5,000 Tasks/TimeBlocks/Sessions/HabitLogs) before
aggregation; a future repository must request a smaller range rather than
silently truncate and label it complete.

## Formula and denominator glossary

| Metric | Formula | Denominator / null rule |
| --- | --- | --- |
| Planned minutes | Sum of eligible TimeBlock overlap minutes | Partial/unavailable when TimeBlock coverage or interval validity is incomplete |
| Actual minutes | Completed Session net minutes plus explicit block actual intervals only when no valid linked Session exists | `null` when actual coverage is incomplete and no known execution source exists |
| Adherence | `actual minutes / planned minutes * 100` | `null` when planned minutes are zero or actual is unknown; values may exceed 100% |
| Variance | `actual minutes - planned minutes` | `null` when either input is unknown |
| TimeBlock completion | Completed-or-overrun productive blocks starting in the period / eligible productive blocks starting in the period | Cancelled/deleted/break/buffer blocks excluded; `null` at N=0 |
| Task completion | Planned tasks fulfilled by period end / planned tasks | A task is planned when due in the period or linked to an eligible period block. A due task is fulfilled only by local due-day end. `null` at N=0 |
| Carryover | Count of planned tasks not fulfilled by period end | Includes open, late, and cancelled outcomes; does not invent a reschedule cause |
| Deep work | Actual minutes with Session tag `deep`, `deep_work`, or `focus`, or linked block type `deep`/`focus` | Shares Actual availability |
| Start delay | Mean of earliest measured actual start minus planned start | Measurable blocks starting in period only; negative values mean an early start |
| Overrun | Sum of `max(0, measured actual - planned)` by measurable block | Does not rely on the legacy `overrun` status label |
| Estimation error (minutes) | Mean absolute block error `mean(abs(actual - planned))` | Measurable blocks starting in period only |
| Estimation error (%) | `sum(abs(actual - planned)) / sum(planned) * 100` | `null` when no measurable planned minutes exist |
| Capacity utilization | `planned minutes / persisted daily-or-weekly capacity * 100` | Capacity comes from authenticated planning preferences, including an explicitly reported product default when necessary |
| Habit adherence | Unique completed expected occurrences / expected occurrences | Daily habits: one per day. Weekly habits: one per Weekly report. Monthly habits are excluded and flagged in v1 because a Daily/Weekly read cannot prove the full-month cadence. Duplicate logs cannot inflate the numerator. `null` at N=0 |
| Completion by time of day | Completed / eligible blocks grouped by scheduled local start hour | Night 00:00-05:59, morning 06:00-11:59, afternoon 12:00-17:59, evening 18:00-23:59 |
| Completion by weekday | Completed / eligible blocks grouped by scheduled local weekday | Monday-first, persisted timezone |
| Goal target minutes | `timeAllocationTarget hours/week * 60 * period days / 7` | `null` when no valid target exists |
| Goal Alignment Index | `100 * (1 - 0.5 * sum(abs(actual share - target share)))` | Union of targeted and actually used/unassigned buckets; `null` without both positive target and actual totals. It measures allocation alignment, not goal success. |
| Four-week trend | Four Monday-Sunday buckets ending with the week containing the report end | Each point preserves actual availability and denominator null rules |
| Schedule volatility | Not calculated | Current schema has no persisted reschedule/version history. `updatedAt` is not treated as evidence of a schedule move. |

## Weekly Execution Index

The Weekly Execution Index is a versioned descriptive composite, not a clinical
or psychological score:

- 30% capped time fulfillment: `min(100, actual/planned*100)`;
- 40% TimeBlock completion;
- 20% planned Task fulfillment;
- 10% Habit adherence.

Components without a denominator are omitted and remaining weights are
renormalized. At least two components are required. Any partial included
component makes the index partial. Extra actual time cannot raise the time
component above 100, and the index never changes underlying metric values.

## Scientific statement discipline

Statements are typed as `OBSERVED`, `DERIVED`, `INFERENCE`, or
`RECOMMENDATION`. Each records the observation period, N, missing count,
baseline, confidence, and uncertainty.

A time-of-day inference is emitted only when at least two buckets each have
N>=3, combined N>=8, and the observed completion difference is at least 20
percentage points. Its language says "associated with," explicitly rejects a
causal claim, and proposes only a bounded two-week within-person experiment.
No medical, psychological, or diagnostic claim is produced.

## Chart integrity

Chart data is generated from the immutable metric bundle, never by a model or a
chart SaaS. Every chart stores the exact metric-bundle SHA-256 and a SHA-256 of
its own canonical data. Rendering may fail independently later, but a renderer
must not recalculate or alter chart values. Planned/actual, goal allocation,
time-of-day completion, and four-week trend charts all preserve partial/null
availability.

## Explicit gaps for later slices

- The pure domain does not read Firestore, schedule a Function, call OpenAI,
  render PNGs, persist archives, or send email.
- A future owner-scoped report repository must prove complete bounded source
  reads over the report plus four-week horizon before marking coverage complete.
- Schedule history must be added as a versioned server-owned event stream before
  schedule volatility can become available.
