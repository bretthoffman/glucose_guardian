/**
 * The Day Recap's numbers and list (pure, unit-tested), built on each phone from the readings and logs
 * it already has: the nurse's preview before sending, and the parent's sheet after.
 */
import { firstName, type HandoffLog, type HandoffReading } from "./handoff";
import { isLowTreatment } from "./lowTreatment";

export interface DayRecapStats {
  /** Share of readings 70 to 180 (null with fewer than 6 readings). */
  inRangePct: number | null;
  /** Separate times it went under 70. */
  lows: number;
  highest: number | null;
}

export interface DayRecapItem {
  icon: "insulin" | "meal" | "stick" | "low";
  title: string;
  sub: string;
  atMs: number;
}

const LOW = 70;
const HIGH = 180;
const MAX_ITEMS = 8;

function inWindow(ts: string, startMs: number, endMs: number): number | null {
  const t = new Date(ts).getTime();
  return Number.isFinite(t) && t >= startMs && t <= endMs ? t : null;
}

export function dayRecapStats(readings: HandoffReading[], startMs: number, endMs: number): DayRecapStats {
  const rs = readings
    .map((r) => ({ g: r.glucose, t: inWindow(r.timestamp, startMs, endMs) }))
    .filter((r): r is { g: number; t: number } => r.t != null && Number.isFinite(r.g))
    .sort((a, b) => a.t - b.t);
  let lows = 0;
  let wasLow = false;
  for (const r of rs) {
    const low = r.g < LOW;
    if (low && !wasLow) lows++;
    wasLow = low;
  }
  return {
    inRangePct: rs.length >= 6 ? Math.round((rs.filter((r) => r.g >= LOW && r.g <= HIGH).length / rs.length) * 100) : null,
    lows,
    highest: rs.length ? Math.round(Math.max(...rs.map((r) => r.g))) : null,
  };
}

/** Everything logged in the window, newest first, with who did it. A treated low gets the low icon. */
export function dayRecapItems(logs: HandoffLog[], startMs: number, endMs: number, fmt: (ms: number) => string): DayRecapItem[] {
  return logs
    .map((l) => ({ l, t: inWindow(l.timestamp, startMs, endMs) }))
    .filter((x): x is { l: HandoffLog; t: number } => x.t != null)
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_ITEMS)
    .map(({ l, t }) => {
      const treatedLow = l.kind === "meal" && isLowTreatment({ foodName: l.title });
      return {
        icon: treatedLow ? "low" : l.kind,
        title: l.title,
        sub: `${l.detail ? `${l.detail} · ` : ""}${fmt(t)}${l.byYou ? " · by you" : l.authorName ? ` · ${firstName(l.authorName)}` : ""}`,
        atMs: t,
      };
    });
}
