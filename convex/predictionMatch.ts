/**
 * Pure scoring for the AI prediction graph's history matcher (see PREDICTION_AI_PLAN_01.md).
 *
 * Given the CURRENT dose situation (pending BG / dose / carbs / trend / prior-logs) and a CANDIDATE
 * past event, produce a 0..1 confidence that the candidate is a good analogy. `predictionReferences`
 * (the Convex query) uses `partialScore` for the cheap log-only first pass and `scoreEvent` once it
 * has the candidate's BG + trend from readings. Everything here is pure so it stays unit-testable and
 * the exact same trend classification runs for the current situation and every candidate.
 *
 * Scales tuned from a read-only sample of real data (2026-07-23): dose median 1.5u/p90 2.5,
 * carbs median 35g/p90 56, glucose 52–401.
 */

export type TrendBucket = "rising_fast" | "rising_slow" | "steady" | "falling_slow" | "falling_fast";

export const BG_SCALE = 100; // mg/dL difference at which BG match → 0
export const DOSE_SCALE = 4; // units
export const CARB_SCALE = 40; // grams

/** Dimension weights (sum = 1). BG + dose dominate; prior-logs is a corroborating bonus. */
export const WEIGHTS = { bg: 0.28, dose: 0.24, carb: 0.2, trend: 0.16, priorLogs: 0.12 } as const;

/** Ordered so bucket "distance" is meaningful (falling → steady → rising). */
const TREND_ORDER: TrendBucket[] = ["falling_fast", "falling_slow", "steady", "rising_slow", "rising_fast"];

export interface Reading {
  glucose: number;
  ms: number;
}

/** A food/insulin log that sits in the 3h BEFORE an event — context for the prior-logs dimension. */
export interface PriorLog {
  kind: "insulin" | "carb";
  minutesBefore: number;
  amount: number;
}

/**
 * Classify the glucose trend over the ~20 minutes before `eventMs` into one of five buckets, by the
 * slope in mg/dL per minute. Thresholds mirror CGM single/double-arrow semantics (±0.7 / ±2.0).
 */
export function classifyTrend(readings: Reading[], eventMs: number): TrendBucket {
  const windowMs = 20 * 60_000;
  const pts = readings
    .filter((r) => r.ms <= eventMs && r.ms >= eventMs - windowMs)
    .sort((a, b) => a.ms - b.ms);
  if (pts.length < 2) return "steady";
  const first = pts[0];
  const last = pts[pts.length - 1];
  const minutes = (last.ms - first.ms) / 60_000;
  if (minutes <= 0) return "steady";
  const slope = (last.glucose - first.glucose) / minutes;
  if (slope > 2.0) return "rising_fast";
  if (slope > 0.7) return "rising_slow";
  if (slope < -2.0) return "falling_fast";
  if (slope < -0.7) return "falling_slow";
  return "steady";
}

/** 1 when equal, decaying linearly to 0 at `scale` apart. */
export function proximity(a: number, b: number, scale: number): number {
  if (scale <= 0) return a === b ? 1 : 0;
  return 1 - Math.min(1, Math.abs(a - b) / scale);
}

/** Same bucket 1.0, off-by-one 0.5, off-by-two 0.2, further 0. */
export function trendMatch(a: TrendBucket, b: TrendBucket): number {
  const d = Math.abs(TREND_ORDER.indexOf(a) - TREND_ORDER.indexOf(b));
  return d === 0 ? 1 : d === 1 ? 0.5 : d === 2 ? 0.2 : 0;
}

/**
 * How well the candidate's pre-event logs match the current situation's pre-event logs. Both empty
 * is a clean match (1.0); a one-sided mismatch (only one has prior logs) is penalized, so a candidate
 * whose lead-in looks like the current lead-in scores higher than one with no prior logs at all.
 */
export function priorLogsMatch(current: PriorLog[], candidate: PriorLog[]): number {
  if (current.length === 0 && candidate.length === 0) return 1;
  if (current.length === 0 || candidate.length === 0) return 0.2;
  let total = 0;
  for (const c of current) {
    let best = 0;
    for (const d of candidate) {
      if (d.kind !== c.kind) continue;
      const timeSim = 1 - Math.min(1, Math.abs(c.minutesBefore - d.minutesBefore) / 90);
      const amtSim = proximity(c.amount, d.amount, c.kind === "insulin" ? DOSE_SCALE : CARB_SCALE);
      best = Math.max(best, 0.5 * timeSim + 0.5 * amtSim);
    }
    total += best;
  }
  return total / current.length;
}

export interface Situation {
  bg: number;
  dose: number;
  carbs: number;
  trend: TrendBucket;
  priorLogs: PriorLog[];
}

/** Log-only partial score (Pass 1): dose + carb + prior-logs, no readings needed. Max = 0.56. */
export function partialScore(cur: Omit<Situation, "bg" | "trend">, ev: Omit<Situation, "bg" | "trend">): number {
  return (
    WEIGHTS.dose * proximity(cur.dose, ev.dose, DOSE_SCALE) +
    WEIGHTS.carb * proximity(cur.carbs, ev.carbs, CARB_SCALE) +
    WEIGHTS.priorLogs * priorLogsMatch(cur.priorLogs, ev.priorLogs)
  );
}

/** Full confidence (Pass 2): partial + BG + trend. 0..1. */
export function scoreEvent(cur: Situation, ev: Situation): number {
  return (
    partialScore(cur, ev) +
    WEIGHTS.bg * proximity(cur.bg, ev.bg, BG_SCALE) +
    WEIGHTS.trend * trendMatch(cur.trend, ev.trend)
  );
}

export type StrengthLabel = "building" | "rough" | "good" | "strong";

/**
 * Combine the chosen references' confidences into one strength signal: the mean match quality scaled
 * by a corroboration factor (more consistent matches → more trustworthy). A single near-perfect
 * analogy still reads "strong"; a lone weak match reads "rough"; no references reads "building".
 */
export function combineStrength(confidences: number[]): { strength: number; label: StrengthLabel } {
  const c = confidences.filter((x) => x > 0).sort((a, b) => b - a).slice(0, 3);
  if (c.length === 0) return { strength: 0, label: "building" };
  const mean = c.reduce((s, x) => s + x, 0) / c.length;
  const countFactor = c.length >= 3 ? 1.0 : c.length === 2 ? 0.92 : 0.8;
  const strength = mean * countFactor;
  const label: StrengthLabel =
    strength > 0.72 ? "strong" : strength >= 0.55 ? "good" : strength >= 0.32 ? "rough" : "building";
  return { strength, label };
}
