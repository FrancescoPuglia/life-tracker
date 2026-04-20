// 🔗 NOTION API INTEGRATION
// Sincronizzazione completa con Notion per Second Brain

import { Page as LifeTrackerPage } from '@/types/blocks';

interface NotionConfig {
  token: string;
  databaseId?: string;
}

interface NotionBlock {
  object: 'block';
  id: string;
  type: string;
  created_time: string;
  last_edited_time: string;
  has_children: boolean;
  archived: boolean;
  [key: string]: any;
}

interface NotionPage {
  object: 'page';
  id: string;
  created_time: string;
  last_edited_time: string;
  cover: any;
  icon: any;
  parent: any;
  archived: boolean;
  properties: {
    [key: string]: {
      type: string;
      [key: string]: any;
    };
  };
}

class NotionAPI {
  private token: string;
  private baseURL = 'https://api.notion.com/v1';
  private headers: Record<string, string>;

  constructor(token: string) {
    this.token = token;
    this.headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    };
  }

  // ============================================================================
  // CORE API METHODS
  // ============================================================================

  private async request(endpoint: string, options?: RequestInit): Promise<any> {
    const url = `${this.baseURL}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.headers,
          ...options?.headers
        }
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Notion API Error: ${response.status} - ${error}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Notion API Request Failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // PAGES API
  // ============================================================================

  async createPage(databaseId: string, properties: any, children?: any[]): Promise<NotionPage> {
    const payload: any = {
      parent: { database_id: databaseId },
      properties
    };

    if (children && children.length > 0) {
      payload.children = children;
    }

    return this.request('/pages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async getPage(pageId: string): Promise<NotionPage> {
    return this.request(`/pages/${pageId}`);
  }

  async updatePage(pageId: string, properties: any): Promise<NotionPage> {
    return this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    });
  }

  async deletePage(pageId: string): Promise<void> {
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true })
    });
  }

  // ============================================================================
  // BLOCKS API
  // ============================================================================

  async getBlocks(pageId: string): Promise<NotionBlock[]> {
    const response = await this.request(`/blocks/${pageId}/children`);
    return response.results;
  }

  async appendBlocks(pageId: string, blocks: any[]): Promise<NotionBlock[]> {
    const response = await this.request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks })
    });
    return response.results;
  }

  async updateBlock(blockId: string, updates: any): Promise<NotionBlock> {
    return this.request(`/blocks/${blockId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.request(`/blocks/${blockId}`, {
      method: 'DELETE'
    });
  }

  // ============================================================================
  // DATABASE API
  // ============================================================================

  async queryDatabase(databaseId: string, filter?: any, sorts?: any[]): Promise<NotionPage[]> {
    const payload: any = {};
    
    if (filter) payload.filter = filter;
    if (sorts) payload.sorts = sorts;

    const response = await this.request(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return response.results;
  }

  async createDatabase(pageId: string, title: string, properties: any): Promise<any> {
    return this.request('/databases', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: pageId },
        title: [{ type: 'text', text: { content: title } }],
        properties
      })
    });
  }

  // ============================================================================
  // SEARCH API
  // ============================================================================

  async search(query: string, filter?: any): Promise<any[]> {
    const payload: any = { query };
    if (filter) payload.filter = filter;

    const response = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return response.results;
  }

  // ============================================================================
  // CONVERSION UTILITIES
  // ============================================================================

  // Convert Life Tracker blocks to Notion blocks
  convertToNotionBlocks(blocks: any[]): any[] {
    return blocks.map(block => this.convertBlockToNotion(block));
  }

  private convertBlockToNotion(block: any): any {
    switch (block.type) {
      case 'paragraph':
        return {
          type: 'paragraph',
          paragraph: {
            rich_text: this.convertRichText(block.content)
          }
        };

      case 'heading1':
        return {
          type: 'heading_1',
          heading_1: {
            rich_text: this.convertRichText(block.content)
          }
        };

      case 'heading2':
        return {
          type: 'heading_2',
          heading_2: {
            rich_text: this.convertRichText(block.content)
          }
        };

      case 'heading3':
        return {
          type: 'heading_3',
          heading_3: {
            rich_text: this.convertRichText(block.content)
          }
        };

      case 'bulletList':
        return {
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: this.convertRichText(block.items?.[0]?.content || [])
          }
        };

      case 'numberedList':
        return {
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: this.convertRichText(block.items?.[0]?.content || [])
          }
        };

      case 'todoList':
        return {
          type: 'to_do',
          to_do: {
            rich_text: this.convertRichText(block.items?.[0]?.content || []),
            checked: block.items?.[0]?.checked || false
          }
        };

      case 'quote':
        return {
          type: 'quote',
          quote: {
            rich_text: this.convertRichText(block.content)
          }
        };

      case 'code':
        return {
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: block.code || '' } }],
            language: block.language || 'plain text'
          }
        };

      case 'callout':
        return {
          type: 'callout',
          callout: {
            rich_text: this.convertRichText(block.content),
            icon: block.icon ? { type: 'emoji', emoji: block.icon } : undefined
          }
        };

      case 'divider':
        return {
          type: 'divider',
          divider: {}
        };

      default:
        // Fallback to paragraph
        return {
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: `[${block.type}] Unsupported block` } }]
          }
        };
    }
  }

  private convertRichText(content: any[]): any[] {
    if (!Array.isArray(content)) return [];

    return content.map(item => ({
      type: 'text',
      text: {
        content: item.text || '',
        link: item.link ? { url: item.link } : undefined
      },
      annotations: {
        bold: item.annotations?.bold || false,
        italic: item.annotations?.italic || false,
        strikethrough: item.annotations?.strikethrough || false,
        underline: item.annotations?.underline || false,
        code: item.annotations?.code || false,
        color: this.convertColor(item.annotations?.color) || 'default'
      }
    }));
  }

  private convertColor(color?: string): string {
    if (!color) return 'default';
    
    // Map hex colors to Notion colors
    const colorMap: Record<string, string> = {
      '#ff0000': 'red',
      '#00ff00': 'green',
      '#0000ff': 'blue',
      '#ffff00': 'yellow',
      '#ff8c00': 'orange',
      '#800080': 'purple',
      '#ffc0cb': 'pink',
      '#a52a2a': 'brown',
      '#808080': 'gray'
    };

    return colorMap[color.toLowerCase()] || 'default';
  }

  // Convert Notion blocks back to Life Tracker format
  convertFromNotionBlocks(notionBlocks: NotionBlock[]): any[] {
    return notionBlocks.map(block => this.convertBlockFromNotion(block));
  }

  private convertBlockFromNotion(block: NotionBlock): any {
    const baseBlock = {
      id: block.id,
      createdAt: new Date(block.created_time),
      updatedAt: new Date(block.last_edited_time)
    };

    switch (block.type) {
      case 'paragraph':
        return {
          ...baseBlock,
          type: 'paragraph',
          content: this.convertFromNotionRichText(block.paragraph?.rich_text)
        };

      case 'heading_1':
        return {
          ...baseBlock,
          type: 'heading1',
          content: this.convertFromNotionRichText(block.heading_1?.rich_text)
        };

      case 'heading_2':
        return {
          ...baseBlock,
          type: 'heading2',
          content: this.convertFromNotionRichText(block.heading_2?.rich_text)
        };

      case 'heading_3':
        return {
          ...baseBlock,
          type: 'heading3',
          content: this.convertFromNotionRichText(block.heading_3?.rich_text)
        };

      case 'bulleted_list_item':
        return {
          ...baseBlock,
          type: 'bulletList',
          items: [{
            id: `${block.id}-item`,
            content: this.convertFromNotionRichText(block.bulleted_list_item?.rich_text)
          }]
        };

      case 'numbered_list_item':
        return {
          ...baseBlock,
          type: 'numberedList',
          items: [{
            id: `${block.id}-item`,
            content: this.convertFromNotionRichText(block.numbered_list_item?.rich_text)
          }]
        };

      case 'to_do':
        return {
          ...baseBlock,
          type: 'todoList',
          items: [{
            id: `${block.id}-item`,
            content: this.convertFromNotionRichText(block.to_do?.rich_text),
            checked: block.to_do?.checked || false
          }]
        };

      case 'quote':
        return {
          ...baseBlock,
          type: 'quote',
          content: this.convertFromNotionRichText(block.quote?.rich_text)
        };

      case 'code':
        return {
          ...baseBlock,
          type: 'code',
          code: block.code?.rich_text?.[0]?.plain_text || '',
          language: block.code?.language || 'plaintext'
        };

      case 'callout':
        return {
          ...baseBlock,
          type: 'callout',
          content: this.convertFromNotionRichText(block.callout?.rich_text),
          icon: block.callout?.icon?.emoji || '💡',
          calloutType: 'info'
        };

      case 'divider':
        return {
          ...baseBlock,
          type: 'divider'
        };

      default:
        return {
          ...baseBlock,
          type: 'paragraph',
          content: [{ text: `[${block.type}] Unsupported block from Notion`, annotations: {} }]
        };
    }
  }

  private convertFromNotionRichText(richText?: any[]): any[] {
    if (!Array.isArray(richText)) return [];

    return richText.map(item => ({
      text: item.plain_text || item.text?.content || '',
      annotations: {
        bold: item.annotations?.bold,
        italic: item.annotations?.italic,
        underline: item.annotations?.underline,
        strikethrough: item.annotations?.strikethrough,
        code: item.annotations?.code,
        color: this.convertNotionColorToHex(item.annotations?.color)
      },
      link: item.text?.link?.url
    }));
  }

  private convertNotionColorToHex(color?: string): string | undefined {
    if (!color || color === 'default') return undefined;

    const colorMap: Record<string, string> = {
      'red': '#ff0000',
      'green': '#00ff00',
      'blue': '#0000ff',
      'yellow': '#ffff00',
      'orange': '#ff8c00',
      'purple': '#800080',
      'pink': '#ffc0cb',
      'brown': '#a52a2a',
      'gray': '#808080'
    };

    return colorMap[color];
  }
}

// ============================================================================
// NOTION SYNC SERVICE
// ============================================================================

class NotionSyncService {
  private notionApi: NotionAPI;
  private databaseId?: string;

  constructor(token: string, databaseId?: string) {
    this.notionApi = new NotionAPI(token);
    this.databaseId = databaseId;
  }

  // Sync a Life Tracker page to Notion
  async syncPageToNotion(page: LifeTrackerPage): Promise<string> {
    if (!this.databaseId) {
      throw new Error('Database ID not configured for Notion sync');
    }

    const properties = {
      'Name': {
        title: [
          {
            type: 'text',
            text: { content: page.title }
          }
        ]
      },
      'Created': {
        date: { start: page.createdAt.toISOString() }
      },
      'Last Modified': {
        date: { start: page.updatedAt.toISOString() }
      }
    };

    const notionBlocks = this.notionApi.convertToNotionBlocks(page.blocks);
    
    const createdPage = await this.notionApi.createPage(
      this.databaseId,
      properties,
      notionBlocks
    );

    return createdPage.id;
  }

  // Sync from Notion back to Life Tracker
  async syncPageFromNotion(notionPageId: string): Promise<LifeTrackerPage> {
    const notionPage = await this.notionApi.getPage(notionPageId);
    const notionBlocks = await this.notionApi.getBlocks(notionPageId);
    
    const blocks = this.notionApi.convertFromNotionBlocks(notionBlocks);

    return {
      id: notionPage.id,
      title: this.extractTitleFromProperties(notionPage.properties),
      icon: notionPage.icon?.emoji || '📝',
      blocks,
      createdAt: new Date(notionPage.created_time),
      updatedAt: new Date(notionPage.last_edited_time),
      userId: '', // Will be set by the caller
      tags: [],
      isTemplate: false
    };
  }

  private extractTitleFromProperties(properties: any): string {
    // Try to find title property
    const titleProp = Object.values(properties).find((prop: any) => 
      prop.type === 'title' && prop.title?.[0]?.plain_text
    );

    if (titleProp) {
      return (titleProp as any).title[0].plain_text;
    }

    return 'Untitled';
  }

  // Bi-directional sync
  async syncAllPages(): Promise<{ imported: number; exported: number }> {
    let imported = 0;
    let exported = 0;

    // This would be implemented based on your specific sync strategy
    // For now, just return counts
    
    return { imported, exported };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { NotionAPI, NotionSyncService };
export type { NotionConfig, NotionBlock, NotionPage };