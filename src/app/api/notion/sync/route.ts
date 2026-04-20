// src/app/api/notion/sync/route.ts
// Proxy API per Notion - VERSIONE CORRETTA

import { NextRequest, NextResponse } from 'next/server';

// Required for static export (GitHub Pages). These routes only work in local dev.
export const dynamic = 'force-static';

// IMPORTANTE: Token deve essere in environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;

export async function GET() {
  return NextResponse.json({ status: 'available', route: 'notion-sync' });
}

export async function POST(request: NextRequest) {
  try {
    // Verifica che il token sia configurato
    if (!NOTION_TOKEN) {
      return NextResponse.json(
        { success: false, error: 'Notion token non configurato sul server' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'test':
        return await testNotionConnection();
      
      case 'create_page':
        return await createPage(data);
      
      case 'get_pages':
        return await getPages();
      
      default:
        return NextResponse.json(
          { success: false, error: 'Azione non supportata' },
          { status: 400 }
        );
    }

  } catch (error) {
    console.error('Notion API error:', error);
    return NextResponse.json(
      { success: false, error: 'Errore interno del server' },
      { status: 500 }
    );
  }
}

async function testNotionConnection() {
  try {
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
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
        pages_found: data.results?.length || 0
      });
    } else {
      const error = await response.text();
      throw new Error(`Notion API Error: ${response.status} - ${error}`);
    }

  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Test connessione fallito: ${error}` },
      { status: 400 }
    );
  }
}

async function createPage(pageData: any) {
  try {
    // Crea una nuova pagina su Notion
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: pageData.parent_page_id },
        properties: {
          title: {
            title: [
              {
                type: 'text',
                text: { content: pageData.title || 'Untitled' }
              }
            ]
          }
        },
        children: pageData.blocks || []
      })
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        page_id: data.id,
        url: data.url
      });
    } else {
      const error = await response.text();
      throw new Error(`Failed to create page: ${error}`);
    }

  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Creazione pagina fallita: ${error}` },
      { status: 400 }
    );
  }
}

async function getPages() {
  try {
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        page_size: 100
      })
    });

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        success: true,
        pages: data.results
      });
    } else {
      const error = await response.text();
      throw new Error(`Failed to get pages: ${error}`);
    }

  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Recupero pagine fallito: ${error}` },
      { status: 400 }
    );
  }
}