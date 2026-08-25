import { describe, expect, it } from 'vitest';
import {
  DESKTOP_REMINDER_LOCAL_STORAGE_KEY,
  PersistentDesktopReminderLocalStore,
  type KeyValueStorage,
} from './reminderLocalStore';

const UID = 'owner-1';
const JOB_ID = 'a'.repeat(64);
const ATTEMPT_ID = 'b'.repeat(64);

describe('Desktop reminder local duplicate journal', () => {
  it('survives restart and scopes duplicate state to the signed-in owner', () => {
    const storage = new MemoryStorage();
    const now = () => new Date('2026-08-25T09:00:00.000Z');
    const first = new PersistentDesktopReminderLocalStore(storage, now);
    first.mark({
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      consumedAt: now().toISOString(),
    });

    const restarted = new PersistentDesktopReminderLocalStore(storage, now);
    expect(restarted.has(UID, JOB_ID)).toBe(true);
    expect(restarted.has('owner-2', JOB_ID)).toBe(false);
  });

  it('ignores corrupt persisted content and retains server-backed safety', () => {
    const storage = new MemoryStorage();
    storage.setItem(DESKTOP_REMINDER_LOCAL_STORAGE_KEY, '{not-json');
    const store = new PersistentDesktopReminderLocalStore(storage);

    expect(store.has(UID, JOB_ID)).toBe(false);
  });

  it('keeps an in-memory fallback when browser storage throws', () => {
    const storage: KeyValueStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    };
    const store = new PersistentDesktopReminderLocalStore(storage);
    store.mark({
      uid: UID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      consumedAt: new Date().toISOString(),
    });

    expect(store.has(UID, JOB_ID)).toBe(true);
  });
});

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
