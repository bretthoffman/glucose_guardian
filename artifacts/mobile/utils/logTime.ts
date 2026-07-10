/**
 * Time-of-day text helpers for backdated log entries. The Log Insulin popup shows a locked date
 * (the day being viewed) and a free-text time field prefilled with the device time — these parse
 * and combine both into the final entry timestamp.
 */

/** Device-local time as editable text, e.g. "5:38 PM" (or "17:38" on 24-hour locales). */
export function formatTimeInputText(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Parse typed time text. Accepts "5:38 PM", "5:38pm", "5 pm", "17:38", "9" (→ 9:00).
 * 12-hour forms require 1–12 with AM/PM; bare-hour forms are 24-hour. Null when invalid.
 */
export function parseTimeInputText(text: string): { hours: number; minutes: number } | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(?:([AaPp])\.?\s*[Mm]?\.?)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] != null ? parseInt(m[2], 10) : 0;
  if (minutes > 59) return null;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "p" && hours !== 12) hours += 12;
    if (meridiem === "a" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes };
}

/** The given calendar day at the given local time-of-day. */
export function combineDayAndTime(day: Date, hours: number, minutes: number): Date {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}
