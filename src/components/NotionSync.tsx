'use client';

import { CloudOff, ShieldCheck } from 'lucide-react';

interface NotionSyncProps {
  className?: string;
}

/**
 * The GitHub Pages application has no trusted same-origin server runtime.
 * Notion synchronization therefore stays visibly disabled until it can be
 * implemented behind the authenticated Functions/domain boundary.
 */
export default function NotionSync({ className = '' }: NotionSyncProps) {
  return (
    <section
      className={`notion-sync rounded-xl border border-amber-300/30 bg-amber-950/20 p-5 ${className}`}
      aria-labelledby="notion-sync-title"
    >
      <div className="flex items-start gap-3">
        <CloudOff className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" aria-hidden="true" />
        <div>
          <h3 id="notion-sync-title" className="text-lg font-semibold text-white">
            Notion Sync non disponibile
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-gray-300">
            Questa installazione statica non invia token o contenuti a un proxy Next.js.
            La sincronizzazione sarà riattivata solo tramite un backend autenticato e
            autorizzato per il tuo account.
          </p>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber-200">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Nessuna credenziale Notion viene richiesta o salvata nel browser.
          </p>
        </div>
      </div>
    </section>
  );
}
