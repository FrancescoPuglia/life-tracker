import {
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from '@/lib/firebase';

export const NOTIFICATION_PREFERENCES_SCHEMA_VERSION =
  'notification-preferences-v2' as const;
const LEGACY_NOTIFICATION_PREFERENCES_SCHEMA_VERSION =
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
  readonly reportRecipient: string | null;
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
    reportRecipient: null,
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
    'reportRecipient', 'timezone', 'weeklyReport', 'whatsappEnabled',
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
  const emailEnabled = booleanValue(source.emailEnabled, 'Email report state');
  const reportRecipient = reportRecipientValue(source.reportRecipient);
  const dailyEnabled = booleanValue(dailyReport.enabled, 'Daily report state');
  const weeklyEnabled = booleanValue(weeklyReport.enabled, 'Weekly report state');
  if (emailEnabled && reportRecipient === null) {
    throw new Error('Report recipient is required when email reports are enabled.');
  }
  if ((dailyEnabled || weeklyEnabled) && !emailEnabled) {
    throw new Error('Email reports must be enabled before a report schedule.');
  }
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
    emailEnabled,
    reportRecipient,
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
      enabled: dailyEnabled,
      localTime: clockValue(dailyReport.localTime, 'Daily report time'),
    }),
    weeklyReport: Object.freeze({
      enabled: weeklyEnabled,
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
        transaction.update(reference, {
          schemaVersion: NOTIFICATION_PREFERENCES_SCHEMA_VERSION,
          ...editable,
          updatedAt: serverTimestamp(),
        });
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
    reportRecipient: value.reportRecipient,
    reminderOffsetsMinutes: [...value.reminderOffsetsMinutes],
    atStartEnabled: value.atStartEnabled,
    missedStart: { ...value.missedStart },
    maxRemindersPerBlock: value.maxRemindersPerBlock,
    dailyReport: { ...value.dailyReport },
    weeklyReport: { ...value.weeklyReport },
  };
}

function assertPersistedIdentity(uid: string, value: DocumentData): void {
  const commonKeys = [
    'atStartEnabled', 'createdAt', 'dailyReport', 'desktopEnabled', 'emailEnabled',
    'id', 'locale', 'maxRemindersPerBlock', 'missedStart', 'quietHours',
    'reminderOffsetsMinutes', 'schemaVersion', 'timezone', 'updatedAt', 'userId',
    'weeklyReport', 'whatsappEnabled',
  ];
  if (value.schemaVersion === NOTIFICATION_PREFERENCES_SCHEMA_VERSION) {
    exact(value, [...commonKeys, 'reportRecipient'], 'Persisted notification preferences');
  } else if (value.schemaVersion === LEGACY_NOTIFICATION_PREFERENCES_SCHEMA_VERSION) {
    exact(value, commonKeys, 'Persisted notification preferences');
  } else {
    throw new Error('Notification preferences identity or schema is invalid.');
  }
  if (
    value.id !== NOTIFICATION_PREFERENCES_DOCUMENT_ID
    || value.userId !== uid
    || !(value.createdAt instanceof Timestamp)
    || !(value.updatedAt instanceof Timestamp)
  ) {
    throw new Error('Notification preferences identity or schema is invalid.');
  }
}

function editableFields(value: DocumentData): EditableNotificationPreferences {
  const legacy = value.schemaVersion === LEGACY_NOTIFICATION_PREFERENCES_SCHEMA_VERSION;
  return {
    timezone: value.timezone,
    locale: value.locale,
    quietHours: value.quietHours,
    desktopEnabled: value.desktopEnabled,
    whatsappEnabled: value.whatsappEnabled,
    // V1 had no recipient authority. Fail closed until an explicit validated
    // v2 save configures the recipient and re-enables report schedules.
    emailEnabled: legacy ? false : value.emailEnabled,
    reportRecipient: legacy ? null : value.reportRecipient,
    reminderOffsetsMinutes: value.reminderOffsetsMinutes,
    atStartEnabled: value.atStartEnabled,
    missedStart: value.missedStart,
    maxRemindersPerBlock: value.maxRemindersPerBlock,
    dailyReport: legacy ? { ...value.dailyReport, enabled: false } : value.dailyReport,
    weeklyReport: legacy ? { ...value.weeklyReport, enabled: false } : value.weeklyReport,
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

function reportRecipientValue(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim() || value.length > 254) {
    throw new Error('Report recipient is invalid.');
  }
  if (!/^[^\s@<>]{1,64}@[^\s@<>]{1,185}$/.test(value) || /[\r\n\u0000]/.test(value)) {
    throw new Error('Report recipient is invalid.');
  }
  const domain = value.slice(value.lastIndexOf('@') + 1);
  if (domain.length < 3 || domain.startsWith('.') || domain.endsWith('.') || !domain.includes('.')) {
    throw new Error('Report recipient is invalid.');
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
