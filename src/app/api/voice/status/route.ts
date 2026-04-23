import { NextResponse } from 'next/server';

// force-static: required for GitHub Pages static export to not crash on this route.
// On Vercel, POST handler overrides this → route runs dynamically at runtime.
export const dynamic = 'force-static';

export type ProviderStatus = 'available' | 'missing_key' | 'error';

export interface VoiceProviderStatus {
  openai: { status: ProviderStatus; error?: string };
  elevenlabs: { status: ProviderStatus; error?: string };
  browser: { status: 'available' };
}

// ============================================================================
// GET — Static info (prerendered at build time)
// ============================================================================

export async function GET() {
  return NextResponse.json({
    service: 'voice-status',
    description: 'POST to check TTS provider availability',
  });
}

// ============================================================================
// POST — Live provider status check (runs dynamically at runtime)
// ============================================================================

export async function POST() {
  const result: VoiceProviderStatus = {
    openai: { status: 'missing_key' },
    elevenlabs: { status: 'missing_key' },
    browser: { status: 'available' },
  };

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
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
