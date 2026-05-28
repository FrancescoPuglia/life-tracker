'use client';

// src/components/WeeklyPlanning/DraftWeekCalendar.tsx
// Read-only 7-column draft week view. Every card is explicitly stamped
// "Draft" so there's never any confusion that nothing is persisted yet.

import type {
  DraftTimeBlock,
  PlanConflict,
  PlanWarning,
  WeekDay,
} from '@/lib/weeklyPlanner';
import {
  activityStyle,
  confidenceLabel,
  dayLabelLong,
  dayLabelShort,
  durationLabel,
} from './weeklyPlanningUi';

export interface DraftWeekCalendarProps {
  blocks: ReadonlyArray<DraftTimeBlock>;
  conflicts: ReadonlyArray<PlanConflict>;
  warnings: ReadonlyArray<PlanWarning>;
}

const ALL_DAYS: ReadonlyArray<WeekDay> = [0, 1, 2, 3, 4, 5, 6];

export default function DraftWeekCalendar({
  blocks,
  conflicts,
  warnings,
}: DraftWeekCalendarProps) {
  const flaggedBlockIds = new Set<string>([
    ...conflicts.flatMap((c) => c.blockIds),
    ...warnings.flatMap((w) => w.blockIds),
  ]);

  const byDay = new Map<WeekDay, DraftTimeBlock[]>();
  for (const d of ALL_DAYS) byDay.set(d, []);
  for (const b of blocks) {
    const arr = byDay.get(b.day);
    if (arr) arr.push(b);
  }
  for (const d of ALL_DAYS) {
    const arr = byDay.get(d);
    if (arr)
      arr.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
  }

  return (
    <section
      aria-label="Draft week calendar"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
      data-testid="draft-week-calendar"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Bozza settimanale
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Questi blocchi non sono ancora salvati nel calendario reale.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
          ⚠ Draft only — non salvato
        </span>
      </header>

      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-7">
        {ALL_DAYS.map((day) => {
          const dayBlocks = byDay.get(day) ?? [];
          return (
            <div
              key={day}
              className="rounded-xl border border-gray-100 bg-gray-50/60 min-h-[160px] flex flex-col"
            >
              <div className="px-3 py-2 border-b border-gray-100 flex items-baseline justify-between">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  title={dayLabelLong(day)}
                >
                  {dayLabelShort(day)}
                </span>
                {dayBlocks.length > 0 && (
                  <span className="text-[10px] text-gray-400">
                    {dayBlocks.length} blocco{dayBlocks.length === 1 ? '' : 'hi'}
                  </span>
                )}
              </div>

              <ul className="flex-1 p-2 space-y-2">
                {dayBlocks.length === 0 ? (
                  <li className="text-[11px] text-gray-300 italic px-1.5 py-1">
                    nessun blocco
                  </li>
                ) : (
                  dayBlocks.map((block) => (
                    <DraftBlockCard
                      key={block.id}
                      block={block}
                      flagged={flaggedBlockIds.has(block.id)}
                    />
                  ))
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// Block card
// ============================================================================

function DraftBlockCard({
  block,
  flagged,
}: {
  block: DraftTimeBlock;
  flagged: boolean;
}) {
  const style = activityStyle(block.activityType);
  return (
    <li
      className={`rounded-lg bg-white border border-gray-100 ${style.accent} border-l-4 px-2.5 py-2 shadow-sm ${flagged ? 'ring-1 ring-rose-200' : ''}`}
      data-testid="draft-block"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-gray-900">
          {block.startTime}–{block.endTime}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${style.badge}`}
          title={style.label}
        >
          {style.emoji}
        </span>
      </div>

      <div
        className="text-[12px] font-medium text-gray-800 mt-0.5 truncate"
        title={block.label}
      >
        {block.label}
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500">
        <span>{durationLabel(block.durationMinutes)}</span>
        {block.mapping && block.mapping.status !== 'maintenance' && (
          <span title={block.mapping.reason}>
            conf. {confidenceLabel(block.mapping.confidence)}
          </span>
        )}
      </div>

      {flagged && (
        <p className="mt-1 text-[10px] text-rose-600">
          Conflitto rilevato — verifica nel pannello sotto.
        </p>
      )}
      <p className="mt-1 text-[9px] uppercase tracking-wider text-amber-600 font-semibold">
        Draft
      </p>
    </li>
  );
}
