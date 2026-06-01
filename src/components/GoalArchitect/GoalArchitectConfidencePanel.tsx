'use client';

// src/components/GoalArchitect/GoalArchitectConfidencePanel.tsx
// Visual breakdown of overall + per-field confidence on the goal draft.

import type {
  DraftConfidence,
  FieldConfidence,
} from '@/lib/goalArchitect';
import {
  confidenceLabel,
  interpretConfidence,
} from './goalArchitectUi';

export interface GoalArchitectConfidencePanelProps {
  confidence: DraftConfidence;
}

const FIELDS: ReadonlyArray<{
  key: keyof Omit<DraftConfidence, 'overall'>;
  label: string;
}> = [
  { key: 'title', label: 'Title' },
  { key: 'hours', label: 'Hours' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'hierarchy', label: 'Hierarchy' },
];

export default function GoalArchitectConfidencePanel({
  confidence,
}: GoalArchitectConfidencePanelProps) {
  const overall = interpretConfidence(confidence.overall);
  return (
    <section
      aria-label="Draft confidence"
      data-testid="goal-architect-confidence"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Confidence</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Stima della qualità interpretativa per il Goal.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${overall.badge}`}
        >
          Overall {overall.label} · {confidenceLabel(confidence.overall)}
        </span>
      </header>

      <div className="px-5 py-4 space-y-3">
        <ConfidenceBar label="Overall" value={confidence.overall} />
        {FIELDS.map((f) => {
          const fc = confidence[f.key];
          return (
            <FieldRow
              key={f.key}
              label={f.label}
              field={fc}
            />
          );
        })}
      </div>
    </section>
  );
}

function FieldRow({
  label,
  field,
}: {
  label: string;
  field: FieldConfidence | undefined;
}) {
  if (!field) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs text-gray-400">
        <span className="font-medium text-gray-500">{label}</span>
        <span>not estimated</span>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs text-gray-600">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="tabular-nums">{confidenceLabel(field.value)}</span>
      </div>
      <ConfidenceBar value={field.value} hideLabel />
      {field.reason && (
        <p className="text-[10px] text-gray-400 mt-1">{field.reason}</p>
      )}
    </div>
  );
}

function ConfidenceBar({
  value,
  label,
  hideLabel = false,
}: {
  value: number;
  label?: string;
  hideLabel?: boolean;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const verdict = interpretConfidence(v);
  return (
    <div className="mt-1">
      {!hideLabel && label && (
        <div className="flex items-center justify-between gap-3 text-xs text-gray-600 mb-1">
          <span className="font-medium text-gray-700">{label}</span>
          <span className="tabular-nums">{confidenceLabel(v)}</span>
        </div>
      )}
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full ${verdict.bar}`}
          style={{ width: `${Math.round(v * 100)}%` }}
        />
      </div>
    </div>
  );
}
