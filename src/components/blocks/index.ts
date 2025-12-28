// 📦 BLOCK COMPONENTS - Export centralizzato
// Notion-like Block Editor System

export { BlockEditor } from './BlockEditor';
export { BlockRenderer } from './BlockRenderer';
export { SlashCommandMenu, PageHeader } from './SlashCommandMenu';

// Re-export types per convenience
export type {
  Block,
  BlockType,
  Page,
  PageCover,
  RichText,
  ParagraphBlock,
  HeadingBlock,
  BulletListBlock,
  NumberedListBlock,
  TodoListBlock,
  ToggleBlock,
  QuoteBlock,
  CalloutBlock,
  CodeBlock,
  ImageBlock,
  VideoBlock,
  DividerBlock,
  TableBlock,
  ColumnsBlock,
  EmbedBlock,
  BookmarkBlock,
  LinkToPageBlock,
  LinkToGoalBlock,
  LinkToTaskBlock
} from '@/types/blocks';

export {
  createBlock,
  createPage,
  createRichText,
  deepCloneBlock,
  deepClonePage,
  generateId
} from '@/types/blocks';