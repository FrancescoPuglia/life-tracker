// src/types/blocks.ts
// 🎨 BLOCK EDITOR TYPES - Sistema Notion-like
// MODALITÀ PSICOPATICO CERTOSINO 🔥
// VERSIONE 2.0 - POST SHERLOCK AUDIT

// ============================================================================
// ID GENERATOR (Anti-collision)
// ============================================================================

let idCounter = 0;

export function generateId(prefix: string = 'id'): string {
  const timestamp = Date.now();
  const counter = ++idCounter;
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${timestamp}-${counter}-${random}`;
}

// ============================================================================
// BLOCK TYPES
// ============================================================================

export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'numberedList'
  | 'todoList'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'image'
  | 'video'
  | 'embed'
  | 'table'
  | 'columns'
  | 'linkToPage'
  | 'linkToGoal'
  | 'linkToTask'
  | 'bookmark';

export type CalloutType = 'info' | 'warning' | 'success' | 'error' | 'note' | 'tip';

export type CodeLanguage = 
  | 'javascript' | 'typescript' | 'python' | 'java' | 'csharp' 
  | 'go' | 'rust' | 'sql' | 'html' | 'css' | 'json' | 'markdown'
  | 'bash' | 'plaintext';

// ============================================================================
// BASE BLOCK
// ============================================================================

export interface BaseBlock {
  id: string;
  type: BlockType;
  createdAt: Date;
  updatedAt: Date;
  children?: Block[]; // Per blocchi nested (toggle, columns)
}

// ============================================================================
// TEXT BLOCKS
// ============================================================================

export interface RichText {
  text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    color?: string;
    backgroundColor?: string;
  };
  link?: string;
}

export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph';
  content: RichText[];
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading1' | 'heading2' | 'heading3';
  content: RichText[];
  toggleable?: boolean; // Heading che può collassare
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  content: RichText[];
}

export interface CalloutBlock extends BaseBlock {
  type: 'callout';
  content: RichText[];
  calloutType: CalloutType;
  icon?: string; // Emoji o URL icona
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
}

// ============================================================================
// LIST BLOCKS
// ============================================================================

export interface ListItem {
  id: string;
  content: RichText[];
  checked?: boolean; // Per todoList
  children?: ListItem[];
}

export interface BulletListBlock extends BaseBlock {
  type: 'bulletList';
  items: ListItem[];
}

export interface NumberedListBlock extends BaseBlock {
  type: 'numberedList';
  items: ListItem[];
}

export interface TodoListBlock extends BaseBlock {
  type: 'todoList';
  items: ListItem[];
}

export interface ToggleBlock extends BaseBlock {
  type: 'toggle';
  summary: RichText[];
  children: Block[];
  isOpen?: boolean;
}

// ============================================================================
// CODE BLOCK
// ============================================================================

export interface CodeBlock extends BaseBlock {
  type: 'code';
  code: string;
  language: CodeLanguage;
  caption?: string;
  showLineNumbers?: boolean;
}

// ============================================================================
// MEDIA BLOCKS
// ============================================================================

export interface ImageBlock extends BaseBlock {
  type: 'image';
  url: string;
  caption?: RichText[];
  alt?: string;
  width?: number; // Percentuale o pixel
  alignment?: 'left' | 'center' | 'right';
}

export interface VideoBlock extends BaseBlock {
  type: 'video';
  url: string; // YouTube, Vimeo, o URL diretto
  caption?: RichText[];
  provider?: 'youtube' | 'vimeo' | 'direct';
}

export interface EmbedBlock extends BaseBlock {
  type: 'embed';
  url: string;
  caption?: RichText[];
  provider?: string;
}

export interface BookmarkBlock extends BaseBlock {
  type: 'bookmark';
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

// ============================================================================
// LAYOUT BLOCKS
// ============================================================================

export interface TableCell {
  content: RichText[];
  header?: boolean;
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  rows: TableCell[][];
  hasHeader?: boolean;
}

export interface ColumnBlock {
  id: string;
  width: number; // Percentuale
  children: Block[];
}

export interface ColumnsBlock extends BaseBlock {
  type: 'columns';
  columns: ColumnBlock[];
}

// ============================================================================
// LINK BLOCKS (Integrazione con Life Tracker)
// ============================================================================

export interface LinkToPageBlock extends BaseBlock {
  type: 'linkToPage';
  pageId: string;
  pageTitle?: string;
  pageIcon?: string;
}

export interface LinkToGoalBlock extends BaseBlock {
  type: 'linkToGoal';
  goalId: string;
  goalTitle?: string;
  showProgress?: boolean;
}

export interface LinkToTaskBlock extends BaseBlock {
  type: 'linkToTask';
  taskId: string;
  taskTitle?: string;
  showStatus?: boolean;
}

// ============================================================================
// UNION TYPE
// ============================================================================

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | QuoteBlock
  | CalloutBlock
  | DividerBlock
  | BulletListBlock
  | NumberedListBlock
  | TodoListBlock
  | ToggleBlock
  | CodeBlock
  | ImageBlock
  | VideoBlock
  | EmbedBlock
  | BookmarkBlock
  | TableBlock
  | ColumnsBlock
  | LinkToPageBlock
  | LinkToGoalBlock
  | LinkToTaskBlock;

// ============================================================================
// PAGE / DOCUMENT
// ============================================================================

export interface PageCover {
  type: 'color' | 'gradient' | 'image';
  value: string; // Colore hex, gradient CSS, o URL immagine
}

export interface Page {
  id: string;
  userId: string;
  title: string;
  icon?: string; // Emoji o URL
  cover?: PageCover;
  blocks: Block[];
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  parentId?: string; // Per pagine nested
  isTemplate?: boolean;
  templateCategory?: string;
  
  // Permissions
  isPublic?: boolean;
  
  // Collegamenti
  linkedGoalIds?: string[];
  linkedProjectIds?: string[];
  linkedTaskIds?: string[];
  
  // Tags
  tags?: string[];
}

// ============================================================================
// TEMPLATE
// ============================================================================

export interface Template {
  id: string;
  name: string;
  description: string;
  icon?: string;
  cover?: PageCover;
  category: TemplateCategory;
  blocks: Block[];
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string; // userId o 'system'
  isBuiltIn?: boolean;
  
  // Usage tracking
  useCount?: number;
}

export type TemplateCategory =
  | 'planning'
  | 'goals'
  | 'journal'
  | 'meeting'
  | 'project'
  | 'notes'
  | 'review'
  | 'habit'
  | 'custom';

// ============================================================================
// EDITOR STATE
// ============================================================================

export interface EditorState {
  page: Page;
  selectedBlockId: string | null;
  focusedBlockId: string | null;
  isDragging: boolean;
  draggedBlockId: string | null;
  history: {
    past: Page[];
    future: Page[];
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function createBlock(type: BlockType, partial?: Partial<Block>): Block {
  const base: BaseBlock = {
    id: generateId('block'),
    type,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };

  switch (type) {
    case 'paragraph':
      return { ...base, type: 'paragraph', content: [] } as ParagraphBlock;
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return { ...base, type, content: [] } as HeadingBlock;
    case 'bulletList':
      return { ...base, type: 'bulletList', items: [] } as BulletListBlock;
    case 'numberedList':
      return { ...base, type: 'numberedList', items: [] } as NumberedListBlock;
    case 'todoList':
      return { ...base, type: 'todoList', items: [] } as TodoListBlock;
    case 'toggle':
      return { ...base, type: 'toggle', summary: [], children: [], isOpen: true } as ToggleBlock;
    case 'quote':
      return { ...base, type: 'quote', content: [] } as QuoteBlock;
    case 'callout':
      return { ...base, type: 'callout', content: [], calloutType: 'info', icon: '💡' } as CalloutBlock;
    case 'divider':
      return { ...base, type: 'divider' } as DividerBlock;
    case 'code':
      return { ...base, type: 'code', code: '', language: 'javascript' } as CodeBlock;
    case 'image':
      return { ...base, type: 'image', url: '', alignment: 'center' } as ImageBlock;
    case 'video':
      return { ...base, type: 'video', url: '' } as VideoBlock;
    case 'embed':
      return { ...base, type: 'embed', url: '' } as EmbedBlock;
    case 'bookmark':
      return { ...base, type: 'bookmark', url: '' } as BookmarkBlock;
    case 'table':
      return { ...base, type: 'table', rows: [[{ content: [] }]], hasHeader: true } as TableBlock;
    case 'columns':
      return { 
        ...base, 
        type: 'columns', 
        columns: [
          { id: generateId('col'), width: 50, children: [] },
          { id: generateId('col'), width: 50, children: [] }
        ] 
      } as ColumnsBlock;
    case 'linkToPage':
      return { ...base, type: 'linkToPage', pageId: '' } as LinkToPageBlock;
    case 'linkToGoal':
      return { ...base, type: 'linkToGoal', goalId: '' } as LinkToGoalBlock;
    case 'linkToTask':
      return { ...base, type: 'linkToTask', taskId: '' } as LinkToTaskBlock;
    default:
      return { ...base, type: 'paragraph', content: [] } as ParagraphBlock;
  }
}

export function createPage(userId: string, partial?: Partial<Page>): Page {
  return {
    id: generateId('page'),
    userId,
    title: 'Untitled',
    blocks: [createBlock('paragraph')],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

export function createRichText(text: string, annotations?: RichText['annotations']): RichText {
  return { text, annotations };
}

// ============================================================================
// DEEP CLONE UTILITIES (preserva Date objects, genera nuovi ID)
// ============================================================================

export function deepCloneBlock(block: Block): Block {
  const cloned = JSON.parse(JSON.stringify(block));
  
  // GENERA NUOVO ID PER IL BLOCCO STESSO
  cloned.id = generateId('block');
  
  // Restore Date objects
  cloned.createdAt = new Date(cloned.createdAt);
  cloned.updatedAt = new Date();
  
  // Handle nested items (lists) - rigenera ID per ogni item
  if ('items' in cloned && Array.isArray(cloned.items)) {
    cloned.items = cloneListItems(cloned.items);
  }
  
  // Handle nested children (toggle)
  if ('children' in cloned && Array.isArray(cloned.children) && cloned.type !== 'columns') {
    cloned.children = cloned.children.map((child: any) => deepCloneBlock(child));
  }
  
  // Handle columns
  if ('columns' in cloned && Array.isArray(cloned.columns)) {
    cloned.columns = cloned.columns.map((col: any) => ({
      ...col,
      id: generateId('col'),
      children: col.children?.map((child: any) => deepCloneBlock(child)) || [],
    }));
  }
  
  return cloned;
}

// Helper per clonare ListItem ricorsivamente
function cloneListItems(items: any[]): any[] {
  return items.map(item => ({
    ...item,
    id: generateId('item'),
    children: item.children ? cloneListItems(item.children) : undefined,
  }));
}

export function deepClonePage(page: Page): Page {
  return {
    ...JSON.parse(JSON.stringify(page)),
    id: generateId('page'),
    blocks: page.blocks.map(block => deepCloneBlock(block)),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}