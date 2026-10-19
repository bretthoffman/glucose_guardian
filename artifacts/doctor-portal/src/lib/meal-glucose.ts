import type { CGMReading } from "@doctor-portal/api-client-react";

/**
 * The glucose readings the portal ties to a meal or dose — before it, and at marks after it — with
 * WHEN each reading was taken, so every "before/after" number can say its time and distance from
 * the meal. One set of rules shared by the meal cards, event log, Selected Meal panel, and meal
 * detail dialog, so they never disagree.
 */

const MIN = 60_000;

/** Before-meal: the last reading at or before the log time, at most this long before it. */
export const BEFORE_WINDOW_MIN = 30;
/** After-meal check: the reading closest to 2 hours after the meal (the standard post-meal check). */
export const AFTER_MARK_MIN = 120;
/** How far from the 2-hour mark a reading may be and still count as "2 h after". */
export const AFTER_TOLERANCE_MIN = 30;

/** A CGM reading tied to an event: its value, when it was taken, and minutes from the event. */
export interface EventReading {
  value: number;
  timestamp: string;
  /** Negative = before the event, positive = after. */
  offsetMin: number;
}

interface ReadingIndex {
  ts: number[];
  readings: CGMReading[];
}

// Sorting months of 5-minute readings once per list, not once per meal.
const indexCache = new WeakMap<CGMReading[], ReadingIndex>();

function indexOf(readings: CGMReading[]): ReadingIndex {
  let idx = indexCache.get(readings);
  if (!idx) {
    const pairs = readings
      .map((r) => ({ r, t: new Date(r.timestamp).getTime() }))
      .sort((a, b) => a.t - b.t);
    idx = { ts: pairs.map((p) => p.t), readings: pairs.map((p) => p.r) };
    indexCache.set(readings, idx);
  }
  return idx;
}

/** First position whose time is >= t. */
function lowerBound(ts: number[], t: number): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function at(idx: ReadingIndex, i: number, eventMs: number): EventReading {
  return {
    value: idx.readings[i].value,
    timestamp: idx.readings[i].timestamp,
    offsetMin: Math.round((idx.ts[i] - eventMs) / MIN),
  };
}

/** The last reading at or before `eventMs`, within `withinMin` — the before-meal glucose. */
export function readingBefore(
  readings: CGMReading[],
  eventMs: number,
  withinMin = BEFORE_WINDOW_MIN,
): EventReading | null {
  const idx = indexOf(readings);
  const i = lowerBound(idx.ts, eventMs + 1) - 1;
  if (i < 0 || eventMs - idx.ts[i] > withinMin * MIN) return null;
  return at(idx, i, eventMs);
}

/** The reading after `eventMs` closest to `markMin` later, within ±`toleranceMin` of that mark. */
export function readingNearMark(
  readings: CGMReading[],
  eventMs: number,
  markMin: number,
  toleranceMin: number,
): EventReading | null {
  const idx = indexOf(readings);
  const target = eventMs + markMin * MIN;
  const i = lowerBound(idx.ts, target);
  let best = -1;
  let bestDist = Infinity;
  for (const j of [i - 1, i]) {
    if (j < 0 || j >= idx.ts.length || idx.ts[j] <= eventMs) continue;
    const dist = Math.abs(idx.ts[j] - target);
    if (dist <= toleranceMin * MIN && dist < bestDist) {
      best = j;
      bestDist = dist;
    }
  }
  return best >= 0 ? at(idx, best, eventMs) : null;
}

/** The standard after-meal check: the reading nearest 2 hours after. */
export function readingAfter(readings: CGMReading[], eventMs: number): EventReading | null {
  return readingNearMark(readings, eventMs, AFTER_MARK_MIN, AFTER_TOLERANCE_MIN);
}

/** "5 min", "1h", "2h 5m". */
export function formatSpan(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs} min`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "5 min before", "2h 1m after", "at log time". */
export function describeOffset(offsetMin: number): string {
  if (offsetMin === 0) return "at log time";
  return `${formatSpan(offsetMin)} ${offsetMin < 0 ? "before" : "after"}`;
}
