import { describe, expect, it } from 'vitest';
import {
  defaultNotificationPreferences,
  normalizeEditableNotificationPreferences,
} from './preferences';

describe('notification preference client contract', () => {
  it('uses the product timezone and disabled channel defaults', () => {
    expect(defaultNotificationPreferences()).toMatchObject({
      timezone: 'Europe/Rome',
      desktopEnabled: false,
      whatsappEnabled: false,
      emailEnabled: false,
      reminderOffsetsMinutes: [15],
    });
  });

  it('normalizes deterministic offset order without changing provider states', () => {
    const normalized = normalizeEditableNotificationPreferences({
      ...defaultNotificationPreferences(),
      desktopEnabled: true,
      reminderOffsetsMinutes: [5, 60, 15],
    });
    expect(normalized.reminderOffsetsMinutes).toEqual([60, 15, 5]);
    expect(normalized.whatsappEnabled).toBe(false);
    expect(normalized.emailEnabled).toBe(false);
  });

  it('rejects invalid timezones, duplicate offsets, and unsafe bounds', () => {
    expect(() => normalizeEditableNotificationPreferences({
      ...defaultNotificationPreferences(),
      timezone: 'Not/AZone',
    })).toThrow(/Timezone/);
    expect(() => normalizeEditableNotificationPreferences({
      ...defaultNotificationPreferences(),
      reminderOffsetsMinutes: [15, 15],
    })).toThrow(/offsets/);
    expect(() => normalizeEditableNotificationPreferences({
      ...defaultNotificationPreferences(),
      maxRemindersPerBlock: 9,
    })).toThrow(/Maximum/);
  });
});
