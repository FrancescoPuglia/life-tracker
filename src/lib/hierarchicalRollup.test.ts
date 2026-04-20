import { describe, it, expect } from 'vitest';
import { calculateProgressPercentage } from './hierarchicalRollup';

describe('hierarchicalRollup', () => {
  describe('calculateProgressPercentage', () => {
    it('should calculate percentage correctly', () => {
      expect(calculateProgressPercentage(5, 10)).toBe(50);
      expect(calculateProgressPercentage(10, 10)).toBe(100);
      expect(calculateProgressPercentage(7.5, 10)).toBe(75);
      expect(calculateProgressPercentage(2.5, 10)).toBe(25);
    });

    it('should clamp to 100% maximum', () => {
      expect(calculateProgressPercentage(15, 10)).toBe(100);
      expect(calculateProgressPercentage(200, 10)).toBe(100);
      expect(calculateProgressPercentage(10.1, 10)).toBe(100);
    });

    it('should handle zero target', () => {
      expect(calculateProgressPercentage(5, 0)).toBe(0);
      expect(calculateProgressPercentage(5, undefined)).toBe(0);
      expect(calculateProgressPercentage(100, 0)).toBe(0);
    });

    it('should handle zero actual hours', () => {
      expect(calculateProgressPercentage(0, 10)).toBe(0);
      expect(calculateProgressPercentage(0, 0)).toBe(0);
    });

    it('should handle negative values gracefully', () => {
      // Edge case: negative hours should be treated as 0
      expect(calculateProgressPercentage(-5, 10)).toBe(0);
      expect(calculateProgressPercentage(5, -10)).toBe(0);
    });

    it('should round to nearest integer', () => {
      expect(calculateProgressPercentage(1, 3)).toBe(33); // 33.33... rounded
      expect(calculateProgressPercentage(2, 3)).toBe(67); // 66.66... rounded
      expect(calculateProgressPercentage(1, 7)).toBe(14); // 14.28... rounded
    });
  });
});
