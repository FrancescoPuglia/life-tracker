/**
 * Calcola la durata in minuti tra due date (safe, coerente, sempre INT)
 * Se tb.durationMinutes valido, usa quello, altrimenti calcola da start/end
 *
 * ✅ FIX: accetta referenceDate opzionale per interpretare "HH:mm"
 */
export function computeDurationMinutes(
  tb: { startTime: any; endTime: any; durationMinutes?: number; id?: string },
  referenceDate?: Date
): number {
  if (
    tb &&
    typeof tb.durationMinutes === "number" &&
    tb.durationMinutes > 0 &&
    tb.durationMinutes <= 24 * 60
  ) {
    return Math.round(tb.durationMinutes);
  }

  const start = toDateSafe(tb.startTime, referenceDate);
  const end = toDateSafe(tb.endTime, referenceDate);

  const startMs = start.getTime();
  const endMs = end.getTime();
  const diffMinutes = Math.round((endMs - startMs) / 60000);

  if (process.env.NEXT_PUBLIC_DEBUG_INIT === "1") {
    // eslint-disable-next-line no-console
    console.log("[DEBUG computeDurationMinutes]", {
      id: tb.id,
      rawStart: tb.startTime,
      rawEnd: tb.endTime,
      startISO: safeToISO(start),
      endISO: safeToISO(end),
      startMs,
      endMs,
      diffMinutes,
      durationMinutesField: tb.durationMinutes,
      referenceDateISO: referenceDate ? safeToISO(referenceDate) : null,
    });
  }

  // Guard: plausibilità
  if (diffMinutes <= 0 || diffMinutes > 24 * 60) return 60;
  return diffMinutes;
}

/**
 * 🔥 FIX: Centralized date parsing utility
 * Handles Date, Firestore Timestamp, ISO strings, epoch, and "HH:mm" time strings.
 *
 * IMPORTANT:
 * - Se arriva "14:30" senza referenceDate → usa OGGI alle 14:30 (NON "adesso")
 * - Se arriva invalido/undefined → usa referenceDate a mezzanotte (o oggi a mezzanotte)
 */
export function toDateSafe(value: any, referenceDate?: Date): Date {
  // 1) Date object
  if (value instanceof Date) {
    return value;
  }

  // 2) Firestore Timestamp (client SDK) has toDate()
  if (value && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : fallbackDate(referenceDate);
  }

  // 3) Firestore Timestamp-like (seconds/nanoseconds)
  //    e.g. { seconds: 123, nanoseconds: 0 }
  if (
    value &&
    typeof value === "object" &&
    typeof value.seconds === "number" &&
    typeof value.nanoseconds === "number"
  ) {
    const ms = value.seconds * 1000 + Math.floor(value.nanoseconds / 1e6);
    const d = new Date(ms);
    return !isNaN(d.getTime()) ? d : fallbackDate(referenceDate);
  }

  // 4) Time-only string "HH:mm" or "H:mm" (optionally also "HH:mm:ss")
  if (typeof value === "string") {
    const t = parseTimeOnlyString(value, referenceDate);
    if (t) return t;
  }

  // 5) String/number parseable as full date
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 6) Fallback
  if (process.env.NEXT_PUBLIC_DEBUG_INIT === "1") {
    // eslint-disable-next-line no-console
    console.warn("⚠️ toDateSafe FALLBACK (unparsable) -> using safe fallback", {
      value,
      referenceDate: referenceDate ? safeToISO(referenceDate) : null,
      stack: new Error().stack,
    });
  } else {
    // eslint-disable-next-line no-console
    console.warn("toDateSafe: Could not parse date value:", value, "using safe fallback");
  }
  return fallbackDate(referenceDate);
}

/**
 * Safe duration calculation between two dates
 * ✅ FIX: referenceDate opzionale
 */
export function getDurationSafe(startTime: any, endTime: any, referenceDate?: Date): number {
  const start = toDateSafe(startTime, referenceDate);
  const end = toDateSafe(endTime, referenceDate);
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
  return hours.toFixed(decimals).replace(/\.0+$/, "");
}

/**
 * Safe date formatting - never shows "Invalid Date" to users
 * ✅ FIX: referenceDate opzionale
 */
export function formatDateSafe(
  date: any,
  options?: Intl.DateTimeFormatOptions,
  fallback: string = "Invalid Date",
  referenceDate?: Date
): string {
  const safeDate = toDateSafe(date, referenceDate);
  if (isNaN(safeDate.getTime())) return fallback;
  return safeDate.toLocaleDateString("en-US", options);
}

/**
 * Safe time formatting - never shows "Invalid Date" to users
 * ✅ FIX: referenceDate opzionale
 */
export function formatTimeSafe(
  date: any,
  options?: Intl.DateTimeFormatOptions,
  fallback: string = "Invalid Time",
  referenceDate?: Date
): string {
  const safeDate = toDateSafe(date, referenceDate);
  if (isNaN(safeDate.getTime())) return fallback;
  return safeDate.toLocaleTimeString("en-US", options);
}

/**
 * Safe ISO string formatting
 * ✅ FIX: referenceDate opzionale
 */
export function formatISOSafe(date: any, fallback: string = "", referenceDate?: Date): string {
  const safeDate = toDateSafe(date, referenceDate);
  if (isNaN(safeDate.getTime())) return fallback;
  return safeDate.toISOString();
}

/**
 * Safe date string formatting
 * ✅ FIX: referenceDate opzionale
 */
export function formatDateStringSafe(
  date: any,
  fallback: string = "Invalid Date",
  referenceDate?: Date
): string {
  const safeDate = toDateSafe(date, referenceDate);
  if (isNaN(safeDate.getTime())) return fallback;
  return safeDate.toDateString();
}

/* =========================
   Helpers (private)
   ========================= */

function parseTimeOnlyString(value: string, referenceDate?: Date): Date | null {
  // Accept "H:mm", "HH:mm", "HH:mm:ss"
  const m = value.trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;

  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] ? Number(m[3]) : 0;

  if (hours < 0 || hours > 23) return null;

  // ✅ Se referenceDate esiste, usala (es. selectedDate)
  // ✅ Altrimenti usa "oggi" (ma NON "adesso": settiamo h/m/s)
  const base = referenceDate ? new Date(referenceDate) : new Date();
  base.setHours(hours, minutes, seconds, 0);
  return base;
}

/**
 * Fallback "anti-teletrasporto":
 * - se referenceDate esiste → referenceDate a mezzanotte (stabile)
 * - altrimenti → oggi a mezzanotte (stabile)
 */
function fallbackDate(referenceDate?: Date): Date {
  const d = referenceDate ? new Date(referenceDate) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function safeToISO(d: Date): string {
  try {
    return d.toISOString();
  } catch {
    return String(d);
  }
}
