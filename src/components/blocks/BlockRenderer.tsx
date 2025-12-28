'use client';

// 🎨 BLOCK RENDERER - Renderizza ogni tipo di blocco
// VERSIONE CORRETTA CON TUTTI I FIX 🔥

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, Plus, Trash2, Copy, ChevronUp, ChevronDown,
  Type, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  Quote, AlertCircle, Code, Image, Video, Link, Table, Columns,
  ChevronRight, MoreHorizontal, Sparkles, ExternalLink, FileText, Target
} from 'lucide-react';
import {
  Block, BlockType, RichText, ParagraphBlock, HeadingBlock,
  BulletListBlock, NumberedListBlock, TodoListBlock, ToggleBlock,
  QuoteBlock, CalloutBlock, CodeBlock, ImageBlock, VideoBlock,
  DividerBlock, TableBlock, ColumnsBlock, EmbedBlock, BookmarkBlock,
  LinkToPageBlock, LinkToGoalBlock, LinkToTaskBlock, createRichText, generateId
} from '@/types/blocks';

// ============================================================================
// TYPES
// ============================================================================

interface BlockRendererProps {
  block: Block;
  isSelected: boolean;
  isFocused: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onFocus: () => void;
  onUpdate: (updates: Partial<Block>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddAfter: (type?: BlockType) => void;
  onTransform: (type: BlockType) => void;
  onSlashCommand: (position: { x: number; y: number }) => void;
  onImageUpload?: (file: File) => Promise<string>;
  isFirst: boolean;
  isLast: boolean;
}

// ============================================================================
// RICH TEXT RENDERER - FIXED KEY HANDLING
// ============================================================================

function RichTextRenderer({ content }: { content: RichText[] }) {
  if (!content || content.length === 0) {
    return null;
  }

  return (
    <>
      {content.map((item, i) => {
        if (!item.text) return null;
        
        let className = '';
        const styles: React.CSSProperties = {};
        
        if (item.annotations?.bold) className += ' font-bold';
        if (item.annotations?.italic) className += ' italic';
        if (item.annotations?.underline) className += ' underline';
        if (item.annotations?.strikethrough) className += ' line-through';
        if (item.annotations?.color) styles.color = item.annotations.color;
        if (item.annotations?.backgroundColor) styles.backgroundColor = item.annotations.backgroundColor;
        
        if (item.annotations?.code) {
          return (
            <code 
              key={`code-${i}`} 
              className="px-1.5 py-0.5 bg-gray-800 rounded text-pink-400 font-mono text-sm"
            >
              {item.text}
            </code>
          );
        }
        
        if (item.link) {
          return (
            <a 
              key={`link-${i}`} 
              href={item.link} 
              className={`text-blue-400 hover:underline ${className}`}
              style={styles}
              target="_blank" 
              rel="noopener noreferrer"
            >
              {item.text}
            </a>
          );
        }
        
        return (
          <span key={`text-${i}`} className={className} style={styles}>
            {item.text}
          </span>
        );
      })}
    </>
  );
}

// ============================================================================
// EDITABLE TEXT - FIX: Approccio uncontrolled per preservare cursore
// ============================================================================

interface EditableTextProps {
  content: RichText[];
  onChange: (content: RichText[]) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  onEnter?: () => void;
  onBackspace?: () => void;
  onSlash?: (position: { x: number; y: number }) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
}

function EditableText({
  content,
  onChange,
  placeholder = 'Scrivi qualcosa...',
  className = '',
  multiline = false,
  onEnter,
  onBackspace,
  onSlash,
  readOnly = false,
  autoFocus = false,
}: EditableTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const lastExternalContent = useRef<string>('');
  const isInternalChange = useRef(false);
  
  const plainText = content.map(c => c.text).join('');
  
  // Sincronizza contenuto esterno solo se diverso dall'ultimo interno
  useEffect(() => {
    if (!ref.current || isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    
    // Solo se il contenuto esterno è cambiato (es. undo/redo, transform)
    if (plainText !== lastExternalContent.current && plainText !== ref.current.textContent) {
      ref.current.textContent = plainText || '';
      lastExternalContent.current = plainText;
    }
  }, [plainText]);
  
  // Inizializza contenuto al mount
  useEffect(() => {
    if (ref.current && !ref.current.textContent) {
      ref.current.textContent = plainText || '';
      lastExternalContent.current = plainText;
    }
  }, []);
  
  // AutoFocus
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      // Posiziona cursore alla fine
      const range = document.createRange();
      const sel = window.getSelection();
      if (ref.current.childNodes.length > 0) {
        range.selectNodeContents(ref.current);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [autoFocus]);
  
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const text = e.currentTarget.textContent || '';
    isInternalChange.current = true;
    lastExternalContent.current = text;
    
    // Preserva annotations se presenti
    if (content.length === 1 && content[0].annotations) {
      onChange([{ ...content[0], text }]);
    } else {
      onChange([createRichText(text)]);
    }
  }, [onChange, content]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentText = ref.current?.textContent || '';
    
    if (e.key === 'Enter' && !e.shiftKey && !multiline) {
      e.preventDefault();
      onEnter?.();
    }
    
    if (e.key === 'Backspace' && currentText === '') {
      e.preventDefault();
      onBackspace?.();
    }
    
    if (e.key === '/' && currentText === '') {
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      if (rect) {
        onSlash?.({ x: rect.left, y: rect.bottom });
      }
    }
  }, [multiline, onEnter, onBackspace, onSlash]);
  
  if (readOnly) {
    return (
      <div className={className}>
        {plainText ? <RichTextRenderer content={content} /> : <span className="text-gray-500">{placeholder}</span>}
      </div>
    );
  }
  
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      className={`outline-none ${className} ${!plainText && !isFocused ? 'text-gray-500' : ''}`}
      data-placeholder={placeholder}
      style={{ minHeight: '1.5em' }}
    />
  );
}

// ============================================================================
// BLOCK MENU - FIXED WITH CLICK OUTSIDE
// ============================================================================

interface BlockMenuProps {
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onTransform: (type: BlockType) => void;
  isFirst: boolean;
  isLast: boolean;
}

function BlockMenu({ onDelete, onDuplicate, onMoveUp, onMoveDown, onTransform, isFirst, isLast }: BlockMenuProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showTransform, setShowTransform] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!showMenu) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setShowTransform(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);
  
  const blockTypes: { type: BlockType; label: string; icon: React.ReactNode }[] = [
    { type: 'paragraph', label: 'Testo', icon: <Type className="w-4 h-4" /> },
    { type: 'heading1', label: 'Titolo 1', icon: <Heading1 className="w-4 h-4" /> },
    { type: 'heading2', label: 'Titolo 2', icon: <Heading2 className="w-4 h-4" /> },
    { type: 'heading3', label: 'Titolo 3', icon: <Heading3 className="w-4 h-4" /> },
    { type: 'bulletList', label: 'Lista puntata', icon: <List className="w-4 h-4" /> },
    { type: 'numberedList', label: 'Lista numerata', icon: <ListOrdered className="w-4 h-4" /> },
    { type: 'todoList', label: 'Todo list', icon: <CheckSquare className="w-4 h-4" /> },
    { type: 'quote', label: 'Citazione', icon: <Quote className="w-4 h-4" /> },
    { type: 'callout', label: 'Callout', icon: <AlertCircle className="w-4 h-4" /> },
    { type: 'code', label: 'Codice', icon: <Code className="w-4 h-4" /> },
  ];
  
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
        className="p-1 hover:bg-gray-700 rounded transition-colors"
      >
        <MoreHorizontal className="w-4 h-4 text-gray-400" />
      </button>
      
      {showMenu && (
        <div className="absolute left-0 top-full mt-1 w-48 bg-gray-800 border border-gray-700 
                      rounded-lg shadow-xl z-50 py-1">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false); }}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-700 
                     flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Elimina
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); setShowMenu(false); }}
            className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 
                     flex items-center gap-2"
          >
            <Copy className="w-4 h-4" /> Duplica
          </button>
          
          <div className="border-t border-gray-700 my-1" />
          
          <button
            onClick={(e) => { e.stopPropagation(); onMoveUp(); setShowMenu(false); }}
            disabled={isFirst}
            className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 
                     flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronUp className="w-4 h-4" /> Sposta su
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onMoveDown(); setShowMenu(false); }}
            disabled={isLast}
            className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 
                     flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronDown className="w-4 h-4" /> Sposta giù
          </button>
          
          <div className="border-t border-gray-700 my-1" />
          
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowTransform(!showTransform); }}
              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 
                       flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Trasforma in
              </span>
              <ChevronRight className="w-4 h-4" />
            </button>
            
            {showTransform && (
              <div className="absolute left-full top-0 ml-1 w-48 bg-gray-800 border border-gray-700 
                            rounded-lg shadow-xl py-1 z-50">
                {blockTypes.map(bt => (
                  <button
                    key={bt.type}
                    onClick={(e) => { e.stopPropagation(); onTransform(bt.type); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 
                             flex items-center gap-2"
                  >
                    {bt.icon} {bt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ALIGNMENT CLASSES - FIX FOR TAILWIND
// ============================================================================

const ALIGNMENT_CLASSES = {
  left: 'items-start',
  center: 'items-center',
  right: 'items-end',
} as const;

// ============================================================================
// MAIN BLOCK RENDERER
// ============================================================================

export function BlockRenderer({
  block,
  isSelected,
  isFocused,
  readOnly,
  onSelect,
  onFocus,
  onUpdate,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAddAfter,
  onTransform,
  onSlashCommand,
  onImageUpload,
  isFirst,
  isLast,
}: BlockRendererProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id, disabled: readOnly });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const renderBlockContent = () => {
    switch (block.type) {
      case 'paragraph':
        return (
          <EditableText
            content={(block as ParagraphBlock).content}
            onChange={(content) => onUpdate({ content } as Partial<ParagraphBlock>)}
            placeholder="Scrivi qualcosa, o premi '/' per i comandi..."
            className="text-gray-200 leading-relaxed"
            onEnter={() => onAddAfter()}
            onBackspace={onDelete}
            onSlash={onSlashCommand}
            readOnly={readOnly}
            autoFocus={isFocused}
          />
        );
        
      case 'heading1':
        return (
          <EditableText
            content={(block as HeadingBlock).content}
            onChange={(content) => onUpdate({ content } as Partial<HeadingBlock>)}
            placeholder="Titolo 1"
            className="text-3xl font-bold text-white"
            onEnter={() => onAddAfter()}
            onBackspace={onDelete}
            onSlash={onSlashCommand}
            readOnly={readOnly}
            autoFocus={isFocused}
          />
        );
        
      case 'heading2':
        return (
          <EditableText
            content={(block as HeadingBlock).content}
            onChange={(content) => onUpdate({ content } as Partial<HeadingBlock>)}
            placeholder="Titolo 2"
            className="text-2xl font-bold text-white"
            onEnter={() => onAddAfter()}
            onBackspace={onDelete}
            onSlash={onSlashCommand}
            readOnly={readOnly}
            autoFocus={isFocused}
          />
        );
        
      case 'heading3':
        return (
          <EditableText
            content={(block as HeadingBlock).content}
            onChange={(content) => onUpdate({ content } as Partial<HeadingBlock>)}
            placeholder="Titolo 3"
            className="text-xl font-semibold text-white"
            onEnter={() => onAddAfter()}
            onBackspace={onDelete}
            onSlash={onSlashCommand}
            readOnly={readOnly}
            autoFocus={isFocused}
          />
        );
      
      case 'bulletList': {
        const bulletBlock = block as BulletListBlock;
        return (
          <div className="space-y-1">
            {(bulletBlock.items || []).map((item, i) => (
              <div key={item.id} className="flex items-start gap-2">
                <span className="text-gray-400 mt-1 select-none">•</span>
                <EditableText
                  content={item.content}
                  onChange={(content) => {
                    const newItems = [...bulletBlock.items];
                    newItems[i] = { ...item, content };
                    onUpdate({ items: newItems } as Partial<BulletListBlock>);
                  }}
                  placeholder="Elemento lista"
                  className="flex-1 text-gray-200"
                  onEnter={() => {
                    const newItems = [...bulletBlock.items];
                    newItems.splice(i + 1, 0, { id: generateId('item'), content: [] });
                    onUpdate({ items: newItems } as Partial<BulletListBlock>);
                  }}
                  onBackspace={() => {
                    // Elimina item vuoto, ma mantieni almeno uno
                    if (bulletBlock.items.length > 1) {
                      const newItems = bulletBlock.items.filter((_, idx) => idx !== i);
                      onUpdate({ items: newItems } as Partial<BulletListBlock>);
                    }
                  }}
                  readOnly={readOnly}
                />
              </div>
            ))}
            {!readOnly && (!bulletBlock.items || bulletBlock.items.length === 0) && (
              <button
                onClick={() => onUpdate({ items: [{ id: generateId('item'), content: [] }] } as Partial<BulletListBlock>)}
                className="text-gray-500 text-sm hover:text-gray-300 ml-4"
              >
                + Aggiungi elemento
              </button>
            )}
          </div>
        );
      }
        
      case 'numberedList': {
        const numberedBlock = block as NumberedListBlock;
        return (
          <div className="space-y-1">
            {(numberedBlock.items || []).map((item, i) => (
              <div key={item.id} className="flex items-start gap-2">
                <span className="text-gray-400 mt-0.5 select-none min-w-[1.5rem]">{i + 1}.</span>
                <EditableText
                  content={item.content}
                  onChange={(content) => {
                    const newItems = [...numberedBlock.items];
                    newItems[i] = { ...item, content };
                    onUpdate({ items: newItems } as Partial<NumberedListBlock>);
                  }}
                  placeholder="Elemento lista"
                  className="flex-1 text-gray-200"
                  onEnter={() => {
                    const newItems = [...numberedBlock.items];
                    newItems.splice(i + 1, 0, { id: generateId('item'), content: [] });
                    onUpdate({ items: newItems } as Partial<NumberedListBlock>);
                  }}
                  onBackspace={() => {
                    if (numberedBlock.items.length > 1) {
                      const newItems = numberedBlock.items.filter((_, idx) => idx !== i);
                      onUpdate({ items: newItems } as Partial<NumberedListBlock>);
                    }
                  }}
                  readOnly={readOnly}
                />
              </div>
            ))}
            {!readOnly && (!numberedBlock.items || numberedBlock.items.length === 0) && (
              <button
                onClick={() => onUpdate({ items: [{ id: generateId('item'), content: [] }] } as Partial<NumberedListBlock>)}
                className="text-gray-500 text-sm hover:text-gray-300 ml-6"
              >
                + Aggiungi elemento
              </button>
            )}
          </div>
        );
      }
        
      case 'todoList': {
        const todoBlock = block as TodoListBlock;
        return (
          <div className="space-y-1">
            {(todoBlock.items || []).map((item, i) => (
              <div key={item.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={item.checked || false}
                  onChange={(e) => {
                    const newItems = [...todoBlock.items];
                    newItems[i] = { ...item, checked: e.target.checked };
                    onUpdate({ items: newItems } as Partial<TodoListBlock>);
                  }}
                  disabled={readOnly}
                  className="mt-1.5 w-4 h-4 rounded border-gray-600 bg-gray-800 
                           text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                />
                <EditableText
                  content={item.content}
                  onChange={(content) => {
                    const newItems = [...todoBlock.items];
                    newItems[i] = { ...item, content };
                    onUpdate({ items: newItems } as Partial<TodoListBlock>);
                  }}
                  placeholder="To-do"
                  className={`flex-1 ${item.checked ? 'text-gray-500 line-through' : 'text-gray-200'}`}
                  onEnter={() => {
                    const newItems = [...todoBlock.items];
                    newItems.splice(i + 1, 0, { id: generateId('item'), content: [], checked: false });
                    onUpdate({ items: newItems } as Partial<TodoListBlock>);
                  }}
                  onBackspace={() => {
                    if (todoBlock.items.length > 1) {
                      const newItems = todoBlock.items.filter((_, idx) => idx !== i);
                      onUpdate({ items: newItems } as Partial<TodoListBlock>);
                    }
                  }}
                  readOnly={readOnly}
                />
              </div>
            ))}
            {!readOnly && (!todoBlock.items || todoBlock.items.length === 0) && (
              <button
                onClick={() => onUpdate({ items: [{ id: generateId('item'), content: [], checked: false }] } as Partial<TodoListBlock>)}
                className="text-gray-500 text-sm hover:text-gray-300 ml-6"
              >
                + Aggiungi to-do
              </button>
            )}
          </div>
        );
      }
        
      case 'toggle': {
        const toggleBlock = block as ToggleBlock;
        return (
          <div>
            <div className="flex items-start gap-2">
              <button
                onClick={() => onUpdate({ isOpen: !toggleBlock.isOpen } as Partial<ToggleBlock>)}
                className="mt-1 p-0.5 hover:bg-gray-700 rounded transition-colors"
              >
                <ChevronRight 
                  className={`w-4 h-4 text-gray-400 transition-transform ${toggleBlock.isOpen ? 'rotate-90' : ''}`} 
                />
              </button>
              {readOnly ? (
                <div className="flex-1 font-medium text-gray-200">
                  {toggleBlock.summary?.length > 0 ? (
                    <RichTextRenderer content={toggleBlock.summary} />
                  ) : (
                    <span className="text-gray-500">Toggle...</span>
                  )}
                </div>
              ) : (
                <EditableText
                  content={toggleBlock.summary || []}
                  onChange={(summary) => onUpdate({ summary } as Partial<ToggleBlock>)}
                  placeholder="Toggle header..."
                  className="flex-1 font-medium text-gray-200"
                  readOnly={readOnly}
                />
              )}
            </div>
            {toggleBlock.isOpen && (
              <div className="ml-6 mt-2 pl-4 border-l border-gray-700">
                {toggleBlock.children?.map((child, idx) => (
                  <div key={child.id} className="py-1">
                    {'content' in child && (
                      <EditableText
                        content={(child as ParagraphBlock).content}
                        onChange={(content) => {
                          const newChildren = [...(toggleBlock.children || [])];
                          newChildren[idx] = { ...child, content } as Block;
                          onUpdate({ children: newChildren } as Partial<ToggleBlock>);
                        }}
                        placeholder="Contenuto toggle..."
                        className="text-gray-300"
                        readOnly={readOnly}
                        onEnter={() => {
                          // Aggiungi nuovo blocco figlio
                          const newChild = { 
                            id: generateId('block'), 
                            type: 'paragraph' as const, 
                            content: [], 
                            createdAt: new Date(), 
                            updatedAt: new Date() 
                          };
                          const newChildren = [...(toggleBlock.children || [])];
                          newChildren.splice(idx + 1, 0, newChild);
                          onUpdate({ children: newChildren } as Partial<ToggleBlock>);
                        }}
                        onBackspace={() => {
                          // Elimina blocco figlio vuoto
                          if ((child as ParagraphBlock).content.length === 0 || 
                              (child as ParagraphBlock).content.every(c => !c.text)) {
                            const newChildren = toggleBlock.children?.filter((_, i) => i !== idx);
                            onUpdate({ children: newChildren } as Partial<ToggleBlock>);
                          }
                        }}
                      />
                    )}
                  </div>
                ))}
                {!readOnly && (
                  <button
                    onClick={() => {
                      const newChild = { 
                        id: generateId('block'), 
                        type: 'paragraph' as const, 
                        content: [], 
                        createdAt: new Date(), 
                        updatedAt: new Date() 
                      };
                      onUpdate({ children: [...(toggleBlock.children || []), newChild] } as Partial<ToggleBlock>);
                    }}
                    className="text-gray-500 text-sm hover:text-gray-300 mt-2"
                  >
                    + Aggiungi contenuto
                  </button>
                )}
              </div>
            )}
          </div>
        );
      }

      case 'quote':
        return (
          <div className="border-l-4 border-gray-600 pl-4">
            <EditableText
              content={(block as QuoteBlock).content}
              onChange={(content) => onUpdate({ content } as Partial<QuoteBlock>)}
              placeholder="Citazione..."
              className="text-gray-300 italic"
              multiline
              readOnly={readOnly}
              autoFocus={isFocused}
            />
          </div>
        );
        
      case 'callout': {
        const calloutBlock = block as CalloutBlock;
        const calloutColors: Record<string, string> = {
          info: 'bg-blue-900/30 border-blue-500',
          warning: 'bg-yellow-900/30 border-yellow-500',
          success: 'bg-green-900/30 border-green-500',
          error: 'bg-red-900/30 border-red-500',
          note: 'bg-purple-900/30 border-purple-500',
          tip: 'bg-cyan-900/30 border-cyan-500',
        };
        return (
          <div className={`flex gap-3 p-4 rounded-lg border-l-4 ${calloutColors[calloutBlock.calloutType] || calloutColors.info}`}>
            <span className="text-2xl select-none">{calloutBlock.icon || '💡'}</span>
            <EditableText
              content={calloutBlock.content}
              onChange={(content) => onUpdate({ content } as Partial<CalloutBlock>)}
              placeholder="Scrivi un callout..."
              className="flex-1 text-gray-200"
              multiline
              readOnly={readOnly}
              autoFocus={isFocused}
            />
          </div>
        );
      }
        
      case 'divider':
        return <hr className="border-gray-700 my-4" />;
        
      case 'code': {
        const codeBlock = block as CodeBlock;
        return (
          <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
              <select
                value={codeBlock.language}
                onChange={(e) => onUpdate({ language: e.target.value } as Partial<CodeBlock>)}
                disabled={readOnly}
                className="bg-transparent text-gray-400 text-sm focus:outline-none cursor-pointer"
              >
                {['javascript', 'typescript', 'python', 'java', 'html', 'css', 'json', 'sql', 'bash', 'plaintext'].map(lang => (
                  <option key={lang} value={lang} className="bg-gray-800">{lang}</option>
                ))}
              </select>
              <button
                onClick={() => navigator.clipboard.writeText(codeBlock.code)}
                className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-700"
              >
                Copia
              </button>
            </div>
            <textarea
              value={codeBlock.code}
              onChange={(e) => onUpdate({ code: e.target.value } as Partial<CodeBlock>)}
              placeholder="// Scrivi il tuo codice..."
              readOnly={readOnly}
              className="w-full p-4 bg-transparent text-green-400 font-mono text-sm 
                       resize-none focus:outline-none min-h-[100px]"
              rows={Math.max(3, (codeBlock.code || '').split('\n').length)}
            />
          </div>
        );
      }

      case 'image': {
        const imageBlock = block as ImageBlock;
        const alignmentClass = ALIGNMENT_CLASSES[imageBlock.alignment || 'center'];
        return (
          <div className={`flex flex-col ${alignmentClass}`}>
            {imageBlock.url ? (
              <>
                <img
                  src={imageBlock.url}
                  alt={imageBlock.alt || ''}
                  className="max-w-full rounded-lg"
                  style={{ width: imageBlock.width ? `${imageBlock.width}%` : 'auto' }}
                />
                {imageBlock.caption && imageBlock.caption.length > 0 && (
                  <div className="mt-2 text-sm text-gray-400 text-center">
                    <RichTextRenderer content={imageBlock.caption} />
                  </div>
                )}
              </>
            ) : !readOnly ? (
              <label className="w-full p-8 border-2 border-dashed border-gray-600 rounded-lg
                              hover:border-gray-500 cursor-pointer flex flex-col items-center gap-2
                              transition-colors">
                <Image className="w-8 h-8 text-gray-500" />
                <span className="text-gray-400 text-sm">Clicca o trascina un'immagine</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file && onImageUpload) {
                      const url = await onImageUpload(file);
                      onUpdate({ url } as Partial<ImageBlock>);
                    }
                  }}
                />
              </label>
            ) : null}
          </div>
        );
      }

      // Continuo nella prossima parte - il file è troppo lungo per un singolo messaggio...
      case 'video': {
        const videoBlock = block as VideoBlock;
        const getVideoEmbedUrl = (url: string) => {
          const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
          if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
          const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
          if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
          return url;
        };
        
        return (
          <div className="w-full">
            {videoBlock.url ? (
              <div className="relative w-full pt-[56.25%] rounded-lg overflow-hidden">
                <iframe
                  src={getVideoEmbedUrl(videoBlock.url)}
                  className="absolute top-0 left-0 w-full h-full"
                  allowFullScreen
                />
              </div>
            ) : !readOnly ? (
              <div className="p-4 border border-gray-700 rounded-lg">
                <input
                  type="text"
                  placeholder="Incolla URL YouTube o Vimeo..."
                  className="w-full bg-gray-800 text-gray-200 px-3 py-2 rounded focus:outline-none"
                  onBlur={(e) => e.target.value && onUpdate({ url: e.target.value } as Partial<VideoBlock>)}
                />
              </div>
            ) : null}
          </div>
        );
      }

      case 'embed': {
        const embedBlock = block as EmbedBlock;
        return embedBlock.url ? (
          <div className="relative w-full pt-[56.25%] rounded-lg overflow-hidden border border-gray-700">
            <iframe src={embedBlock.url} className="absolute top-0 left-0 w-full h-full" allowFullScreen />
          </div>
        ) : !readOnly ? (
          <div className="p-4 border border-gray-700 rounded-lg">
            <input
              type="text"
              placeholder="Incolla URL da incorporare..."
              className="w-full bg-gray-800 text-gray-200 px-3 py-2 rounded focus:outline-none"
              onBlur={(e) => e.target.value && onUpdate({ url: e.target.value } as Partial<EmbedBlock>)}
            />
          </div>
        ) : null;
      }

      case 'bookmark': {
        const bookmarkBlock = block as BookmarkBlock;
        return bookmarkBlock.url ? (
          <a 
            href={bookmarkBlock.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 p-4 border border-gray-700 rounded-lg hover:bg-gray-800/50"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white truncate">{bookmarkBlock.title || bookmarkBlock.url}</div>
              {bookmarkBlock.description && (
                <div className="text-sm text-gray-400 mt-1 line-clamp-2">{bookmarkBlock.description}</div>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                <ExternalLink className="w-3 h-3" />
                <span className="truncate">{bookmarkBlock.url}</span>
              </div>
            </div>
          </a>
        ) : !readOnly ? (
          <div className="p-4 border border-gray-700 rounded-lg">
            <input
              type="text"
              placeholder="Incolla URL per creare bookmark..."
              className="w-full bg-gray-800 text-gray-200 px-3 py-2 rounded focus:outline-none"
              onBlur={(e) => e.target.value && onUpdate({ url: e.target.value, title: e.target.value } as Partial<BookmarkBlock>)}
            />
          </div>
        ) : null;
      }

      case 'table': {
        const tableBlock = block as TableBlock;
        
        const updateCell = (rowIndex: number, cellIndex: number, content: RichText[]) => {
          const newRows = tableBlock.rows.map((row, rIdx) =>
            rIdx === rowIndex
              ? row.map((cell, cIdx) => (cIdx === cellIndex ? { ...cell, content } : cell))
              : row
          );
          onUpdate({ rows: newRows } as Partial<TableBlock>);
        };
        
        const addRow = () => {
          const colCount = tableBlock.rows[0]?.length || 2;
          const newRow = Array(colCount).fill(null).map(() => ({ content: [] }));
          onUpdate({ rows: [...tableBlock.rows, newRow] } as Partial<TableBlock>);
        };
        
        const addColumn = () => {
          const newRows = tableBlock.rows.map(row => [...row, { content: [] }]);
          onUpdate({ rows: newRows } as Partial<TableBlock>);
        };
        
        const deleteRow = (rowIndex: number) => {
          if (tableBlock.rows.length <= 1) return;
          const newRows = tableBlock.rows.filter((_, i) => i !== rowIndex);
          onUpdate({ rows: newRows } as Partial<TableBlock>);
        };
        
        return (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <tbody>
                {(tableBlock.rows || []).map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="group/row">
                    {row.map((cell, cellIndex) => {
                      const isHeader = tableBlock.hasHeader && rowIndex === 0;
                      return (
                        <td
                          key={`cell-${rowIndex}-${cellIndex}`}
                          className={`border border-gray-700 px-1 py-1 text-left relative ${
                            isHeader ? 'bg-gray-800 font-semibold' : 'bg-gray-900/50'
                          }`}
                        >
                          {readOnly ? (
                            <div className={`px-2 py-1 ${isHeader ? 'text-white' : 'text-gray-300'}`}>
                              <RichTextRenderer content={cell.content} />
                            </div>
                          ) : (
                            <EditableText
                              content={cell.content}
                              onChange={(content) => updateCell(rowIndex, cellIndex, content)}
                              placeholder={isHeader ? 'Header' : 'Cella'}
                              className={`px-2 py-1 min-w-[80px] ${isHeader ? 'text-white font-semibold' : 'text-gray-300'}`}
                              readOnly={readOnly}
                            />
                          )}
                        </td>
                      );
                    })}
                    {!readOnly && (
                      <td className="border-0 w-8 opacity-0 group-hover/row:opacity-100 transition-opacity">
                        <button
                          onClick={() => deleteRow(rowIndex)}
                          className="p-1 text-red-400 hover:text-red-300"
                          title="Elimina riga"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!readOnly && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={addRow}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 border border-gray-700 rounded hover:bg-gray-800"
                >
                  + Riga
                </button>
                <button
                  onClick={addColumn}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 border border-gray-700 rounded hover:bg-gray-800"
                >
                  + Colonna
                </button>
              </div>
            )}
          </div>
        );
      }

      case 'columns':
        return (
          <div className="grid grid-cols-2 gap-4">
            <div className="text-gray-500 text-center py-8 border border-dashed border-gray-600 rounded">
              Colonna 1 - Work in Progress
            </div>
            <div className="text-gray-500 text-center py-8 border border-dashed border-gray-600 rounded">
              Colonna 2 - Work in Progress
            </div>
          </div>
        );

      case 'linkToPage': {
        const pageLink = block as LinkToPageBlock;
        return (
          <div className="flex items-center gap-2 p-3 border border-gray-700 rounded-lg hover:bg-gray-800/50">
            <FileText className="w-5 h-5 text-gray-400" />
            <span className="text-gray-200">{pageLink.pageTitle || 'Pagina collegata'}</span>
          </div>
        );
      }

      case 'linkToGoal': {
        const goalLink = block as LinkToGoalBlock;
        return (
          <div className="flex items-center gap-2 p-3 border border-gray-700 rounded-lg hover:bg-gray-800/50">
            <Target className="w-5 h-5 text-cyan-400" />
            <span className="text-gray-200">{goalLink.goalTitle || 'Goal collegato'}</span>
          </div>
        );
      }

      case 'linkToTask': {
        const taskLink = block as LinkToTaskBlock;
        return (
          <div className="flex items-center gap-2 p-3 border border-gray-700 rounded-lg hover:bg-gray-800/50">
            <CheckSquare className="w-5 h-5 text-green-400" />
            <span className="text-gray-200">{taskLink.taskTitle || 'Task collegato'}</span>
          </div>
        );
      }
        
      default:
        return (
          <div className="text-gray-500 italic p-2 bg-gray-800/50 rounded">
            Blocco non supportato: {(block as any).type}
          </div>
        );
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-start gap-2 py-1 px-2 -mx-2 rounded-lg transition-colors
                ${isSelected ? 'bg-gray-800/50' : ''}
                ${isHovered && !readOnly ? 'bg-gray-800/30' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      {!readOnly && (
        <div className={`flex items-center gap-1 pt-1 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
          <button
            {...attributes}
            {...listeners}
            className="p-1 cursor-grab hover:bg-gray-700 rounded transition-colors"
          >
            <GripVertical className="w-4 h-4 text-gray-500" />
          </button>
          
          <button
            onClick={(e) => { e.stopPropagation(); onAddAfter(); }}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            <Plus className="w-4 h-4 text-gray-500" />
          </button>
          
          <BlockMenu
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onTransform={onTransform}
            isFirst={isFirst}
            isLast={isLast}
          />
        </div>
      )}
      
      <div className="flex-1 min-w-0" onClick={onFocus}>
        {renderBlockContent()}
      </div>
    </div>
  );
}

export default BlockRenderer;