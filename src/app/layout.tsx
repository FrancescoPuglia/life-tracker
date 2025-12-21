import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// 🔥 FIX: Use system fonts instead of Google Fonts to avoid network dependency in dev
const systemFont = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

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
  themeColor: '#3b82f6',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="./favicon.ico" />
        <link rel="apple-touch-icon" href="./icon-192x192.png" />
        <link rel="manifest" href="./manifest.json" />
      </head>
      <body className="antialiased" style={{ fontFamily: systemFont }}>
        <ErrorBoundary>
          <div id="root" className="min-h-screen bg-gray-50">
            {children}
          </div>
        </ErrorBoundary>
      </body>
    </html>
  )
}
