/** Local calendar-day helpers for Dose Log historical graph (DST-safe). */

export interface LocalDayBoundaries {
  /** Local midnight of the selected calendar day. */
  startMs: number;
  /** Local midnight of the following calendar day (exclusive end). */
  endMs: number;
  /** Inclusive lower bound as ISO string for Convex range queries. */
  startIso: string;
  /** Exclusive upper bound as ISO string for Convex range queries. */
  endIso: string;
  /** Stable cache key in the user's local timezone (`YYYY-MM-DD`). */
  dayKey: string;
}

/** Start of the local calendar day for `date` (00:00:00.000 local). */
export function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Exclusive end of the local calendar day (next local midnight). Handles DST transitions. */
export function endOfLocalDay(date: Date): Date {
  const start = startOfLocalDay(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return end;
}

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function localDayBoundaries(date: Date): LocalDayBoundaries {
  const start = startOfLocalDay(date);
  const end = endOfLocalDay(date);
  return {
    startMs: start.getTime(),
    endMs: end.getTime(),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    dayKey: localDateKey(start),
  };
}

/** Inclusive start, exclusive end — matches LogHistory day filtering. */
export function isTimestampInLocalDay(ts: string, dayStartMs: number, dayEndMs: number): boolean {
  const t = new Date(ts).getTime();
  return t >= dayStartMs && t < dayEndMs;
}

export function selectedDayFromOffset(todayStart: Date, dayOffset: number): Date {
  const d = new Date(todayStart);
  d.setDate(d.getDate() - dayOffset);
  return d;
}

export function isTodayOffset(dayOffset: number): boolean {
  return dayOffset === 0;
}

export function canNavigateToNextDay(dayOffset: number): boolean {
  return dayOffset > 0;
}
