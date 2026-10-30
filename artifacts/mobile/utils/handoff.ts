/**
 * The handoff sheet (pure, unit-tested): what the next person needs to know, filled in from the
 * logs and readings the phone already has, and when the sheet should pop up.
 *
 * - "caregiver": the school nurse or grandma, on their first open of the day. "Good morning, Holly.
 *   Here's Bella's morning." Covers the last 12 hours, so an overnight low is on it.
 * - "family": a parent opening the app after others logged while they were away. "While you were
 *   away." Covers the time since they last opened the app.
 */

export type HandoffKind = "caregiver" | "family";

export interface HandoffReading {
  glucose: number;
  timestamp: string;
}

export interface HandoffLog {
  timestamp: string;
  kind: "insulin" | "meal" | "stick";
  /** "Humalog 3 units", "Waffles · 45g carbs", "Finger stick 132". */
  title: string;
  /** Shown first on the line under the title, e.g. "35g carbs". */
  detail?: string;
  authorName?: string;
  byYou: boolean;
}

export interface HandoffItem {
  icon: "insulin" | "meal" | "stick" | "low" | "high";
  title: string;
  sub: string;
}

export interface HandoffSummary {
  kind: HandoffKind;
  heading: string;
  /** "8:05 AM", for the kicker line. */
  timeLabel: string;
  /** family only: "Since you last opened the app at 7:20 AM". */
  sinceLine: string | null;
  now: { glucose: number; trend?: string } | null;
  active: { units: number; wearsOffAt: number } | null;
  inRangePct: number | null;
  items: HandoffItem[];
}

export const CAREGIVER_WINDOW_MS = 12 * 60 * 60 * 1000;
export const AWAY_MIN_MS = 90 * 60 * 1000;
const MAX_ITEMS = 5;

function partOfDay(hour: number): { greet: string; span: string } {
  if (hour < 5) return { greet: "Hi", span: "night" };
  if (hour < 12) return { greet: "Good morning", span: "morning" };
  if (hour < 17) return { greet: "Good afternoon", span: "day" };
  return { greet: "Good evening", span: "evening" };
}

/** "Holly", "Holly and Andrea", "Holly, Andrea and Grandma". */
export function joinNames(names: string[]): string {
  const n = names.map((x) => x.trim()).filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

export function firstName(name: string): string {
  return name.trim().split(/[\s(]+/)[0] || name.trim();
}

/** Low point under 70 in the window, and when it recovered to 80+ (if it did). */
function lowItem(readings: HandoffReading[], fmt: (ms: number) => string): HandoffItem | null {
  let low: HandoffReading | null = null;
  for (const r of readings) if (r.glucose < 70 && (!low || r.glucose < low.glucose)) low = r;
  if (!low) return null;
  const lowMs = new Date(low.timestamp).getTime();
  const back = readings.find((r) => new Date(r.timestamp).getTime() > lowMs && r.glucose >= 80);
  return {
    icon: "low",
    title: `Low, ${Math.round(low.glucose)}`,
    sub: `${fmt(lowMs)}${back ? ` · back to ${Math.round(back.glucose)} by ${fmt(new Date(back.timestamp).getTime())}` : ""}`,
  };
}

/** High point over 250 in the window, and when it came back under 180 (if it did). */
function highItem(readings: HandoffReading[], fmt: (ms: number) => string): HandoffItem | null {
  let high: HandoffReading | null = null;
  for (const r of readings) if (r.glucose > 250 && (!high || r.glucose > high.glucose)) high = r;
  if (!high) return null;
  const highMs = new Date(high.timestamp).getTime();
  const back = readings.find((r) => new Date(r.timestamp).getTime() > highMs && r.glucose <= 180);
  return {
    icon: "high",
    title: `Highest ${Math.round(high.glucose)}`,
    sub: `${fmt(highMs)}${back ? ` · back under 180 by ${fmt(new Date(back.timestamp).getTime())}` : " · still coming down"}`,
  };
}

export function buildHandoffSummary(input: {
  kind: HandoffKind;
  viewerName: string;
  /** Exact name(s) to greet ("Holly and Andrea"); "" greets nobody by name. Defaults to viewerName's first name. */
  greetAs?: string;
  childName: string;
  nowMs: number;
  /** family: when they last opened the app. caregiver: ignored (12-hour window). */
  sinceMs?: number | null;
  readings: HandoffReading[];
  logs: HandoffLog[];
  current?: { glucose: number; trend?: string } | null;
  iob?: { units: number; remainingMin: number } | null;
  fmtTime: (ms: number) => string;
}): HandoffSummary {
  const { kind, nowMs, fmtTime } = input;
  const sinceMs = kind === "caregiver" ? nowMs - CAREGIVER_WINDOW_MS : (input.sinceMs ?? nowMs - CAREGIVER_WINDOW_MS);
  const inWindow = (ts: string) => {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) && t >= sinceMs && t <= nowMs + 5 * 60_000;
  };
  const readings = input.readings
    .filter((r) => Number.isFinite(r.glucose) && inWindow(r.timestamp))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const logs = input.logs
    .filter((l) => inWindow(l.timestamp) && (kind === "caregiver" || !l.byYou))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const items: HandoffItem[] = logs.slice(0, MAX_ITEMS).map((l) => ({
    icon: l.kind,
    title: l.title,
    sub: `${l.detail ? `${l.detail} · ` : ""}${fmtTime(new Date(l.timestamp).getTime())}${l.byYou ? " · by you" : l.authorName ? ` · ${firstName(l.authorName)}` : ""}`,
  }));
  const low = lowItem(readings, fmtTime);
  const high = highItem(readings, fmtTime);
  if (high) items.push(high);
  if (low) items.push(low);

  const hour = new Date(nowMs).getHours();
  const { greet, span } = partOfDay(hour);
  const greetName = (input.greetAs ?? firstName(input.viewerName)).trim();
  const heading =
    kind === "caregiver"
      ? `${greet}${greetName ? `, ${greetName}` : ""}. Here's ${input.childName}'s ${span}.`
      : "While you were away";
  const timeLabel = fmtTime(nowMs);
  const sinceLine = kind === "family" ? `Since you last opened the app at ${fmtTime(sinceMs)}` : null;

  const inRangePct =
    kind === "family" && readings.length >= 6
      ? Math.round((readings.filter((r) => r.glucose >= 70 && r.glucose <= 180).length / readings.length) * 100)
      : null;
  const active =
    input.iob && input.iob.units >= 0.05
      ? { units: Math.round(input.iob.units * 10) / 10, wearsOffAt: nowMs + input.iob.remainingMin * 60_000 }
      : null;

  return {
    kind,
    heading,
    timeLabel,
    sinceLine,
    now: input.current ?? null,
    active,
    inRangePct,
    items,
  };
}

/**
 * Whether the sheet pops up now.
 * - caregiver: once a day (first open), or again if a newer note arrived since it last showed.
 * - family: back after 90+ minutes and someone else logged meanwhile, or a new caregiver note.
 */
export function shouldShowHandoff(input: {
  kind: HandoffKind;
  nowMs: number;
  todayKey: string;
  lastShownDay: string | null;
  lastShownMs: number | null;
  lastOpenMs: number | null;
  othersLoggedSinceLastOpen: boolean;
  hasContent: boolean;
  noteCreatedAt: number | null;
}): boolean {
  const newNote = input.noteCreatedAt != null && (input.lastShownMs == null || input.noteCreatedAt > input.lastShownMs);
  if (input.kind === "caregiver") {
    if (newNote) return true;
    return input.hasContent && input.lastShownDay !== input.todayKey;
  }
  if (newNote) return true;
  if (input.lastOpenMs == null) return false; // first launch on this phone: nothing to catch up on
  return input.nowMs - input.lastOpenMs >= AWAY_MIN_MS && input.othersLoggedSinceLastOpen;
}
