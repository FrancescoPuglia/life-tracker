'use client';

// 🧠 NOTES PAGE - Second Brain Interface
// Integrazione completa del Notion Editor con Life Tracker

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Search, Filter, Grid, List, Calendar, 
  ArrowLeft, MoreVertical, Trash2, Copy,
  BookOpen, Target, Briefcase, CheckSquare,
  Tag, Clock, Star, Eye, Edit3, Cloud
} from 'lucide-react';
import { BlockEditor } from '@/components/blocks';
import { Page, createPage, createBlock } from '@/types/blocks';
import { db } from '@/lib/database';
import { useAuthContext } from '@/providers/AuthProvider';
import NotionSync from '@/components/NotionSync';

// ============================================================================
// TYPES
// ============================================================================

interface NotesPageProps {
  className?: string;
}

type ViewMode = 'list' | 'grid' | 'editor' | 'notion';
type SortBy = 'updated' | 'created' | 'title' | 'blocks';
type FilterBy = 'all' | 'templates' | 'recent' | 'linked';

interface PageWithStats extends Page {
  blocksCount: number;
  wordsCount: number;
  lastModified: string;
}

function formatNoteDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function NotesPage({ className = '' }: NotesPageProps) {
  const { user } = useAuthContext();
  
  // State
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [currentPage, setCurrentPage] = useState<Page | null>(null);
  const [pages, setPages] = useState<PageWithStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [filterBy, setFilterBy] = useState<FilterBy>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  // Page management
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  
  // ============================================================================
  // DATA LOADING
  // ============================================================================
  
  const loadPages = useCallback(async () => {
    if (!user?.uid) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('🧠 Loading pages for user:', user.uid);
      
      const rawPages = await db.getPages(user.uid);
      console.log('📚 Loaded pages:', rawPages.length);
      
      // Add stats to pages
      const pagesWithStats: PageWithStats[] = rawPages.map(page => {
        const blocksCount = page.blocks.length;
        
        // Calculate approximate word count
        const wordsCount = page.blocks.reduce((total, block) => {
          if ('content' in block && Array.isArray(block.content)) {
            return total + block.content.reduce((blockTotal: number, richText: any) => 
              blockTotal + (richText.text ? richText.text.split(' ').length : 0), 0
            );
          }
          if ('items' in block && Array.isArray(block.items)) {
            return total + block.items.reduce((blockTotal: number, item: any) => 
              blockTotal + (item.content ? item.content.reduce((itemTotal: number, richText: any) => 
                itemTotal + (richText.text ? richText.text.split(' ').length : 0), 0
              ) : 0), 0
            );
          }
          return total;
        }, 0);
        
        const lastModified = formatNoteDate(page.updatedAt);
        
        return {
          ...page,
          blocksCount,
          wordsCount,
          lastModified
        };
      });
      
      setPages(pagesWithStats);
    } catch (error) {
      console.error('❌ Error loading pages:', error);
      setError('Errore nel caricamento delle pagine');
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);
  
  useEffect(() => {
    loadPages();
  }, [loadPages]);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      setOpenDropdownId(null);
    };
    
    if (openDropdownId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdownId]);
  
  // ============================================================================
  // PAGE OPERATIONS
  // ============================================================================
  
  const handleCreatePage = async (title?: string, isTemplate?: boolean) => {
    if (!user?.uid) return;
    
    try {
      const newPageData = {
        userId: user.uid,
        title: title || 'Untitled Page',
        icon: '📝',
        blocks: [createBlock('paragraph')],
        isTemplate: isTemplate || false,
        tags: []
      };
      
      console.log('➕ Creating new page:', newPageData.title);
      const createdPage = await db.createPage(newPageData);
      
      // 🎉 Trigger dopamine reward for page creation
      if (typeof window !== 'undefined' && (window as any).strategicDopamine && user?.uid) {
        (window as any).strategicDopamine.triggerPageCreation();
      }
      
      // Switch to editor mode with new page
      setCurrentPage(createdPage);
      setViewMode('editor');
      
      // Refresh list
      await loadPages();
      
    } catch (error) {
      console.error('❌ Error creating page:', error);
      setError('Errore nella creazione della pagina');
    }
  };
  
  const handleSavePage = async (page: Page) => {
    if (!user?.uid) return;
    
    try {
      console.log('💾 Saving page:', page.id, page.title);
      await db.savePage(page);
      
      // Update current page state
      setCurrentPage(page);
      
      // Refresh list if in list view
      if (viewMode === 'list' || viewMode === 'grid') {
        await loadPages();
      }
    } catch (error) {
      console.error('❌ Error saving page:', error);
      setError('Errore nel salvataggio');
    }
  };
  
  const handleDeletePage = async (pageId: string) => {
    if (!user?.uid) return;
    
    if (!confirm('Sei sicuro di voler eliminare questa pagina?')) return;
    
    try {
      console.log('🗑️ Deleting page:', pageId);
      await db.deletePage(pageId);
      
      // If we're editing the deleted page, go back to list
      if (currentPage?.id === pageId) {
        setCurrentPage(null);
        setViewMode('list');
      }
      
      // Refresh list
      await loadPages();
    } catch (error) {
      console.error('❌ Error deleting page:', error);
      setError('Errore nell\'eliminazione');
    }
  };
  
  const handleDuplicatePage = async (page: Page) => {
    if (!user?.uid) return;
    
    try {
      const duplicatedData = {
        userId: user.uid,
        title: `${page.title} (Copy)`,
        icon: page.icon,
        cover: page.cover,
        blocks: page.blocks.map(block => ({ ...block })), // Simple copy
        tags: [...(page.tags || [])]
      };
      
      console.log('📋 Duplicating page:', page.title);
      const duplicated = await db.createPage(duplicatedData);
      
      await loadPages();
    } catch (error) {
      console.error('❌ Error duplicating page:', error);
      setError('Errore nella duplicazione');
    }
  };
  
  const handleRenamePage = async (pageId: string, newTitle: string) => {
    if (!user?.uid || !newTitle.trim()) return;
    
    try {
      console.log('✏️ Renaming page:', pageId, 'to:', newTitle);
      
      // Find the page
      const page = pages.find(p => p.id === pageId);
      if (!page) return;
      
      // Update the page
      const updatedPage = { 
        ...page, 
        title: newTitle.trim(), 
        updatedAt: new Date() 
      };
      
      await db.savePage(updatedPage);
      
      // Reset editing state
      setEditingPageId(null);
      setEditingTitle('');
      setOpenDropdownId(null);
      
      // Refresh list
      await loadPages();
    } catch (error) {
      console.error('❌ Error renaming page:', error);
      setError('Errore nella rinominazione');
    }
  };
  
  const startRenaming = (page: Page) => {
    setEditingPageId(page.id);
    setEditingTitle(page.title);
    setOpenDropdownId(null);
  };
  
  const cancelRenaming = () => {
    setEditingPageId(null);
    setEditingTitle('');
  };
  
  // ============================================================================
  // FILTERING & SEARCH
  // ============================================================================
  
  const getFilteredPages = useCallback(() => {
    let filtered = [...pages];
    
    // Apply filters
    switch (filterBy) {
      case 'templates':
        filtered = filtered.filter(p => p.isTemplate);
        break;
      case 'recent':
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        filtered = filtered.filter(p => new Date(p.updatedAt) >= weekAgo);
        break;
      case 'linked':
        filtered = filtered.filter(p => 
          p.linkedGoalIds?.length || p.linkedProjectIds?.length || p.linkedTaskIds?.length
        );
        break;
    }
    
    // Apply tag filter
    if (selectedTag) {
      filtered = filtered.filter(p => p.tags?.includes(selectedTag));
    }
    
    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(query) ||
        p.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'blocks':
          return b.blocksCount - a.blocksCount;
        case 'updated':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    
    return filtered;
  }, [pages, filterBy, selectedTag, searchQuery, sortBy]);
  
  const allTags = pages.reduce((tags, page) => {
    page.tags?.forEach(tag => tags.add(tag));
    return tags;
  }, new Set<string>());
  
  // ============================================================================
  // UI COMPONENTS
  // ============================================================================
  
  const PageCard = ({ page }: { page: PageWithStats }) => (
    <div className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-indigo-200 hover:bg-slate-50/50">
      <div className="flex items-start justify-between mb-3">
        <div 
          className="flex items-center gap-3 flex-1 cursor-pointer"
          onClick={() => { setCurrentPage(page); setViewMode('editor'); }}
        >
          <span className="text-2xl">{page.icon || '📝'}</span>
          <div className="flex-1">
            {editingPageId === page.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleRenamePage(page.id, editingTitle);
                    }
                    if (e.key === 'Escape') {
                      cancelRenaming();
                    }
                  }}
                  onBlur={() => handleRenamePage(page.id, editingTitle)}
                  autoFocus
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cancelRenaming();
                  }}
                  className="text-gray-400 hover:text-white"
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-slate-900 transition-colors group-hover:text-indigo-700">
                  {page.title}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span>{page.blocksCount} blocks</span>
                  <span>•</span>
                  <span>{page.wordsCount} words</span>
                  <span>•</span>
                  <span>{page.lastModified}</span>
                </div>
              </>
            )}
          </div>
        </div>
        
        <div className="relative">
          <button 
            className="p-1 hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setOpenDropdownId(openDropdownId === page.id ? null : page.id);
            }}
          >
            <MoreVertical className="w-4 h-4 text-gray-400" />
          </button>
          
          {/* Dropdown Menu */}
          {openDropdownId === page.id && (
            <div className="absolute right-0 top-8 z-20 w-48 rounded-lg border border-slate-200 bg-white shadow-xl">
              <div className="py-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRenaming(page);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 className="w-4 h-4" />
                  Rinomina
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDuplicatePage(page);
                    setOpenDropdownId(null);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="w-4 h-4" />
                  Duplica
                </button>
                <div className="my-1 border-t border-slate-200"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeletePage(page.id);
                    setOpenDropdownId(null);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-900/20 hover:text-red-300 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Elimina
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {page.tags && page.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {page.tags.map(tag => (
            <span 
              key={tag} 
              className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
      
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {page.isTemplate && (
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3" />
            Template
          </span>
        )}
        {(page.linkedGoalIds?.length || page.linkedProjectIds?.length || page.linkedTaskIds?.length) && (
          <span className="flex items-center gap-1">
            <Target className="w-3 h-3" />
            Linked
          </span>
        )}
      </div>
    </div>
  );
  
  // ============================================================================
  // RENDER
  // ============================================================================
  
  if (viewMode === 'editor' && currentPage) {
    return (
      <div className={`h-full w-full bg-white ${className}`}>
        {/* Editor Header */}
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => { setCurrentPage(null); setViewMode('list'); }}
              className="flex items-center gap-2 text-slate-600 transition-colors hover:text-indigo-700"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm">Torna alle pagine</span>
            </button>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Auto-save attivo</span>
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
          </div>
        </div>
        
        {/* Block Editor */}
        <div className="h-[calc(100vh-120px)] overflow-auto">
          <BlockEditor
            page={currentPage}
            userId={user?.uid || ''}
            onSave={handleSavePage}
            autoSave={true}
            autoSaveDelay={2000}
          />
        </div>
      </div>
    );
  }

  if (viewMode === 'notion') {
    return (
      <div className={`h-full w-full bg-white ${className}`}>
        {/* Notion Header */}
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center gap-2 text-slate-600 transition-colors hover:text-indigo-700"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm">Torna alle pagine</span>
            </button>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Cloud className="w-4 h-4" />
              <span>Notion Sync</span>
            </div>
          </div>
        </div>
        
        {/* Notion Sync Component */}
        <div className="h-[calc(100vh-120px)] overflow-auto p-4">
          <NotionSync />
        </div>
      </div>
    );
  }
  
  return (
    <div className={`h-full w-full bg-white ${className}`}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1440px] px-4 py-5">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="flex items-center gap-3 text-[28px] font-semibold tracking-[-0.02em] text-slate-950">
                <BookOpen className="h-6 w-6 text-indigo-600" /> <span>Second Brain</span>
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Le tue idee, note e conoscenze organizzate
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => setViewMode('notion')}
                className="lt-button-secondary px-4 text-indigo-700"
              >
                <Cloud className="w-5 h-5" />
                Notion
              </button>

              <button
                onClick={() => handleCreatePage('New Page')}
                className="lt-button-primary px-4"
              >
                <Plus className="w-5 h-5" />
                Nuova Pagina
              </button>
              
              <button
                onClick={() => handleCreatePage('New Template', true)}
                className="lt-button-secondary px-4"
              >
                <Star className="w-5 h-5" />
                Template
              </button>
            </div>
          </div>
          
          {/* Search & Filters */}
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cerca nelle pagine..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterBy)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
            >
              <option value="all">Tutte</option>
              <option value="recent">Recenti</option>
              <option value="templates">Template</option>
              <option value="linked">Collegate</option>
            </select>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800"
            >
              <option value="updated">Ultima modifica</option>
              <option value="created">Data creazione</option>
              <option value="title">Titolo</option>
              <option value="blocks">Numero blocchi</option>
            </select>
            
            <div className="flex items-center rounded-lg border border-slate-300 bg-white">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400 hover:text-slate-700'}`}
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400 hover:text-slate-700'}`}
              >
                <Grid className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Tags */}
      {allTags.size > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                selectedTag === null ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              Tutti
            </button>
            {Array.from(allTags).map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  selectedTag === tag ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Content */}
      <div className="mx-auto h-[calc(100vh-200px)] max-w-[1440px] overflow-auto px-4 pb-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-700 rounded-lg">
            <p className="text-red-400">{error}</p>
            <button 
              onClick={() => setError(null)}
              className="mt-2 text-red-300 hover:text-red-200 text-sm underline"
            >
              Chiudi
            </button>
          </div>
        )}
        
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-slate-500">Caricamento…</div>
          </div>
        ) : getFilteredPages().length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="mx-auto mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-semibold text-slate-800">
              {searchQuery || selectedTag ? 'Nessun risultato' : 'Nessuna pagina'}
            </h3>
            <p className="mb-6 text-sm text-slate-500">
              {searchQuery || selectedTag 
                ? 'Prova a modificare i filtri di ricerca'
                : 'Inizia creando la tua prima pagina'
              }
            </p>
            {!searchQuery && !selectedTag && (
              <button
                onClick={() => handleCreatePage('My First Page')}
                className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
              >
                Crea la prima pagina
              </button>
            )}
          </div>
        ) : (
          <div className={
            viewMode === 'grid' 
              ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" 
              : "space-y-4"
          }>
            {getFilteredPages().map(page => (
              <PageCard key={page.id} page={page} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
