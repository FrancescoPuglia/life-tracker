import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../src/domain/integrity';
import type { EntityRecord, UserPlanningPreferences } from '../../src/domain/types';
import {
  REPORT_EMAIL_SCHEMA_VERSION,
  REPORT_EMAIL_TEMPLATE_VERSION,
  ReportEmailCompositionError,
  ResendEmailProvider,
  buildScientificExecutionReport,
  composeScientificReportEmail,
  createStoredScientificReportArchive,
  renderReportCharts,
  validateComposedScientificReportEmail,
  type ResendEmailClient,
  type ScientificExecutionReport,
  type ScientificReportInput,
  type StoredScientificReportArchive,
} from '../../src/reports';

const UID = 'report-email-owner';
const NOW = '2026-08-23T20:30:00.000Z';
const PREFERENCES: UserPlanningPreferences = {
  source: 'persisted',
  defaultsApplied: [],
  timezone: 'Europe/Rome',
  workingHours: { start: '07:00', end: '22:00' },
  maxDailyPlannedMinutes: 600,
  maxWeeklyPlannedMinutes: 3_000,
  minBufferMinutes: 15,
  maxConsecutiveHighEnergyBlocks: 2,
};

function record(id: string, values: Readonly<Record<string, unknown>> = {}): EntityRecord {
  return {
    id,
    _version: 1,
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-08-01T08:00:00.000Z',
    ...values,
  };
}

function report(
  type: 'daily' | 'weekly' = 'weekly',
  sessionsAvailable = true,
): ScientificExecutionReport {
  const goals = Array.from({ length: 15 }, (_, index) => record(`goal-${index}`, {
    title: index === 0
      ? '<script>steal-authority()</script> & hostile "Goal"'
      : `Goal ${index}`,
    timeAllocationTarget: index === 0 ? 168 : index,
  }));
  const timeBlocks = Array.from({ length: 7 }, (_, index) => {
    const day = 17 + index;
    const plannedMinutes = 60 + index * 10;
    return record(`block-${index}`, {
      title: `Block ${index}`,
      goalId: `goal-${index}`,
      startTime: `2026-08-${day}T07:00:00.000Z`,
      endTime: new Date(Date.parse(`2026-08-${day}T07:00:00.000Z`) + plannedMinutes * 60_000)
        .toISOString(),
      status: index === 5 ? 'planned' : 'completed',
      type: index % 2 === 0 ? 'deep' : 'work',
    });
  });
  const sessions = sessionsAvailable
    ? Array.from({ length: 6 }, (_, index) => {
      const day = 17 + index;
      const actualMinutes = 50 + index * 5;
      return record(`session-${index}`, {
        timeBlockId: `block-${index}`,
        goalId: `goal-${index}`,
        startTime: `2026-08-${day}T07:05:00.000Z`,
        endTime: new Date(Date.parse(`2026-08-${day}T07:05:00.000Z`) + actualMinutes * 60_000)
          .toISOString(),
        duration: actualMinutes * 60,
        status: 'completed',
        tags: [],
      });
    })
    : null;
  const input: ScientificReportInput = {
    uid: UID,
    reportType: type,
    localDate: '2026-08-23',
    timezone: 'Europe/Rome',
    locale: 'en-GB',
    generatedAt: NOW,
    preferences: PREFERENCES,
    coverage: {
      goals: 'complete',
      projects: 'complete',
      tasks: 'complete',
      timeBlocks: 'complete',
      sessions: sessionsAvailable ? 'complete' : 'unavailable',
      habits: 'complete',
      habitLogs: 'complete',
    },
    records: {
      goals,
      projects: [],
      tasks: [],
      timeBlocks,
      sessions,
      habits: [],
      habitLogs: [],
    },
  };
  return buildScientificExecutionReport(input);
}

function archive(
  type: 'daily' | 'weekly' = 'weekly',
  sessionsAvailable = true,
): StoredScientificReportArchive {
  return createStoredScientificReportArchive(UID, report(type, sessionsAvailable), NOW);
}

function mailbox() {
  return {
    from: { email: 'reports@example.test', name: 'Life Tracker Reports' },
    to: { email: 'francesco@example.test', name: 'Francesco' },
  } as const;
}

function acceptedClient(capture?: (payload: unknown, options: unknown) => void): ResendEmailClient {
  return {
    emails: {
      async send(payload, options) {
        capture?.(payload, options);
        return {
          data: { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' },
          error: null,
          headers: {},
        };
      },
    },
  };
}

describe('deterministic scientific report email composition', () => {
  it('renders a deterministic weekly HTML/text report with every required scientific section', async () => {
    const source = archive();
    const before = canonicalJson(source);
    const first = await composeScientificReportEmail({ uid: UID, archive: source });
    const retry = await composeScientificReportEmail({ uid: UID, archive: source });

    expect(first.schemaVersion).toBe(REPORT_EMAIL_SCHEMA_VERSION);
    expect(first.templateVersion).toBe(REPORT_EMAIL_TEMPLATE_VERSION);
    expect(first).toEqual(retry);
    expect(first.attachments).toHaveLength(source.report.charts.length);
    expect(first.idempotencyKey).toMatch(/^life-tracker-report-v3\/[0-9a-f]{64}$/);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(() => validateComposedScientificReportEmail(first)).not.toThrow();
    expect(first.html).toMatch(/^<!doctype html>/);
    expect(first.html).not.toMatch(/https?:\/\//i);
    expect(first.html).toContain('name="viewport"');
    expect(first.html).toContain('max-width:696px');
    expect(first.subject).toBe(
      'Life Tracker — Weekly Executive Review · 2026-08-17 → 2026-08-23',
    );
    expect(first.html).toContain('PRECISION PERFORMANCE OS');
    for (let section = 1; section <= 18; section += 1) {
      expect(first.html).toContain(`${section}.`);
      expect(first.text).toContain(`${section}.`);
    }
    expect(first.html).toContain('Missing Sessions are unknown and never treated as zero execution');
    expect(first.text).toContain('Missing Sessions are unknown, never zero');
    expect(first.text).toContain('Associations are not causal claims');
    expect(first.html).toContain('OBSERVED:');
    expect(first.html).toContain('Confidence');
    expect(first.html).not.toMatch(/<script\b/i);
    expect(first.html).not.toContain('steal-authority()');
    expect(first.html.match(/cid:chart_[0-9a-f]{48}@life-tracker-report/g)).toHaveLength(
      first.attachments.length,
    );
    for (const attachment of first.attachments) {
      expect(attachment.content.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(createHash('sha256').update(attachment.content).digest('hex'))
        .toBe(attachment.contentHash);
      expect(first.html).toContain(`cid:${attachment.contentId}`);
    }
    expect(canonicalJson(source)).toBe(before);
  });

  it('keeps a Daily report useful and explicit when Session evidence is unavailable', async () => {
    const email = await composeScientificReportEmail({
      uid: UID,
      archive: archive('daily', false),
    });

    expect(email.subject).toBe('Life Tracker Daily Execution Report — 2026-08-23');
    expect(email.html).toContain('Daily Execution Report');
    expect(email.html).toContain('Tomorrow Workload and Risk');
    expect(email.html).toContain('Data-quality Note');
    expect(email.text).toContain('Actual Session time: Unavailable');
    expect(email.text).not.toContain('Actual Session time: 0');
    expect(email.text).toContain('missing Sessions are unknown, never zero');
  });

  it('fails closed on cross-owner/archive/chart tampering and preserves the archive', async () => {
    const source = archive();
    const before = canonicalJson(source);
    let called = false;
    await expect(composeScientificReportEmail({
      uid: 'another-owner',
      archive: source,
    }, async () => {
      called = true;
      return [];
    })).rejects.toBeInstanceOf(ReportEmailCompositionError);
    expect(called).toBe(false);

    await expect(composeScientificReportEmail({
      uid: UID,
      archive: { ...source, artifactHash: '0'.repeat(64) },
    })).rejects.toBeInstanceOf(ReportEmailCompositionError);

    const rendered = await renderReportCharts(source.report.charts);
    const first = rendered[0];
    if (!first) throw new Error('Missing rendered chart fixture.');
    const corruptedPng = Buffer.from(first.png.png);
    corruptedPng[corruptedPng.length - 1] = (corruptedPng[corruptedPng.length - 1] ?? 0) ^ 1;
    const corrupted = [
      { ...first, png: { ...first.png, png: corruptedPng } },
      ...rendered.slice(1),
    ];
    await expect(composeScientificReportEmail({ uid: UID, archive: source }, async () => corrupted))
      .rejects.toBeInstanceOf(ReportEmailCompositionError);
    expect(canonicalJson(source)).toBe(before);
  });

  it('normalizes native rendering failure without leaking its detail or destroying the report', async () => {
    const source = archive();
    const before = canonicalJson(source);
    const promise = composeScientificReportEmail({ uid: UID, archive: source }, async () => {
      throw new Error('native failure with credential-shaped private detail');
    });
    await expect(promise).rejects.toBeInstanceOf(ReportEmailCompositionError);
    await expect(promise).rejects.not.toThrow('credential-shaped');
    expect(canonicalJson(source)).toBe(before);
  });

  it('rejects active/external HTML, hash tampering, and corrupted attachments at the provider boundary', async () => {
    const email = await composeScientificReportEmail({ uid: UID, archive: archive() });
    const active = { ...email, html: email.html.replace('</body>', '<script>x()</script></body>') };
    expect(() => validateComposedScientificReportEmail(active)).toThrow('active content');

    const external = { ...email, html: email.html.replace('</body>', '<img src="https://tracker.invalid/x"/></body>') };
    expect(() => validateComposedScientificReportEmail(external)).toThrow('external resource');

    expect(() => validateComposedScientificReportEmail({
      ...email,
      subject: `${email.subject} changed`,
    })).toThrow('content hash is invalid');

    const first = email.attachments[0];
    if (!first) throw new Error('Missing attachment fixture.');
    const content = Buffer.from(first.content);
    content[content.length - 1] = (content[content.length - 1] ?? 0) ^ 1;
    expect(() => validateComposedScientificReportEmail({
      ...email,
      attachments: [{ ...first, content }, ...email.attachments.slice(1)],
    })).toThrow('attachment is invalid');
  });
});

describe('provider-neutral Resend report adapter', () => {
  it('maps the exact HTML, text, copied CID buffers, tags, and stable provider idempotency key', async () => {
    const email = await composeScientificReportEmail({ uid: UID, archive: archive('daily') });
    let capturedPayload: any;
    let capturedOptions: any;
    const provider = new ResendEmailProvider(acceptedClient((payload, options) => {
      capturedPayload = payload;
      capturedOptions = options;
      const firstAttachment = capturedPayload.attachments?.[0]?.content;
      if (Buffer.isBuffer(firstAttachment)) firstAttachment[0] = 0;
    }));
    const beforeHash = createHash('sha256').update(email.attachments[0]!.content).digest('hex');
    const result = await provider.sendReportEmail({ ...mailbox(), email });

    expect(result).toEqual({
      outcome: 'accepted',
      provider: 'resend',
      providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
    });
    expect(capturedPayload).toMatchObject({
      from: 'Life Tracker Reports <reports@example.test>',
      to: ['Francesco <francesco@example.test>'],
      subject: email.subject,
      html: email.html,
      text: email.text,
      tags: [
        { name: 'report_type', value: 'daily' },
        { name: 'report_schema', value: 'v1' },
      ],
    });
    expect(capturedPayload.attachments[0]).toMatchObject({
      filename: email.attachments[0]!.filename,
      contentId: email.attachments[0]!.contentId,
      contentType: 'image/png',
    });
    expect(capturedOptions).toEqual({ idempotencyKey: email.idempotencyKey });
    expect(createHash('sha256').update(email.attachments[0]!.content).digest('hex')).toBe(beforeHash);
  });

  it.each([
    ['rate_limit_exceeded', 'retry_later', 'rate_limited'],
    ['concurrent_idempotent_requests', 'retry_later', 'idempotency_in_progress'],
    ['monthly_quota_exceeded', 'rejected', 'provider_quota_exhausted'],
    ['invalid_api_key', 'rejected', 'provider_configuration'],
    ['invalid_idempotent_request', 'rejected', 'idempotency_conflict'],
    ['security_error', 'rejected', 'provider_security_rejection'],
    ['invalid_attachment', 'rejected', 'invalid_message'],
    ['validation_error', 'rejected', 'provider_rejected'],
    ['internal_server_error', 'uncertain', 'transport_unknown'],
  ] as const)('normalizes provider error %s without exposing its body', async (name, outcome, reason) => {
    const email = await composeScientificReportEmail({ uid: UID, archive: archive('daily') });
    const client = {
      emails: {
        async send() {
          return {
            data: null,
            error: { name, statusCode: 500, message: 'private provider body and internal detail' },
            headers: null,
          };
        },
      },
    } as ResendEmailClient;
    const result = await new ResendEmailProvider(client).sendReportEmail({ ...mailbox(), email });
    expect(result).toEqual({ outcome, provider: 'resend', reason });
    expect(JSON.stringify(result)).not.toContain('private provider body');
  });

  it('fails closed before the provider on an invalid recipient and treats thrown transport as uncertain', async () => {
    const email = await composeScientificReportEmail({ uid: UID, archive: archive('daily') });
    const send = vi.fn(async () => {
      throw new Error('network response with private detail');
    });
    const provider = new ResendEmailProvider({ emails: { send } } as ResendEmailClient);
    const invalid = await provider.sendReportEmail({
      ...mailbox(),
      to: { email: 'not-an-email', name: null },
      email,
    });
    expect(invalid).toEqual({
      outcome: 'rejected',
      provider: 'resend',
      reason: 'invalid_recipient',
    });
    expect(send).not.toHaveBeenCalled();

    const uncertain = await provider.sendReportEmail({ ...mailbox(), email });
    expect(uncertain).toEqual({
      outcome: 'uncertain',
      provider: 'resend',
      reason: 'transport_unknown',
    });
    expect(JSON.stringify(uncertain)).not.toContain('private detail');
  });

  it('does not call the provider for a content hash mismatch', async () => {
    const email = await composeScientificReportEmail({ uid: UID, archive: archive('daily') });
    const send = vi.fn(acceptedClient().emails.send);
    const provider = new ResendEmailProvider({ emails: { send } });
    const result = await provider.sendReportEmail({
      ...mailbox(),
      email: { ...email, subject: `${email.subject} changed` },
    });
    expect(result).toEqual({
      outcome: 'rejected',
      provider: 'resend',
      reason: 'invalid_message',
    });
    expect(send).not.toHaveBeenCalled();
  });
});
