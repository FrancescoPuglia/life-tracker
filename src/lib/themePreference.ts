export const LIFE_TRACKER_THEME_EVENT = 'life-tracker:theme-preference' as const;
export const LIFE_TRACKER_THEME_STORAGE_KEY = 'life-tracker.appearance.v1' as const;

export type LifeTrackerThemeMode = 'system' | 'light' | 'dark';
export type ResolvedLifeTrackerTheme = 'light' | 'dark';

export interface LifeTrackerAppearancePreference {
  readonly mode: LifeTrackerThemeMode;
  readonly reducedMotion: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_APPEARANCE_PREFERENCE: LifeTrackerAppearancePreference = Object.freeze({
  mode: 'system',
  reducedMotion: false,
});

export function normalizeAppearancePreference(value: unknown): LifeTrackerAppearancePreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid appearance preference.');
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(',') !== 'mode,reducedMotion') throw new Error('Invalid appearance preference.');
  if (!['system', 'light', 'dark'].includes(String(source.mode))) {
    throw new Error('Invalid theme mode.');
  }
  if (typeof source.reducedMotion !== 'boolean') throw new Error('Invalid motion preference.');
  return Object.freeze({
    mode: source.mode as LifeTrackerThemeMode,
    reducedMotion: source.reducedMotion,
  });
}

export function loadAppearancePreference(
  storage: StorageLike | null = browserStorage(),
): LifeTrackerAppearancePreference {
  try {
    const raw = storage?.getItem(LIFE_TRACKER_THEME_STORAGE_KEY);
    return raw ? normalizeAppearancePreference(JSON.parse(raw)) : DEFAULT_APPEARANCE_PREFERENCE;
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCE;
  }
}

export function resolveThemeMode(
  mode: LifeTrackerThemeMode,
  systemDark = browserSystemDark(),
): ResolvedLifeTrackerTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

export function applyAppearancePreference(
  preference: LifeTrackerAppearancePreference,
  options: { readonly persist?: boolean; readonly notify?: boolean } = {},
): LifeTrackerAppearancePreference {
  const normalized = normalizeAppearancePreference(preference);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolveThemeMode(normalized.mode);
    document.documentElement.dataset.themeMode = normalized.mode;
    document.documentElement.dataset.reducedMotion = String(normalized.reducedMotion);
  }
  if (options.persist !== false) browserStorage()?.setItem(
    LIFE_TRACKER_THEME_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  if (options.notify !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LIFE_TRACKER_THEME_EVENT, { detail: normalized }));
  }
  return normalized;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function browserSystemDark(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}
