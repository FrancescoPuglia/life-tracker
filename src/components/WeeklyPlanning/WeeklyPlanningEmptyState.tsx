'use client';

// src/components/WeeklyPlanning/WeeklyPlanningEmptyState.tsx
// Shown before the user has generated a draft. Sets expectations and
// gives a one-click path forward.

export interface WeeklyPlanningEmptyStateProps {
  onLoadExample: () => void;
}

const STEPS: ReadonlyArray<{ title: string; body: string; emoji: string }> = [
  {
    emoji: '📝',
    title: 'Scrivi le intenzioni',
    body:
      'Una frase per ogni attività della settimana. Va bene linguaggio naturale, italiano o inglese.',
  },
  {
    emoji: '✨',
    title: 'Genera la bozza',
    body:
      'Il motore parsifica il testo, mappa su Goal/Project/Task e propone una settimana realistica.',
  },
  {
    emoji: '🧭',
    title: 'Rivedi mapping & conflitti',
    body:
      'Controlla che ogni attività punti al Goal giusto. Risolvi conflitti prima di approvare.',
  },
];

const EXAMPLES: ReadonlyArray<{ goal: string; line: string }> = [
  { goal: 'Lavoro', line: 'Career deep work ogni mattina 90 minuti.' },
  { goal: 'Scacchi', line: 'Lunedì Catalana 2 ore. Martedì Sveshnikov 90 minuti.' },
  { goal: 'Model Physique', line: 'Palestra 4 volte a settimana.' },
  { goal: 'Intelligence Engine', line: 'Leggere ogni sera 30 minuti.' },
  { goal: 'Presence Upgrade', line: 'Presence upgrade sabato 1 ora.' },
];

export default function WeeklyPlanningEmptyState({
  onLoadExample,
}: WeeklyPlanningEmptyStateProps) {
  return (
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/60 via-white to-indigo-50/40 p-6 shadow-sm">
      <div className="text-center max-w-2xl mx-auto">
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
          Deterministic MVP
        </span>
        <h3 className="mt-4 text-xl font-bold text-gray-900">
          Trasforma la tua settimana in una bozza intelligente
        </h3>
        <p className="mt-2 text-sm text-gray-600">
          Scrivi cosa vuoi fare questa settimana. Il motore (locale,
          deterministico, senza AI esterne) ti restituirà una bozza
          settimanale collegata ai tuoi Goal.
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

      <div className="mt-6">
        <h4 className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-2">
          Esempi collegati ai tuoi 5 Goal
        </h4>
        <ul className="space-y-1.5">
          {EXAMPLES.map((ex) => (
            <li
              key={ex.goal}
              className="flex items-baseline gap-3 text-xs text-gray-600"
            >
              <span className="w-36 shrink-0 font-medium text-gray-800">
                {ex.goal}
              </span>
              <span className="italic text-gray-500">“{ex.line}”</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onLoadExample}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 transition"
          data-testid="empty-load-example"
        >
          ✨ Load Example & Try
        </button>
      </div>
    </section>
  );
}
