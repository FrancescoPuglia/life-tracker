import { NextRequest, NextResponse } from 'next/server';

// force-static: required for GitHub Pages static export to not crash on this route.
// On Vercel, POST handler overrides this → route runs dynamically at runtime.
export const dynamic = 'force-static';

// ============================================================================
// OPENAI TTS
// ============================================================================

async function speakOpenAI(
  text: string,
  voice: string,
  model: string
): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'tts-1',
      input: text,
      voice: voice || 'alloy',
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`OpenAI TTS error ${res.status}: ${err}`);
  }

  return res.arrayBuffer();
}

// ============================================================================
// ELEVENLABS TTS
// ============================================================================

async function speakElevenLabs(
  text: string,
  voiceId: string,
  modelId: string
): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId || 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`ElevenLabs TTS error ${res.status}: ${err}`);
  }

  return res.arrayBuffer();
}

// ============================================================================
// RATE LIMITER
// ============================================================================

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, limit = 30, windowMs = 60000): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);
  if (!record || now > record.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
}

// ============================================================================
// GET — required for force-static export
// ============================================================================

export async function GET() {
  return NextResponse.json({
    service: 'voice-speak',
    description: 'POST text to generate TTS audio via OpenAI or ElevenLabs',
  });
}

// ============================================================================
// POST — TTS generation
// ============================================================================

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || '127.0.0.1';

  if (!rateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Riprova tra un minuto.' },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { text, provider, voice, model } = body as {
      text?: string;
      provider?: string;
      voice?: string;
      model?: string;
    };

    if (!text || !provider) {
      return NextResponse.json(
        { error: 'Required fields: text, provider' },
        { status: 400 }
      );
    }

    // Limit text length to prevent abuse
    if (text.length > 1000) {
      return NextResponse.json(
        { error: 'Text too long (max 1000 chars)' },
        { status: 400 }
      );
    }

    let audioBuffer: ArrayBuffer;

    if (provider === 'openai') {
      audioBuffer = await speakOpenAI(text, voice || 'alloy', model || 'tts-1');
    } else if (provider === 'elevenlabs') {
      audioBuffer = await speakElevenLabs(text, voice || 'EXAVITQu4vr4xnSDxMaL', model || 'eleven_multilingual_v2');
    } else {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}. Use "openai" or "elevenlabs".` },
        { status: 400 }
      );
    }

    // Return raw audio
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Voice TTS Error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';

    if (msg.includes('API_KEY not configured') || msg.includes('api_key')) {
      return NextResponse.json(
        { error: msg, code: 'MISSING_KEY' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: `TTS generation failed: ${msg}`, code: 'TTS_ERROR' },
      { status: 500 }
    );
  }
}
