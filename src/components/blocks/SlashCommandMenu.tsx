'use client';

// 🎨 SLASH COMMAND MENU & PAGE HEADER
// MODALITÀ PSICOPATICO CERTOSINO 🔥

import React, { useState, useEffect, useRef } from 'react';
import {
  Type, Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  Quote, AlertCircle, Code, Image, Video, Link, Table, Columns,
  ToggleLeft, Minus, FileText, Target, Bookmark, X, Search,
  ImagePlus, Smile
} from 'lucide-react';
import { BlockType, Page, PageCover } from '@/types/blocks';

// ============================================================================
// SLASH COMMAND MENU
// ============================================================================

interface SlashCommandMenuProps {
  position: { x: number; y: number };
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}

interface CommandItem {
  type: BlockType;
  label: string;
  description: string;
  icon: React.ReactNode;
  keywords: string[];
}

const COMMANDS: CommandItem[] = [
  // Testo Base
  { type: 'paragraph', label: 'Testo', description: 'Testo semplice', icon: <Type className="w-5 h-5" />, keywords: ['text', 'paragraph', 'testo'] },
  { type: 'heading1', label: 'Titolo 1', description: 'Titolo grande', icon: <Heading1 className="w-5 h-5" />, keywords: ['h1', 'heading', 'titolo'] },
  { type: 'heading2', label: 'Titolo 2', description: 'Titolo medio', icon: <Heading2 className="w-5 h-5" />, keywords: ['h2', 'heading', 'titolo'] },
  { type: 'heading3', label: 'Titolo 3', description: 'Titolo piccolo', icon: <Heading3 className="w-5 h-5" />, keywords: ['h3', 'heading', 'titolo'] },
  
  // Liste
  { type: 'bulletList', label: 'Lista puntata', description: 'Lista con punti', icon: <List className="w-5 h-5" />, keywords: ['bullet', 'list', 'punti', 'elenco'] },
  { type: 'numberedList', label: 'Lista numerata', description: 'Lista con numeri', icon: <ListOrdered className="w-5 h-5" />, keywords: ['numbered', 'list', 'numeri', 'elenco'] },
  { type: 'todoList', label: 'To-do list', description: 'Lista con checkbox', icon: <CheckSquare className="w-5 h-5" />, keywords: ['todo', 'check', 'task', 'checkbox'] },
  { type: 'toggle', label: 'Toggle', description: 'Contenuto espandibile', icon: <ToggleLeft className="w-5 h-5" />, keywords: ['toggle', 'expand', 'collapse', 'espandi'] },
  
  // Contenuto
  { type: 'quote', label: 'Citazione', description: 'Blocco citazione', icon: <Quote className="w-5 h-5" />, keywords: ['quote', 'citazione', 'blockquote'] },
  { type: 'callout', label: 'Callout', description: 'Box evidenziato', icon: <AlertCircle className="w-5 h-5" />, keywords: ['callout', 'info', 'warning', 'alert', 'box'] },
  { type: 'code', label: 'Codice', description: 'Blocco di codice', icon: <Code className="w-5 h-5" />, keywords: ['code', 'codice', 'programming'] },
  { type: 'divider', label: 'Divisore', description: 'Linea orizzontale', icon: <Minus className="w-5 h-5" />, keywords: ['divider', 'line', 'hr', 'separator'] },
  
  // Media
  { type: 'image', label: 'Immagine', description: 'Carica o incolla immagine', icon: <Image className="w-5 h-5" />, keywords: ['image', 'immagine', 'foto', 'picture'] },
  { type: 'video', label: 'Video', description: 'YouTube, Vimeo, o link', icon: <Video className="w-5 h-5" />, keywords: ['video', 'youtube', 'vimeo'] },
  { type: 'bookmark', label: 'Bookmark', description: 'Anteprima link', icon: <Bookmark className="w-5 h-5" />, keywords: ['bookmark', 'link', 'preview'] },
  { type: 'embed', label: 'Embed', description: 'Incorpora contenuto esterno', icon: <Link className="w-5 h-5" />, keywords: ['embed', 'iframe', 'incorpora'] },
  
  // Layout
  { type: 'table', label: 'Tabella', description: 'Tabella semplice', icon: <Table className="w-5 h-5" />, keywords: ['table', 'tabella', 'grid'] },
  { type: 'columns', label: 'Colonne', description: 'Layout a colonne', icon: <Columns className="w-5 h-5" />, keywords: ['columns', 'colonne', 'layout'] },
  
  // Link interni
  { type: 'linkToPage', label: 'Link a pagina', description: 'Collega altra pagina', icon: <FileText className="w-5 h-5" />, keywords: ['link', 'page', 'pagina'] },
  { type: 'linkToGoal', label: 'Link a Goal', description: 'Collega un obiettivo', icon: <Target className="w-5 h-5" />, keywords: ['goal', 'obiettivo', 'target'] },
  { type: 'linkToTask', label: 'Link a Task', description: 'Collega un task', icon: <CheckSquare className="w-5 h-5" />, keywords: ['task', 'todo', 'attività'] },
];

export function SlashCommandMenu({ position, onSelect, onClose }: SlashCommandMenuProps) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const filteredCommands = COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(search.toLowerCase()) ||
    cmd.keywords.some(k => k.includes(search.toLowerCase()))
  );
  
  // Boundary checking - adjust position if menu would go off screen
  useEffect(() => {
    if (menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let newX = position.x;
      let newY = position.y;
      
      // Check right boundary
      if (position.x + menuRect.width > viewportWidth - 20) {
        newX = viewportWidth - menuRect.width - 20;
      }
      
      // Check bottom boundary
      if (position.y + menuRect.height > viewportHeight - 20) {
        newY = position.y - menuRect.height - 10; // Show above instead
      }
      
      // Check left boundary
      if (newX < 20) newX = 20;
      
      // Check top boundary
      if (newY < 20) newY = 20;
      
      if (newX !== position.x || newY !== position.y) {
        setAdjustedPosition({ x: newX, y: newY });
      }
    }
  }, [position]);
  
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          onSelect(filteredCommands[selectedIndex].type);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredCommands, selectedIndex, onSelect, onClose]);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
  
  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-80 max-h-96 bg-gray-800 border border-gray-700 
               rounded-xl shadow-2xl overflow-hidden"
      style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
    >
      {/* Search */}
      <div className="p-2 border-b border-gray-700">
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-lg">
          <Search className="w-4 h-4 text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca blocco..."
            className="flex-1 bg-transparent text-sm text-white focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Commands */}
      <div className="overflow-y-auto max-h-72 p-2">
        {filteredCommands.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-500 text-sm">
            Nessun blocco trovato
          </div>
        ) : (
          <>
            <div className="px-3 py-1 text-xs text-gray-500 uppercase">Blocchi</div>
            {filteredCommands.map((cmd, index) => (
              <button
                key={cmd.type}
                onClick={() => onSelect(cmd.type)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
                          ${index === selectedIndex ? 'bg-gray-700' : 'hover:bg-gray-700/50'}`}
              >
                <div className="w-10 h-10 flex items-center justify-center bg-gray-700/50 rounded-lg text-gray-400">
                  {cmd.icon}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-white">{cmd.label}</div>
                  <div className="text-xs text-gray-400">{cmd.description}</div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PAGE HEADER
// ============================================================================

interface PageHeaderProps {
  page: Page;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string) => void;
  onCoverChange: (cover: PageCover | undefined) => void;
  onImageUpload?: (file: File) => Promise<string>;
  readOnly?: boolean;
}

const EMOJI_LIST = ['📝', '🎯', '📚', '💡', '🚀', '⚡', '🔥', '💪', '🧠', '📊', '📈', '✅', '⭐', '💎', '🏆', '📌', '🎨', '🛠️', '📱', '💻', '🌟', '🎉', '📖', '✍️', '🗂️'];

const COVER_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
];

const COVER_COLORS = [
  '#1e3a5f', '#2d3748', '#1a365d', '#234e52', '#322659',
  '#3c366b', '#553c9a', '#702459', '#742a2a', '#975a16'
];

export function PageHeader({
  page,
  onTitleChange,
  onIconChange,
  onCoverChange,
  onImageUpload,
  readOnly = false,
}: PageHeaderProps) {
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isEditingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [isEditingTitle]);
  
  return (
    <div className="relative">
      {/* Cover */}
      {page.cover ? (
        <div 
          className="w-full h-48 relative group"
          style={{
            background: page.cover.type === 'gradient' 
              ? page.cover.value 
              : page.cover.type === 'color'
              ? page.cover.value
              : undefined,
            backgroundImage: page.cover.type === 'image' ? `url(${page.cover.value})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!readOnly && (
            <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setShowCoverPicker(true)}
                className="px-3 py-1.5 bg-black/50 hover:bg-black/70 text-white text-sm rounded-lg backdrop-blur-sm"
              >
                Cambia cover
              </button>
              <button
                onClick={() => onCoverChange(undefined)}
                className="px-3 py-1.5 bg-black/50 hover:bg-black/70 text-white text-sm rounded-lg backdrop-blur-sm"
              >
                Rimuovi
              </button>
            </div>
          )}
        </div>
      ) : !readOnly ? (
        <button
          onClick={() => setShowCoverPicker(true)}
          className="w-full py-8 text-gray-500 hover:text-gray-400 hover:bg-gray-800/30 
                   transition-colors flex items-center justify-center gap-2"
        >
          <ImagePlus className="w-5 h-5" />
          <span className="text-sm">Aggiungi cover</span>
        </button>
      ) : null}
      
      {/* Icon & Title */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="relative">
            <button
              onClick={() => !readOnly && setShowIconPicker(!showIconPicker)}
              className={`text-6xl ${!readOnly ? 'hover:bg-gray-800 rounded-lg p-2 -m-2' : ''}`}
              disabled={readOnly}
            >
              {page.icon || '📄'}
            </button>
            
            {showIconPicker && (
              <div className="absolute top-full left-0 mt-2 p-3 bg-gray-800 border border-gray-700 
                            rounded-xl shadow-xl z-50 w-64">
                <div className="flex flex-wrap gap-2">
                  {EMOJI_LIST.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => { onIconChange(emoji); setShowIconPicker(false); }}
                      className="text-2xl p-2 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Title */}
          <div className="flex-1">
            {isEditingTitle ? (
              <input
                ref={titleRef}
                type="text"
                value={page.title}
                onChange={(e) => onTitleChange(e.target.value)}
                onBlur={() => setIsEditingTitle(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                className="w-full text-4xl font-bold bg-transparent text-white 
                         focus:outline-none border-b-2 border-cyan-500"
                placeholder="Untitled"
              />
            ) : (
              <h1 
                onClick={() => !readOnly && setIsEditingTitle(true)}
                className={`text-4xl font-bold text-white ${!readOnly ? 'cursor-text hover:bg-gray-800/50 rounded px-2 -mx-2' : ''}`}
              >
                {page.title || 'Untitled'}
              </h1>
            )}
            
            {page.tags && page.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {page.tags.map(tag => (
                  <span key={tag} className="px-2 py-1 bg-gray-800 text-gray-400 text-sm rounded">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Cover Picker Modal */}
      {showCoverPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCoverPicker(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-96 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">Scegli cover</h3>
              <button onClick={() => setShowCoverPicker(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Gradients */}
              <div>
                <div className="text-sm text-gray-400 mb-2">Gradienti</div>
                <div className="grid grid-cols-4 gap-2">
                  {COVER_GRADIENTS.map((gradient, i) => (
                    <button
                      key={i}
                      onClick={() => { onCoverChange({ type: 'gradient', value: gradient }); setShowCoverPicker(false); }}
                      className="h-12 rounded-lg hover:ring-2 ring-cyan-500 transition-all"
                      style={{ background: gradient }}
                    />
                  ))}
                </div>
              </div>
              
              {/* Colors */}
              <div>
                <div className="text-sm text-gray-400 mb-2">Colori solidi</div>
                <div className="grid grid-cols-5 gap-2">
                  {COVER_COLORS.map((color, i) => (
                    <button
                      key={i}
                      onClick={() => { onCoverChange({ type: 'color', value: color }); setShowCoverPicker(false); }}
                      className="h-10 rounded-lg hover:ring-2 ring-cyan-500 transition-all"
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
              
              {/* Upload */}
              {onImageUpload && (
                <div>
                  <div className="text-sm text-gray-400 mb-2">Immagine personalizzata</div>
                  <label className="block w-full p-4 border-2 border-dashed border-gray-600 rounded-lg
                                  hover:border-gray-500 cursor-pointer text-center">
                    <ImagePlus className="w-6 h-6 text-gray-500 mx-auto mb-2" />
                    <span className="text-sm text-gray-400">Carica immagine</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = await onImageUpload(file);
                          onCoverChange({ type: 'image', value: url });
                          setShowCoverPicker(false);
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}