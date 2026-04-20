import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/ai/openai-integration';
import { isAIAvailable, getAIConfig } from '@/lib/ai/provider';

// Required for static export (GitHub Pages). These routes only work in local dev.
export const dynamic = 'force-static';

// Simple in-memory rate limiter
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string, limit = 10, windowMs = 60000): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

export async function GET() {
  // Health check endpoint - returns AI provider status
  try {
    const available = isAIAvailable();
    if (!available) {
      return NextResponse.json({ status: 'unavailable', provider: null });
    }
    const config = getAIConfig();
    return NextResponse.json({
      status: 'available',
      provider: config.provider,
      model: config.chatModel,
      supportsTools: config.supportsTools,
    });
  } catch {
    return NextResponse.json({ status: 'unavailable', provider: null });
  }
}

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || '127.0.0.1';

  if (!rateLimit(ip, 10, 60000)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Riprova tra un minuto.' },
      { status: 429 }
    );
  }

  try {
    const { message, context, history, userId } = await request.json();

    if (!message || !context || !userId) {
      return NextResponse.json(
        { error: 'Campi obbligatori mancanti: message, context, userId' },
        { status: 400 }
      );
    }

    const result = await chat(message, context, history || []);

    return NextResponse.json({
      response: result.response,
      proposedChanges: result.proposedChanges || [],
      toolCalls: result.toolCalls || []
    });

  } catch (error) {
    console.error('AI API Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';

    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Ollama non raggiungibile')) {
      return NextResponse.json(
        { error: 'Ollama non raggiungibile. Avvia Ollama con: ollama serve' },
        { status: 503 }
      );
    }

    if (errorMessage.includes('API key')) {
      return NextResponse.json(
        { error: 'API key mancante o invalida. Verifica la configurazione in .env.local' },
        { status: 401 }
      );
    }

    if (errorMessage.includes('rate limit')) {
      return NextResponse.json(
        { error: 'Limite di richieste raggiunto. Aspetta un momento e riprova.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: `Errore AI: ${errorMessage}` },
      { status: 500 }
    );
  }
}
