'use client';

import { useEffect, useState } from 'react';
import { Clock3, Pause, Play, Square } from 'lucide-react';
import type { Session, TimeBlock } from '@/types';
import { sessionElapsedSeconds } from '@/lib/sessionTiming';

interface NowBarProps {
  currentSession?: Session | null;
  currentTimeBlock?: TimeBlock | null;
  nextTimeBlock?: TimeBlock | null;
  sessionStateReady?: boolean;
  onStartSession: (taskId?: string, timeBlockId?: string) => void;
  onPauseSession: () => void;
  onStopSession: () => void;
}

export default function NowBar({
  currentSession,
  currentTimeBlock,
  nextTimeBlock,
  sessionStateReady = true,
  onStartSession,
  onPauseSession,
  onStopSession,
}: NowBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [sessionDuration, setSessionDuration] = useState(0);
  const [timeBlockRemaining, setTimeBlockRemaining] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const nextNow = new Date();
      setCurrentTime(nextNow);
      setSessionDuration(currentSession ? sessionElapsedSeconds(currentSession, nextNow) ?? 0 : 0);
      setTimeBlockRemaining(currentTimeBlock
        ? Math.floor((currentTimeBlock.endTime.getTime() - nextNow.getTime()) / 1000)
        : 0);
    };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, [currentSession, currentTimeBlock]);

  const isOverrun = timeBlockRemaining < 0;
  const statusLabel = currentSession?.status === 'active'
    ? `Sessione · ${formatDuration(sessionDuration)}`
    : currentSession?.status === 'paused'
      ? `In pausa · ${formatDuration(sessionDuration)}`
      : currentTimeBlock
        ? isOverrun
          ? `Fuori tempo · ${formatDuration(timeBlockRemaining)}`
          : `${formatDuration(timeBlockRemaining)} rimanenti`
        : `Ora ${formatClock(currentTime)}`;

  return (
    <div className="flex min-w-0 items-center justify-center gap-3" data-testid="now-bar">
      <div className="hidden min-w-0 items-center gap-3 xl:flex">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700" aria-hidden="true">
          <Clock3 size={16} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-[13px] leading-tight">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Ora</span>
            <span className="max-w-[260px] truncate font-semibold text-slate-900">
              {currentTimeBlock?.title ?? 'Nessun blocco attivo'}
            </span>
            <span className={`shrink-0 text-xs font-medium ${isOverrun ? 'text-red-600' : 'text-cyan-700'}`}>
              {statusLabel}
            </span>
          </div>
          {nextTimeBlock && (
            <p className="mt-0.5 max-w-[460px] truncate text-xs text-slate-500">
              Dopo: <span className="font-medium text-slate-700">{nextTimeBlock.title}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {!currentSession ? (
          <button
            type="button"
            onClick={() => onStartSession(currentTimeBlock?.taskId, currentTimeBlock?.id)}
            disabled={!sessionStateReady}
            className="lt-button-primary min-h-[36px] px-3"
          >
            <Play size={15} fill="currentColor" aria-hidden="true" />
            <span>{sessionStateReady ? 'Avvia sessione' : 'Verifica sessioni…'}</span>
          </button>
        ) : currentSession.status === 'active' ? (
          <>
            <button type="button" onClick={onPauseSession} className="lt-icon-button min-h-[36px] w-9" aria-label="Metti in pausa">
              <Pause size={16} fill="currentColor" aria-hidden="true" />
            </button>
            <button type="button" onClick={onStopSession} className="lt-icon-button min-h-[36px] w-9 text-red-600" aria-label="Termina sessione">
              <Square size={15} fill="currentColor" aria-hidden="true" />
            </button>
          </>
        ) : (
          <button type="button" onClick={() => onStartSession()} className="lt-button-primary min-h-[36px] px-3">
            <Play size={15} fill="currentColor" aria-hidden="true" />
            Riprendi
          </button>
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const absolute = Math.abs(seconds);
  const hours = Math.floor(absolute / 3_600);
  const minutes = Math.floor((absolute % 3_600) / 60);
  const secs = absolute % 60;
  const prefix = seconds < 0 ? '+' : '';
  return hours > 0
    ? `${prefix}${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${prefix}${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
