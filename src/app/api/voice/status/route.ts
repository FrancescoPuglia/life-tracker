import { NextResponse } from 'next/server';

// Required for static export (GitHub Pages). These routes only work in local dev.
export const dynamic = 'force-static';

export type ProviderStatus = 'available' | 'missing_key' | 'error';

export interface VoiceProviderStatus {
  openai: { status: ProviderStatus; error?: string };
  elevenlabs: { status: ProviderStatus; error?: string };
  browser: { status: 'available' };
}

// ============================================================================
// GET — Check provider availability
// ============================================================================

export async function GET() {
  const result: VoiceProviderStatus = {
    openai: { status: 'missing_key' },
    elevenlabs: { status: 'missing_key' },
    browser: { status: 'available' },
  };

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      // Light validation: check key format (starts with sk-)
      const key = process.env.OPENAI_API_KEY;
      if (key.startsWith('sk-') && key.length > 20) {
        result.openai = { status: 'available' };
      } else {
        result.openai = { status: 'error', error: 'Invalid API key format' };
      }
    } catch {
      result.openai = { status: 'error', error: 'Key validation failed' };
    }
  }

  // Check ElevenLabs
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      const key = process.env.ELEVENLABS_API_KEY;
      if (key.length > 10) {
        result.elevenlabs = { status: 'available' };
      } else {
        result.elevenlabs = { status: 'error', error: 'Invalid API key format' };
      }
    } catch {
      result.elevenlabs = { status: 'error', error: 'Key validation failed' };
    }
  }

  return NextResponse.json(result);
}
