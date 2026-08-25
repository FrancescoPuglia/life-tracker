import {
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

export const NOTIFICATION_PREFERENCES_SCHEMA_VERSION =
  'notification-preferences-v1' as const;
export const NOTIFICATION_PREFERENCES_DOCUMENT_ID = 'default' as const;
export const NOTIFICATION_TIMEZONE_FALLBACK = 'Europe/Rome' as const;

export interface EditableNotificationPreferences {
  readonly timezone: string;
  readonly locale: string;
  readonly quietHours: Readonly<{
    enabled: boolean;
    start: string;
    end: string;
  }>;
  readonly desktopEnabled: boolean;
  readonly whatsappEnabled: boolean;
  readonly emailEnabled: boolean;
  readonly reminderOffsetsMinutes: readonly number[];
  readonly atStartEnabled: boolean;
  readonly missedStart: Readonly<{
    enabled: boolean;
    afterMinutes: number;
  }>;
  readonly maxRemindersPerBlock: number;
  readonly dailyReport: Readonly<{
    enabled: boolean;
    localTime: string;
  }>;
  readonly weeklyReport: Readonly<{
    enabled: boolean;
    isoWeekday: number;
    localTime: string;
  }>;
}

export interface NotificationPreferencesStore {
  load(uid: string): Promise<EditableNotificationPreferences>;
  save(uid: string, preferences: EditableNotificationPreferences): Promise<void>;
}

export function defaultNotificationPreferences(): EditableNotificationPreferences {
  return Object.freeze({
    timezone: NOTIFICATION_TIMEZONE_FALLBACK,
    locale: 'it-IT',
    quietHours: Object.freeze({ enabled: false, start: '22:30', end: '07:00' }),
    desktopEnabled: false,
    whatsappEnabled: false,
    emailEnabled: false,
    reminderOffsetsMinutes: Object.freeze([15]),
    atStartEnabled: true,
    missedStart: Object.freeze({ enabled: false, afterMinutes: 10 }),
    maxRemindersPerBlock: 3,
    dailyReport: Object.freeze({ enabled: false, localTime: '22:30' }),
    weeklyReport: Object.freeze({ enabled: false, isoWeekday: 7, localTime: '20:30' }),
  });
}

export function normalizeEditableNotificationPreferences(
  value: unknown,
): EditableNotificationPreferences {
  const source = record(value, 'Notification preferences');
  exact(source, [
    'atStartEnabled', 'dailyReport', 'desktopEnabled', 'emailEnabled', 'locale',
    'maxRemindersPerBlock', 'missedStart', 'quietHours', 'reminderOffsetsMinutes',
    'timezone', 'weeklyReport', 'whatsappEnabled',
  ], 'Notification preferences');
  const quietHours = record(source.quietHours, 'Quiet hours');
  const missedStart = record(source.missedStart, 'Missed-start preference');
  const dailyReport = record(source.dailyReport, 'Daily report preference');
  const weeklyReport = record(source.weeklyReport, 'Weekly report preference');
  exact(quietHours, ['enabled', 'end', 'start'], 'Quiet hours');
  exact(missedStart, ['afterMinutes', 'enabled'], 'Missed-start preference');
  exact(dailyReport, ['enabled', 'localTime'], 'Daily report preference');
  exact(weeklyReport, ['enabled', 'isoWeekday', 'localTime'], 'Weekly report preference');
  const timezone = timezoneValue(source.timezone);
  const locale = localeValue(source.locale);
  const offsets = offsetsValue(source.reminderOffsetsMinutes);
  return Object.freeze({
    timezone,
    locale,
    quietHours: Object.freeze({
      enabled: booleanValue(quietHours.enabled, 'Quiet-hours enabled state'),
      start: clockValue(quietHours.start, 'Quiet-hours start'),
      end: clockValue(quietHours.end, 'Quiet-hours end'),
    }),
    desktopEnabled: booleanValue(source.desktopEnabled, 'Desktop reminder state'),
    whatsappEnabled: booleanValue(source.whatsappEnabled, 'WhatsApp reminder state'),
    emailEnabled: booleanValue(source.emailEnabled, 'Email reminder state'),
    reminderOffsetsMinutes: Object.freeze(offsets),
    atStartEnabled: booleanValue(source.atStartEnabled, 'At-start reminder state'),
    missedStart: Object.freeze({
      enabled: booleanValue(missedStart.enabled, 'Missed-start enabled state'),
      afterMinutes: integerValue(missedStart.afterMinutes, 1, 240, 'Missed-start delay'),
    }),
    maxRemindersPerBlock: integerValue(
      source.maxRemindersPerBlock,
      1,
      8,
      'Maximum reminders per block',
    ),
    dailyReport: Object.freeze({
      enabled: booleanValue(dailyReport.enabled, 'Daily report state'),
      localTime: clockValue(dailyReport.localTime, 'Daily report time'),
    }),
    weeklyReport: Object.freeze({
      enabled: booleanValue(weeklyReport.enabled, 'Weekly report state'),
      isoWeekday: integerValue(weeklyReport.isoWeekday, 1, 7, 'Weekly report day'),
      localTime: clockValue(weeklyReport.localTime, 'Weekly report time'),
    }),
  });
}

export class FirestoreNotificationPreferencesStore implements NotificationPreferencesStore {
  async load(uid: string): Promise<EditableNotificationPreferences> {
    assertUid(uid);
    return runTransaction(firestore, async (transaction) => {
      const reference = doc(
        firestore,
        `users/${uid}/notificationPreferences/${NOTIFICATION_PREFERENCES_DOCUMENT_ID}`,
      );
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) return defaultNotificationPreferences();
      const value = snapshot.data();
      assertPersistedIdentity(uid, value);
      return normalizeEditableNotificationPreferences(editableFields(value));
    });
  }

  async save(uid: string, preferences: EditableNotificationPreferences): Promise<void> {
    assertUid(uid);
    const normalized = normalizeEditableNotificationPreferences(preferences);
    await runTransaction(firestore, async (transaction) => {
      const reference = doc(
        firestore,
        `users/${uid}/notificationPreferences/${NOTIFICATION_PREFERENCES_DOCUMENT_ID}`,
      );
      const snapshot = await transaction.get(reference);
      const editable = encodeEditable(normalized);
      if (snapshot.exists()) {
        assertPersistedIdentity(uid, snapshot.data());
        transaction.update(reference, { ...editable, updatedAt: serverTimestamp() });
        return;
      }
      transaction.set(reference, {
        schemaVersion: NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
        id: NOTIFICATION_PREFERENCES_DOCUMENT_ID,
        userId: uid,
        ...editable,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }
}

export const notificationPreferencesStore = new FirestoreNotificationPreferencesStore();

function encodeEditable(value: EditableNotificationPreferences): DocumentData {
  return {
    timezone: value.timezone,
    locale: value.locale,
    quietHours: { ...value.quietHours },
    desktopEnabled: value.desktopEnabled,
    whatsappEnabled: value.whatsappEnabled,
    emailEnabled: value.emailEnabled,
    reminderOffsetsMinutes: [...value.reminderOffsetsMinutes],
    atStartEnabled: value.atStartEnabled,
    missedStart: { ...value.missedStart },
    maxRemindersPerBlock: value.maxRemindersPerBlock,
    dailyReport: { ...value.dailyReport },
    weeklyReport: { ...value.weeklyReport },
  };
}

function assertPersistedIdentity(uid: string, value: DocumentData): void {
  exact(value, [
    'atStartEnabled', 'createdAt', 'dailyReport', 'desktopEnabled', 'emailEnabled',
    'id', 'locale', 'maxRemindersPerBlock', 'missedStart', 'quietHours',
    'reminderOffsetsMinutes', 'schemaVersion', 'timezone', 'updatedAt', 'userId',
    'weeklyReport', 'whatsappEnabled',
  ], 'Persisted notification preferences');
  if (
    value.schemaVersion !== NOTIFICATION_PREFERENCES_SCHEMA_VERSION
    || value.id !== NOTIFICATION_PREFERENCES_DOCUMENT_ID
    || value.userId !== uid
    || !(value.createdAt instanceof Timestamp)
    || !(value.updatedAt instanceof Timestamp)
  ) {
    throw new Error('Notification preferences identity or schema is invalid.');
  }
}

function editableFields(value: DocumentData): EditableNotificationPreferences {
  return {
    timezone: value.timezone,
    locale: value.locale,
    quietHours: value.quietHours,
    desktopEnabled: value.desktopEnabled,
    whatsappEnabled: value.whatsappEnabled,
    emailEnabled: value.emailEnabled,
    reminderOffsetsMinutes: value.reminderOffsetsMinutes,
    atStartEnabled: value.atStartEnabled,
    missedStart: value.missedStart,
    maxRemindersPerBlock: value.maxRemindersPerBlock,
    dailyReport: value.dailyReport,
    weeklyReport: value.weeklyReport,
  } as EditableNotificationPreferences;
}

function offsetsValue(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error('Reminder offsets are invalid.');
  }
  const offsets = value.map((item) => integerValue(item, 1, 1_440, 'Reminder offset'));
  if (new Set(offsets).size !== offsets.length) throw new Error('Reminder offsets are invalid.');
  return offsets.sort((left, right) => right - left);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function exact(source: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(source).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`${label} is invalid.`);
  }
}

function timezoneValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
    throw new Error('Timezone is invalid.');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error('Timezone is invalid.');
  }
  return value;
}

function localeValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 35) {
    throw new Error('Locale is invalid.');
  }
  try {
    if (Intl.getCanonicalLocales(value).length !== 1) throw new Error();
  } catch {
    throw new Error('Locale is invalid.');
  }
  return value;
}

function clockValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`);
  return value;
}

function integerValue(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
}

function assertUid(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error('Notification preferences owner is invalid.');
  }
}
