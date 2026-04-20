import { describe, it, expect, beforeEach } from 'vitest';
import { toDateSafe } from './dateUtils';

describe('dateUtils', () => {
  describe('toDateSafe', () => {
    it('should return Date objects unchanged', () => {
      const date = new Date('2026-01-11T10:00:00Z');
      const result = toDateSafe(date);
      expect(result).toEqual(date);
      expect(result.getTime()).toBe(date.getTime());
    });

    it('should parse ISO string dates', () => {
      const result = toDateSafe('2026-01-11T10:00:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCHours()).toBe(10);
      expect(result.getUTCDate()).toBe(11);
      expect(result.getUTCMonth()).toBe(0); // January = 0
    });

    it('should parse Firestore Timestamp objects', () => {
      const timestamp = {
        toDate: () => new Date('2026-01-11T10:00:00Z'),
        seconds: 1736590800,
        nanoseconds: 0,
      };
      const result = toDateSafe(timestamp);
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCHours()).toBe(10);
    });

    it('should handle time-only strings with reference date', () => {
      const ref = new Date('2026-01-11T00:00:00Z');
      const result = toDateSafe('14:30', ref);

      expect(result).toBeInstanceOf(Date);
      // Implementation uses local time (setHours), so test with local getters
      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(30);
      expect(result.getDate()).toBe(ref.getDate()); // Same day as reference
    });

    it('should handle epoch milliseconds', () => {
      const epochMs = new Date('2026-01-11T10:00:00Z').getTime();
      const result = toDateSafe(epochMs);

      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCHours()).toBe(10);
    });

    it('should fallback to reference date for invalid input', () => {
      const ref = new Date('2026-01-11T00:00:00Z');
      const result = toDateSafe('invalid-date', ref);

      // Should return reference date at midnight (local time)
      expect(result).toBeInstanceOf(Date);
      expect(result.getDate()).toBe(ref.getDate());
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
    });

    it('should handle null/undefined with current date fallback', () => {
      const result = toDateSafe(null);
      expect(result).toBeInstanceOf(Date);
      // Should be a valid date (current time)
      expect(isNaN(result.getTime())).toBe(false);
    });
  });
});
