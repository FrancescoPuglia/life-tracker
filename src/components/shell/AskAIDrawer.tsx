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
//   GitHub Pages can use AI when an external authenticated backend is
//   configured at build time. The browser never receives provider secrets.

import { useEffect, useRef, type ReactNode } from 'react';
import { isAIBackendConfigured } from '@/lib/ai/client';

export interface AskAIDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Override configuration detection in focused component tests. */
  backendConfigured?: boolean;
  children?: ReactNode;
}

export default function AskAIDrawer({
  open,
  onClose,
  backendConfigured,
  children,
}: AskAIDrawerProps) {
  const configured = backendConfigured ?? isAIBackendConfigured();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Keep the dialog keyboard-contained and return focus to its invoker.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        e.preventDefault();
        closeBtnRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open, onClose]);

  return (
    <div
      data-testid={open ? 'ai-drawer' : undefined}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? true : undefined}
      aria-label={open ? 'Ask AI' : undefined}
      aria-hidden={open ? undefined : true}
      hidden={!open}
      className="fixed inset-0 z-[70]"
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        data-testid="ai-drawer-backdrop"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] cursor-default"
      />

      {/* Panel */}
      <aside
        ref={panelRef}
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
          {configured ? children ?? <NoChildrenFallback /> : <BackendConfigurationNotice />}
        </div>

        <footer className="px-5 py-3 border-t border-gray-100 text-[10px] text-gray-400">
          Firebase authentication is verified by the backend. Provider
          secrets never enter this client.
        </footer>
      </aside>
    </div>
  );
}

function BackendConfigurationNotice() {
  return (
    <div
      data-testid="ai-drawer-configuration-notice"
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900"
    >
      <p className="font-semibold">AI backend is not configured.</p>
      <p className="mt-1 text-amber-800">
        This static app needs the URL of a separate authenticated backend.
        No request will be sent until it is configured.
      </p>
      <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-amber-800">
        <li>Set <code className="font-mono">NEXT_PUBLIC_AI_API_BASE_URL</code> during the frontend build.</li>
        <li>Allow this frontend origin in the backend CORS allowlist.</li>
        <li>Keep all provider keys and administrative credentials server-side.</li>
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
