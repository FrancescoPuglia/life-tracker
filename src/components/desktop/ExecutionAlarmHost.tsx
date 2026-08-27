'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, BellRing, CalendarClock, Clock3, Octagon, Play, ShieldCheck, X } from 'lucide-react';
import type { Goal, Project, Session, Task, TimeBlock } from '@/types';
import {
  EXECUTION_ALARM_SIGNAL_EVENT,
  EXECUTION_ALARM_STOP_EVENT,
  executionAlarmStateStore,
  isExecutionAlarmSignal,
  resolveExecutionAlarmContext,
  type ExecutionAlarmSignal,
  type ExecutionAlarmPreferences,
  type PersistedExecutionAlarmState,
} from '@/lib/desktop/executionAlarm';
import { ExecutionAlarmSound } from '@/lib/desktop/executionAlarmSound';

interface ExecutionAlarmHostProps {
  readonly uid: string;
  readonly preferences: ExecutionAlarmPreferences;
  readonly timeBlocks: readonly TimeBlock[];
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[];
  readonly goals: readonly Goal[];
  readonly timezone: string;
  readonly locale: string;
  readonly currentSession: Session | null;
  readonly onStartSession: (taskId?: string, timeBlockId?: string) => Promise<boolean | void>;
  readonly onOpenPlanner: () => void;
}

export default function ExecutionAlarmHost({
  uid,
  preferences,
  timeBlocks,
  tasks,
  projects,
  goals,
  timezone,
  locale,
  currentSession,
  onStartSession,
  onOpenPlanner,
}: ExecutionAlarmHostProps) {
  const [active, setActive] = useState<{
    state: PersistedExecutionAlarmState;
    signal: ExecutionAlarmSignal;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [normalNotice, setNormalNotice] = useState<ExecutionAlarmSignal | null>(null);
  const [alarmStage, setAlarmStage] = useState<0 | 30 | 60 | 90>(0);
  const sound = useRef<ExecutionAlarmSound | null>(null);
  if (!sound.current) sound.current = new ExecutionAlarmSound();
  const snoozedUntilMs = active?.state.snoozedUntil
    ? Date.parse(active.state.snoozedUntil)
    : null;
  const isSnoozed = snoozedUntilMs !== null && snoozedUntilMs > Date.now();

  const acknowledge = useCallback(() => {
    executionAlarmStateStore.acknowledge(uid);
    sound.current?.stop();
    setActive(null);
  }, [uid]);

  useEffect(() => {
    const restored = executionAlarmStateStore.load(uid);
    if (!restored) return;
    const signal = restoreSignal(restored, timeBlocks, tasks, projects, goals, timezone, locale);
    if (signal) setActive({ state: restored, signal });
    else executionAlarmStateStore.acknowledge(uid);
  }, [goals, locale, projects, tasks, timeBlocks, timezone, uid]);

  useEffect(() => {
    const onSignal = (event: Event) => {
      const signal = (event as CustomEvent<unknown>).detail;
      if (!isExecutionAlarmSignal(signal)) return;
      if (signal.presentation === 'normal') {
        setNormalNotice(signal);
        if (preferences.soundEnabled && !preferences.muted) {
          void sound.current?.playOnce();
        }
        return;
      }
      setNormalNotice(null);
      setActive({
        state: executionAlarmStateStore.activate(uid, signal),
        signal,
      });
    };
    const onStop = () => acknowledge();
    window.addEventListener(EXECUTION_ALARM_SIGNAL_EVENT, onSignal);
    window.addEventListener(EXECUTION_ALARM_STOP_EVENT, onStop);
    return () => {
      window.removeEventListener(EXECUTION_ALARM_SIGNAL_EVENT, onSignal);
      window.removeEventListener(EXECUTION_ALARM_STOP_EVENT, onStop);
      sound.current?.stop();
    };
  }, [acknowledge, preferences.muted, preferences.soundEnabled, uid]);

  useEffect(() => {
    if (!normalNotice) return undefined;
    const timer = setTimeout(() => setNormalNotice(null), 8_000);
    return () => clearTimeout(timer);
  }, [normalNotice]);

  useEffect(() => {
    if (!active || isSnoozed) {
      setAlarmStage(0);
      return undefined;
    }
    setAlarmStage(0);
    const timers = [
      setTimeout(() => setAlarmStage(30), 30_000),
      setTimeout(() => setAlarmStage(60), 60_000),
      setTimeout(() => setAlarmStage(90), 90_000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active, isSnoozed]);

  useEffect(() => {
    if (!active) return undefined;
    const stopFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      acknowledge();
    };
    window.addEventListener('keydown', stopFromKeyboard);
    return () => window.removeEventListener('keydown', stopFromKeyboard);
  }, [acknowledge, active]);

  useEffect(() => {
    if (!active || !isSnoozed || snoozedUntilMs === null) return undefined;
    sound.current?.stop();
    const timer = setTimeout(() => {
      setActive((current) => current ? {
        ...current,
        state: { ...current.state, snoozedUntil: null },
      } : null);
    }, Math.max(0, snoozedUntilMs - Date.now()));
    return () => clearTimeout(timer);
  }, [active, isSnoozed, snoozedUntilMs]);

  useEffect(() => {
    if (!active || isSnoozed || preferences.muted || !preferences.soundEnabled) {
      sound.current?.stop();
      return undefined;
    }
    void sound.current?.startBounded();
    return () => sound.current?.stop();
  }, [active, isSnoozed, preferences.muted, preferences.soundEnabled]);

  const matchedBlock = useMemo(() => (
    active?.signal.context.timeBlockId
      ? timeBlocks.find((block) => block.id === active.signal.context.timeBlockId)
      : undefined
  ), [active?.signal.context.timeBlockId, timeBlocks]);

  useEffect(() => {
    if (!active) return;
    const timeBlockId = active.signal.context.timeBlockId;
    if (
      (timeBlockId && currentSession?.timeBlockId === timeBlockId)
      || matchedBlock?.deleted
      || matchedBlock?.status === 'completed'
      || matchedBlock?.status === 'cancelled'
    ) acknowledge();
  }, [acknowledge, active, currentSession?.timeBlockId, matchedBlock?.deleted, matchedBlock?.status]);

  if (!active || isSnoozed) {
    if (!normalNotice) return null;
    return (
      <aside
        role="status"
        aria-live="assertive"
        data-testid="execution-alarm-normal-banner"
        className="fixed left-1/2 top-4 z-[100] flex w-[min(94vw,680px)] -translate-x-1/2 items-center gap-4 rounded-2xl border border-cyan-200 bg-slate-950 px-5 py-4 text-white shadow-2xl"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300">
          <BellRing size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">È ora di eseguire</p>
          <p className="truncate text-base font-bold">{normalNotice.dispatch.title}</p>
        </div>
        <button
          type="button"
          onClick={() => setNormalNotice(null)}
          aria-label="Chiudi avviso"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300"
        >
          <X size={19} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  const { dispatch, context, presentation } = active.signal;
  const start = formatTime(dispatch.startTime, dispatch.locale, dispatch.timezone);
  const end = formatTime(
    new Date(Date.parse(dispatch.startTime) + dispatch.plannedMinutes * 60_000).toISOString(),
    dispatch.locale,
    dispatch.timezone,
  );
  const contextLabel = [context.goalTitle, context.projectTitle].filter(Boolean).join(' · ');

  const startSession = async () => {
    setBusy(true);
    try {
      const result = await onStartSession(
        context.taskId ?? undefined,
        context.timeBlockId ?? undefined,
      );
      if (result !== false) acknowledge();
    } finally {
      setBusy(false);
    }
  };

  const snooze = (minutes: 5 | 10 | 15) => {
    setActive({
      ...active,
      state: executionAlarmStateStore.snooze(uid, active.state, minutes),
    });
    sound.current?.stop();
  };

  const openPlanner = () => {
    acknowledge();
    onOpenPlanner();
  };

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/75 px-4 backdrop-blur-sm"
      role="presentation"
      data-testid="execution-alarm-overlay"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="execution-alarm-title"
        aria-describedby="execution-alarm-motivation"
        className={`w-full max-w-2xl overflow-hidden rounded-[28px] border bg-white shadow-2xl transition-transform motion-reduce:transition-none ${
          alarmStage >= 60 ? 'border-amber-300 motion-safe:scale-[1.015]' : 'border-slate-200'
        }`}
      >
        <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-white">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300">
                <AlarmClock size={24} aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                  {presentation === 'test' ? 'TEST EXECUTION ALARM' : 'TIME TO EXECUTE'}
                </p>
                <h2 id="execution-alarm-title" className="mt-1 text-2xl font-semibold leading-tight">
                  {dispatch.title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={acknowledge}
              className="grid h-10 w-10 place-items-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300"
              aria-label="Interrompi e chiudi Execution Alarm"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <p
            id="execution-alarm-motivation"
            className={`rounded-2xl border px-4 py-3 text-center text-base font-semibold ${
              alarmStage >= 60
                ? 'border-amber-200 bg-amber-50 text-amber-950'
                : 'border-indigo-100 bg-indigo-50 text-indigo-950'
            }`}
          >
            {alarmStage >= 90
              ? 'Ultimo segnale audio. L’allarme visivo resta attivo finché non scegli.'
              : alarmStage >= 60
                ? 'Proteggi il blocco: avvia ora oppure ripianifica consapevolmente.'
                : alarmStage >= 30
                  ? 'Non hai ancora iniziato. Il piano conta soltanto se lo esegui.'
                  : 'Il piano conta soltanto se lo esegui.'}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Clock3 size={14} aria-hidden="true" /> Orario
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-950">{start} – {end}</p>
              <p className="text-sm text-slate-500">{dispatch.plannedMinutes} minuti pianificati</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <ShieldCheck size={14} aria-hidden="true" /> Contesto
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {contextLabel || 'Blocco di esecuzione'}
              </p>
              <p className="text-sm capitalize text-slate-500">
                {context.priority ? `Priorità ${context.priority}` : 'Priorità non specificata'}
              </p>
            </div>
          </div>

          <button
            type="button"
            autoFocus
            onClick={() => void startSession()}
            disabled={busy}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            <Play size={19} fill="currentColor" aria-hidden="true" />
            {busy ? 'AVVIO SICURO…' : 'AVVIA SESSIONE'}
          </button>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button type="button" onClick={() => snooze(5)} className="lt-button-secondary min-h-[42px] px-3">
              POSTICIPA 5 MIN
            </button>
            <button type="button" onClick={() => snooze(10)} className="lt-button-secondary min-h-[42px] px-3">
              POSTICIPA 10 MIN
            </button>
            <button type="button" onClick={openPlanner} className="lt-button-secondary min-h-[42px] px-3">
              <CalendarClock size={16} aria-hidden="true" /> SPOSTA
            </button>
            <button type="button" onClick={acknowledge} className="lt-button-secondary min-h-[42px] px-3 text-slate-700">
              SALTA
            </button>
          </div>
          <button
            type="button"
            onClick={acknowledge}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-black tracking-wide text-red-800 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            <Octagon size={18} aria-hidden="true" /> STOP ALARM
          </button>
          <p className="text-center text-xs leading-5 text-slate-500">
            Segnale audio a cadenza limitata fino a 90 secondi; poi l’avviso resta silenzioso. Premi Esc o STOP ALARM in qualsiasi momento.
          </p>
        </div>
      </section>
    </div>
  );
}

function formatTime(value: string, locale: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function restoreSignal(
  state: PersistedExecutionAlarmState,
  timeBlocks: readonly TimeBlock[],
  tasks: readonly Task[],
  projects: readonly Project[],
  goals: readonly Goal[],
  timezone: string,
  locale: string,
): ExecutionAlarmSignal | null {
  const block = state.blockId
    ? timeBlocks.find((candidate) => candidate.id === state.blockId)
    : undefined;
  if (
    !block
    || block.deleted
    || block.status === 'completed'
    || block.status === 'cancelled'
  ) return null;
  const plannedMinutes = Math.max(
    1,
    Math.round((block.endTime.getTime() - block.startTime.getTime()) / 60_000),
  );
  const dispatch = {
    jobId: state.occurrenceId,
    attemptId: state.attemptId,
    kind: state.trigger,
    offsetMinutes: state.trigger === 'at_start' ? 0 : -1,
    scheduledFor: state.scheduledInstant,
    startTime: block.startTime.toISOString(),
    title: block.title,
    plannedMinutes,
    timezone,
    locale,
  } as const;
  return {
    dispatch,
    context: resolveExecutionAlarmContext(dispatch, timeBlocks, tasks, projects, goals),
    presentation: 'strong',
  };
}
