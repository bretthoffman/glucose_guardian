/**
 * "What's new" decisions. Pure + unit-tested; the sheet in components/WhatsNew.tsx does the I/O.
 */
export interface NoteLike {
  id: string;
  date: string;
}

export type WhatsNewAction = "show" | "markSeen" | "none";

/**
 * What to do at launch, given the newest bundled note and the id this device last showed.
 *  - Already seen → nothing.
 *  - Never shown anything AND no existing logs → a brand-new install: record it silently (a new user
 *    doesn't need "what changed").
 *  - Last seen is an OLDER note in the list → show the newest one.
 *  - Last seen isn't in the list (e.g. a newer bundle was rolled back) → nothing; never show old notes.
 */
export function whatsNewAction(notes: NoteLike[], lastSeenId: string | null, hasExistingData: boolean): WhatsNewAction {
  const latest = notes[0];
  if (!latest) return "none";
  if (lastSeenId === latest.id) return "none";
  if (lastSeenId == null) return hasExistingData ? "show" : "markSeen";
  return notes.some((n) => n.id === lastSeenId) ? "show" : "none";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-19" → "Oct 19" (or "Oct 19, 2025" when not the current year). Parsed by hand: no timezone shift. */
export function formatNoteDate(date: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const label = `${MONTHS[mo - 1] ?? ""} ${d}`;
  return y === now.getFullYear() ? label : `${label}, ${y}`;
}
