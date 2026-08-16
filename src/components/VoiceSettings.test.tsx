import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceSettings from './VoiceSettings';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/voice/voiceConfig';

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  previewVoice: vi.fn(),
  previewRole: vi.fn(),
  stopSpeech: vi.fn(),
}));

vi.mock('@/lib/voice', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/voice')>();
  return {
    ...original,
    useVoice: () => ({
      settings: original.DEFAULT_VOICE_SETTINGS,
      updateSettings: mocks.updateSettings,
      voices: [],
      isAvailable: true,
      previewVoice: mocks.previewVoice,
      previewRole: mocks.previewRole,
      stopSpeech: mocks.stopSpeech,
    }),
  };
});

describe('VoiceSettings browser-only security boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers only local browser speech and explains the cloud boundary', () => {
    render(<VoiceSettings />);

    expect(screen.getByText('Browser (integrato)')).toBeInTheDocument();
    expect(screen.getByText(/provider vocali cloud legacy sono disabilitati/i)).toBeInTheDocument();
    expect(screen.queryByText(/qualita premium/i)).toBeNull();
  });

  it('keeps ordinary local voice settings functional', () => {
    render(<VoiceSettings />);

    fireEvent.click(screen.getByRole('button', { name: /English/i }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      language: 'en-US',
      browserVoices: {},
    });

    fireEvent.click(screen.getByRole('button', { name: 'ON' }));
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enabled: !DEFAULT_VOICE_SETTINGS.enabled,
    });
  });
});
