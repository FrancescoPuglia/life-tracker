import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock IndexedDB for Node test environment (database.ts uses it)
if (typeof indexedDB === 'undefined') {
  global.indexedDB = {} as any;
}

// Mock localStorage
if (typeof localStorage === 'undefined') {
  global.localStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn()
  } as any;
}

// Mock sessionStorage
if (typeof sessionStorage === 'undefined') {
  global.sessionStorage = {
    getItem: vi.fn(() => null), // Return null by default
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn()
  } as any;
}

// Mock Firebase
vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: null },
  firestore: {},
  storage: {},
}));

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Suppress console errors in tests (cleaner output)
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
};
