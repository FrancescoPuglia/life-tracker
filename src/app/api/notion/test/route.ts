// src/app/api/notion/test/route.ts
// API route per testare la connessione a Notion

import { NextRequest, NextResponse } from 'next/server';

// Required for static export (GitHub Pages). These routes only work in local dev.
export const dynamic = 'force-static';

export async function GET() {
  return NextResponse.json({ status: 'available', route: 'notion-test' });
}

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token mancante' },
        { status: 400 }
      );
    }

    // Test Notion API with a simple search
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        query: '',
        page_size: 1
      })
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        message: 'Connessione a Notion riuscita',
        results: data.results?.length || 0
      });
    } else {
      const error = await response.text();
      return NextResponse.json(
        { success: false, error: `Notion API Error: ${response.status} - ${error}` },
        { status: response.status }
      );
    }

  } catch (error) {
    console.error('Notion test error:', error);
    return NextResponse.json(
      { success: false, error: 'Errore interno del server' },
      { status: 500 }
    );
  }
}