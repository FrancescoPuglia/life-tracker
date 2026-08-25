export const DESKTOP_REMINDER_LOCAL_STORAGE_KEY =
  'life-tracker.desktop-reminder-consumption.v1';

const MAX_LOCAL_RECORDS = 256;
const LOCAL_RETENTION_MS = 45 * 24 * 60 * 60_000;

export interface DesktopReminderConsumption {
  readonly uid: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly consumedAt: string;
}

export interface DesktopReminderLocalStore {
  has(uid: string, jobId: string): boolean;
  mark(record: DesktopReminderConsumption): void;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Server idempotency is authoritative; this bounded local journal protects restart races. */
export class PersistentDesktopReminderLocalStore implements DesktopReminderLocalStore {
  private readonly memory = new Map<string, DesktopReminderConsumption>();

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.load();
  }

  has(uid: string, jobId: string): boolean {
    assertIdentity(uid, 'Desktop reminder owner');
    assertHash(jobId, 'Desktop reminder job');
    this.prune();
    return this.memory.has(key(uid, jobId));
  }

  mark(record: DesktopReminderConsumption): void {
    const normalized = normalizeRecord(record);
    this.memory.set(key(normalized.uid, normalized.jobId), normalized);
    this.prune();
    this.persist();
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(DESKTOP_REMINDER_LOCAL_STORAGE_KEY);
      if (!raw || raw.length > 128_000) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > MAX_LOCAL_RECORDS) return;
      for (const value of parsed) {
        try {
          const record = normalizeRecord(value);
          this.memory.set(key(record.uid, record.jobId), record);
        } catch {
          // One corrupt local record never grants authority or blocks valid records.
        }
      }
      this.prune();
    } catch {
      // Native delivery remains protected by server idempotency if storage is unavailable.
    }
  }

  private prune(): void {
    const nowMs = this.now().getTime();
    if (!Number.isFinite(nowMs)) return;
    const records = [...this.memory.values()]
      .filter((record) => nowMs - Date.parse(record.consumedAt) <= LOCAL_RETENTION_MS)
      .sort((left, right) => Date.parse(right.consumedAt) - Date.parse(left.consumedAt))
      .slice(0, MAX_LOCAL_RECORDS);
    this.memory.clear();
    for (const record of records) this.memory.set(key(record.uid, record.jobId), record);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        DESKTOP_REMINDER_LOCAL_STORAGE_KEY,
        JSON.stringify([...this.memory.values()]),
      );
    } catch {
      // The in-memory fallback remains active for this process.
    }
  }
}

export function browserDesktopReminderLocalStore(): PersistentDesktopReminderLocalStore {
  let storage: KeyValueStorage | null = null;
  try {
    storage = typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    storage = null;
  }
  return new PersistentDesktopReminderLocalStore(storage);
}

function normalizeRecord(value: unknown): DesktopReminderConsumption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Desktop reminder local record is invalid.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).sort().join(',') !== 'attemptId,consumedAt,jobId,uid') {
    throw new Error('Desktop reminder local record is invalid.');
  }
  const consumedAt = instant(source.consumedAt);
  return Object.freeze({
    uid: identity(source.uid, 'Desktop reminder owner'),
    jobId: hash(source.jobId, 'Desktop reminder job'),
    attemptId: hash(source.attemptId, 'Desktop reminder attempt'),
    consumedAt,
  });
}

function key(uid: string, jobId: string): string {
  return `${uid}\u0000${jobId}`;
}

function identity(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  assertIdentity(value, label);
  return value;
}

function assertIdentity(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  assertHash(value, label);
  return value;
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function instant(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Desktop reminder local time is invalid.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Desktop reminder local time is invalid.');
  }
  return date.toISOString();
}
