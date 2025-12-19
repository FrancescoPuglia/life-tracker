/**
 * 🔥 P1 FIX: Centralized date parsing utility
 * Handles various date formats consistently across the app
 */

export function toDateSafe(value: any, referenceDate?: Date): Date {
  // Already a Date object
  if (value instanceof Date) {
    return value;
  }
  
  // Firestore Timestamp with toDate method
  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  
  // String or number that can be parsed
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  
  // Time-only string like "14:30" - combine with reference date
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value) && referenceDate) {
    const [hours, minutes] = value.split(':').map(Number);
    const result = new Date(referenceDate);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }
  
  // Fallback to current date
  console.warn('toDateSafe: Could not parse date value:', value, 'using current date');
  return referenceDate || new Date();
}

/**
 * Safe duration calculation between two dates
 */
export function getDurationSafe(startTime: any, endTime: any): number {
  const start = toDateSafe(startTime);
  const end = toDateSafe(endTime);
  return Math.max(0, end.getTime() - start.getTime());
}

/**
 * Convert duration in milliseconds to hours
 */
export function msToHours(durationMs: number): number {
  return durationMs / (1000 * 60 * 60);
}

/**
 * Format hours for display
 */
export function formatHours(hours: number, decimals: number = 1): string {
  return hours.toFixed(decimals).replace(/\.0+$/, '');
}