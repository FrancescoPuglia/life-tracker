import { describe, expect, it } from 'vitest';
import {
  parseWeeklyReviewApiRequest,
  parseWeeklyReviewApiResponse,
  weeklyReviewRetryRequest,
  weeklyReviewSendTestRequest,
  weeklyReviewStatusRequest,
} from './index';

const REPORT_ID = `report_${'a'.repeat(56)}`;

describe('weekly review API contract', () => {
  it('creates and parses the three exact requests', () => {
    expect(parseWeeklyReviewApiRequest(weeklyReviewStatusRequest()).action).toBe('status');
    expect(parseWeeklyReviewApiRequest(weeklyReviewSendTestRequest()).action).toBe('send_test');
    expect(parseWeeklyReviewApiRequest(weeklyReviewRetryRequest(REPORT_ID))).toEqual({
      schemaVersion: 'weekly-review-api-v1',
      action: 'retry_delivery',
      reportId: REPORT_ID,
    });
  });

  it('rejects extra authority and malformed report identities', () => {
    expect(() => parseWeeklyReviewApiRequest({
      ...weeklyReviewStatusRequest(), userId: 'forged-owner',
    })).toThrow('invalid');
    expect(() => weeklyReviewRetryRequest('../report')).toThrow('invalid');
  });

  it('parses provider-accepted metadata without accepting arbitrary fields', () => {
    expect(parseWeeklyReviewApiResponse({
      schemaVersion: 'weekly-review-api-v1',
      action: 'send_test',
      outcome: 'provider_accepted',
      pipelineState: 'PROVIDER_ACCEPTED',
      reportId: REPORT_ID,
      archiveId: REPORT_ID,
      period: '2026-08-17',
      providerMessageId: 'provider-message-1',
      idempotencyKeyHash: 'b'.repeat(64),
      occurredAt: '2026-08-23T18:30:00.000Z',
    })).toMatchObject({ reportId: REPORT_ID, pipelineState: 'PROVIDER_ACCEPTED' });
  });
});
