'use client';

// src/components/GoalArchitect/KeyResultDraftPanel.tsx
// Editable list of KeyResultDraft entries linked to the Goal.

import { ChangeEvent } from 'react';
import type {
  GoalArchitectIssue,
  KeyResultDraft,
  KeyResultUnit,
} from '@/lib/goalArchitect';
import {
  confidenceLabel,
  interpretConfidence,
  keyResultUnitLabel,
} from './goalArchitectUi';

export interface KeyResultDraftEdit {
  title?: string;
  targetValue?: number;
  currentValue?: number;
  unit?: KeyResultUnit;
  customUnit?: string;
}

export interface KeyResultDraftPanelProps {
  keyResults: ReadonlyArray<KeyResultDraft>;
  issues: ReadonlyArray<GoalArchitectIssue>;
  onChange: (keyResultId: string, patch: KeyResultDraftEdit) => void;
}

const UNIT_OPTIONS: ReadonlyArray<{ value: '' | KeyResultUnit; label: string }> = [
  { value: '', label: '—' },
  { value: 'percent', label: '%' },
  { value: 'hours', label: 'h' },
  { value: 'days', label: 'days' },
  { value: 'sessions', label: 'sessions' },
  { value: 'courses', label: 'courses' },
  { value: 'videos', label: 'videos' },
  { value: 'studies', label: 'studies' },
  { value: 'tasks', label: 'tasks' },
  { value: 'books', label: 'books' },
  { value: 'custom', label: 'custom' },
];

export default function KeyResultDraftPanel({
  keyResults,
  issues,
  onChange,
}: KeyResultDraftPanelProps) {
  const issuesById = new Map<string, GoalArchitectIssue[]>();
  for (const i of issues) {
    if (i.entityKind === 'key_result' && i.entityId) {
      const bucket = issuesById.get(i.entityId) ?? [];
      bucket.push(i);
      issuesById.set(i.entityId, bucket);
    }
  }

  return (
    <section
      aria-label="Key results"
      data-testid="goal-architect-key-results"
      className="rounded-2xl border border-gray-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-base font-semibold text-gray-900">Key Results</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Risultati misurabili collegati al Goal ({keyResults.length}).
        </p>
      </header>

      {keyResults.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500 italic">
          Nessun Key Result definito. Aggiungili nel testo (KR: …) e rigenera.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {keyResults.map((kr) => {
            const hasWarning = (issuesById.get(kr.id) ?? []).length > 0;
            return (
              <KeyResultRow
                key={kr.id}
                kr={kr}
                hasWarning={hasWarning}
                onChange={onChange}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function KeyResultRow({
  kr,
  hasWarning,
  onChange,
}: {
  kr: KeyResultDraft;
  hasWarning: boolean;
  onChange: (keyResultId: string, patch: KeyResultDraftEdit) => void;
}) {
  const conf = interpretConfidence(kr.confidence?.overall ?? 0);
  const unitText = keyResultUnitLabel(kr.unit, kr.customUnit);

  const handleTitle = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(kr.id, { title: e.target.value });
  };
  const handleTarget = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = raw === '' ? undefined : parseFloat(raw);
    onChange(kr.id, {
      targetValue:
        parsed === undefined || !Number.isFinite(parsed) ? undefined : parsed,
    });
  };
  const handleCurrent = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = raw === '' ? undefined : parseFloat(raw);
    onChange(kr.id, {
      currentValue:
        parsed === undefined || !Number.isFinite(parsed) ? undefined : parsed,
    });
  };
  const handleUnit = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value as '' | KeyResultUnit;
    onChange(kr.id, { unit: v === '' ? undefined : v });
  };

  return (
    <li
      data-testid="goal-architect-key-result-row"
      className={`px-5 py-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center border-l-4 ${
        hasWarning ? 'border-l-amber-400 bg-amber-50/30' : 'border-l-transparent'
      }`}
    >
      <div className="sm:col-span-5">
        <input
          type="text"
          value={kr.title}
          onChange={handleTitle}
          aria-label="Key result title"
          data-testid={`goal-architect-kr-title-${kr.id}`}
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
      </div>
      <div className="sm:col-span-2">
        <input
          type="number"
          min={0}
          step="0.5"
          value={kr.targetValue ?? ''}
          onChange={handleTarget}
          aria-label="Key result target value"
          placeholder="target"
          data-testid={`goal-architect-kr-target-${kr.id}`}
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
      </div>
      <div className="sm:col-span-2">
        <input
          type="number"
          min={0}
          step="0.5"
          value={kr.currentValue ?? ''}
          onChange={handleCurrent}
          aria-label="Key result current value"
          placeholder="current"
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        />
      </div>
      <div className="sm:col-span-2">
        <select
          value={kr.unit ?? ''}
          onChange={handleUnit}
          aria-label="Key result unit"
          data-testid={`goal-architect-kr-unit-${kr.id}`}
          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
        >
          {UNIT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-1 flex items-center justify-end text-[10px]">
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 font-medium ${conf.badge}`}
          title={`Confidence ${confidenceLabel(kr.confidence?.overall ?? 0)}`}
        >
          {confidenceLabel(kr.confidence?.overall ?? 0)}
        </span>
      </div>
      <p className="sm:col-span-12 text-[10px] text-gray-400">
        {kr.currentValue ?? 0} / {kr.targetValue ?? '—'} {unitText}
      </p>
    </li>
  );
}
