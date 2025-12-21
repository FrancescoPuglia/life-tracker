/**
 * Calcola la durata in minuti tra due date (safe, coerente, sempre INT)
 * Se tb.durationMinutes valido, usa quello, altrimenti calcola da start/end
 */
export function computeDurationMinutes(tb: { startTime: any, endTime: any, durationMinutes?: number, id?: string }): number {
  if (tb && typeof tb.durationMinutes === 'number' && tb.durationMinutes > 0 && tb.durationMinutes <= 24*60) {
    return Math.round(tb.durationMinutes);
  }
  const start = toDateSafe(tb.startTime);
  const end = toDateSafe(tb.endTime);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const diffMinutes = Math.round((endMs - startMs) / 60000);
  if (process.env.NEXT_PUBLIC_DEBUG_INIT === '1') {
    // eslint-disable-next-line no-console
    console.log('[DEBUG computeDurationMinutes]', {
      id: tb.id,
      rawStart: tb.startTime,
      rawEnd: tb.endTime,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      startMs,
      endMs,
      diffMinutes,
      durationMinutesField: tb.durationMinutes
    });
  }
  // Guard: plausibilità
  if (diffMinutes <= 0 || diffMinutes > 24*60) return 60;
  return diffMinutes;
}
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

/**
 * Safe date formatting - never shows "Invalid Date" to users
 */
export function formatDateSafe(date: any, options?: Intl.DateTimeFormatOptions, fallback: string = 'Invalid Date'): string {
  const safeDate = toDateSafe(date);
  if (isNaN(safeDate.getTime())) {
    return fallback;
  }
  return safeDate.toLocaleDateString('en-US', options);
}

/**
 * Safe time formatting - never shows "Invalid Date" to users
 */
export function formatTimeSafe(date: any, options?: Intl.DateTimeFormatOptions, fallback: string = 'Invalid Time'): string {
  const safeDate = toDateSafe(date);
  if (isNaN(safeDate.getTime())) {
    return fallback;
  }
  return safeDate.toLocaleTimeString('en-US', options);
}

/**
 * Safe ISO string formatting
 */
export function formatISOSafe(date: any, fallback: string = ''): string {
  const safeDate = toDateSafe(date);
  if (isNaN(safeDate.getTime())) {
    return fallback;
  }
  return safeDate.toISOString();
}

/**
 * Safe date string formatting  
 */
export function formatDateStringSafe(date: any, fallback: string = 'Invalid Date'): string {
  const safeDate = toDateSafe(date);
  if (isNaN(safeDate.getTime())) {
    return fallback;
  }
  return safeDate.toDateString();
}