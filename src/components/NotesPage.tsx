'use client';

// 🧠 NOTES PAGE - Second Brain Interface
// Integrazione completa del Notion Editor con Life Tracker

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, Search, Filter, Grid, List, Calendar, 
  ArrowLeft, MoreVertical, Trash2, Copy,
  BookOpen, Target, Briefcase, CheckSquare,
  Tag, Clock, Star, Eye, Edit3
} from 'lucide-react';
import { BlockEditor } from '@/components/blocks';
import { Page, createPage, createBlock } from '@/types/blocks';
import { db } from '@/lib/database';
import { useAuthContext } from '@/providers/AuthProvider';

// ============================================================================
// TYPES
// ============================================================================

interface NotesPageProps {
  className?: string;
}

type ViewMode = 'list' | 'grid' | 'editor';
type SortBy = 'updated' | 'created' | 'title' | 'blocks';
type FilterBy = 'all' | 'templates' | 'recent' | 'linked';

interface PageWithStats extends Page {
  blocksCount: number;
  wordsCount: number;
  lastModified: string;
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
        
        const lastModified = new Date(page.updatedAt).toLocaleDateString('it-IT', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        
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
    <div className="group p-4 bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-xl transition-all">
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
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-cyan-500"
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
                <h3 className="font-medium text-white group-hover:text-cyan-400 transition-colors">
                  {page.title}
                </h3>
                <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
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
            <div className="absolute right-0 top-8 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20">
              <div className="py-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startRenaming(page);
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2"
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
                  className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Duplica
                </button>
                <div className="border-t border-gray-700 my-1"></div>
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
              className="px-2 py-1 bg-gray-700/50 text-gray-300 text-xs rounded"
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
      <div className={`w-full h-full bg-gray-950 ${className}`}>
        {/* Editor Header */}
        <div className="sticky top-0 z-20 bg-gray-950/80 backdrop-blur-sm border-b border-gray-800">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => { setCurrentPage(null); setViewMode('list'); }}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm">Torna alle pagine</span>
            </button>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Auto-save attivo</span>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
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
  
  return (
    <div className={`w-full h-full bg-gray-950 ${className}`}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/80 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                🧠 <span>Second Brain</span>
              </h1>
              <p className="text-gray-400 mt-1">
                Le tue idee, note e conoscenze organizzate
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleCreatePage('New Page')}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 
                         text-white rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
                Nuova Pagina
              </button>
              
              <button
                onClick={() => handleCreatePage('New Template', true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 
                         text-white rounded-lg transition-colors"
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
                className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg 
                         text-white placeholder-gray-400 focus:outline-none focus:border-cyan-500"
              />
            </div>
            
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as FilterBy)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              <option value="all">Tutte</option>
              <option value="recent">Recenti</option>
              <option value="templates">Template</option>
              <option value="linked">Collegate</option>
            </select>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              <option value="updated">Ultima modifica</option>
              <option value="created">Data creazione</option>
              <option value="title">Titolo</option>
              <option value="blocks">Numero blocchi</option>
            </select>
            
            <div className="flex items-center border border-gray-700 rounded-lg">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                <List className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
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
                selectedTag === null ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-300 hover:text-white'
              }`}
            >
              Tutti
            </button>
            {Array.from(allTags).map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  selectedTag === tag ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-300 hover:text-white'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 pb-8 h-[calc(100vh-200px)] overflow-auto">
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
            <div className="text-gray-400">Caricamento...</div>
          </div>
        ) : getFilteredPages().length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl text-gray-400 mb-2">
              {searchQuery || selectedTag ? 'Nessun risultato' : 'Nessuna pagina'}
            </h3>
            <p className="text-gray-500 mb-6">
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