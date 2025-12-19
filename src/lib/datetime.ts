/**
 * 🔥 P0 TASK C: Centralized date/time normalization
 * Single source of truth for all date parsing to fix overdue triangles and wrong hours
 */

export interface DateParseResult {
  date: Date;
  isValid: boolean;
  originalValue: any;
  parseMethod: string;
}

/**
 * Parse any date value into a reliable Date object
 * Handles: Date objects, ISO strings, timestamps, Firestore Timestamps, HH:mm strings
 */
export function parseDateTime(value: any, referenceDate?: Date): DateParseResult {
  const result: DateParseResult = {
    date: new Date(),
    isValid: false,
    originalValue: value,
    parseMethod: 'fallback'
  };

  // Already a valid Date object
  if (value instanceof Date && !isNaN(value.getTime())) {
    result.date = value;
    result.isValid = true;
    result.parseMethod = 'date-object';
    return result;
  }

  // Firestore Timestamp with toDate method
  if (value && typeof value.toDate === 'function') {
    try {
      result.date = value.toDate();
      result.isValid = !isNaN(result.date.getTime());
      result.parseMethod = 'firestore-timestamp';
      return result;
    } catch (error) {
      console.warn('Failed to parse Firestore timestamp:', value, error);
    }
  }

  // ISO string or timestamp number
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      result.date = parsed;
      result.isValid = true;
      result.parseMethod = typeof value === 'string' ? 'iso-string' : 'timestamp';
      return result;
    }
  }

  // Time-only string like "14:30" - combine with reference date
  if (typeof value === 'string' && /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/.test(value)) {
    if (referenceDate) {
      const [hours, minutes] = value.split(':').map(Number);
      result.date = new Date(referenceDate);
      result.date.setHours(hours, minutes, 0, 0);
      result.isValid = !isNaN(result.date.getTime());
      result.parseMethod = 'time-string-with-reference';
      return result;
    }
  }

  // Fallback to current time for invalid inputs
  result.date = referenceDate || new Date();
  result.isValid = false;
  result.parseMethod = 'fallback';
  
  console.warn('🔥 DateTime Parse Warning:', {
    value,
    type: typeof value,
    fallbackUsed: result.date.toISOString(),
    method: result.parseMethod
  });

  return result;
}

/**
 * Safe duration calculation between two date values
 * Returns duration in milliseconds, always >= 0
 */
export function calculateDuration(startTime: any, endTime: any, referenceDate?: Date): number {
  const start = parseDateTime(startTime, referenceDate);
  const end = parseDateTime(endTime, referenceDate);

  if (!start.isValid || !end.isValid) {
    console.warn('🔥 Duration calculation with invalid dates:', {
      start: { value: startTime, parsed: start.date, valid: start.isValid },
      end: { value: endTime, parsed: end.date, valid: end.isValid }
    });
    return 0;
  }

  const durationMs = Math.max(0, end.date.getTime() - start.date.getTime());
  return durationMs;
}

/**
 * Convert duration in milliseconds to hours
 */
export function msToHours(durationMs: number): number {
  return durationMs / (1000 * 60 * 60);
}

/**
 * Format hours for display (removes unnecessary decimals)
 */
export function formatHours(hours: number, decimals: number = 1): string {
  return hours.toFixed(decimals).replace(/\.0+$/, '');
}

/**
 * Check if a time block is overdue
 * A block is overdue if: endTime < now AND status !== 'completed'
 */
export function isBlockOverdue(
  endTime: any, 
  status: string, 
  referenceDate?: Date,
  now: Date = new Date()
): boolean {
  if (status === 'completed') {
    return false;
  }

  const endResult = parseDateTime(endTime, referenceDate);
  if (!endResult.isValid) {
    return false; // Can't determine if invalid end time
  }

  return endResult.date.getTime() < now.getTime();
}

/**
 * Calculate how many minutes a block is overdue
 * Returns 0 if not overdue
 */
export function getOverdueMinutes(
  endTime: any, 
  status: string, 
  referenceDate?: Date,
  now: Date = new Date()
): number {
  if (!isBlockOverdue(endTime, status, referenceDate, now)) {
    return 0;
  }

  const endResult = parseDateTime(endTime, referenceDate);
  const overdueMs = now.getTime() - endResult.date.getTime();
  return Math.floor(overdueMs / (1000 * 60)); // Convert to minutes
}

/**
 * Get today's date at midnight (useful for reference dates)
 */
export function getTodayAtMidnight(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Ensure a date is a valid Date object - fallback to current time
 * Backward compatibility with existing dateUtils.ts
 */
export function toDateSafe(value: any, referenceDate?: Date): Date {
  const result = parseDateTime(value, referenceDate);
  return result.date;
}

/**
 * Safe duration calculation - backward compatibility
 */
export function getDurationSafe(startTime: any, endTime: any): number {
  return calculateDuration(startTime, endTime);
}