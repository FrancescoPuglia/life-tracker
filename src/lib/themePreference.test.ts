import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE_PREFERENCE,
  LIFE_TRACKER_THEME_STORAGE_KEY,
  loadAppearancePreference,
  normalizeAppearancePreference,
  resolveThemeMode,
} from './themePreference';

describe('global appearance preference', () => {
  it('defaults to system and resolves every supported mode deterministically', () => {
    expect(DEFAULT_APPEARANCE_PREFERENCE).toEqual({ mode: 'system', reducedMotion: false });
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
    expect(resolveThemeMode('light', true)).toBe('light');
  });

  it('fails safely on malformed or expanded local data', () => {
    const storage = new MemoryStorage();
    storage.setItem(LIFE_TRACKER_THEME_STORAGE_KEY, JSON.stringify({
      mode: 'dark', reducedMotion: true, token: 'not-allowed',
    }));
    expect(loadAppearancePreference(storage)).toBe(DEFAULT_APPEARANCE_PREFERENCE);
    expect(() => normalizeAppearancePreference({ mode: 'neon', reducedMotion: false })).toThrow();
  });

  it('loads a validated offline preference', () => {
    const storage = new MemoryStorage();
    storage.setItem(LIFE_TRACKER_THEME_STORAGE_KEY, JSON.stringify({ mode: 'dark', reducedMotion: true }));
    expect(loadAppearancePreference(storage)).toEqual({ mode: 'dark', reducedMotion: true });
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
