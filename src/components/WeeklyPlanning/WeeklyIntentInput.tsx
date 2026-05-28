'use client';

// src/components/WeeklyPlanning/WeeklyIntentInput.tsx
// Free-form weekly intent textarea + primary actions. Pure presentation:
// owns no state of its own, all changes flow up via callbacks.

import { ChangeEvent } from 'react';

export interface WeeklyIntentInputProps {
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onClear: () => void;
  onLoadExample: () => void;
  disabled?: boolean;
}

const PLACEHOLDER =
  'Scrivi la tua settimana in linguaggio naturale...\n\nEsempio:\nOgni giorno sveglia alle 7.\nCareer deep work ogni mattina 90 minuti.\nLunedì Catalana 2 ore.\nMartedì Sveshnikov 90 minuti.\nPalestra 4 volte a settimana.\nLeggere ogni sera 30 minuti.';

export default function WeeklyIntentInput({
  value,
  onChange,
  onGenerate,
  onClear,
  onLoadExample,
  disabled = false,
}: WeeklyIntentInputProps) {
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const canGenerate = value.trim().length > 0 && !disabled;

  return (
    <section
      aria-label="Weekly intentions"
      className="rounded-2xl border border-blue-100 bg-white/80 backdrop-blur-sm shadow-sm overflow-hidden"
    >
      <header className="border-b border-blue-100 px-5 py-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Le tue intenzioni della settimana
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Scrivi liberamente. Il motore tradurrà il testo in blocchi
            collegati ai tuoi Goal.
          </p>
        </div>
        <button
          type="button"
          onClick={onLoadExample}
          disabled={disabled}
          className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50 transition"
        >
          Load example
        </button>
      </header>

      <div className="p-5 space-y-4">
        <label className="block">
          <span className="sr-only">Weekly intent text</span>
          <textarea
            value={value}
            onChange={handleChange}
            placeholder={PLACEHOLDER}
            disabled={disabled}
            rows={10}
            className="w-full resize-vertical rounded-xl border border-gray-200 bg-white/90 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200 transition disabled:opacity-50"
            data-testid="weekly-intent-textarea"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-600">Suggerimenti:</span>
          {[
            '“ogni giorno alle 7”',
            '“4 volte a settimana”',
            '“lunedì 2 ore”',
            '“ogni sera 30 min”',
          ].map((s) => (
            <span
              key={s}
              className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5"
            >
              {s}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
            data-testid="weekly-intent-generate"
          >
            <span>✨</span>
            Generate Draft Week
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled || value.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 transition"
          >
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}
