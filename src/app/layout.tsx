import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { BUILD_ID } from '@/lib/buildInfo'
import { AI_BACKEND_BUILD_ID } from '@/lib/ai/backendConfig'
import { DEPLOYMENT_ENVIRONMENT, RUNTIME_TARGET } from '@/lib/runtimeEnvironment'
import ThemeRuntime from '@/components/theme/ThemeRuntime'

const systemFont = '"Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif'

export const metadata: Metadata = {
  title: 'Life Tracker - Know Every Second What To Do',
  description: 'A comprehensive life tracking system with real-time timeboxing, habit tracking, OKR management, and analytics.',
  keywords: 'life tracking, productivity, time management, habits, goals, OKR, analytics',
  authors: [{ name: 'Life Tracker' }],
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#4f46e5',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" suppressHydrationWarning>
      <head>
        <link rel="icon" href="./favicon.ico" />
        <link rel="apple-touch-icon" href="./icon-192x192.png" />
        <link rel="manifest" href="./manifest.json" />
      </head>
      <body
        className="antialiased"
        data-life-tracker-build={BUILD_ID}
        data-life-tracker-ai-backend={AI_BACKEND_BUILD_ID}
        data-life-tracker-environment={DEPLOYMENT_ENVIRONMENT}
        data-life-tracker-runtime={RUNTIME_TARGET}
        style={{ fontFamily: systemFont }}
      >
        <ThemeRuntime />
        <ErrorBoundary>
          <div id="root" className="min-h-screen bg-gray-50">
            {children}
          </div>
        </ErrorBoundary>
      </body>
    </html>
  )
}
