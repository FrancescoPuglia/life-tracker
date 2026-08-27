import { describe, expect, it, vi } from 'vitest';
import { WEEKLY_REVIEW_API_SCHEMA_VERSION } from '../../../packages/report-contract';
import { createWeeklyReviewApiClient } from './weeklyReviewApiClient';

const REPORT_ID = `report_${'a'.repeat(56)}`;

describe('weekly review callable client', () => {
  it('sends an owner-free test request and validates provider acceptance', async () => {
    const call = vi.fn(async () => ({
      schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
      action: 'send_test',
      outcome: 'provider_accepted',
      pipelineState: 'PROVIDER_ACCEPTED',
      reportId: REPORT_ID,
      archiveId: REPORT_ID,
      period: '2026-08-17',
      providerMessageId: 'provider-message-1',
      idempotencyKeyHash: 'b'.repeat(64),
      occurredAt: '2026-08-27T10:00:00.000Z',
    }));

    await expect(createWeeklyReviewApiClient(call).sendTest())
      .resolves.toMatchObject({ outcome: 'provider_accepted', reportId: REPORT_ID });
    expect(call).toHaveBeenCalledWith({
      schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
      action: 'send_test',
    });
    expect(JSON.stringify(call.mock.calls)).not.toMatch(/userId|recipient|email/i);
  });

  it('fails closed on a malformed or redirected response', async () => {
    const call = vi.fn(async () => ({
      schemaVersion: WEEKLY_REVIEW_API_SCHEMA_VERSION,
      action: 'send_test',
      outcome: 'provider_accepted',
      reportId: REPORT_ID,
      archiveId: null,
    }));
    await expect(createWeeklyReviewApiClient(call).sendTest()).rejects.toThrow(/invalid/i);
  });
});
