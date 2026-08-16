import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AIInputBarV2 from './AIInputBarV2';

const mocks = vi.hoisted(() => ({
  authState: {
    user: { uid: 'firebase-user' } as { uid: string } | null,
    status: 'signedIn' as 'unknown' | 'signedIn' | 'signedOut',
  },
  configured: true,
  requestAIChat: vi.fn(),
  applyAIPlan: vi.fn(),
  rollbackAIPlan: vi.fn(),
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
    rollbackAIPlan: mocks.rollbackAIPlan,
    createIdempotencyKey: () => 'idem_1234567890123456',
  };
});

vi.mock('@/lib/voice/voiceService', () => ({
  getVoiceService: () => null,
}));

describe('AIInputBarV2 secure client flow', () => {
  beforeEach(() => {
    mocks.authState.user = { uid: 'firebase-user' };
    mocks.authState.status = 'signedIn';
    mocks.configured = true;
    mocks.requestAIChat.mockReset();
    mocks.applyAIPlan.mockReset();
    mocks.rollbackAIPlan.mockReset();
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

  it('applies an immutable preview through the backend without local data callbacks', async () => {
    mocks.requestAIChat.mockResolvedValueOnce({
      message: 'Anteprima pronta',
      plan: {
        id: 'plan_123',
        hash: '0123456789abcdef',
        expiresAt: '2099-01-01T00:00:00.000Z',
        operationCount: 2,
        diff: [
          {
            action: 'create',
            entityType: 'timeBlock',
            entityId: 'block_1',
            summary: 'Crea blocco di lavoro profondo',
            changedFields: ['title', 'startTime', 'endTime'],
          },
          {
            action: 'update',
            entityType: 'task',
            entityId: 'task_1',
            summary: 'Collega il task al nuovo blocco',
            changedFields: ['timeBlockId'],
          },
        ],
        warnings: [],
        conflicts: [],
        status: 'preview',
      },
    });
    mocks.applyAIPlan.mockResolvedValueOnce({ message: 'Piano applicato' });
    render(<AIInputBarV2 />);

    fireEvent.change(screen.getByLabelText('Messaggio per l’assistente AI'), {
      target: { value: 'Pianifica' },
    });
    fireEvent.click(screen.getByLabelText('Invia messaggio AI'));
    expect(await screen.findByText('Crea blocco di lavoro profondo')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Applica piano' }));

    await waitFor(() => {
      expect(mocks.applyAIPlan).toHaveBeenCalledWith(
        'plan_123',
        'idem_1234567890123456',
      );
    });
    expect(await screen.findByText('Piano applicato')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rollback' })).toBeInTheDocument();
  });
});
