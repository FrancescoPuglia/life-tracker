import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/ai/openai-integration';

export async function POST(request: NextRequest) {
  try {
    const { message, context, history, userId } = await request.json();

    if (!message || !context || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: message, context, userId' },
        { status: 400 }
      );
    }

    // Chiamata all'AI
    const result = await chat(message, context, history || []);

    return NextResponse.json({
      response: result.response,
      proposedChanges: result.proposedChanges || [],
      toolCalls: result.toolCalls || []
    });

  } catch (error) {
    console.error('🧠 AI API Error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Errore sconosciuto';
    
    // Errori comuni con soluzioni
    if (errorMessage.includes('API key')) {
      return NextResponse.json(
        { error: 'API key OpenAI mancante o invalida. Verifica OPENAI_API_KEY in .env.local' },
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