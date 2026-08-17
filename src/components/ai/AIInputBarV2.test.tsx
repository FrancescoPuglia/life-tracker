import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AIClientError } from '@/lib/ai/client';
import AIInputBarV2, { isAssistantSessionOwner } from './AIInputBarV2';

const mocks = vi.hoisted(() => ({
  authState: {
    user: { uid: 'firebase-user' } as { uid: string } | null,
    status: 'signedIn' as 'unknown' | 'signedIn' | 'signedOut',
  },
  configured: true,
  requestAIChat: vi.fn(),
  applyAIPlan: vi.fn(),
  rollbackAIExecution: vi.fn(),
  createIdempotencyKey: vi.fn(),
  voiceService: {
    getLanguage: vi.fn(),
    getSettings: vi.fn(),
    speakAIResponse: vi.fn(),
    stopSpeech: vi.fn(),
  },
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuthContext: () => mocks.authState,
}));

vi.mock('@/lib/ai/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai/client')>();
  return {
    ...original,
    isAIBackendConfigured: () => mocks.configured,
    requestAIChat: mocks.requestAIChat,
    applyAIPlan: mocks.applyAIPlan,
    rollbackAIExecution: mocks.rollbackAIExecution,
    createIdempotencyKey: mocks.createIdempotencyKey,
  };
});

vi.mock('@/lib/voice/voiceService', () => ({
  getVoiceService: () => mocks.voiceService,
}));

describe('AIInputBarV2 secure client flow', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.authState.user = { uid: 'firebase-user' };
    mocks.authState.status = 'signedIn';
    mocks.configured = true;
    mocks.requestAIChat.mockReset();
    mocks.applyAIPlan.mockReset();
    mocks.rollbackAIExecution.mockReset();
    mocks.createIdempotencyKey.mockReset();
    mocks.createIdempotencyKey.mockReturnValue('idem_1234567890123456');
    mocks.voiceService.getLanguage.mockReset();
    mocks.voiceService.getLanguage.mockReturnValue('it-IT');
    mocks.voiceService.getSettings.mockReset();
    mocks.voiceService.getSettings.mockReturnValue({ provider: 'browser' });
    mocks.voiceService.speakAIResponse.mockReset();
    mocks.voiceService.stopSpeech.mockReset();
  });

  it('fails closed until the hydrated assistant session matches the authenticated UID', () => {
    expect(isAssistantSessionOwner('user-a', 'user-a')).toBe(true);
    expect(isAssistantSessionOwner('user-a', 'user-b')).toBe(false);
    expect(isAssistantSessionOwner('user-a', null)).toBe(false);
    expect(isAssistantSessionOwner(null, 'user-a')).toBe(false);
  });

  it('disables cloud AI clearly for signed-out users', () => {
    mocks.authState.user = null;
    mocks.authState.status = 'signedOut';

    render(<AIInputBarV2 />);

    expect(screen.getByText('Accedi per usare l’AI cloud')).toBeInTheDocument();
    expect(screen.getByText(/modalità guest non invia dati al cloud/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Messaggio per l’assistente AI')).toBeDisabled();
  });

  it('disables requests when the external backend is absent', () => {
    mocks.configured = false;

    render(<AIInputBarV2 />);

    expect(screen.getByText('Backend AI non configurato')).toBeInTheDocument();
    expect(screen.getByText(/NEXT_PUBLIC_AI_API_BASE_URL/)).toBeInTheDocument();
    expect(screen.getByLabelText('Invia messaggio AI')).toBeDisabled();
  });

  it('sends only conversational input through the authenticated client', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({ message: 'Risposta dal backend' });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Organizza domani' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));

    await waitFor(() => {
      expect(mocks.requestAIChat).toHaveBeenCalledWith({
        message: 'Organizza domani',
        mode: 'ask',
        history: [],
      });
    });
    expect(await screen.findByText('Risposta dal backend')).toBeInTheDocument();
  });

  it('renders a recoverable backend-offline state without exposing provider details', async () => {
    mocks.requestAIChat.mockRejectedValueOnce(new AIClientError('unavailable', 503));
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Analizza oggi' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));

    expect(await screen.findByText('Backend AI non raggiungibile')).toBeInTheDocument();
    expect(screen.getByLabelText('Messaggio per l’assistente AI')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova connessione AI' }));
    expect(screen.getByLabelText('Messaggio per l’assistente AI')).toBeEnabled();
  });

  it('shows an expired-authentication state after the client refresh attempt fails', async () => {
    mocks.requestAIChat.mockRejectedValueOnce(new AIClientError('session_expired', 401));
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Analizza oggi' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));

    expect(await screen.findByText('Accedi per usare l’AI cloud')).toBeInTheDocument();
    expect(screen.getByText(/sessione è scaduta/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Messaggio per l’assistente AI')).toBeDisabled();
  });

  it('applies an immutable preview through the backend without local data callbacks', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: {
        id: 'plan_123',
        tool: 'preview_changes',
        createdAt: '2098-12-31T23:45:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        baseStateHash: 'a'.repeat(64),
        hash: 'b'.repeat(64),
        operations: [
          { action: 'create', entityType: 'timeBlocks', entityId: 'block_1' },
          { action: 'update', entityType: 'tasks', entityId: 'task_1' },
        ],
        diff: [
          {
            action: 'create',
            entityType: 'timeBlocks',
            entityId: 'block_1',
            summary: 'Crea blocco di lavoro profondo',
            title: 'Lavoro profondo',
            changedFields: ['title', 'startTime', 'endTime'],
            before: null,
            after: { title: 'Lavoro profondo' },
          },
          {
            action: 'update',
            entityType: 'tasks',
            entityId: 'task_1',
            summary: 'Collega il task al nuovo blocco',
            title: 'Task principale',
            changedFields: ['timeBlockId'],
            before: { timeBlockId: null },
            after: { timeBlockId: 'block_1' },
          },
        ],
        reason: 'Pianificazione richiesta.',
        warnings: [],
        conflicts: [],
        assumptions: [],
        expectedImpact: ['Due modifiche alla pianificazione.'],
        destructiveOperationCount: 0,
        status: 'previewed',
        approval: {
          required: true,
          capability: 'a'.repeat(43),
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
    });
    mocks.applyAIPlan.mockResolvedValueOnce(validActionResult());
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    expect(await screen.findByText('Crea blocco di lavoro profondo')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));

    await waitFor(() => {
      expect(mocks.applyAIPlan).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'plan_123', approval: expect.any(Object) }),
        'idem_1234567890123456',
      );
    });
    expect(await screen.findByText('Piano applicato')).toBeInTheDocument();
    expect(screen.getByText(/Ricevuta:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla modifiche' })).toBeInTheDocument();
  });

  it('rejects a preview without invoking a privileged endpoint', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: minimalPlan(),
    });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rifiuta' }));

    expect(await screen.findByText('Piano rifiutato senza modificare i dati.')).toBeInTheDocument();
    expect(mocks.applyAIPlan).not.toHaveBeenCalled();
  });

  it('uses the execution-bound capability for rollback', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: minimalPlan(),
    });
    mocks.applyAIPlan.mockResolvedValueOnce(validActionResult());
    mocks.rollbackAIExecution.mockResolvedValueOnce({
      ...validActionResult(),
      message: 'Rollback completato',
      status: 'rolled_back',
      rollback: undefined,
      receipt: {
        ...validActionResult().receipt,
        status: 'rolled_back',
        rollbackAvailable: false,
        rollbackExpiresAt: null,
      },
    });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annulla modifiche' }));

    await waitFor(() => {
      expect(mocks.rollbackAIExecution).toHaveBeenCalledWith(
        'execution_123',
        'r'.repeat(43),
        'idem_1234567890123456',
        { planId: 'plan_123', hash: 'b'.repeat(64) },
      );
    });
    expect((await screen.findAllByText('Rollback completato')).length).toBeGreaterThan(0);
  });

  it('renders the authoritative rolled-back state when apply reconciliation observes a prior rollback', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: minimalPlan(),
    });
    mocks.applyAIPlan.mockResolvedValueOnce({
      ...validActionResult(),
      message: 'Rollback già completato',
      status: 'rolled_back',
      idempotentReplay: true,
      rollback: undefined,
      receipt: {
        ...validActionResult().receipt,
        status: 'rolled_back',
        rollbackAvailable: false,
        rollbackExpiresAt: null,
      },
    });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Riconcilia il piano' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));

    expect(await screen.findByText('Rollback già completato')).toBeInTheDocument();
    expect(screen.getByTestId('ai-plan-plan_123')).toHaveTextContent('rolled_back');
    expect(screen.getByText('Rollback completato')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annulla modifiche' })).not.toBeInTheDocument();
  });

  it('marks a stale preview unusable without reporting the backend offline', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: minimalPlan(),
    });
    mocks.applyAIPlan.mockRejectedValueOnce(new AIClientError('state_changed', 409));
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/stato è cambiato/i);
    expect(screen.getByRole('button', { name: 'Applica piano' })).toBeDisabled();
    expect(screen.queryByText('Backend AI non raggiungibile')).not.toBeInTheDocument();
  });

  it('groups schedule moves and exposes the exact approved before/after times', async () => {
    const plan = minimalPlan();
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: {
        ...plan,
        operations: [{ action: 'move', entityType: 'timeBlocks', entityId: 'block_1' }],
        diff: [{
          action: 'move',
          entityType: 'timeBlocks',
          entityId: 'block_1',
          summary: 'Sposta il blocco di lavoro.',
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
      },
    });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Sposta il blocco' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));

    expect(await screen.findByRole('region', { name: 'Modifiche Spostamenti' })).toBeInTheDocument();
    expect(screen.getByLabelText('Valore precedente startTime')).toHaveTextContent(
      '2098-12-31T09:00:00.000Z',
    );
    expect(screen.getByLabelText('Valore proposto endTime')).toHaveTextContent(
      '2098-12-31T12:00:00.000Z',
    );
  });

  it('renders every browser-safe create field, the reason, and long values without silent truncation', async () => {
    const plan = minimalPlan();
    const longDescription = `Complete detail ${'x'.repeat(700)}`;
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima completa',
      plan: {
        ...plan,
        tool: 'preview_goal_architecture',
        operations: [{ action: 'create', entityType: 'tasks', entityId: 'task-created' }],
        diff: [{
          action: 'create',
          entityType: 'tasks',
          entityId: 'task-created',
          summary: 'Crea un task validato.',
          title: 'Task completo',
          changedFields: ['description', 'domainId', 'estimatedMinutes', 'priority', 'projectId', 'title'],
          before: null,
          after: {
            title: 'Task completo',
            description: longDescription,
            priority: 'high',
            estimatedMinutes: 90,
            projectId: 'project-1',
            domainId: 'domain-1',
          },
        }],
        reason: 'Motivo esatto coperto dal changeset.',
      },
    });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Crea il task' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));

    expect(await screen.findByText(/Motivo esatto coperto dal changeset/)).toBeInTheDocument();
    expect(screen.getByLabelText('Valore proposto priority')).toHaveTextContent('high');
    expect(screen.getByLabelText('Valore proposto estimatedMinutes')).toHaveTextContent('90');
    expect(screen.getByLabelText('Valore proposto description')).toHaveTextContent(longDescription);
  });

  it('persists an uncertain action and reuses its idempotency key after remount', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: minimalPlan(),
    });
    mocks.applyAIPlan.mockRejectedValueOnce(new AIClientError('committed_unverified', 503));
    const first = render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica in sicurezza' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));

    expect(await screen.findByRole('button', { name: 'Riconcilia applicazione' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuova chat' })).toBeDisabled();
    expect(window.sessionStorage.length).toBe(1);
    first.unmount();

    mocks.applyAIPlan.mockResolvedValueOnce(validActionResult());
    render(<AIInputBarV2 />);
    expect(await screen.findByText('Sessione di modifica sicura ripristinata.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Riconcilia applicazione' }));

    await waitFor(() => {
      expect(mocks.applyAIPlan).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'plan_123' }),
        'idem_1234567890123456',
      );
    });
    expect(await screen.findByText('Piano applicato')).toBeInTheDocument();
  });

  it('isolates an account switch without destroying the previous user recovery key', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: minimalPlan(),
    });
    mocks.applyAIPlan.mockRejectedValueOnce(new AIClientError('committed_unverified', 503));
    const view = render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica per il primo account' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));
    expect(await screen.findByRole('button', { name: 'Riconcilia applicazione' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('life-tracker:secure-ai-actions:firebase-user')).not.toBeNull();

    mocks.authState.user = { uid: 'second-user' };
    view.rerender(<AIInputBarV2 />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Riconcilia applicazione' })).not.toBeInTheDocument();
    });
    expect(window.sessionStorage.getItem('life-tracker:secure-ai-actions:firebase-user')).not.toBeNull();
    expect(screen.queryByText('Sessione di modifica sicura ripristinata.')).not.toBeInTheDocument();

    mocks.authState.user = { uid: 'firebase-user' };
    view.rerender(<AIInputBarV2 />);
    expect(await screen.findByText('Sessione di modifica sicura ripristinata.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Riconcilia applicazione' })).toBeInTheDocument();
  });

  it('clears volatile drafts and ignores an in-flight chat result after an account switch', async () => {
    const firstResponse = deferred<{ message: string }>();
    mocks.requestAIChat
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce({ message: 'Risposta per B' });
    const view = render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Contenuto privato di A' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    await waitFor(() => expect(mocks.requestAIChat).toHaveBeenCalledTimes(1));

    mocks.authState.user = { uid: 'second-user' };
    view.rerender(<AIInputBarV2 />);
    expect(screen.queryByText('Contenuto privato di A')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Messaggio per l’assistente AI')).toHaveValue('');

    await act(async () => {
      firstResponse.resolve({ message: 'Risposta privata per A' });
      await firstResponse.promise;
    });
    expect(screen.queryByText('Risposta privata per A')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Domanda di B' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    await waitFor(() => {
      expect(mocks.requestAIChat).toHaveBeenLastCalledWith({
        message: 'Domanda di B',
        mode: 'ask',
        history: [],
      });
    });
    expect(await screen.findByText('Risposta per B')).toBeInTheDocument();
  });

  it('stops account-local speech and ignores a late recognition result after an account switch', async () => {
    const recognitions: Array<{
      abort: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      onresult?: (event: unknown) => void;
    }> = [];
    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      abort = vi.fn();
      start = vi.fn();
      stop = vi.fn();
      onresult?: (event: unknown) => void;

      constructor() {
        recognitions.push(this);
      }
    }
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeSpeechRecognition;
    mocks.requestAIChat.mockResolvedValueOnce({ message: 'Risposta parlata privata di A' });
    const view = render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Parla solo con A' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    expect(await screen.findByText('Risposta parlata privata di A')).toBeInTheDocument();
    expect(mocks.voiceService.speakAIResponse).toHaveBeenCalledWith('Risposta parlata privata di A');
    const accountARecognition = recognitions[0];
    expect(accountARecognition).toBeDefined();
    mocks.voiceService.stopSpeech.mockClear();

    mocks.authState.user = { uid: 'second-user' };
    view.rerender(<AIInputBarV2 />);
    await waitFor(() => expect(mocks.voiceService.stopSpeech).toHaveBeenCalledTimes(1));
    await act(async () => {
      accountARecognition?.onresult?.({
        results: Object.assign([[{ transcript: 'Trascrizione privata tardiva di A' }]], {
          length: 1,
        }),
      });
    });
    expect(screen.getByLabelText('Messaggio per l’assistente AI')).toHaveValue('');
    expect(screen.queryByDisplayValue('Trascrizione privata tardiva di A')).not.toBeInTheDocument();

    view.unmount();
    expect(mocks.voiceService.stopSpeech).toHaveBeenCalledTimes(2);
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it('preserves an in-flight action for same-key recovery by its original owner only', async () => {
    const firstApply = deferred<ReturnType<typeof validActionResult>>();
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima privata di A',
      plan: minimalPlan(),
    });
    mocks.applyAIPlan.mockReturnValueOnce(firstApply.promise);
    const view = render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica per A' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));
    await waitFor(() => expect(mocks.applyAIPlan).toHaveBeenCalledTimes(1));

    mocks.authState.user = { uid: 'second-user' };
    view.rerender(<AIInputBarV2 />);
    expect(screen.queryByText('Anteprima privata di A')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Applica piano' })).not.toBeInTheDocument();

    await act(async () => {
      firstApply.resolve(validActionResult());
      await firstApply.promise;
    });
    expect(screen.queryByText('Piano applicato')).not.toBeInTheDocument();

    mocks.authState.user = { uid: 'firebase-user' };
    view.rerender(<AIInputBarV2 />);
    expect(await screen.findByRole('button', { name: 'Riconcilia applicazione' })).toBeInTheDocument();

    mocks.applyAIPlan.mockResolvedValueOnce(validActionResult());
    fireEvent.click(screen.getByRole('button', { name: 'Riconcilia applicazione' }));
    await waitFor(() => {
      expect(mocks.applyAIPlan).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 'plan_123' }),
        'idem_1234567890123456',
      );
    });
    expect(await screen.findByText('Piano applicato')).toBeInTheDocument();
  });

  it('reconciles a malformed 2xx action response with the same idempotency key', async () => {
    const expiresAt = new Date(Date.now() + 750).toISOString();
    const originalKey = 'idem_original_1234567890123456';
    mocks.createIdempotencyKey
      .mockReturnValueOnce(originalKey)
      .mockReturnValueOnce('idem_must_not_be_generated');
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: {
        ...minimalPlan(),
        expiresAt,
        approval: { ...minimalPlan().approval, expiresAt },
      },
    });
    mocks.applyAIPlan.mockRejectedValueOnce(new AIClientError('invalid_response', 200));
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica e riconcilia' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));

    expect(await screen.findByRole('button', { name: 'Riconcilia applicazione' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rifiuta' })).not.toBeInTheDocument();
    expect(await screen.findByText(/Anteprima scaduta/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riconcilia applicazione' })).toBeEnabled();
    mocks.applyAIPlan.mockResolvedValueOnce(validActionResult());
    fireEvent.click(screen.getByRole('button', { name: 'Riconcilia applicazione' }));

    await waitFor(() => {
      expect(mocks.applyAIPlan).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ id: 'plan_123' }),
        originalKey,
      );
    });
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Piano applicato')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annulla modifiche' })).toBeInTheDocument();
  });

  it('keeps an uncertain rollback reconcilable after capability expiry', async () => {
    const expiresAt = new Date(Date.now() + 750).toISOString();
    const applyKey = 'idem_apply_1234567890123456';
    const rollbackKey = 'idem_rollback_1234567890123456';
    mocks.createIdempotencyKey
      .mockReturnValueOnce(applyKey)
      .mockReturnValueOnce(rollbackKey)
      .mockReturnValueOnce('idem_must_not_be_generated');
    mocks.requestAIChat.mockResolvedValueOnce({ message: 'Anteprima pronta', plan: minimalPlan() });
    mocks.applyAIPlan.mockResolvedValueOnce({
      ...validActionResult(),
      receipt: { ...validActionResult().receipt, rollbackExpiresAt: expiresAt },
      rollback: { ...validActionResult().rollback, expiresAt },
    });
    mocks.rollbackAIExecution.mockRejectedValueOnce(new AIClientError('invalid_response', 200));
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Applica e poi annulla' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annulla modifiche' }));
    expect(await screen.findByRole('button', { name: 'Riconcilia rollback' })).toBeInTheDocument();

    await waitFor(() => {
      expect(Date.now()).toBeGreaterThan(Date.parse(expiresAt));
      expect(screen.getByRole('button', { name: 'Riconcilia rollback' })).toBeEnabled();
    }, { timeout: 2_500 });
    mocks.rollbackAIExecution.mockResolvedValueOnce({
      ...validActionResult(),
      message: 'Rollback completato',
      status: 'rolled_back',
      rollback: undefined,
      receipt: {
        ...validActionResult().receipt,
        status: 'rolled_back',
        rollbackAvailable: false,
        rollbackExpiresAt: null,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Riconcilia rollback' }));

    await waitFor(() => {
      expect(mocks.rollbackAIExecution).toHaveBeenNthCalledWith(
        2,
        'execution_123',
        'r'.repeat(43),
        rollbackKey,
        { planId: 'plan_123', hash: 'b'.repeat(64) },
      );
    });
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
    expect((await screen.findAllByText('Rollback completato')).length).toBeGreaterThan(0);
  });

  it('expires a rollback capability on the clock and clears protected session state', async () => {
    const expiresAt = new Date(Date.now() + 750).toISOString();
    const execution = {
      ...validActionResult(),
      receipt: {
        ...validActionResult().receipt,
        rollbackExpiresAt: expiresAt,
      },
      rollback: {
        ...validActionResult().rollback,
        expiresAt,
      },
    };
    window.sessionStorage.setItem('life-tracker:secure-ai-actions:firebase-user', JSON.stringify({
      version: 1,
      entries: [{
        plan: { ...minimalPlan(), status: 'applied' },
        execution,
        recoveryPending: false,
      }],
      actionKeys: [],
    }));

    render(<AIInputBarV2 />);

    expect(await screen.findByRole('button', { name: 'Annulla modifiche' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuova chat' })).toBeDisabled();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Annulla modifiche' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Nuova chat' })).toBeEnabled();
      expect(window.sessionStorage.length).toBe(0);
    }, { timeout: 2_500 });
  });
});

function minimalPlan() {
  return {
    id: 'plan_123',
    tool: 'preview_changes',
    createdAt: '2098-12-31T23:45:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    baseStateHash: 'a'.repeat(64),
    hash: 'b'.repeat(64),
    operations: [{ action: 'update' as const, entityType: 'tasks', entityId: 'task_1' }],
    diff: [{
      action: 'update' as const,
      entityType: 'tasks',
      entityId: 'task_1',
      summary: 'Aggiorna il task.',
      title: 'Task',
      changedFields: ['title'],
      before: { title: 'Prima' },
      after: { title: 'Dopo' },
    }],
    reason: 'Pianificazione richiesta.',
    warnings: [],
    conflicts: [],
    assumptions: [],
    expectedImpact: [],
    destructiveOperationCount: 0,
    status: 'previewed' as const,
    approval: {
      required: true as const,
      capability: 'a'.repeat(43),
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

function validActionResult() {
  return {
    message: 'Piano applicato',
    executionId: 'execution_123',
    planId: 'plan_123',
    hash: 'b'.repeat(64),
    status: 'applied' as const,
    idempotentReplay: false,
    verified: true,
    receipt: {
      executionId: 'execution_123',
      planId: 'plan_123',
      changesetHash: 'b'.repeat(64),
      status: 'applied' as const,
      verified: true,
      timestamp: '2099-01-01T00:00:01.000Z',
      affected: [{ collection: 'tasks', id: 'task_1' }],
      rollbackAvailable: true,
      rollbackExpiresAt: '2099-01-08T00:00:01.000Z',
    },
    rollback: {
      capability: 'r'.repeat(43),
      expiresAt: '2099-01-08T00:00:01.000Z',
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
