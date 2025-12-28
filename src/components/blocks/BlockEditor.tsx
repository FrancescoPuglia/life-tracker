'use client';

// 🎨 BLOCK EDITOR - Editor Notion-like completo
// MODALITÀ PSICOPATICO CERTOSINO 🔥

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Page, Block, createBlock, createPage, deepCloneBlock, generateId, createRichText, RichText } from '@/types/blocks';
import { BlockRenderer } from './BlockRenderer';
import { PageHeader, SlashCommandMenu } from './SlashCommandMenu';

// ============================================================================
// TYPES
// ============================================================================

interface BlockEditorProps {
  page?: Page;
  userId: string;
  onSave?: (page: Page) => Promise<void>;
  onImageUpload?: (file: File) => Promise<string>;
  readOnly?: boolean;
  className?: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function BlockEditor({
  page: initialPage,
  userId,
  onSave,
  onImageUpload,
  readOnly = false,
  className = '',
  autoSave = true,
  autoSaveDelay = 2000,
}: BlockEditorProps) {
  // State
  const [page, setPage] = useState<Page>(
    initialPage || createPage(userId)
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ x: 0, y: 0 });
  const [slashMenuBlockId, setSlashMenuBlockId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // Refs
  const editorRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pageRef = useRef(page); // FIX: Ref per evitare stale closure
  
  // Keep pageRef in sync
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  
  // History for undo/redo
  const [history, setHistory] = useState<{ past: Page[]; future: Page[] }>({
    past: [],
    future: [],
  });

  // Sync with initialPage prop changes
  useEffect(() => {
    if (initialPage && initialPage.id !== page.id) {
      setPage(initialPage);
      setHistory({ past: [], future: [] });
      setHasUnsavedChanges(false);
    }
  }, [initialPage, page.id]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ============================================================================
  // AUTO-SAVE - FIX: Usa pageRef per evitare race condition
  // ============================================================================

  useEffect(() => {
    if (!autoSave || !hasUnsavedChanges || !onSave) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await onSave(pageRef.current); // FIX: Usa ref invece di page
        setHasUnsavedChanges(false);
      } catch (error) {
        console.error('Auto-save failed:', error);
      } finally {
        setIsSaving(false);
      }
    }, autoSaveDelay);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [page, autoSave, autoSaveDelay, hasUnsavedChanges, onSave]);

  // ============================================================================
  // HISTORY MANAGEMENT - FIX: Evita stale closure usando functional update
  // ============================================================================

  const pushHistory = useCallback((newPage: Page) => {
    setPage(currentPage => {
      // Salva lo stato corrente nella history
      setHistory(prev => ({
        past: [...prev.past.slice(-49), currentPage], // Keep last 50 states
        future: [],
      }));
      return newPage;
    });
    setHasUnsavedChanges(true);
  }, []); // Nessuna dipendenza - usa functional update

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.past.length === 0) return prev;
      
      const previous = prev.past[prev.past.length - 1];
      setPage(currentPage => {
        // Sposta lo stato corrente nel future
        setHistory(h => ({
          past: h.past.slice(0, -1),
          future: [currentPage, ...h.future.slice(0, 49)], // Limit future too
        }));
        return previous;
      });
      setHasUnsavedChanges(true);
      return prev; // Return unchanged, actual update happens in nested setHistory
    });
  }, []);

  const redo = useCallback(() => {
    setHistory(prev => {
      if (prev.future.length === 0) return prev;
      
      const next = prev.future[0];
      setPage(currentPage => {
        setHistory(h => ({
          past: [...h.past, currentPage],
          future: h.future.slice(1),
        }));
        return next;
      });
      setHasUnsavedChanges(true);
      return prev;
    });
  }, []);

  // ============================================================================
  // BLOCK OPERATIONS
  // ============================================================================

  const updateBlock = useCallback((blockId: string, updates: Partial<Block>) => {
    const newPage: Page = {
      ...page,
      blocks: page.blocks.map(block =>
        block.id === blockId
          ? { ...block, ...updates, updatedAt: new Date() } as Block
          : block
      ),
      updatedAt: new Date(),
    };
    pushHistory(newPage);
  }, [page, pushHistory]);

  const addBlock = useCallback((afterBlockId: string | null, type: Block['type'] = 'paragraph') => {
    const newBlock = createBlock(type);
    const newBlocks = [...page.blocks];
    
    if (afterBlockId) {
      const index = newBlocks.findIndex(b => b.id === afterBlockId);
      newBlocks.splice(index + 1, 0, newBlock);
    } else {
      newBlocks.push(newBlock);
    }
    
    const newPage = {
      ...page,
      blocks: newBlocks,
      updatedAt: new Date(),
    };
    pushHistory(newPage);
    
    // Focus the new block
    setTimeout(() => setFocusedBlockId(newBlock.id), 0);
    
    return newBlock.id;
  }, [page, pushHistory]);

  const deleteBlock = useCallback((blockId: string) => {
    if (page.blocks.length <= 1) return; // Keep at least one block
    
    const index = page.blocks.findIndex(b => b.id === blockId);
    const newBlocks = page.blocks.filter(b => b.id !== blockId);
    
    const newPage = {
      ...page,
      blocks: newBlocks,
      updatedAt: new Date(),
    };
    pushHistory(newPage);
    
    // Focus previous block
    if (index > 0) {
      setFocusedBlockId(newBlocks[index - 1].id);
    } else if (newBlocks.length > 0) {
      setFocusedBlockId(newBlocks[0].id);
    }
  }, [page, pushHistory]);

  const duplicateBlock = useCallback((blockId: string) => {
    setPage(currentPage => {
      const block = currentPage.blocks.find(b => b.id === blockId);
      if (!block) return currentPage;
      
      // deepCloneBlock già genera un nuovo ID
      const newBlock = deepCloneBlock(block);
      
      const index = currentPage.blocks.findIndex(b => b.id === blockId);
      const newBlocks = [...currentPage.blocks];
      newBlocks.splice(index + 1, 0, newBlock);
      
      const newPage = {
        ...currentPage,
        blocks: newBlocks,
        updatedAt: new Date(),
      };
      
      // Salva nella history
      setHistory(prev => ({
        past: [...prev.past.slice(-49), currentPage],
        future: [],
      }));
      setHasUnsavedChanges(true);
      
      return newPage;
    });
  }, []);

  const moveBlock = useCallback((blockId: string, direction: 'up' | 'down') => {
    const index = page.blocks.findIndex(b => b.id === blockId);
    if (index === -1) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= page.blocks.length) return;
    
    const newBlocks = arrayMove(page.blocks, index, newIndex);
    
    const newPage = {
      ...page,
      blocks: newBlocks,
      updatedAt: new Date(),
    };
    pushHistory(newPage);
  }, [page, pushHistory]);

  const transformBlock = useCallback((blockId: string, newType: Block['type']) => {
    const block = page.blocks.find(b => b.id === blockId);
    if (!block) return;
    
    // Se stesso tipo, non fare nulla
    if (block.type === newType) return;
    
    // Create new block of the target type
    const newBlock = createBlock(newType);
    
    // ============================================================
    // CONVERSIONE INTELLIGENTE DEI CONTENUTI
    // ============================================================
    
    // Helper per estrarre testo da content array
    const getTextFromContent = (content: RichText[]): string => 
      content.map(c => c.text).join('');
    
    // Helper per estrarre testo da items (liste)
    const getTextFromItems = (items: any[]): string =>
      items.map(item => getTextFromContent(item.content || [])).join('\n');
    
    // Helper per creare items da testo
    const createItemsFromText = (text: string): any[] =>
      text.split('\n').filter(line => line.trim()).map(line => ({
        id: generateId('item'),
        content: [createRichText(line)],
        checked: false,
      }));
    
    // Estrai contenuto dal blocco sorgente
    let sourceText = '';
    let sourceContent: RichText[] = [];
    
    if ('content' in block && Array.isArray((block as any).content)) {
      sourceContent = (block as any).content;
      sourceText = getTextFromContent(sourceContent);
    } else if ('items' in block && Array.isArray((block as any).items)) {
      sourceText = getTextFromItems((block as any).items);
      sourceContent = [createRichText(sourceText)];
    } else if ('summary' in block && Array.isArray((block as any).summary)) {
      sourceContent = (block as any).summary;
      sourceText = getTextFromContent(sourceContent);
    } else if ('code' in block) {
      sourceText = (block as any).code || '';
      sourceContent = [createRichText(sourceText)];
    }
    
    // Applica contenuto al blocco destinazione
    if ('content' in newBlock) {
      // Destinazione è un blocco con content (paragraph, heading, quote, callout)
      (newBlock as any).content = sourceContent.length > 0 ? sourceContent : [createRichText(sourceText)];
    } else if ('items' in newBlock) {
      // Destinazione è una lista (bulletList, numberedList, todoList)
      const items = sourceText ? createItemsFromText(sourceText) : [];
      (newBlock as any).items = items.length > 0 ? items : [{ id: generateId('item'), content: [], checked: false }];
    } else if ('summary' in newBlock) {
      // Destinazione è toggle
      (newBlock as any).summary = sourceContent.length > 0 ? sourceContent : [createRichText(sourceText)];
    } else if ('code' in newBlock) {
      // Destinazione è code block
      (newBlock as any).code = sourceText;
    }
    
    // Preserva metadati originali
    newBlock.id = block.id;
    newBlock.createdAt = block.createdAt;
    
    const newPage = {
      ...page,
      blocks: page.blocks.map(b => b.id === blockId ? newBlock : b),
      updatedAt: new Date(),
    };
    pushHistory(newPage);
  }, [page, pushHistory]);

  // ============================================================================
  // DRAG & DROP
  // ============================================================================

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = page.blocks.findIndex(b => b.id === active.id);
      const newIndex = page.blocks.findIndex(b => b.id === over.id);
      
      const newBlocks = arrayMove(page.blocks, oldIndex, newIndex);
      
      const newPage = {
        ...page,
        blocks: newBlocks,
        updatedAt: new Date(),
      };
      pushHistory(newPage);
    }
  }, [page, pushHistory]);

  // ============================================================================
  // SLASH COMMAND
  // ============================================================================

  const handleSlashCommand = useCallback((blockId: string, position: { x: number; y: number }) => {
    setSlashMenuBlockId(blockId);
    setSlashMenuPosition(position);
    setShowSlashMenu(true);
  }, []);

  const handleSlashSelect = useCallback((type: Block['type']) => {
    if (slashMenuBlockId) {
      transformBlock(slashMenuBlockId, type);
    }
    setShowSlashMenu(false);
    setSlashMenuBlockId(null);
  }, [slashMenuBlockId, transformBlock]);

  // ============================================================================
  // KEYBOARD SHORTCUTS - FIX: Error handling migliorato
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl/Cmd + Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      // Redo: Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      // Save: Ctrl/Cmd + S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (onSave) {
          setIsSaving(true);
          onSave(pageRef.current)
            .then(() => {
              setHasUnsavedChanges(false);
            })
            .catch((error) => {
              console.error('Save failed:', error);
              // Potresti aggiungere un toast/notifica qui
            })
            .finally(() => {
              setIsSaving(false);
            });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, onSave]);

  // ============================================================================
  // PAGE OPERATIONS
  // ============================================================================

  const updatePageTitle = useCallback((title: string) => {
    const newPage = { ...page, title, updatedAt: new Date() };
    pushHistory(newPage);
  }, [page, pushHistory]);

  const updatePageIcon = useCallback((icon: string) => {
    const newPage = { ...page, icon, updatedAt: new Date() };
    pushHistory(newPage);
  }, [page, pushHistory]);

  const updatePageCover = useCallback((cover: Page['cover']) => {
    const newPage = { ...page, cover, updatedAt: new Date() };
    pushHistory(newPage);
  }, [page, pushHistory]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div 
      ref={editorRef}
      className={`block-editor w-full h-full bg-gray-950 ${className}`}
    >
      {/* Page Header with Cover & Title */}
      <PageHeader
        page={page}
        onTitleChange={updatePageTitle}
        onIconChange={updatePageIcon}
        onCoverChange={updatePageCover}
        onImageUpload={onImageUpload}
        readOnly={readOnly}
      />
      
      {/* Save Status */}
      <div className="sticky top-0 z-10 flex items-center justify-end px-4 py-2 bg-gray-950/80 backdrop-blur-sm border-b border-gray-800">
        <div className="flex items-center gap-3 text-xs">
          {hasUnsavedChanges && (
            <span className="text-yellow-500">● Modifiche non salvate</span>
          )}
          {isSaving && (
            <span className="text-blue-400">Salvando...</span>
          )}
          {!hasUnsavedChanges && !isSaving && (
            <span className="text-green-500">✓ Salvato</span>
          )}
        </div>
      </div>
      
      {/* Blocks Container */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={page.blocks.map(b => b.id)}
            strategy={verticalListSortingStrategy}
          >
            {page.blocks.map((block, index) => (
              <BlockRenderer
                key={block.id}
                block={block}
                isSelected={selectedBlockId === block.id}
                isFocused={focusedBlockId === block.id}
                readOnly={readOnly}
                onSelect={() => setSelectedBlockId(block.id)}
                onFocus={() => setFocusedBlockId(block.id)}
                onUpdate={(updates) => updateBlock(block.id, updates)}
                onDelete={() => deleteBlock(block.id)}
                onDuplicate={() => duplicateBlock(block.id)}
                onMoveUp={() => moveBlock(block.id, 'up')}
                onMoveDown={() => moveBlock(block.id, 'down')}
                onAddAfter={(type) => addBlock(block.id, type)}
                onTransform={(type) => transformBlock(block.id, type)}
                onSlashCommand={(pos) => handleSlashCommand(block.id, pos)}
                onImageUpload={onImageUpload}
                isFirst={index === 0}
                isLast={index === page.blocks.length - 1}
              />
            ))}
          </SortableContext>
        </DndContext>
        
        {/* Add Block Button */}
        {!readOnly && (
          <button
            onClick={() => addBlock(page.blocks[page.blocks.length - 1]?.id || null)}
            className="w-full py-4 mt-4 text-gray-500 hover:text-gray-300 
                     hover:bg-gray-800/50 rounded-lg transition-colors
                     flex items-center justify-center gap-2 group"
          >
            <span className="text-xl">+</span>
            <span className="text-sm opacity-0 group-hover:opacity-100 transition-opacity">
              Aggiungi blocco
            </span>
          </button>
        )}
      </div>
      
      {/* Slash Command Menu */}
      {showSlashMenu && (
        <SlashCommandMenu
          position={slashMenuPosition}
          onSelect={handleSlashSelect}
          onClose={() => setShowSlashMenu(false)}
        />
      )}
    </div>
  );
}

export default BlockEditor;