'use client';

// src/components/WeeklyPlanning/WpiWeeklyExecutionSummary.tsx
// Minimal embed for the existing `WeeklyExecution` tab. Renders a single,
// non-invasive card that surfaces the count of WPI-tagged TimeBlocks and the
// current completion rate, and points the user to the dedicated "Weekly
// Intelligence" tab for the full review. Consumes only public APIs of the
// engine + DataProvider — no refactor of the host component.

import { useMemo } from 'react';
import {
  calculateWpiWeeklyAnalytics,
  extractWpiKey,
  findMatchingDraftForWeek,
  isTimeBlockInWeek,
  isWpiTimeBlock,
  parseWpiKey,
  type ExistingTimeBlockSnapshot,
} from '@/lib/weeklyPlanner';
import { useDataContext } from '@/providers/DataProvider';

function mondayISO(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayOfWeek = copy.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  copy.setDate(copy.getDate() + diffToMonday);
  const yyyy = copy.getFullYear();
  const mm = String(copy.getMonth() + 1).padStart(2, '0');
  const dd = String(copy.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Compact summary card themed to match the existing dark WeeklyExecution UI.
 * Renders nothing when there are no WPI blocks for the week — keeping the
 * host page unchanged for users who haven't used the feature yet.
 */
export default function WpiWeeklyExecutionSummary() {
  const data = useDataContext();
  const userIdOrLocal =
    data.userId && data.userId.length > 0 ? data.userId : 'local';

  const summary = useMemo(() => {
    const weekStartISO = mondayISO(new Date());
    const snapshots: ExistingTimeBlockSnapshot[] = data.timeBlocks.map((b) => ({
      id: b.id,
      title: b.title,
      notes: b.notes,
      startTime: b.startTime,
      endTime: b.endTime,
      status: b.status,
      type: b.type,
      taskId: b.taskId,
      projectId: b.projectId,
      goalId: b.goalId,
    }));

    const draftIdsInPlay = new Set<string>();
    for (const b of data.timeBlocks) {
      if (!isTimeBlockInWeek(b, weekStartISO)) continue;
      if (!isWpiTimeBlock(b)) continue;
      const key = extractWpiKey(b.notes);
      const parsed = key ? parseWpiKey(key) : null;
      if (parsed) draftIdsInPlay.add(parsed.draftId);
    }
    const matchedDraft = findMatchingDraftForWeek({
      userIdOrLocal,
      weekStartISO,
      draftIdsInPlay: Array.from(draftIdsInPlay),
    });

    const result = calculateWpiWeeklyAnalytics({
      allTimeBlocks: snapshots,
      weekStartISO,
      matchedDraft,
    });
    return { weekStartISO, result };
  }, [data.timeBlocks, userIdOrLocal]);

  const generated = summary.result.weekly.generatedBlocks;
  if (generated === 0) return null;

  const completedPct = Math.round(summary.result.weekly.completionRate * 100);
  const plannedH = Math.round(
    summary.result.weekly.totalPlannedMinutes / 60,
  );

  return (
    <div
      className="mt-4 rounded-xl border border-blue-500/30 bg-blue-900/20 p-3"
      data-testid="wpi-weekly-execution-summary"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">
            Weekly Intelligence
          </p>
          <p className="text-sm text-blue-100 mt-0.5">
            {generated} blocchi WPI · {completedPct}% completati ·{' '}
            {plannedH}h pianificate
          </p>
        </div>
        <p className="text-[10px] text-blue-300/80 text-right">
          Apri la tab &ldquo;Weekly Intelligence&rdquo; per la review
          completa.
        </p>
      </div>
    </div>
  );
}
