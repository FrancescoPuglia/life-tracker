'use client';

// src/components/shell/AskAIDrawer.tsx
// Slide-in right drawer that wraps the existing AI input experience.
//
// Why a drawer:
//   The AI Assistant used to live as a giant permanent card in the left
//   sidebar. It overweighted the navigation, pushed the rest of the menu
//   off-screen, and was always present even when the user wasn't asking
//   anything. As a drawer it stays out of the way until summoned via the
//   "Ask AI" button in the top bar.
//
// Static-export awareness:
//   AI features rely on the Next.js `/api/ai/chat` route handler. When the
//   app is exported statically (e.g. GitHub Pages), API routes don't run
//   and the request will 404. The drawer detects this and shows a clear
//   message explaining the situation instead of letting the user wait on
//   a request that will never resolve.

import { useEffect, useRef, type ReactNode } from 'react';

export interface AskAIDrawerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Force the drawer into "static deployment" mode (useful for tests and
   * for an explicit visual override). When unset, the drawer falls back to
   * `isStaticDeployment()` which is best-effort.
   */
  isStatic?: boolean;
  children?: ReactNode;
}

/**
 * Detect static deployment. The bundled Next.js config uses
 * `output: 'export'` for the GitHub Pages target, which means API routes
 * are not available at runtime. We expose this through a public env var so
 * the drawer can render an honest fallback instead of looking broken.
 *
 * Detection order (cheap, no network):
 *   1. `NEXT_PUBLIC_STATIC_EXPORT === '1'` (set in CI for GH Pages builds).
 *   2. Hostname ends with `github.io`.
 *   3. Default: false (assume server / dev).
 */
export function isStaticDeployment(): boolean {
  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NEXT_PUBLIC_STATIC_EXPORT === '1'
  ) {
    return true;
  }
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname ?? '';
    if (host.endsWith('github.io')) return true;
  }
  return false;
}

export default function AskAIDrawer({
  open,
  onClose,
  isStatic,
  children,
}: AskAIDrawerProps) {
  const staticMode = isStatic ?? isStaticDeployment();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Close on Escape — common drawer convention.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus the close button when opened so keyboard users have an anchor.
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="ai-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Ask AI"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close AI drawer"
        onClick={onClose}
        data-testid="ai-drawer-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] cursor-default"
      />

      {/* Panel */}
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-[420px] bg-white shadow-2xl flex flex-col border-l border-gray-200"
        data-testid="ai-drawer-panel"
      >
        <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-blue-700">
              Ask AI
            </p>
            <h3 className="mt-0.5 text-base font-semibold text-gray-900">
              AI Assistant
            </h3>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            data-testid="ai-drawer-close"
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {staticMode ? <StaticDeploymentNotice /> : children ?? <NoChildrenFallback />}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 text-[10px] text-gray-400">
          AI never reads or writes secrets in this client. All processing
          happens on the server.
        </footer>
      </aside>
    </div>
  );
}

function StaticDeploymentNotice() {
  return (
    <div
      data-testid="ai-drawer-static-notice"
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900"
    >
      <p className="font-semibold">AI is unavailable on this deployment.</p>
      <p className="mt-1 text-amber-800">
        AI works in local and server deployments. GitHub Pages serves a
        static export, which cannot run Next.js API routes.
      </p>
      <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-amber-800">
        <li>Run <code className="font-mono">npm run dev</code> locally to use AI features.</li>
        <li>Deploy on Vercel / Fly / a Node host to enable the API route.</li>
        <li>This is a deployment limitation — no secrets are ever placed in the client.</li>
      </ul>
    </div>
  );
}

function NoChildrenFallback() {
  return (
    <div className="text-sm text-gray-500">
      <p>Nothing to render — pass the AI input component as the drawer&rsquo;s child.</p>
    </div>
  );
}
