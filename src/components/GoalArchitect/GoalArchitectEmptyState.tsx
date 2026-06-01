'use client';

// src/components/GoalArchitect/GoalArchitectEmptyState.tsx
// Pre-generation guide. Sets expectations and points to Load Example.

export interface GoalArchitectEmptyStateProps {
  onLoadExample: () => void;
}

const STEPS: ReadonlyArray<{ emoji: string; title: string; body: string }> = [
  {
    emoji: '📝',
    title: 'Scrivi la struttura',
    body:
      'Goal, ore totali, scadenza, progetti e task in linguaggio naturale (italiano o inglese).',
  },
  {
    emoji: '🏗️',
    title: 'Genera la bozza',
    body:
      'Il parser crea Goal → Projects → Tasks + Key Results con confidence e issue. Nessun dato reale viene salvato.',
  },
  {
    emoji: '🧭',
    title: 'Rivedi prima del commit',
    body:
      'Controlla mapping, ore, scadenze e warning. Il commit reale arriva nel prossimo step.',
  },
];

export default function GoalArchitectEmptyState({
  onLoadExample,
}: GoalArchitectEmptyStateProps) {
  return (
    <section
      className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/60 via-white to-indigo-50/40 p-6 shadow-sm"
      data-testid="goal-architect-empty-state"
    >
      <div className="text-center max-w-2xl mx-auto">
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
          Draft only · No data saved
        </span>
        <h3 className="mt-4 text-xl font-bold text-gray-900">
          Write your goal architecture once. Review the structure before
          anything is created.
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          Trasforma un piano in linguaggio naturale in una bozza strutturata
          Goal → Projects → Tasks + Key Results.
        </p>
      </div>

      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="rounded-xl border border-gray-100 bg-white p-4"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <span className="text-base">{step.emoji}</span>
              <span>
                <span className="text-blue-600 mr-1">{i + 1}.</span>
                {step.title}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-gray-600 leading-relaxed">
              {step.body}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onLoadExample}
          data-testid="goal-architect-empty-load-example"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 transition"
        >
          🏗️ Load Chess example & try
        </button>
      </div>
    </section>
  );
}
