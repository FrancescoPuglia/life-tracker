import type {
  DocumentData,
  DocumentSnapshot,
} from 'firebase-admin/firestore';
import { DomainError } from '../domain/errors';
import { normalizeNotificationPreferences } from '../notifications/domain';
import {
  deriveScientificReportSchedulePolicy,
  type ScientificReportSchedulePolicy,
} from './scheduling';

/**
 * Exact server-side authority normalization shared by run and manifest
 * transactions. Legacy v1 preferences deliberately lose email authority until
 * an explicit v2 browser save supplies a validated recipient.
 */
export function deriveFirestoreScientificReportSchedulePolicy(
  uid: string,
  userSnapshot: DocumentSnapshot,
  preferenceSnapshot: DocumentSnapshot,
): ScientificReportSchedulePolicy {
  const userValue = userSnapshot.exists ? userSnapshot.data() ?? {} : null;
  const preferenceValue = preferenceSnapshot.exists ? preferenceSnapshot.data() ?? {} : {};
  const persistedTimezone = persistedUserTimezone(uid, userValue);
  if (preferenceSnapshot.exists) {
    assertScopedOwner(uid, preferenceValue, 'Notification preferences', true);
  }
  let effectivePreferences = preferenceValue;
  if (preferenceSnapshot.exists) {
    if (preferenceValue.schemaVersion === 'notification-preferences-v1') {
      effectivePreferences = {
        ...preferenceValue,
        emailEnabled: false,
        reportRecipient: null,
        dailyReport: {
          ...plainRecord(preferenceValue.dailyReport, 'Legacy Daily report preference'),
          enabled: false,
        },
        weeklyReport: {
          ...plainRecord(preferenceValue.weeklyReport, 'Legacy Weekly report preference'),
          enabled: false,
        },
      };
    } else if (preferenceValue.schemaVersion !== 'notification-preferences-v2') {
      throw new DomainError('INTERNAL', 'Notification preference schema is invalid.');
    }
  }
  return deriveScientificReportSchedulePolicy(normalizeNotificationPreferences(
    uid,
    effectivePreferences,
    persistedTimezone,
  ));
}

function persistedUserTimezone(uid: string, value: DocumentData | null): unknown {
  if (value === null) return undefined;
  assertScopedOwner(uid, value, 'Persisted user profile', false);
  const preferences = value.preferences === undefined
    ? null
    : plainRecord(value.preferences, 'Persisted user preferences');
  return preferences?.timezone ?? value.timezone;
}

function assertScopedOwner(
  uid: string,
  value: unknown,
  label: string,
  requireUserId: boolean,
): void {
  const record = plainRecord(value, label);
  if (requireUserId && record.userId !== uid) {
    throw new DomainError('INTERNAL', `${label} owner is invalid.`);
  }
  for (const field of ['userId', 'uid', 'ownerId', 'ownerUid'] as const) {
    if (record[field] !== undefined && record[field] !== uid) {
      throw new DomainError('INTERNAL', `${label} owner is invalid.`);
    }
  }
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('INTERNAL', `${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}
