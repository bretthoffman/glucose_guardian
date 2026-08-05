import { findInsulinByChipLabel, isBolusInsulin } from "../constants/insulin";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";

/**
 * Insulin-on-board (IOB) and carbs-on-board (COB) from the on-device logs — the standard pump
 * bolus-calculator model, with a CURVILINEAR activity curve (bilinear approximation of the real
 * rapid-insulin action profile: activity ramps to a peak ~30% into the window, then tapers).
 * The old linear decay overstated remaining insulin mid-window, which systematically shrank
 * chained daytime recommendations toward zero.
 *
 *  - Rapid-acting insulin: ~4 h duration of insulin action (DIA), activity peak ~72 min.
 *  - Regular / pre-mixed: slower, longer tail — 6 h, peak ~108 min.
 *  - Basal insulin (long/ultra-long/intermediate) NEVER counts toward IOB — standard practice.
 *  - Entries with no recorded insulin type are counted as rapid: counting an unknown mealtime
 *    dose is the safe direction (it can only reduce the next suggestion).
 *  - Logged carbs absorb linearly; the window follows the meal's absorption speed when known
 *    (fast ~2 h, medium ~3 h default, slow/high-fat ~4 h).
 */
export const RAPID_DIA_MIN = 240;
export const REGULAR_DIA_MIN = 360;
export const CARB_ABSORPTION_MIN = 180;
export const CARB_ABSORPTION_FAST_MIN = 120;
export const CARB_ABSORPTION_SLOW_MIN = 240;

/** Fraction of DIA at which insulin activity peaks in the bilinear model. */
const ACTIVITY_PEAK_FRACTION = 0.3;

export type CarbAbsorptionSpeed = "fast" | "medium" | "slow";

/** COB window in minutes for a meal's absorption speed (medium when unknown). */
export function carbAbsorptionMinFor(absorption?: CarbAbsorptionSpeed | string): number {
  if (absorption === "fast") return CARB_ABSORPTION_FAST_MIN;
  if (absorption === "slow") return CARB_ABSORPTION_SLOW_MIN;
  return CARB_ABSORPTION_MIN;
}

/**
 * Remaining fraction of a dose still to act, `ageMin` minutes in, under a bilinear activity curve
 * that rises linearly to its peak at ACTIVITY_PEAK_FRACTION×DIA and falls linearly to 0 at DIA.
 * Compared to linear decay this reports slightly MORE remaining insulin before the peak (little
 * has acted yet) and LESS after it — matching the published rapid-analog action profile.
 */
export function remainingInsulinFraction(ageMin: number, diaMin: number): number {
  if (diaMin <= 0 || ageMin >= diaMin) return 0;
  if (ageMin <= 0) return 1;
  const peak = diaMin * ACTIVITY_PEAK_FRACTION;
  // Area under the activity triangle up to `ageMin` (total area normalized to 1).
  let delivered: number;
  if (ageMin <= peak) {
    delivered = (ageMin * ageMin) / (peak * diaMin);
  } else {
    const tail = diaMin - peak;
    const remainingTail = diaMin - ageMin;
    delivered = 1 - (remainingTail * remainingTail) / (tail * diaMin);
  }
  return Math.min(1, Math.max(0, 1 - delivered));
}

export interface ActiveInsulinSummary {
  /** Decayed sum of active mealtime insulin, in units (2 dp). */
  totalUnits: number;
  doseCount: number;
  lastDoseUnits: number | null;
  lastDoseAgeMin: number | null;
  /** Sum of the ORIGINAL units of every dose still inside its window, undecayed. */
  originalUnits: number;
  /**
   * Minutes until the LAST-finishing active dose is done, and that dose's own window. Together they
   * drive the decay bar — see {@link activeFractionRemaining} for why this is time-based.
   */
  remainingMin: number;
  remainingWindowMin: number;
}

export interface ActiveCarbsSummary {
  /** Decayed sum of absorbing carbs, in grams (whole). */
  totalGrams: number;
  entryCount: number;
  lastEntryGrams: number | null;
  lastEntryAgeMin: number | null;
  /** Undecayed sum of every in-window entry. */
  originalGrams: number;
  /** Minutes until the last-finishing meal is absorbed, and that meal's own window. */
  remainingMin: number;
  remainingWindowMin: number;
}

/** DIA in minutes for a logged dose; null = excluded from IOB (basal never counts). */
export function insulinEntryDiaMin(
  entry: Pick<InsulinLogEntry, "type" | "insulinType">,
): number | null {
  if (entry.type === "basal") return null;
  if (entry.insulinType) {
    const opt = findInsulinByChipLabel(entry.insulinType);
    if (opt) {
      if (!isBolusInsulin(opt.type)) return null;
      return opt.type === "rapid" ? RAPID_DIA_MIN : REGULAR_DIA_MIN;
    }
  }
  return RAPID_DIA_MIN;
}

function entryAgeMin(timestamp: string, nowMs: number): number | null {
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return null;
  // Future-dated entries (backdating typos) count at full strength: clamping to age 0 can only
  // shrink the suggested dose, never inflate it.
  return Math.max(0, (nowMs - t) / 60_000);
}

export function computeActiveInsulin(
  insulinLog: InsulinLogEntry[],
  nowMs: number,
): ActiveInsulinSummary {
  let totalUnits = 0;
  let originalUnits = 0;
  let doseCount = 0;
  // The dose that finishes LAST decides the bar. Tracked as (minutes left, that dose's window) so the
  // fraction stays anchored to a single dose's lifetime instead of a moving aggregate.
  let latest: { remainingMin: number; windowMin: number } | null = null;
  let last: { units: number; ageMin: number } | null = null;

  for (const entry of insulinLog) {
    if (!(entry.units > 0)) continue;
    const dia = insulinEntryDiaMin(entry);
    if (dia == null) continue;
    const ageMin = entryAgeMin(entry.timestamp, nowMs);
    if (ageMin == null || ageMin >= dia) continue;
    totalUnits += entry.units * remainingInsulinFraction(ageMin, dia);
    originalUnits += entry.units;
    doseCount++;
    const leftMin = dia - ageMin;
    if (latest == null || leftMin > latest.remainingMin) {
      latest = { remainingMin: leftMin, windowMin: dia };
    }
    if (last == null || ageMin < last.ageMin) last = { units: entry.units, ageMin };
  }

  return {
    totalUnits: Math.round(totalUnits * 100) / 100,
    doseCount,
    lastDoseUnits: last?.units ?? null,
    lastDoseAgeMin: last != null ? Math.round(last.ageMin) : null,
    originalUnits: Math.round(originalUnits * 100) / 100,
    remainingMin: latest != null ? Math.round(latest.remainingMin) : 0,
    remainingWindowMin: latest?.windowMin ?? 0,
  };
}

export function computeActiveCarbs(foodLog: FoodLogEntry[], nowMs: number): ActiveCarbsSummary {
  let totalGrams = 0;
  let originalGrams = 0;
  let entryCount = 0;
  let latest: { remainingMin: number; windowMin: number } | null = null;
  let last: { grams: number; ageMin: number } | null = null;

  for (const entry of foodLog) {
    if (!(entry.estimatedCarbs > 0)) continue;
    const window = carbAbsorptionMinFor(entry.absorption);
    const ageMin = entryAgeMin(entry.timestamp, nowMs);
    if (ageMin == null || ageMin >= window) continue;
    totalGrams += entry.estimatedCarbs * (1 - ageMin / window);
    originalGrams += entry.estimatedCarbs;
    entryCount++;
    const leftMin = window - ageMin;
    if (latest == null || leftMin > latest.remainingMin) {
      latest = { remainingMin: leftMin, windowMin: window };
    }
    if (last == null || ageMin < last.ageMin) last = { grams: entry.estimatedCarbs, ageMin };
  }

  return {
    totalGrams: Math.round(totalGrams),
    entryCount,
    lastEntryGrams: last?.grams ?? null,
    lastEntryAgeMin: last != null ? Math.round(last.ageMin) : null,
    originalGrams: Math.round(originalGrams),
    remainingMin: latest != null ? Math.round(latest.remainingMin) : 0,
    remainingWindowMin: latest?.windowMin ?? 0,
  };
}

/** Compact age: "just now", "32m", "1h 20m", "2h". */
export function formatAgeShort(ageMin: number | null): string {
  if (ageMin == null || ageMin < 1) return "just now";
  const m = Math.round(ageMin);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/**
 * Fill fraction for the on-board decay bars: 1 = fully active (left edge), 0 = nothing left (right).
 *
 * TIME-based — pass `remainingMin` over `remainingWindowMin`, both anchored to the single entry that
 * finishes LAST. An earlier, amount-based version (remaining grams ÷ original grams) had a visible
 * defect: a nearly-exhausted entry still contributed its FULL original amount to the denominator while
 * contributing almost nothing to the numerator, so it dragged the fill down and the bar JUMPED BACKWARD
 * when that entry finally dropped out of the window — with nothing new logged. Measured: 17% → 50%.
 *
 * Anchoring to the last-finishing entry fixes that, because an earlier entry expiring doesn't change
 * which entry finishes last. Behavior with multiple logs:
 *  - a fresh log that outlasts everything becomes the anchor, so the bar returns to full — correct,
 *    something fully active was just added;
 *  - an older log expiring is invisible to the bar, which keeps draining smoothly.
 *
 * Returns 0 when nothing is in-window, so callers can use it directly as a "should I render?" test.
 */
export function activeFractionRemaining(remaining: number, original: number): number {
  if (!(original > 0) || !(remaining > 0)) return 0;
  return Math.min(1, Math.max(0, remaining / original));
}
