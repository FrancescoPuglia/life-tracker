import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const API_ORIGIN = 'http://127.0.0.1:8787';
const APPROVAL_CAPABILITY = 'a'.repeat(43);
const ROLLBACK_CAPABILITY = 'r'.repeat(43);
const CHANGESET_HASH = 'b'.repeat(64);

type CallCounts = {
  chat: number;
  apply: number;
  rollback: number;
  expiredAuth: number;
};

test.describe('secure AI browser boundary', () => {
  test('desktop covers grounded read, exact preview, reject, apply, drift, errors, and undo', async ({ page }, testInfo) => {
    const calls: CallCounts = { chat: 0, apply: 0, rollback: 0, expiredAuth: 0 };
    const consoleErrors = collectUnexpectedConsoleErrors(page);
    await installFakeAITransport(page, calls);
    await registerWithFirebaseEmulator(page, testInfo);

    await expect(page.getByTestId('app-ready')).toBeVisible();
    await expect(page.getByText('No active goals yet.')).toBeVisible();

    await page.getByTestId('ask-ai-button').click();
    await expect(page.getByTestId('ai-drawer')).toBeVisible();
    await expect(page.getByTestId('ai-drawer-close')).toBeFocused();
    await expect(page.getByText('Backend AI autenticato')).toBeVisible();

    await sendAIMessage(page, 'Analizza la mia settimana');
    await expect(page.getByText('Analisi grounded su dati autorizzati.')).toBeVisible();
    expect(calls.chat).toBe(1);

    await startNewChat(page);
    await selectPlanMode(page);
    await sendAIMessage(page, 'Piano con conflitto');
    await expect(page.getByTestId('ai-plan-plan_conflict')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Modifiche Spostamenti' })).toBeVisible();
    await expect(page.getByText('Impegno bloccato alle 10:00.')).toBeVisible();
    await expect(page.getByText('Conflitto con blocco fisso.')).toBeVisible();
    await expect(page.getByText('La preferenza oraria resta invariata.')).toBeVisible();
    await expect(page.getByLabel('Valore precedente startTime')).toContainText('2098-12-31T09:00:00.000Z');
    await expect(page.getByLabel('Valore proposto endTime')).toContainText('2098-12-31T12:00:00.000Z');
    await expect(page.getByRole('button', { name: 'Applica piano' })).toBeDisabled();
    await page.screenshot({ path: 'test-results/playwright/desktop-conflict-preview.png', fullPage: true });
    await page.getByRole('button', { name: 'Rifiuta' }).click();
    await expect(page.getByText('Piano rifiutato senza modificare i dati.')).toBeVisible();
    expect(calls.apply).toBe(0);

    await startNewChat(page);
    await sendAIMessage(page, 'Piano sicuro');
    await expect(page.getByTestId('ai-plan-plan_safe')).toBeVisible();
    const applyButton = page.getByRole('button', { name: 'Applica piano' });
    await applyButton.dblclick();
    await expect(page.getByText('Piano applicato e verificato.')).toBeVisible();
    await expect(page.getByText('execution_safe', { exact: true })).toBeVisible();
    await expect(page.getByText('completata', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Annulla modifiche' })).toBeVisible();
    expect(calls.apply).toBe(1);
    await page.screenshot({ path: 'test-results/playwright/desktop-applied-receipt.png', fullPage: true });

    await page.getByRole('button', { name: 'Annulla modifiche' }).click();
    await expect(page.getByText('Rollback completato e verificato.')).toBeVisible();
    await expect(page.getByText('Rollback completato', { exact: true })).toBeVisible();
    expect(calls.rollback).toBe(1);
    expect(consoleErrors).toEqual([]);

    await startNewChat(page);
    await sendAIMessage(page, 'Piano stale');
    await page.getByRole('button', { name: 'Applica piano' }).click();
    await expect(page.getByText(/Lo stato è cambiato: questa anteprima/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Applica piano' })).toBeDisabled();

    await startNewChat(page);
    await sendAIMessage(page, 'Simula offline');
    await expect(page.getByText('Backend AI non raggiungibile')).toBeVisible();
    await expect(page.getByLabel('Messaggio per l’assistente AI')).toBeDisabled();
    await page.getByRole('button', { name: 'Riprova connessione AI' }).click();
    await expect(page.getByLabel('Messaggio per l’assistente AI')).toBeEnabled();

    await sendAIMessage(page, 'Sessione scaduta');
    await expect(page.getByText('Accedi per usare l’AI cloud')).toBeVisible();
    await expect(page.getByText(/La sessione è scaduta/)).toBeVisible();
    await expect(page.getByLabel('Messaggio per l’assistente AI')).toBeDisabled();
    expect(calls.expiredAuth).toBe(2);

    expect(consoleErrors).toHaveLength(4);
    expect(consoleErrors.filter((entry) => entry.includes('status of 409'))).toHaveLength(1);
    expect(consoleErrors.filter((entry) => entry.includes('ERR_CONNECTION_REFUSED'))).toHaveLength(1);
    expect(consoleErrors.filter((entry) => entry.includes('status of 401'))).toHaveLength(2);
  });

  test('mobile preserves layout, focus, authenticated request, and keyboard close', async ({ page }, testInfo) => {
    const calls: CallCounts = { chat: 0, apply: 0, rollback: 0, expiredAuth: 0 };
    const consoleErrors = collectUnexpectedConsoleErrors(page);
    await installFakeAITransport(page, calls);
    await registerWithFirebaseEmulator(page, testInfo);

    await page.getByTestId('ask-ai-button').click();
    const drawer = page.getByTestId('ai-drawer-panel');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('ai-drawer-close')).toBeFocused();
    const bounds = await drawer.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(393);
    const drawerOwnsHudOverlapPoint = await page.evaluate(() => {
      const candidate = document.elementFromPoint(48, window.innerHeight - 120);
      return Boolean(candidate?.closest('[data-testid="ai-drawer"]'));
    });
    expect(drawerOwnsHudOverlapPoint).toBe(true);

    await sendAIMessage(page, 'Analizza da mobile');
    await expect(page.getByText('Analisi grounded su dati autorizzati.')).toBeVisible();
    expect(calls.chat).toBe(1);
    await page.screenshot({ path: 'test-results/playwright/mobile-grounded-answer.png', fullPage: true });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ai-drawer')).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });
});

async function registerWithFirebaseEmulator(page: Page, testInfo: TestInfo): Promise<void> {
  const suffix = `${testInfo.project.name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const email = `browser-${suffix}@example.test`;
  const password = 'Verifier-Password-2026';
  const createResponse = await page.request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key',
    { data: { email, password, returnSecureToken: false } },
  );
  expect(createResponse.ok()).toBe(true);

  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByTestId('app-ready')).toBeVisible({ timeout: 45_000 });
  const motivation = page.getByRole('button', { name: 'Chiudi motivazione giornaliera' });
  if (await motivation.isVisible()) await motivation.click();
}

async function sendAIMessage(page: Page, message: string): Promise<void> {
  const input = page.getByLabel('Messaggio per l’assistente AI');
  await input.fill(message);
  await page.getByLabel('Invia messaggio AI').click();
}

async function startNewChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nuova chat' }).click();
  await expect(page.getByLabel('Messaggio per l’assistente AI')).toBeEnabled();
}

async function selectPlanMode(page: Page): Promise<void> {
  await page.getByLabel('Seleziona modalità AI').click();
  await page.getByRole('button', { name: /Plan.*Pianifica con anteprima/ }).click();
}

async function installFakeAITransport(page: Page, calls: CallCounts): Promise<void> {
  await page.route(`${API_ORIGIN}/v1/**`, async (route) => {
    const request = route.request();
    const authorization = request.headers().authorization;
    expect(Boolean(authorization && /^Bearer [A-Za-z0-9._-]+$/.test(authorization))).toBe(true);
    expect(request.method()).toBe('POST');
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(body, 'userId')).toBe(false);

    if (request.url().endsWith('/v1/chat')) {
      calls.chat += 1;
      const message = String(body.message ?? '');
      if (message === 'Simula offline') {
        await route.abort('connectionrefused');
        return;
      }
      if (message === 'Sessione scaduta') {
        calls.expiredAuth += 1;
        await json(route, 401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
        return;
      }
      if (message === 'Piano con conflitto') {
        await json(route, 200, { message: 'Anteprima con conflitto.', plan: lifePlan('plan_conflict', true) });
        return;
      }
      if (message === 'Piano sicuro') {
        await json(route, 200, { message: 'Anteprima sicura.', plan: lifePlan('plan_safe', false) });
        return;
      }
      if (message === 'Piano stale') {
        await json(route, 200, { message: 'Anteprima da verificare.', plan: lifePlan('plan_stale', false) });
        return;
      }
      await json(route, 200, { message: 'Analisi grounded su dati autorizzati.' });
      return;
    }

    if (/\/v1\/plans\/[^/]+\/apply$/.test(request.url())) {
      calls.apply += 1;
      expect(Object.keys(body).sort()).toEqual(['approvalCapability', 'idempotencyKey']);
      expect(body.approvalCapability).toBe(APPROVAL_CAPABILITY);
      expect(typeof body.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,160}$/.test(body.idempotencyKey)).toBe(true);
      if (request.url().includes('/plan_stale/')) {
        await json(route, 409, { error: { code: 'STATE_CHANGED', message: 'The plan is stale.' } });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      await json(route, 200, actionResult('applied'));
      return;
    }

    if (/\/v1\/executions\/[^/]+\/rollback$/.test(request.url())) {
      calls.rollback += 1;
      expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'rollbackCapability']);
      expect(body.rollbackCapability).toBe(ROLLBACK_CAPABILITY);
      expect(typeof body.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,160}$/.test(body.idempotencyKey)).toBe(true);
      await json(route, 200, actionResult('rolled_back'));
      return;
    }

    await json(route, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });
}

function lifePlan(id: string, conflicted: boolean) {
  return {
    id,
    tool: 'preview_week_schedule',
    createdAt: '2098-12-31T23:45:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    baseStateHash: 'a'.repeat(64),
    hash: CHANGESET_HASH,
    status: 'previewed',
    operations: [{ action: 'move', entityType: 'timeBlocks', entityId: 'block_1' }],
    diff: [{
      action: 'move',
      entityType: 'timeBlocks',
      entityId: 'block_1',
      summary: 'Sposta il blocco senza toccare gli impegni fissi.',
      title: 'Lavoro profondo',
      changedFields: ['startTime', 'endTime'],
      before: {
        startTime: '2098-12-31T09:00:00.000Z',
        endTime: '2098-12-31T10:00:00.000Z',
      },
      after: {
        startTime: '2098-12-31T11:00:00.000Z',
        endTime: '2098-12-31T12:00:00.000Z',
      },
    }],
    reason: 'Pianificazione richiesta dall’utente.',
    warnings: ['Impegno bloccato alle 10:00.'],
    conflicts: conflicted ? ['Conflitto con blocco fisso.'] : [],
    assumptions: ['La preferenza oraria resta invariata.'],
    expectedImpact: ['Sposta 60 minuti di lavoro profondo.'],
    destructiveOperationCount: 0,
    approval: {
      required: true,
      capability: APPROVAL_CAPABILITY,
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

function actionResult(status: 'applied' | 'rolled_back') {
  const applied = status === 'applied';
  return {
    message: applied ? 'Piano applicato e verificato.' : 'Rollback completato e verificato.',
    executionId: 'execution_safe',
    planId: 'plan_safe',
    hash: CHANGESET_HASH,
    status,
    idempotentReplay: false,
    verified: true,
    receipt: {
      executionId: 'execution_safe',
      planId: 'plan_safe',
      changesetHash: CHANGESET_HASH,
      status,
      verified: true,
      timestamp: '2099-01-01T00:00:01.000Z',
      affected: [{ collection: 'timeBlocks', id: 'block_1' }],
      rollbackAvailable: applied,
      rollbackExpiresAt: applied ? '2099-01-08T00:00:01.000Z' : null,
    },
    ...(applied ? {
      rollback: {
        capability: ROLLBACK_CAPABILITY,
        expiresAt: '2099-01-08T00:00:01.000Z',
      },
    } : {}),
  };
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function collectUnexpectedConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror:${error.name}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console:${message.text().slice(0, 160)}`);
  });
  return errors;
}
