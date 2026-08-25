import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as functionsLogger from 'firebase-functions/logger';
import { createDesktopReminderCallableFunction } from './desktop-reminder-api';
import { FirestoreDesktopReminderRateLimiter } from './desktop-reminder-rate-limiter';
import { FirestoreReminderRepository } from './firestore-repository';
import {
  ReminderReconciliationService,
  type ReconcileReminderInput,
} from './reconciliation-service';
import type { ReminderReconciliationExecutor } from './reconciliation-trigger';
import {
  createNotificationPreferencesReminderReconciliationFunction,
  createTimeBlockReminderReconciliationFunction,
  createUserProfileReminderReconciliationFunction,
} from './reconciliation-trigger';
import type { ReminderReconciliationRepository, ReminderTaskQueue } from './repository';
import { withWhatsAppPreferenceDisabled } from './runtime-channel-policy';

export const NATIVE_REMINDER_SCHEDULE_HORIZON_MS = 29 * 24 * 60 * 60 * 1_000;

const NATIVE_ONLY_QUEUE: ReminderTaskQueue = Object.freeze({
  maximumScheduleHorizonMs: NATIVE_REMINDER_SCHEDULE_HORIZON_MS,
  enqueue: async () => {
    throw new Error('Native-only reminder runtime cannot enqueue cloud work.');
  },
  cancel: async () => {
    throw new Error('Native-only reminder runtime cannot cancel cloud work.');
  },
});

/**
 * This executor has no runtime switch and no Cloud Tasks adapter. The isolated
 * native deployment is compile-time Desktop-only; a later cloud release must
 * deliberately replace these trigger Functions from a separately reviewed
 * codebase after Cloud Tasks and provider approval.
 */
export function createNativeOnlyReminderReconciliationExecutor(
  repository: ReminderReconciliationRepository,
): ReminderReconciliationExecutor {
  const reconciliation = new ReminderReconciliationService(repository, NATIVE_ONLY_QUEUE);
  return Object.freeze({
    reconcile: (input: ReconcileReminderInput) =>
      reconciliation.reconcile(withWhatsAppPreferenceDisabled(input)),
  });
}

const app = getApps()[0] ?? initializeApp();
const firestore = getFirestore(app);
const repository = new FirestoreReminderRepository(firestore);
const reconciliationDependencies = Object.freeze({
  source: repository,
  reconciliation: createNativeOnlyReminderReconciliationExecutor(repository),
  logger: functionsLogger,
});

export const reconcileTimeBlockReminders =
  createTimeBlockReminderReconciliationFunction(reconciliationDependencies);

export const reconcileNotificationPreferenceReminders =
  createNotificationPreferencesReminderReconciliationFunction(reconciliationDependencies);

export const reconcileUserProfileReminders =
  createUserProfileReminderReconciliationFunction(reconciliationDependencies);

export const desktopReminderApi = createDesktopReminderCallableFunction({
  repository,
  rateLimiter: new FirestoreDesktopReminderRateLimiter(firestore),
  logger: functionsLogger,
});
