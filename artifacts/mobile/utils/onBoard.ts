import { findInsulinByChipLabel, isBolusInsulin } from "../constants/insulin";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";

/**
 * Insulin-on-board (IOB) and carbs-on-board (COB) from the on-device logs — the standard pump
 * bolus-calculator model, with linear decay (the accepted manual-calculator simplification; it
 * reports slightly MORE remaining insulin mid-window than the true activity curve, which biases
 * the next suggestion smaller — the safe direction).
 *
 *  - Rapid-acting insulin: ~4 h duration of insulin action (DIA).
 *  - Regular / pre-mixed: slower, longer tail — 6 h.
 *  - Basal insulin (long/ultra-long/intermediate) NEVER counts toward IOB — standard practice.
 *  - Entries with no recorded insulin type are counted as rapid: counting an unknown mealtime
 *    dose is the safe direction (it can only reduce the next suggestion).
 *  - Logged carbs absorb over ~3 h.
 */
export const RAPID_DIA_MIN = 240;
export const REGULAR_DIA_MIN = 360;
export const CARB_ABSORPTION_MIN = 180;

export interface ActiveInsulinSummary {
  /** Decayed sum of active mealtime insulin, in units (2 dp). */
  totalUnits: number;
  doseCount: number;
  lastDoseUnits: number | null;
  lastDoseAgeMin: number | null;
}

export interface ActiveCarbsSummary {
  /** Decayed sum of absorbing carbs, in grams (whole). */
  totalGrams: number;
  entryCount: number;
  lastEntryGrams: number | null;
  lastEntryAgeMin: number | null;
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
  let doseCount = 0;
  let last: { units: number; ageMin: number } | null = null;

  for (const entry of insulinLog) {
    if (!(entry.units > 0)) continue;
    const dia = insulinEntryDiaMin(entry);
    if (dia == null) continue;
    const ageMin = entryAgeMin(entry.timestamp, nowMs);
    if (ageMin == null || ageMin >= dia) continue;
    totalUnits += entry.units * (1 - ageMin / dia);
    doseCount++;
    if (last == null || ageMin < last.ageMin) last = { units: entry.units, ageMin };
  }

  return {
    totalUnits: Math.round(totalUnits * 100) / 100,
    doseCount,
    lastDoseUnits: last?.units ?? null,
    lastDoseAgeMin: last != null ? Math.round(last.ageMin) : null,
  };
}

export function computeActiveCarbs(foodLog: FoodLogEntry[], nowMs: number): ActiveCarbsSummary {
  let totalGrams = 0;
  let entryCount = 0;
  let last: { grams: number; ageMin: number } | null = null;

  for (const entry of foodLog) {
    if (!(entry.estimatedCarbs > 0)) continue;
    const ageMin = entryAgeMin(entry.timestamp, nowMs);
    if (ageMin == null || ageMin >= CARB_ABSORPTION_MIN) continue;
    totalGrams += entry.estimatedCarbs * (1 - ageMin / CARB_ABSORPTION_MIN);
    entryCount++;
    if (last == null || ageMin < last.ageMin) last = { grams: entry.estimatedCarbs, ageMin };
  }

  return {
    totalGrams: Math.round(totalGrams),
    entryCount,
    lastEntryGrams: last?.grams ?? null,
    lastEntryAgeMin: last != null ? Math.round(last.ageMin) : null,
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
