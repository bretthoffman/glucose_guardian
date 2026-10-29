/**
 * Finger-stick (blood-glucose meter) helpers: match a meter check to the CGM reading at the same
 * moment, and describe how far apart they are. Pure + unit-tested.
 *
 * This is INFORMATIONAL ONLY. Nothing here feeds dose math — a finger stick never changes a
 * recommended dose, and logging one never changes the CGM.
 */

/** Meter readings outside this range are typos, not readings (most meters read about 20–600). */
export const METER_MIN_MG_DL = 20;
export const METER_MAX_MG_DL = 600;

/** The nearest CGM reading must be within this much of the finger stick to count as "the same moment". */
export const CGM_MATCH_WINDOW_MS = 10 * 60 * 1000;

export interface CgmPoint {
  glucose: number;
  timestamp: string;
  dexcomTrend?: number | string;
}

export interface CgmMatch {
  glucose: number;
  timestamp: string;
  trend?: string;
}

/**
 * The CGM reading closest in time to `atMs`, if one is within {@link CGM_MATCH_WINDOW_MS}.
 * Readings can arrive in any order.
 */
export function matchCgmReading(readings: CgmPoint[], atMs: number): CgmMatch | null {
  let best: CgmPoint | null = null;
  let bestGap = Infinity;
  for (const r of readings) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t) || !Number.isFinite(r.glucose)) continue;
    const gap = Math.abs(t - atMs);
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  if (!best || bestGap > CGM_MATCH_WINDOW_MS) return null;
  const trend = best.dexcomTrend != null ? String(best.dexcomTrend) : undefined;
  return { glucose: best.glucose, timestamp: best.timestamp, ...(trend ? { trend } : {}) };
}

/** Parse typed meter text. Whole mg/dL only; null when empty, not a number, or out of range. */
export function parseMeterInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = parseInt(t, 10);
  return n >= METER_MIN_MG_DL && n <= METER_MAX_MG_DL ? n : null;
}

export type FingerStickVerdict = "close" | "different";

export interface FingerStickComparison {
  /** CGM minus meter, mg/dL (positive = CGM read higher). */
  diff: number;
  /** |diff| as a whole percent of the meter value. */
  pct: number;
  direction: "higher" | "lower" | "same";
  verdict: FingerStickVerdict;
}

/**
 * The common CGM-accuracy benchmark ("15/15"): a CGM reading counts as a close match when it is
 * within 15 mg/dL of the meter below 100 mg/dL, or within 15% at 100 mg/dL and above.
 */
export function compareFingerStick(meter: number, cgm: number): FingerStickComparison {
  const diff = Math.round(cgm - meter);
  const pct = meter > 0 ? Math.round((Math.abs(diff) / meter) * 100) : 0;
  const close = meter < 100 ? Math.abs(diff) <= 15 : Math.abs(diff) <= meter * 0.15;
  return {
    diff,
    pct,
    direction: diff > 0 ? "higher" : diff < 0 ? "lower" : "same",
    verdict: close ? "close" : "different",
  };
}

/**
 * Whether glucose was changing fast at the time, from the Dexcom trend. Covers Dexcom's arrow
 * names ("SingleUp", "DoubleDown"…), their numeric codes (1, 2, 6, 7), and plain words.
 */
export function isTrendMovingFast(trend: string | undefined): boolean {
  if (!trend) return false;
  const t = trend.trim().toLowerCase();
  if (["1", "2", "6", "7"].includes(t)) return true;
  return /double|single|rising quickly|falling quickly|fast/.test(t) && !/45|flat|steady|stable/.test(t);
}

/** "The CGM read 32 higher (+18%)" / "The CGM read 14 lower" / "The CGM matched exactly". */
export function comparisonSentence(c: FingerStickComparison): string {
  if (c.direction === "same") return "The CGM matched exactly";
  const amount = Math.abs(c.diff);
  const pctText = c.pct > 0 ? ` (${c.direction === "higher" ? "+" : "−"}${c.pct}%)` : "";
  return `The CGM read ${amount} ${c.direction}${pctText}`;
}

/** Short form for log rows: "32 higher" / "14 lower" / "exact match". */
export function comparisonShort(c: FingerStickComparison): string {
  if (c.direction === "same") return "exact match";
  return `${Math.abs(c.diff)} ${c.direction}`;
}

export const FINGER_STICK_REASONS = [
  { key: "seemed_off", label: "Number seemed off" },
  { key: "symptoms", label: "Felt low or high" },
  { key: "before_dosing", label: "Before dosing" },
  { key: "new_sensor", label: "New sensor" },
  { key: "routine", label: "Routine" },
] as const;

export type FingerStickReasonKey = (typeof FINGER_STICK_REASONS)[number]["key"];

export function reasonLabel(key: string | undefined): string | null {
  return FINGER_STICK_REASONS.find((r) => r.key === key)?.label ?? null;
}
