/**
 * Chat history helpers (pure): the local day key a message belongs to, and how a day reads in the
 * History list ("Today", "Yesterday", "Tue, Oct 27", with the year when it isn't this year).
 */
import { toLocalIsoDate } from "./labs";

export function chatDayKey(d: Date = new Date()): string {
  return toLocalIsoDate(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local Date for a "YYYY-MM-DD" day key (noon, so DST shifts never move it to another day). */
export function dateFromDayKey(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

export function chatDayLabel(day: string, now: Date = new Date()): string {
  const today = chatDayKey(now);
  if (day === today) return "Today";
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  if (day === chatDayKey(y)) return "Yesterday";
  const d = dateFromDayKey(day);
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}
