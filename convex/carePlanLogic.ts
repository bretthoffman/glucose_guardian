/**
 * Pure helpers for the Care Plan and the day recap (no Convex imports, so the app can use them too).
 */
import type { CareAccess } from "./careSchedule";

export const PLAN_FIELD_MAX = 1000;
export const RECAP_NOTE_MAX = 500;
export const DEFAULT_RECHECK_MINUTES = 15;
/** A caregiver code with no school hours set: 8:00 AM to 3:00 PM on the caregiver's phone clock. */
export const DEFAULT_START_MINUTE = 8 * 60;
export const DEFAULT_END_MINUTE = 15 * 60;

export interface CarePlanFields {
  low: string;
  high: string;
  supplies: string;
  notes: string;
  recheckMinutes?: number;
}

/** Trimmed, length-capped text; a recheck time between 5 and 60 minutes (anything else is dropped). */
export function cleanPlan(input: CarePlanFields): CarePlanFields {
  const t = (s: string) => s.replace(/\r\n/g, "\n").trim().slice(0, PLAN_FIELD_MAX);
  const m = input.recheckMinutes;
  const recheck = m != null && Number.isFinite(m) && m >= 5 && m <= 60 ? Math.round(m) : undefined;
  return { low: t(input.low), high: t(input.high), supplies: t(input.supplies), notes: t(input.notes), ...(recheck ? { recheckMinutes: recheck } : {}) };
}

export function planIsEmpty(p: Pick<CarePlanFields, "low" | "high" | "supplies" | "notes">): boolean {
  return !p.low.trim() && !p.high.trim() && !p.supplies.trim() && !p.notes.trim();
}

/** Lines the family wrote, one step each (blank lines dropped). */
export function planSteps(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim())
    .filter(Boolean);
}

/**
 * Today's recap window. A code with school hours (weekly) uses them, on the clock of whoever set them;
 * any other code uses 8:00 AM to 3:00 PM on the caregiver's phone clock (`deviceTzOffsetMinutes`,
 * minutes EAST of UTC, i.e. -Date#getTimezoneOffset()).
 */
export function recapWindow(access: CareAccess, nowMs: number, deviceTzOffsetMinutes: number): { startMs: number; endMs: number } {
  let tz = deviceTzOffsetMinutes;
  let start = DEFAULT_START_MINUTE;
  let end = DEFAULT_END_MINUTE;
  if (access.mode === "weekly" && access.startMinute < access.endMinute) {
    tz = access.tzOffsetMinutes;
    start = access.startMinute;
    end = access.endMinute;
  }
  const local = new Date(nowMs + tz * 60_000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tz * 60_000;
  return { startMs: midnight + start * 60_000, endMs: midnight + end * 60_000 };
}

/** When the recap goes out: now, or when the hours end (now if they already ended). */
export function recapSendAt(window: { endMs: number }, nowMs: number, sendNow: boolean): number {
  return sendNow || window.endMs <= nowMs ? nowMs : window.endMs;
}
