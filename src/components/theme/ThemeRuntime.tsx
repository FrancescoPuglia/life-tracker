'use client';

import { useEffect } from 'react';
import {
  LIFE_TRACKER_THEME_EVENT,
  applyAppearancePreference,
  loadAppearancePreference,
  normalizeAppearancePreference,
} from '@/lib/themePreference';

export default function ThemeRuntime() {
  useEffect(() => {
    const applyCurrent = () => applyAppearancePreference(loadAppearancePreference(), {
      persist: false,
      notify: false,
    });
    applyCurrent();

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemTheme = () => {
      if (loadAppearancePreference().mode === 'system') applyCurrent();
    };
    const onPreference = (event: Event) => {
      try {
        applyAppearancePreference(normalizeAppearancePreference(
          (event as CustomEvent<unknown>).detail,
        ), { persist: false, notify: false });
      } catch {
        applyCurrent();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'life-tracker.appearance.v1') applyCurrent();
    };
    media.addEventListener('change', onSystemTheme);
    window.addEventListener(LIFE_TRACKER_THEME_EVENT, onPreference);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onSystemTheme);
      window.removeEventListener(LIFE_TRACKER_THEME_EVENT, onPreference);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return null;
}
