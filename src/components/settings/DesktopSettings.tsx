'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, BellRing, Monitor, Moon, Sun, Volume2, VolumeX } from 'lucide-react';
import { AI_BACKEND_BUILD_ID } from '@/lib/ai/backendConfig';
import {
  getWeeklyReviewApiClient,
  type WeeklyReviewApiClient,
} from '@/lib/reports/weeklyReviewApiClient';
import type { WeeklyReviewStatusResponse } from '../../../packages/report-contract';
import {
  DEPLOYMENT_ENVIRONMENT,
  RUNTIME_TARGET,
} from '@/lib/runtimeEnvironment';
import {
  desktopNativeBridge,
  type DesktopNativeBridge,
  type DesktopNativeStatus,
} from '@/lib/desktop/nativeBridge';
import { DESKTOP_REMINDER_REFRESH_EVENT } from '@/lib/desktop/reminderCoordinator';
import {
  EXECUTION_ALARM_PREFERENCES_EVENT,
  EXECUTION_ALARM_STOP_EVENT,
  defaultExecutionAlarmPreferences,
  dispatchExecutionAlarmSignal,
  executionAlarmPreferencesStore,
  normalizeExecutionAlarmPreferences,
  type ExecutionAlarmMode,
  type ExecutionAlarmPreferences,
} from '@/lib/desktop/executionAlarm';
import {
  defaultNotificationPreferences,
  normalizeEditableNotificationPreferences,
  notificationPreferencesStore,
  type EditableNotificationPreferences,
  type NotificationPreferencesStore,
} from '@/lib/notifications/preferences';
import {
  applyAppearancePreference,
  loadAppearancePreference,
  type LifeTrackerAppearancePreference,
  type LifeTrackerThemeMode,
} from '@/lib/themePreference';

const UNAVAILABLE_STATUS: DesktopNativeStatus = {
  available: false,
  notificationPermission: 'unavailable',
  autostartEnabled: null,
};

interface DesktopSettingsProps {
  readonly userId: string;
  readonly bridge?: DesktopNativeBridge;
  readonly preferencesStore?: NotificationPreferencesStore;
  readonly weeklyReviewApi?: WeeklyReviewApiClient;
}

export default function DesktopSettings({
  userId,
  bridge = desktopNativeBridge,
  preferencesStore = notificationPreferencesStore,
  weeklyReviewApi,
}: DesktopSettingsProps) {
  const [status, setStatus] = useState<DesktopNativeStatus>(UNAVAILABLE_STATUS);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<EditableNotificationPreferences>(
    defaultNotificationPreferences,
  );
  const [offsetText, setOffsetText] = useState('15');
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [alarmPreferences, setAlarmPreferences] = useState<ExecutionAlarmPreferences>(
    defaultExecutionAlarmPreferences,
  );
  const [weeklyReviewStatus, setWeeklyReviewStatus] = useState<WeeklyReviewStatusResponse | null>(null);
  const [appearance, setAppearance] = useState<LifeTrackerAppearancePreference>(
    loadAppearancePreference,
  );

  const refresh = useCallback(async () => {
    try {
      setStatus(await bridge.readStatus());
      setError(null);
    } catch {
      setStatus(UNAVAILABLE_STATUS);
      setError('Lo stato Desktop non è disponibile. Riavvia Life Tracker e riprova.');
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    setPreferencesLoading(true);
    void preferencesStore.load(userId)
      .then((value) => {
        if (disposed) return;
        setPreferences(value);
        setOffsetText(value.reminderOffsetsMinutes.join(', '));
        setError(null);
      })
      .catch(() => {
        if (!disposed) {
          setError('Impossibile caricare le preferenze degli avvisi. I dati non sono stati modificati.');
        }
      })
      .finally(() => {
        if (!disposed) setPreferencesLoading(false);
      });
    return () => { disposed = true; };
  }, [preferencesStore, userId]);

  useEffect(() => {
    setAlarmPreferences(executionAlarmPreferencesStore.load(userId));
    const update = (event: Event) => {
      try {
        setAlarmPreferences(normalizeExecutionAlarmPreferences(
          (event as CustomEvent<unknown>).detail,
        ));
      } catch {
        // Keep the current validated owner-local settings.
      }
    };
    window.addEventListener(EXECUTION_ALARM_PREFERENCES_EVENT, update);
    return () => window.removeEventListener(EXECUTION_ALARM_PREFERENCES_EVENT, update);
  }, [userId]);

  const run = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    setMessage(null);
    setError(null);
    try {
      await action();
    } catch {
      setError(name === 'reminder-policy'
        ? 'Le preferenze degli avvisi non sono valide o disponibili. Nessun dato è stato modificato.'
        : 'L’azione Desktop non è riuscita e si è chiusa in sicurezza. Nessun dato è stato modificato.');
    } finally {
      setBusyAction(null);
    }
  };

  const requestNotifications = () => run('permission', async () => {
    const notificationPermission = await bridge.requestNotificationPermission();
    setStatus((current) => ({ ...current, notificationPermission }));
    setMessage(notificationPermission === 'granted'
      ? 'Notifiche native abilitate.'
      : 'Windows non ha concesso le notifiche. L’allarme in-app resta disponibile.');
    window.dispatchEvent(new Event(DESKTOP_REMINDER_REFRESH_EVENT));
  });

  const testNotifications = () => run('test', async () => {
    await bridge.sendTestNotification();
    setMessage('Notifica di test inviata. Il clic apre soltanto Life Tracker.');
  });

  const changeAutostart = (enabled: boolean) => run('autostart', async () => {
    const authoritativeState = await bridge.setAutostart(enabled);
    setStatus((current) => ({ ...current, autostartEnabled: authoritativeState }));
    setMessage(authoritativeState
      ? 'Life Tracker si avvierà all’accesso a Windows.'
      : 'Avvio automatico di Windows disattivato.');
  });

  const saveReminderPolicy = () => run('reminder-policy', async () => {
    const reminderOffsetsMinutes = offsetText
      .split(',')
      .map((value) => Number(value.trim()));
    const normalized = normalizeEditableNotificationPreferences({
      ...preferences,
      reminderOffsetsMinutes,
    });
    await preferencesStore.save(userId, normalized);
    setPreferences(normalized);
    setOffsetText(normalized.reminderOffsetsMinutes.join(', '));
    setMessage('Preferenze di avvisi e review salvate. Le esecuzioni future saranno riconciliate in sicurezza.');
    window.dispatchEvent(new Event(DESKTOP_REMINDER_REFRESH_EVENT));
  });

  const saveAlarmPolicy = () => run('execution-alarm', async () => {
    const saved = executionAlarmPreferencesStore.save(userId, alarmPreferences);
    setAlarmPreferences(saved);
    if (saved.mode === 'off' || saved.muted) {
      window.dispatchEvent(new Event(EXECUTION_ALARM_STOP_EVENT));
    }
    setMessage('Execution Alarm salvato per questo Desktop. La pianificazione server resta invariata.');
  });

  const refreshWeeklyReviewStatus = () => run('weekly-review-status', async () => {
    const client = weeklyReviewApi ?? getWeeklyReviewApiClient();
    const result = await client.status();
    setWeeklyReviewStatus(result);
    setMessage('Stato della Weekly Executive Review aggiornato.');
  });

  const sendWeeklyReviewTest = () => run('weekly-review-test', async () => {
    const client = weeklyReviewApi ?? getWeeklyReviewApiClient();
    const result = await client.sendTest();
    if (result.outcome === 'provider_accepted' || result.outcome === 'already_accepted') {
      setMessage('Review archiviata e accettata dal provider email.');
    } else if (result.outcome === 'retry_pending') {
      setMessage('Review archiviata. Il nuovo tentativo di consegna è programmato.');
    } else if (result.outcome === 'not_due') {
      setMessage('Nessuna review settimanale è ancora dovuta con queste preferenze.');
    } else {
      throw new Error('Weekly review delivery failed safely.');
    }
    setWeeklyReviewStatus(await client.status());
  });

  const testExecutionAlarm = (kind: 'normal' | 'strong' | 'critical') => {
    const now = new Date();
    dispatchExecutionAlarmSignal({
      dispatch: {
        jobId: 'e'.repeat(64),
        attemptId: 'f'.repeat(64),
        kind: 'at_start',
        offsetMinutes: 0,
        scheduledFor: now.toISOString(),
        startTime: now.toISOString(),
        title: `TEST ${kind === 'critical' ? 'CRITICAL' : kind.toUpperCase()} — Focus strategico`,
        plannedMinutes: 45,
        timezone: preferences.timezone,
        locale: preferences.locale,
      },
      context: {
        timeBlockId: null,
        taskId: null,
        goalTitle: 'Precision Performance OS',
        projectTitle: 'Execution Alarm',
        priority: kind === 'critical' ? 'critical' : 'high',
      },
      presentation: kind === 'normal' ? 'normal' : 'test',
    });
  };

  const muteAll = () => {
    const saved = executionAlarmPreferencesStore.save(userId, {
      ...alarmPreferences,
      muted: true,
    });
    setAlarmPreferences(saved);
    window.dispatchEvent(new Event(EXECUTION_ALARM_STOP_EVENT));
    setMessage('Execution Alarm silenziato. Il tracking e i promemoria pianificati restano integri.');
  };

  const updateAppearance = (next: Partial<LifeTrackerAppearancePreference>) => {
    const saved = applyAppearancePreference({ ...appearance, ...next });
    setAppearance(saved);
  };

  return (
    <section className="space-y-6" aria-labelledby="desktop-settings-title">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 id="desktop-settings-title" className="text-xl font-bold text-slate-900">
          Impostazioni Desktop
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Personalizza esecuzione, notifiche e review. Il tracking continua anche senza integrazioni native.
        </p>

      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Aspetto</p>
        <h3 className="mt-1 text-lg font-bold text-slate-900">Tema globale</h3>
        <p className="mt-1 text-sm text-slate-600">
          La preferenza è disponibile anche offline e si applica a tutte le schermate.
        </p>
        <fieldset className="mt-4">
          <legend className="sr-only">Tema</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ['system', 'Sistema', Monitor],
              ['light', 'Chiaro', Sun],
              ['dark', 'Scuro', Moon],
            ] as const).map(([mode, label, Icon]) => (
              <label
                key={mode}
                className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border px-4 transition-colors ${
                  appearance.mode === mode
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-950'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="life-tracker-theme"
                  value={mode}
                  checked={appearance.mode === mode}
                  onChange={() => updateAppearance({ mode: mode as LifeTrackerThemeMode })}
                />
                <Icon size={18} aria-hidden="true" />
                <span className="font-bold">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 flex min-h-[48px] cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 text-sm text-slate-700">
          <span>
            <span className="block font-bold text-slate-900">Movimento ridotto</span>
            <span className="block text-xs text-slate-500">Riduce transizioni, pulsazioni e animazioni decorative.</span>
          </span>
          <input
            type="checkbox"
            checked={appearance.reducedMotion}
            onChange={(event) => updateAppearance({ reducedMotion: event.target.checked })}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/15 text-cyan-300">
              <AlarmClock size={21} aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-lg font-semibold">Execution Alarm</h3>
              <p className="mt-0.5 text-sm text-slate-300">
                Un solo livello di esecuzione sopra i promemoria già pianificati.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Modalità</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['off', 'Disattivato', 'Nessun segnale Desktop'],
                ['normal', 'Normale', 'Notifica, suono e banner discreto'],
                ['strong', 'Forte', 'Overlay persistente ed escalation limitata'],
                ['critical_only', 'Solo criticità', 'Forte sulle priorità alte, normale sulle altre'],
              ] as const).map(([value, label, description]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    alarmPreferences.mode === value
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="execution-alarm-mode"
                      value={value}
                      checked={alarmPreferences.mode === value}
                      onChange={() => setAlarmPreferences((current) => ({
                        ...current,
                        mode: value as ExecutionAlarmMode,
                        muted: false,
                      }))}
                    />
                    <span className="text-sm font-semibold text-slate-900">{label}</span>
                  </span>
                  <span className="mt-1 block pl-6 text-xs leading-4 text-slate-500">{description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="rounded-xl border border-slate-200 p-4">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                {alarmPreferences.soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
                Suono
              </span>
              <span className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={alarmPreferences.soundEnabled}
                  onChange={(event) => setAlarmPreferences((current) => ({
                    ...current,
                    soundEnabled: event.target.checked,
                    muted: event.target.checked ? false : current.muted,
                  }))}
                />
                Attiva il segnale originale Life Tracker
              </span>
            </label>
            <label className="rounded-xl border border-slate-200 p-4 text-sm font-semibold text-slate-900">
              Snooze predefinito
              <select
                value={alarmPreferences.snoozeMinutes}
                onChange={(event) => setAlarmPreferences((current) => ({
                  ...current,
                  snoozeMinutes: Number(event.target.value) as 5 | 10 | 15,
                }))}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              >
                <option value={5}>5 minuti</option>
                <option value={10}>10 minuti</option>
                <option value={15}>15 minuti</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveAlarmPolicy()}
              disabled={busyAction !== null}
              className="lt-button-primary min-h-[42px] px-4"
            >
              {busyAction === 'execution-alarm' ? 'Salvataggio…' : 'Salva Execution Alarm'}
            </button>
            <button type="button" onClick={() => testExecutionAlarm('normal')} className="lt-button-secondary min-h-[42px] px-4">
              <BellRing size={16} aria-hidden="true" /> TEST NORMALE
            </button>
            <button type="button" onClick={() => testExecutionAlarm('strong')} className="lt-button-secondary min-h-[42px] px-4">
              <BellRing size={16} aria-hidden="true" /> TEST FORTE
            </button>
            <button type="button" onClick={() => testExecutionAlarm('critical')} className="lt-button-secondary min-h-[42px] px-4">
              <BellRing size={16} aria-hidden="true" /> TEST CRITICO
            </button>
            <button type="button" onClick={muteAll} className="lt-button-secondary min-h-[42px] px-4 text-slate-700">
              <VolumeX size={16} aria-hidden="true" /> SILENZIA TUTTO
            </button>
          </div>

          <p className="text-xs leading-5 text-slate-500">
            Modalità, suono e snooze restano owner-locali su questo Desktop. Orari, quiet hours,
            dedupe e validazione del TimeBlock continuano a usare l’autorità notifiche esistente.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Notifiche Windows</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Servono per gli avvisi quando Life Tracker non è in primo piano. L’allarme in-app
              continua a funzionare anche se Windows le nega.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase text-slate-700">
            {notificationPermissionLabel(status.notificationPermission)}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {status.notificationPermission !== 'granted' && (
            <button
              type="button"
              onClick={requestNotifications}
              disabled={!status.available || busyAction !== null}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'permission' ? 'Verifica…' : 'Abilita notifiche'}
            </button>
          )}
          <button
            type="button"
            onClick={testNotifications}
            disabled={status.notificationPermission !== 'granted' || busyAction !== null}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'test' ? 'Invio…' : 'Invia notifica di test'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Esecuzione</p>
        <h3 className="mt-1 text-lg font-bold text-slate-900">Avvisi pianificati</h3>
        <p className="mt-1 text-sm text-slate-600">
          Il sistema rilegge il TimeBlock corrente prima di mostrare ogni avviso. Blocchi spostati,
          completati, annullati o eliminati vengono soppressi.
        </p>

        <fieldset disabled={preferencesLoading || busyAction !== null} className="mt-5 space-y-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={preferences.desktopEnabled}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                desktopEnabled: event.target.checked,
              }))}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block font-semibold text-slate-900">Avvisi Desktop pianificati</span>
              <span className="block text-sm text-slate-600">
                Richiedono il permesso Windows e Life Tracker attivo nella tray.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold text-slate-800">
              Fuso orario
              <input
                aria-label="Reminder timezone"
                value={preferences.timezone}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  timezone: event.target.value,
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Minuti prima (separati da virgola)
              <input
                aria-label="Reminder offsets"
                inputMode="numeric"
                value={offsetText}
                onChange={(event) => setOffsetText(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Massimo per blocco
              <input
                aria-label="Maximum reminders per block"
                type="number"
                min={1}
                max={8}
                value={preferences.maxRemindersPerBlock}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  maxRemindersPerBlock: Number(event.target.value),
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={preferences.atStartEnabled}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  atStartEnabled: event.target.checked,
                }))}
              />
              Avvisa all’inizio del blocco
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={preferences.missedStart.enabled}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  missedStart: { ...current.missedStart, enabled: event.target.checked },
                }))}
              />
              Avvisa per avvio mancato
            </label>
          </div>

          <label className="block max-w-xs text-sm font-semibold text-slate-800">
            Ritardo avvio mancato (minuti)
            <input
              aria-label="Missed-start delay"
              type="number"
              min={1}
              max={240}
              value={preferences.missedStart.afterMinutes}
              onChange={(event) => setPreferences((current) => ({
                ...current,
                missedStart: {
                  ...current.missedStart,
                  afterMinutes: Number(event.target.value),
                },
              }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={preferences.quietHours.enabled}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, enabled: event.target.checked },
                }))}
              />
              Ore silenziose
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Silenzioso dalle
              <input
                aria-label="Quiet hours start"
                type="time"
                value={preferences.quietHours.start}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, start: event.target.value },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Silenzioso fino alle
              <input
                aria-label="Quiet hours end"
                type="time"
                value={preferences.quietHours.end}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  quietHours: { ...current.quietHours, end: event.target.value },
                }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
              />
            </label>
          </div>

          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-bold text-slate-900">Review esecutive programmate</h4>
                <p className="mt-1 text-sm text-slate-600">
                  Le metriche restano deterministiche e usano il fuso orario persistito. Salvare
                  una preferenza non configura un provider e non invia automaticamente email.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={preferences.emailEnabled}
                  onChange={(event) => setPreferences((current) => ({
                    ...current,
                    emailEnabled: event.target.checked,
                    dailyReport: event.target.checked
                      ? current.dailyReport
                      : { ...current.dailyReport, enabled: false },
                    weeklyReport: event.target.checked
                      ? current.weeklyReport
                      : { ...current.weeklyReport, enabled: false },
                  }))}
                />
                Abilita invio email
              </label>
            </div>

            <label className="mt-4 block max-w-xl text-sm font-semibold text-slate-800">
              Destinatario
              <input
                aria-label="Report recipient"
                type="email"
                autoComplete="email"
                value={preferences.reportRecipient ?? ''}
                onChange={(event) => setPreferences((current) => ({
                  ...current,
                  reportRecipient: event.target.value || null,
                }))}
                placeholder="name@example.com"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
              />
            </label>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={preferences.dailyReport.enabled}
                    disabled={!preferences.emailEnabled}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      dailyReport: { ...current.dailyReport, enabled: event.target.checked },
                    }))}
                  />
                  Review giornaliera
                </label>
                <label className="mt-3 block text-sm text-slate-700">
                  Orario
                  <input
                    aria-label="Daily Report time"
                    type="time"
                    value={preferences.dailyReport.localTime}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      dailyReport: { ...current.dailyReport, localTime: event.target.value },
                    }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={preferences.weeklyReport.enabled}
                    disabled={!preferences.emailEnabled}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      weeklyReport: { ...current.weeklyReport, enabled: event.target.checked },
                    }))}
                  />
                  Weekly Executive Review
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-700">
                    Giorno
                    <select
                      aria-label="Weekly Report day"
                      value={preferences.weeklyReport.isoWeekday}
                      onChange={(event) => setPreferences((current) => ({
                        ...current,
                        weeklyReport: {
                          ...current.weeklyReport,
                          isoWeekday: Number(event.target.value),
                        },
                      }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    >
                      {['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']
                        .map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Orario
                    <input
                      aria-label="Weekly Report time"
                      type="time"
                      value={preferences.weeklyReport.localTime}
                      onChange={(event) => setPreferences((current) => ({
                        ...current,
                        weeklyReport: { ...current.weeklyReport, localTime: event.target.value },
                      }))}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={() => void sendWeeklyReviewTest()}
                    disabled={busyAction !== null || !preferences.emailEnabled || !preferences.weeklyReport.enabled}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyAction === 'weekly-review-test' ? 'Generazione e invio…' : 'Invia review settimanale di test'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshWeeklyReviewStatus()}
                    disabled={busyAction !== null}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busyAction === 'weekly-review-status' ? 'Verifica…' : 'Verifica pipeline e prossima esecuzione'}
                  </button>
                </div>
                <dl className="mt-4 grid gap-2 text-xs text-slate-700">
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <dt>Prossima esecuzione</dt>
                    <dd className="font-bold text-slate-900">
                      {weeklyReviewStatus?.schedule.nextRunAt
                        ? new Intl.DateTimeFormat('it-IT', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: weeklyReviewStatus.schedule.timezone,
                        }).format(new Date(weeklyReviewStatus.schedule.nextRunAt))
                        : 'Verifica stato'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <dt>Ultima consegna</dt>
                    <dd className="font-bold text-slate-900">
                      {weeklyReviewStatus?.latest
                        ? weeklyReviewPipelineLabel(weeklyReviewStatus.latest.deliveryState)
                        : 'Nessuna conferma caricata'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={saveReminderPolicy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busyAction === 'reminder-policy' ? 'Salvataggio…' : 'Salva avvisi e review'}
          </button>
        </fieldset>

        <p className="mt-4 text-xs text-slate-500">
          WhatsApp ed email restano disattivati finché non li abiliti. Credenziali e provider
          restano protetti esclusivamente nel backend.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={status.autostartEnabled === true}
            disabled={!status.available || busyAction !== null}
            onChange={(event) => void changeAutostart(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block text-xs font-black uppercase tracking-[0.16em] text-indigo-600">Desktop</span>
            <span className="mt-1 block text-lg font-bold text-slate-900">Avvia con Windows</span>
            <span className="mt-1 block text-sm text-slate-600">
              Usa l’avvio automatico dell’app installata. Chiudere la finestra mantiene Life
              Tracker nella tray; Esci termina completamente l’app.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-600">AI e privacy</p>
        <h3 className="mt-1 text-lg font-bold text-slate-900">Secure AI attiva</h3>
        <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
          <p className="rounded-xl bg-slate-50 p-3"><strong className="block text-slate-900">OpenAI protetta</strong>Le credenziali non entrano nel Desktop.</p>
          <p className="rounded-xl bg-slate-50 p-3"><strong className="block text-slate-900">MCP sola lettura</strong>Nessuna autorità di scrittura.</p>
          <p className="rounded-xl bg-slate-50 p-3"><strong className="block text-slate-900">Review limitata</strong>Invia metriche strutturate, non segreti.</p>
        </div>
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-black uppercase tracking-[0.16em] text-slate-700">Avanzate e diagnostica</summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <StatusItem label="Runtime" value={RUNTIME_TARGET} />
          <StatusItem label="Ambiente" value={DEPLOYMENT_ENVIRONMENT} />
          <StatusItem
            label="Bridge nativo"
            value={loading ? 'verifica' : status.available ? 'disponibile' : 'non disponibile'}
          />
        </dl>
        <p className="mt-4 break-all font-mono text-xs text-slate-600">{AI_BACKEND_BUILD_ID}</p>
        <p className="mt-2 text-xs text-slate-500">
          Metadato pubblico di instradamento della build; non è una credenziale.
        </p>
      </details>

      {message && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
    </section>
  );
}

function StatusItem({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-slate-900">{value}</dd>
    </div>
  );
}

function weeklyReviewPipelineLabel(
  state: WeeklyReviewStatusResponse['pipelineState'],
): string {
  return {
    NOT_DUE: 'Non ancora dovuta',
    GENERATING: 'Generazione in corso',
    ARCHIVED: 'Archiviata',
    INTERPRETING: 'Interpretazione in corso',
    COMPOSED: 'Email composta',
    SENDING: 'Invio in corso',
    PROVIDER_ACCEPTED: 'Accettata dal provider',
    RETRY_PENDING: 'Nuovo tentativo programmato',
    FAILED: 'Consegna da verificare',
  }[state];
}

function notificationPermissionLabel(
  value: DesktopNativeStatus['notificationPermission'],
): string {
  return {
    granted: 'ABILITATE',
    denied: 'DISABILITATE',
    prompt: 'DA CONFIGURARE',
    unavailable: 'NON DISPONIBILI',
  }[value];
}
