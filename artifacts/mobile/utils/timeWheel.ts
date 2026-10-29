/**
 * Pure helpers for the time wheel (hour / minute / AM-PM columns, like the iOS alarm picker).
 * The wheel reads and writes the same "5:38 PM" text the log screens already parse with
 * `parseTimeInputText`, so saving logic is unchanged.
 */
import { formatTimeInputText, parseTimeInputText } from "./logTime";

export type Period = "AM" | "PM";
export interface WheelTime {
  /** 1–12 */
  hour: number;
  /** 0–59 */
  minute: number;
  period: Period;
}

export const WHEEL_HOURS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const WHEEL_MINUTES: readonly number[] = Array.from({ length: 60 }, (_, i) => i);
export const WHEEL_PERIODS: readonly Period[] = ["AM", "PM"];

/** 24-hour clock → wheel columns. */
export function toWheel(hours: number, minutes: number): WheelTime {
  const period: Period = hours >= 12 ? "PM" : "AM";
  const h = hours % 12;
  return { hour: h === 0 ? 12 : h, minute: minutes, period };
}

/** Wheel columns → 24-hour clock. */
export function fromWheel(t: WheelTime): { hours: number; minutes: number } {
  let hours = t.hour % 12;
  if (t.period === "PM") hours += 12;
  return { hours, minutes: t.minute };
}

/** Wheel columns → the text the screens store, e.g. "5:38 PM". */
export function wheelText(t: WheelTime): string {
  return `${t.hour}:${String(t.minute).padStart(2, "0")} ${t.period}`;
}

/** The screens' time text → wheel columns; unreadable text falls back to `fallback` (default now). */
export function wheelFromText(text: string, fallback: Date = new Date()): WheelTime {
  const parsed = parseTimeInputText(text);
  if (parsed) return toWheel(parsed.hours, parsed.minutes);
  return toWheel(fallback.getHours(), fallback.getMinutes());
}

/** Readable label for the time button: the stored text when valid, else the fallback time. */
export function timeButtonLabel(text: string, fallback: Date = new Date()): string {
  return parseTimeInputText(text) ? wheelText(wheelFromText(text, fallback)) : formatTimeInputText(fallback);
}

/** Index of the row nearest a scroll offset, clamped to the column. */
export function wheelIndexAt(offsetY: number, rowHeight: number, count: number): number {
  const i = Math.round(offsetY / rowHeight);
  return Math.max(0, Math.min(count - 1, i));
}
