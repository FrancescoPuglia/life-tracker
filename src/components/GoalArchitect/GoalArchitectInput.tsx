'use client';

// src/components/GoalArchitect/GoalArchitectInput.tsx
// Textarea + primary actions for the Goal Architect tab.

import { ChangeEvent } from 'react';

export type GoalArchitectExampleKey =
  | 'work'
  | 'chess'
  | 'modelPhysique'
  | 'intelligenceEngine'
  | 'presenceUpgrade';

export interface GoalArchitectInputProps {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onClear: () => void;
  onLoadExample: (key: GoalArchitectExampleKey) => void;
  disabled?: boolean;
}

const PLACEHOLDER =
  'Scrivi il tuo Goal in linguaggio naturale.\n\nEsempio:\nGoal: Scacchi — Chess Mastery.\nTarget date: 31/12/2026.\nTotal hours: 300.\nProgetti: Calcolo e Visualizzazione 80h, Tattica 60h, Aperture 70h.\nNel progetto Aperture crea task: Catalana 20h critical, Sveshnikov 25h critical.';

const EXAMPLE_CHIPS: ReadonlyArray<{
  key: GoalArchitectExampleKey;
  label: string;
}> = [
  { key: 'chess', label: 'Scacchi' },
  { key: 'work', label: 'Lavoro' },
  { key: 'modelPhysique', label: 'Model Physique' },
  { key: 'intelligenceEngine', label: 'Intelligence Engine' },
  { key: 'presenceUpgrade', label: 'Presence Upgrade' },
];

export default function GoalArchitectInput({
  value,
  onChange,
  onGenerate,
  onClear,
  onLoadExample,
  disabled = false,
}: GoalArchitectInputProps) {
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const canGenerate = value.trim().length > 0 && !disabled;

  return (
    <section
      aria-label="Goal architect input"
      className="rounded-2xl border border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-blue-100 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Descrivi la struttura del tuo Goal
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Italiano o inglese. Il parser è deterministico e non chiama AI esterne.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onLoadExample('chess')}
          disabled={disabled}
          className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50 transition"
          data-testid="goal-architect-load-example"
        >
          Load Example
        </button>
      </header>

      <div className="p-5 space-y-4">
        <label className="block">
          <span className="sr-only">Goal architect text</span>
          <textarea
            value={value}
            onChange={handleChange}
            placeholder={PLACEHOLDER}
            disabled={disabled}
            rows={10}
            className="w-full resize-vertical rounded-xl border border-gray-200 bg-white/90 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 transition disabled:opacity-50"
            data-testid="goal-architect-textarea"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Quick fixtures:</span>
          {EXAMPLE_CHIPS.map((chip) => (
            <button
              type="button"
              key={chip.key}
              onClick={() => onLoadExample(chip.key)}
              disabled={disabled}
              data-testid={`goal-architect-chip-${chip.key}`}
              className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
            data-testid="goal-architect-generate"
          >
            <span>🏗️</span>
            Generate Draft
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled || value.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition"
            data-testid="goal-architect-clear"
          >
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}
