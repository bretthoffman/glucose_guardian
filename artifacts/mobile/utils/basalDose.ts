import type { DoseWarning } from "./dose";

/**
 * Basal (long/ultra-long/intermediate) insulin suggestion. Unlike mealtime boluses, basal is not
 * computed from carbs or the moment's glucose — clinically it is a steady daily dose, titrated
 * against fasting/early-morning glucose:
 *
 *  - Baseline: the user's most recent logged basal dose (titration adjusts the current dose), or —
 *    when none was ever logged — an ADA-style starting estimate of 0.2 u/kg/day from body weight.
 *  - Fasting adjustment (treat-to-target): 3-day early-morning average vs target; small ±1–2 u
 *    nudges, with a reduction and warning when overnight/morning lows appear. Only applied on top
 *    of a real logged dose — a fresh weight estimate is not titrated.
 *  - Basal pens dose in whole units, so the total rounds to the nearest 1 u.
 */
export interface BasalDoseBreakdown {
  baselineUnits: number | null;
  baselineSource: "lastDose" | "weight" | null;
  /** 3-day early-morning average, when enough readings exist. */
  fastingAvg: number | null;
  fastingAdjustment: number;
  hadMorningLow: boolean;
  totalDose: number;
  warnings: DoseWarning[];
}

const KG_PER_LB = 0.45359237;
/** ADA initiation guidance: 0.1–0.2 u/kg/day — use the midpoint-conservative 0.2 for an estimate. */
const STARTING_UNITS_PER_KG = 0.2;
/** Readings below this in the fasting window trigger a dose reduction + warning. */
const MORNING_LOW_THRESHOLD = 70;
/** Minimum fasting readings before the average is trusted for titration. */
const MIN_FASTING_READINGS = 2;

export function computeBasalDose(params: {
  weightLbs?: number;
  /** Units of the most recent logged basal dose, when one exists. */
  lastBasalUnits?: number;
  /** Glucose values from the early-morning (fasting) window over the last ~3 days. */
  fastingReadings: number[];
  targetBG: number;
}): BasalDoseBreakdown {
  const { weightLbs, lastBasalUnits, fastingReadings, targetBG } = params;
  const warnings: DoseWarning[] = [];

  let baselineUnits: number | null = null;
  let baselineSource: BasalDoseBreakdown["baselineSource"] = null;
  if (lastBasalUnits != null && lastBasalUnits > 0) {
    baselineUnits = lastBasalUnits;
    baselineSource = "lastDose";
  } else if (weightLbs != null && weightLbs > 0) {
    baselineUnits = Math.round(weightLbs * KG_PER_LB * STARTING_UNITS_PER_KG);
    baselineSource = "weight";
  }

  const hadMorningLow = fastingReadings.some((g) => g < MORNING_LOW_THRESHOLD);
  const fastingAvg =
    fastingReadings.length >= MIN_FASTING_READINGS
      ? Math.round(fastingReadings.reduce((s, g) => s + g, 0) / fastingReadings.length)
      : null;

  let fastingAdjustment = 0;
  if (baselineSource === "lastDose") {
    if (hadMorningLow || (fastingAvg !== null && fastingAvg < 80)) {
      fastingAdjustment = -2;
    } else if (fastingAvg !== null && fastingAvg > targetBG + 50) {
      fastingAdjustment = 2;
    } else if (fastingAvg !== null && fastingAvg > targetBG + 20) {
      fastingAdjustment = 1;
    }
  }

  const totalDose =
    baselineUnits == null ? 0 : Math.max(0, Math.round(baselineUnits + fastingAdjustment));

  warnings.push({
    level: "info",
    message:
      "Take basal insulin at the same time each day. Dose changes should be confirmed with your care team.",
  });
  if (hadMorningLow) {
    warnings.push({
      level: "danger",
      message:
        "Overnight or early-morning lows detected in the last 3 days. A lower basal dose may be needed — contact your care team.",
    });
  }
  if (baselineUnits == null) {
    warnings.push({
      level: "info",
      message:
        "No basal history or body weight on file. Log a basal dose once (or add weight to your profile) to get a suggestion — until then, enter your prescribed amount manually.",
    });
  }

  return {
    baselineUnits,
    baselineSource,
    fastingAvg,
    fastingAdjustment,
    hadMorningLow,
    totalDose,
    warnings,
  };
}
