/**
 * The handoff sheet (pure, unit-tested): what the next person needs to know, filled in from the
 * logs and readings the phone already has, and when the sheet should pop up.
 *
 * - "caregiver": the school nurse or grandma, on their first open of the day. "Good morning, Holly.
 *   Here's Bella's morning." Covers today since midnight (the last 6 hours when it's opened before
 *   6 AM, so an overnight low is still on it), plus the most recent long-acting dose from the last
 *   24 hours, so they know the background insulin was given.
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
  /** Long-acting (background) insulin, e.g. Lantus or Tresiba. */
  longActing?: boolean;
}

export interface HandoffItem {
  icon: "insulin" | "meal" | "stick" | "low" | "high";
  title: string;
  sub: string;
  /** When it happened: the list is in true time order, newest first. */
  atMs: number;
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
  /** Morning catch-up is off for this caregiver: the sheet carries only the note. */
  noteOnly: boolean;
}

/** Fallback reach for "While you were away" when we don't know when they last opened the app. */
export const CAREGIVER_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Before 6 AM, "since midnight" is too short to catch the night: show the last 6 hours instead. */
export const EARLY_WINDOW_MS = 6 * 60 * 60 * 1000;
/** The latest long-acting dose is always shown if it was given in the last 24 hours. */
export const LONG_ACTING_REACH_MS = 24 * 60 * 60 * 1000;
export const AWAY_MIN_MS = 90 * 60 * 1000;
const MAX_ITEMS = 5;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local midnight at the start of the day that contains ms. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Caregiver window start: since midnight, or the last 6 hours if that reaches back further. */
export function caregiverSince(nowMs: number): number {
  return Math.min(startOfDay(nowMs), nowMs - EARLY_WINDOW_MS);
}

/** "7:10 AM" today, "Yesterday 6:15 PM", or "Mon 6:15 PM" for older. */
function dayTime(ms: number, nowMs: number, fmt: (ms: number) => string): string {
  const today = startOfDay(nowMs);
  if (ms >= today) return fmt(ms);
  const yesterday = startOfDay(today - 1);
  if (ms >= yesterday) return `Yesterday ${fmt(ms)}`;
  return `${WEEKDAYS[new Date(ms).getDay()]} ${fmt(ms)}`;
}

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
function lowItem(readings: HandoffReading[], when: (ms: number) => string, fmt: (ms: number) => string): HandoffItem | null {
  let low: HandoffReading | null = null;
  for (const r of readings) if (r.glucose < 70 && (!low || r.glucose < low.glucose)) low = r;
  if (!low) return null;
  const lowMs = new Date(low.timestamp).getTime();
  const back = readings.find((r) => new Date(r.timestamp).getTime() > lowMs && r.glucose >= 80);
  return {
    icon: "low",
    title: `Low, ${Math.round(low.glucose)}`,
    atMs: lowMs,
    sub: `${when(lowMs)}${back ? ` · back to ${Math.round(back.glucose)} by ${fmt(new Date(back.timestamp).getTime())}` : ""}`,
  };
}

/** High point over 250 in the window, and when it came back under 180 (if it did). */
function highItem(readings: HandoffReading[], when: (ms: number) => string, fmt: (ms: number) => string): HandoffItem | null {
  let high: HandoffReading | null = null;
  for (const r of readings) if (r.glucose > 250 && (!high || r.glucose > high.glucose)) high = r;
  if (!high) return null;
  const highMs = new Date(high.timestamp).getTime();
  const back = readings.find((r) => new Date(r.timestamp).getTime() > highMs && r.glucose <= 180);
  return {
    icon: "high",
    title: `Highest ${Math.round(high.glucose)}`,
    atMs: highMs,
    sub: `${when(highMs)}${back ? ` · back under 180 by ${fmt(new Date(back.timestamp).getTime())}` : " · still coming down"}`,
  };
}

export function buildHandoffSummary(input: {
  kind: HandoffKind;
  viewerName: string;
  /** Exact name(s) to greet ("Holly and Andrea"); "" greets nobody by name. Defaults to viewerName's first name. */
  greetAs?: string;
  childName: string;
  nowMs: number;
  /** family: when they last opened the app. caregiver: ignored (since midnight, see caregiverSince). */
  sinceMs?: number | null;
  readings: HandoffReading[];
  logs: HandoffLog[];
  current?: { glucose: number; trend?: string } | null;
  iob?: { units: number; remainingMin: number } | null;
  fmtTime: (ms: number) => string;
  /** Catch-up is off for this caregiver: no numbers or logs, just a heading for the note. */
  noteOnly?: boolean;
}): HandoffSummary {
  const { kind, nowMs, fmtTime } = input;
  const sinceMs = kind === "caregiver" ? caregiverSince(nowMs) : (input.sinceMs ?? nowMs - CAREGIVER_WINDOW_MS);
  const inRange = (ts: string, fromMs: number) => {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) && t >= fromMs && t <= nowMs + 5 * 60_000;
  };
  const inWindow = (ts: string) => inRange(ts, sinceMs);
  const when = (ms: number) => dayTime(ms, nowMs, fmtTime);
  const readings = input.readings
    .filter((r) => Number.isFinite(r.glucose) && inWindow(r.timestamp))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const logs = input.logs
    .filter((l) => inWindow(l.timestamp) && (kind === "caregiver" || !l.byYou))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const shown = logs.slice(0, MAX_ITEMS);
  // The caregiver always learns whether the background insulin was given, even if it was last night.
  if (kind === "caregiver") {
    const lastLong = input.logs
      .filter((l) => l.kind === "insulin" && l.longActing && inRange(l.timestamp, nowMs - LONG_ACTING_REACH_MS))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
    if (lastLong && !shown.includes(lastLong)) shown.push(lastLong);
  }
  const items: HandoffItem[] = shown.map((l) => {
    const atMs = new Date(l.timestamp).getTime();
    const detail = l.detail ?? (l.longActing ? "Long-acting" : undefined);
    return {
      icon: l.kind,
      title: l.title,
      atMs,
      sub: `${detail ? `${detail} · ` : ""}${when(atMs)}${l.byYou ? " · by you" : l.authorName ? ` · ${firstName(l.authorName)}` : ""}`,
    };
  });
  const low = lowItem(readings, when, fmtTime);
  const high = highItem(readings, when, fmtTime);
  if (high) items.push(high);
  if (low) items.push(low);
  // One list in true time order, newest first: lows and highs sit where they happened.
  items.sort((a, b) => b.atMs - a.atMs);

  const hour = new Date(nowMs).getHours();
  const { greet, span } = partOfDay(hour);
  const greetName = (input.greetAs ?? firstName(input.viewerName)).trim();
  const heading =
    kind === "caregiver" && input.noteOnly
      ? `${greet}${greetName ? `, ${greetName}` : ""}. A note about ${input.childName}.`
      : kind === "caregiver"
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

  if (kind === "caregiver" && input.noteOnly) {
    return { kind, heading, timeLabel, sinceLine, now: null, active: null, inRangePct: null, items: [], noteOnly: true };
  }

  return {
    kind,
    noteOnly: false,
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
 * - caregiver: once a day (first open), or again if a newer note arrived since it last showed. With
 *   the catch-up turned off for them, only a new note picked for them pops up.
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
  /** caregiver: false = morning catch-up turned off by the family; only a new note pops up. */
  catchUp?: boolean;
}): boolean {
  const newNote = input.noteCreatedAt != null && (input.lastShownMs == null || input.noteCreatedAt > input.lastShownMs);
  if (input.kind === "caregiver") {
    if (newNote) return true;
    if (input.catchUp === false) return false;
    return input.hasContent && input.lastShownDay !== input.todayKey;
  }
  if (newNote) return true;
  if (input.lastOpenMs == null) return false; // first launch on this phone: nothing to catch up on
  return input.nowMs - input.lastOpenMs >= AWAY_MIN_MS && input.othersLoggedSinceLastOpen;
}
