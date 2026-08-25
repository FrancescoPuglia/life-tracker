import { describe, expect, it } from 'vitest';
import { InMemoryReminderRepository } from '../../src/notifications/in-memory-repository';
import {
  createNativeOnlyReminderReconciliationExecutor,
  desktopReminderApi,
  reconcileNotificationPreferenceReminders,
  reconcileTimeBlockReminders,
  reconcileUserProfileReminders,
} from '../../src/notifications/native-runtime-bindings';

const UID = 'owner-1';

describe('isolated native reminder runtime', () => {
  it('exports one authenticated callable and three private Firestore triggers with no secrets', () => {
    const callable = endpoint(desktopReminderApi);
    expect(callable).toMatchObject({
      region: ['europe-west1'],
      ingressSettings: 'ALLOW_ALL',
      timeoutSeconds: 15,
      minInstances: 0,
      maxInstances: 2,
      concurrency: 20,
      callableTrigger: {},
    });
    expect(callable.secretEnvironmentVariables ?? []).toEqual([]);

    const triggers = [
      endpoint(reconcileTimeBlockReminders),
      endpoint(reconcileNotificationPreferenceReminders),
      endpoint(reconcileUserProfileReminders),
    ];
    for (const trigger of triggers) {
      expect(trigger).toMatchObject({
        region: ['europe-west1'],
        ingressSettings: 'ALLOW_INTERNAL_ONLY',
        minInstances: 0,
        eventTrigger: expect.objectContaining({
          eventType: 'google.cloud.firestore.document.v1.written',
          retry: true,
        }),
      });
      expect(trigger.secretEnvironmentVariables ?? []).toEqual([]);
      expect(trigger.taskQueueTrigger).toBeUndefined();
      expect(trigger.scheduleTrigger).toBeUndefined();
    }
  });

  it('is compile-time Desktop-only even when untrusted preferences request WhatsApp', async () => {
    const repository = new InMemoryReminderRepository();
    const reconciliation = createNativeOnlyReminderReconciliationExecutor(repository);

    await expect(reconciliation.reconcile(reconciliationInput())).resolves.toMatchObject({
      desiredJobCount: 1,
      clientPendingCount: 1,
      enqueuedCount: 0,
      deferredCount: 0,
      cancellationFailureCount: 0,
    });
    expect(repository.listJobsForTest(UID).filter((job) => job.state !== 'superseded'))
      .toEqual([expect.objectContaining({ channel: 'desktop', state: 'client_pending' })]);
  });
});

function reconciliationInput() {
  return {
    uid: UID,
    timeBlockId: 'block-1',
    timeBlockValue: {
      userId: UID,
      startTime: '2026-08-25T10:00:00.000Z',
      endTime: '2026-08-25T11:00:00.000Z',
      status: 'planned',
      reminderEnabled: true,
    },
    notificationPreferencesValue: {
      schemaVersion: 'notification-preferences-v2',
      userId: UID,
      timezone: 'Europe/Rome',
      desktopEnabled: true,
      whatsappEnabled: true,
      reminderOffsetsMinutes: [15],
      atStartEnabled: false,
      missedStart: { enabled: false, afterMinutes: 10 },
      maxRemindersPerBlock: 3,
    },
    persistedTimezone: 'Europe/Rome',
    now: '2026-08-25T08:00:00.000Z',
  };
}

function endpoint(value: unknown): Record<string, unknown> {
  return (value as { __endpoint: Record<string, unknown> }).__endpoint;
}
