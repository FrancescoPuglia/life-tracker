import { describe, expect, it, vi } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { createWeeklyReviewCallableHandler } from '../../src/reports/weekly-review-api';

const UID = 'owner-1';
const NOW = '2026-08-27T10:00:00.000Z';

function status() {
  return {
    pipelineState: 'NOT_DUE' as const,
    schedule: {
      enabled: true,
      isoWeekday: 7,
      localTime: '20:30',
      timezone: 'Europe/Rome',
      nextRunAt: '2026-08-30T18:30:00.000Z',
    },
    latest: null,
  };
}

function result() {
  return {
    outcome: 'not_due' as const,
    pipelineState: 'NOT_DUE' as const,
    reportId: null,
    archiveId: null,
    period: null,
    providerMessageId: null,
    idempotencyKeyHash: null,
    occurredAt: NOW,
  };
}

function dependencies(owner: string | null = UID) {
  return {
    gate: { allowedOwnerUid: vi.fn(() => owner) },
    now: () => new Date(NOW),
    service: {
      status: vi.fn(async () => status()),
      sendTest: vi.fn(async () => result()),
      retryDelivery: vi.fn(async () => result()),
    },
  };
}

describe('authenticated weekly review API', () => {
  it('derives the owner only from verified Firebase Auth', async () => {
    const deps = dependencies();
    const handler = createWeeklyReviewCallableHandler(deps);
    await expect(handler({
      auth: { uid: UID },
      data: { schemaVersion: 'weekly-review-api-v1', action: 'status' },
    })).resolves.toMatchObject({ action: 'status', pipelineState: 'NOT_DUE' });
    expect(deps.service.status).toHaveBeenCalledWith(UID, NOW);
  });

  it('denies unauthenticated, forged-owner, disabled, and malformed calls', async () => {
    await expect(createWeeklyReviewCallableHandler(dependencies())({
      data: { schemaVersion: 'weekly-review-api-v1', action: 'status' },
    })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(createWeeklyReviewCallableHandler(dependencies())({
      auth: { uid: 'other-owner' },
      data: { schemaVersion: 'weekly-review-api-v1', action: 'status' },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(createWeeklyReviewCallableHandler(dependencies(null))({
      auth: { uid: UID },
      data: { schemaVersion: 'weekly-review-api-v1', action: 'status' },
    })).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(createWeeklyReviewCallableHandler(dependencies())({
      auth: { uid: UID },
      data: { schemaVersion: 'weekly-review-api-v1', action: 'send_test', userId: UID },
    })).rejects.toBeInstanceOf(HttpsError);
  });

  it('passes only an exact report ID to the owner-bound retry service', async () => {
    const deps = dependencies();
    const reportId = `report_${'a'.repeat(56)}`;
    await createWeeklyReviewCallableHandler(deps)({
      auth: { uid: UID },
      data: { schemaVersion: 'weekly-review-api-v1', action: 'retry_delivery', reportId },
    });
    expect(deps.service.retryDelivery).toHaveBeenCalledWith(UID, reportId, NOW);
  });
});
