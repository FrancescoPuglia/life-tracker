'use client';

// 🔗 NOTION SYNC COMPONENT
// Interfaccia per la sincronizzazione con Notion

import React, { useState, useEffect } from 'react';
import { 
  Cloud, Download, Upload, Settings, CheckCircle, 
  AlertTriangle, Loader, ExternalLink, Key, Database
} from 'lucide-react';
import { NotionSyncService } from '@/lib/notionApi';
import { useAuthContext } from '@/providers/AuthProvider';
import { db } from '@/lib/database';

interface NotionSyncProps {
  className?: string;
}

interface SyncStats {
  totalPages: number;
  lastSync: Date | null;
  syncedPages: number;
  pendingPages: number;
}

interface SyncResult {
  success: boolean;
  imported: number;
  exported: number;
  errors: string[];
}

export default function NotionSync({ className = '' }: NotionSyncProps) {
  const { user } = useAuthContext();
  
  // State
  const [notionToken, setNotionToken] = useState('');
  const [databaseId, setDatabaseId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStats, setSyncStats] = useState<SyncStats>({
    totalPages: 0,
    lastSync: null,
    syncedPages: 0,
    pendingPages: 0
  });
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Load saved configuration
  useEffect(() => {
    loadNotionConfig();
  }, []);

  const loadNotionConfig = async () => {
    try {
      const saved = localStorage.getItem('notion_config');
      if (saved) {
        const config = JSON.parse(saved);
        setNotionToken(config.token || '');
        setDatabaseId(config.databaseId || '');
        setIsConnected(config.connected || false);
      }
    } catch (error) {
      console.error('Error loading Notion config:', error);
    }
  };

  const saveNotionConfig = async (token: string, dbId: string, connected: boolean) => {
    try {
      const config = { token, databaseId: dbId, connected };
      localStorage.setItem('notion_config', JSON.stringify(config));
      setIsConnected(connected);
    } catch (error) {
      console.error('Error saving Notion config:', error);
    }
  };

  // Test Notion connection
  const testConnection = async () => {
    setIsLoading(true);
    
    try {
      console.log('🧪 NOTION: Testing connection...');
      
      // Usa la nuova API proxy corretta
      const response = await fetch('/api/notion/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' })
      });
      
      const result = await response.json();
      console.log('🧪 NOTION: Test result:', result);
      
      if (result.success) {
        await saveNotionConfig('server-configured', '', true);
        alert('✅ Connessione a Notion riuscita!');
        setShowConfig(false);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('❌ NOTION: Connection test failed:', error);
      alert(`❌ Connessione fallita: ${error}`);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Sync all pages to Notion
  const syncToNotion = async () => {
    if (!isConnected || !user?.uid) return;

    setIsSyncing(true);
    const errors: string[] = [];
    let exported = 0;

    try {
      console.log('📤 NOTION: Starting sync to Notion...');
      
      // Get all pages from Life Tracker
      const pages = await db.getPages(user.uid);
      console.log(`📚 NOTION: Found ${pages.length} pages to sync`);
      
      for (const page of pages) {
        try {
          console.log(`📄 NOTION: Syncing page "${page.title}"`);
          
          // Usa la nuova API proxy
          const response = await fetch('/api/notion/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              action: 'create_page',
              data: {
                title: page.title,
                blocks: page.blocks, // Converti se necessario
                parent_page_id: process.env.NEXT_PUBLIC_NOTION_PARENT_PAGE // Configurabile
              }
            })
          });
          
          const result = await response.json();
          
          if (result.success) {
            console.log(`✅ NOTION: Page "${page.title}" synced successfully`);
            exported++;
          } else {
            throw new Error(result.error);
          }
        } catch (error) {
          console.error(`❌ NOTION: Error syncing page "${page.title}":`, error);
          errors.push(`Error syncing page "${page.title}": ${error}`);
        }
      }

      const result: SyncResult = {
        success: errors.length === 0,
        imported: 0,
        exported,
        errors
      };

      setLastSyncResult(result);
      setSyncStats(prev => ({
        ...prev,
        lastSync: new Date(),
        syncedPages: exported
      }));

      console.log('📊 NOTION: Sync completed:', result);

      if (result.success) {
        alert(`✅ ${exported} pagine sincronizzate con Notion`);
      } else {
        alert(`⚠️ Sincronizzazione completata con ${errors.length} errori`);
      }

    } catch (error) {
      console.error('❌ NOTION: Sync to Notion failed:', error);
      alert('❌ Errore durante la sincronizzazione');
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync from Notion
  const syncFromNotion = async () => {
    if (!isConnected) return;

    alert('📥 Importazione da Notion non ancora implementata');
    // TODO: Implement import from Notion database
  };

  // Disconnect from Notion
  const disconnect = async () => {
    localStorage.removeItem('notion_config');
    setNotionToken('');
    setDatabaseId('');
    setIsConnected(false);
    setShowConfig(false);
  };

  return (
    <div className={`notion-sync ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Cloud className="w-8 h-8 text-purple-400" />
          <div>
            <h3 className="text-xl font-bold text-white">Notion Sync</h3>
            <p className="text-gray-400 text-sm">
              Sincronizza le tue note con Notion
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-5 h-5" />
              <span className="text-sm">Connesso</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-sm">Non connesso</span>
            </div>
          )}

          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
          >
            <Settings className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      {showConfig && (
        <div className="mb-6 p-4 bg-gray-800/50 border border-gray-700 rounded-lg">
          <h4 className="font-bold text-white mb-4">⚙️ Configurazione Notion</h4>
          
          <div className="space-y-4">
            {/* Integration Token */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <Key className="w-4 h-4 inline mr-1" />
                Integration Token
              </label>
              <input
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                placeholder="secret_xxxxxxxxxxxxx"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded 
                         text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Crea un'integrazione su <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener" className="text-purple-400 hover:underline">notion.so/my-integrations</a>
              </p>
            </div>

            {/* Database ID */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                <Database className="w-4 h-4 inline mr-1" />
                Database ID (opzionale)
              </label>
              <input
                type="text"
                value={databaseId}
                onChange={(e) => setDatabaseId(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded 
                         text-white placeholder-gray-400 focus:outline-none focus:border-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                ID del database dove sincronizzare (lascia vuoto per creare nuove pagine)
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={testConnection}
                disabled={isLoading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 
                         text-white rounded transition-colors flex items-center gap-2"
              >
                {isLoading ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Testa Connessione
              </button>

              {isConnected && (
                <button
                  onClick={disconnect}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                >
                  Disconnetti
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sync Actions */}
      {isConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Export to Notion */}
          <button
            onClick={syncToNotion}
            disabled={isSyncing || !isConnected}
            className="p-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 
                     disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors
                     flex items-center justify-center gap-3"
          >
            {isSyncing ? (
              <Loader className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
            <div>
              <div className="font-medium">Esporta su Notion</div>
              <div className="text-sm opacity-80">Sincronizza le tue pagine</div>
            </div>
          </button>

          {/* Import from Notion */}
          <button
            onClick={syncFromNotion}
            disabled={isSyncing || !isConnected}
            className="p-4 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 
                     disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors
                     flex items-center justify-center gap-3"
          >
            <Download className="w-5 h-5" />
            <div>
              <div className="font-medium">Importa da Notion</div>
              <div className="text-sm opacity-80">Carica pagine esistenti</div>
            </div>
          </button>
        </div>
      )}

      {/* Sync Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-3 bg-gray-800/30 rounded-lg text-center">
          <div className="text-2xl font-bold text-cyan-400">{syncStats.totalPages}</div>
          <div className="text-xs text-gray-400">Pagine Totali</div>
        </div>
        <div className="p-3 bg-gray-800/30 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-400">{syncStats.syncedPages}</div>
          <div className="text-xs text-gray-400">Sincronizzate</div>
        </div>
        <div className="p-3 bg-gray-800/30 rounded-lg text-center">
          <div className="text-2xl font-bold text-yellow-400">{syncStats.pendingPages}</div>
          <div className="text-xs text-gray-400">In Attesa</div>
        </div>
        <div className="p-3 bg-gray-800/30 rounded-lg text-center">
          <div className="text-sm text-gray-300">
            {syncStats.lastSync ? syncStats.lastSync.toLocaleDateString('it-IT') : 'Mai'}
          </div>
          <div className="text-xs text-gray-400">Ultima Sync</div>
        </div>
      </div>

      {/* Last Sync Result */}
      {lastSyncResult && (
        <div className={`p-4 rounded-lg border ${
          lastSyncResult.success 
            ? 'bg-green-900/20 border-green-500' 
            : 'bg-red-900/20 border-red-500'
        }`}>
          <h5 className={`font-medium mb-2 ${
            lastSyncResult.success ? 'text-green-400' : 'text-red-400'
          }`}>
            {lastSyncResult.success ? '✅ Sincronizzazione Completata' : '⚠️ Sincronizzazione con Errori'}
          </h5>
          
          <div className="text-sm text-gray-300">
            <div>📤 Esportate: {lastSyncResult.exported} pagine</div>
            <div>📥 Importate: {lastSyncResult.imported} pagine</div>
            {lastSyncResult.errors.length > 0 && (
              <div className="mt-2">
                <div className="text-red-400">Errori:</div>
                {lastSyncResult.errors.map((error, index) => (
                  <div key={index} className="text-xs text-red-300">• {error}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Help Section */}
      {!isConnected && (
        <div className="mt-6 p-4 bg-blue-900/20 border border-blue-500 rounded-lg">
          <h5 className="font-medium text-blue-400 mb-2">🚀 Come configurare Notion</h5>
          <ol className="text-sm text-gray-300 space-y-1">
            <li>1. Vai su <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener" className="text-blue-400 hover:underline">notion.so/my-integrations</a></li>
            <li>2. Clicca "New integration" e dai un nome</li>
            <li>3. Copia l'Integration Token</li>
            <li>4. Condividi il database/pagina Notion con l'integrazione</li>
            <li>5. Incolla il token qui e testa la connessione</li>
          </ol>
        </div>
      )}
    </div>
  );
}