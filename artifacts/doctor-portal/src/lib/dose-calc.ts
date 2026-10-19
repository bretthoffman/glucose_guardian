import type { PatientSnapshot } from "@doctor-portal/api-client-react";
import { computeDose, type DoseBreakdown } from "./app-dose/dose";
import {
  MEAL_BUCKET_HOURS,
  MEAL_BUCKET_LABELS,
  effectiveDoseSettings,
  mealBucketForHour,
  type DoseSettingsByTime,
  type EffectiveDoseSettings,
} from "./app-dose/doseSettings";
import { computePatternTuning, patternFactorForNow, type BucketTuning } from "./app-dose/doseTuning";
import { findInsulinByChipLabel, isBolusInsulin, type InsulinOption } from "./app-dose/insulin";
import {
  computeActiveCarbs,
  computeActiveInsulin,
  type ActiveCarbsSummary,
  type ActiveInsulinSummary,
} from "./app-dose/onBoard";
import { getEffectiveTrend, type TrendInfo } from "./app-dose/trend";

/**
 * The app's dose calculator, run on the portal's copy of the patient's data. Inputs are derived
 * exactly as the app's calculator screen derives them (components/FoodInsulinModal): the latest
 * CGM reading and its trend, the reading ~45 min earlier, time-of-day settings, insulin and carbs
 * still on board from the logs, the learned pattern factor, and the weight-based safety cap.
 */

/** The app's built-in values when a patient hasn't saved their own (context/GlucoseContext). */
export const APP_DEFAULTS = { carbRatio: 15, correctionFactor: 50, targetGlucose: 120 };

export interface DoseCalculation {
  breakdown: DoseBreakdown;
  bg: { value: number; timestamp: string; previous?: number; delta45Min?: number; trend: TrendInfo };
  target: number;
  settings: EffectiveDoseSettings & { bucketLabel: string; bucketHours: string };
  base: { carbRatio: number; correctionFactor: number };
  /** Settings the patient hasn't saved, so the app's defaults were used. */
  defaulted: ("carb ratio" | "correction factor" | "target")[];
  activeInsulin: ActiveInsulinSummary;
  activeCarbs: ActiveCarbsSummary;
  tuning: BucketTuning;
  insulin?: InsulinOption;
  carbs: number;
}

export function calculateDose(snapshot: PatientSnapshot, carbs: number, atMs = Date.now()): DoseCalculation | null {
  const history = [...(snapshot.glucoseReadings ?? [])]
    .map((r) => ({ glucose: r.value, timestamp: r.timestamp, dexcomTrend: r.trend, t: new Date(r.timestamp).getTime() }))
    .filter((r) => r.t <= atMs)
    .sort((a, b) => a.t - b.t);
  const latest = history[history.length - 1];
  if (!latest || !(latest.glucose > 0)) return null;

  const p = snapshot.profile;
  const defaulted: DoseCalculation["defaulted"] = [];
  const pick = (value: number | undefined, fallback: number, name: DoseCalculation["defaulted"][number]) => {
    if (value != null && value > 0) return value;
    defaulted.push(name);
    return fallback;
  };
  const baseCR = pick(p.carbRatio, APP_DEFAULTS.carbRatio, "carb ratio");
  const baseCF = pick(p.correctionFactor, APP_DEFAULTS.correctionFactor, "correction factor");
  const target = pick(p.targetGlucose, APP_DEFAULTS.targetGlucose, "target");
  const byTime = (p as { doseSettingsByTime?: DoseSettingsByTime }).doseSettingsByTime;
  const at = new Date(atMs);
  const eff = effectiveDoseSettings(baseCR, baseCF, byTime, at);

  // Glucose change over ~45 min (reading 35–60 min before the latest, nearest 45) — the app's
  // IOB-effectiveness input.
  let best: { gap: number; glucose: number } | null = null;
  for (const r of history) {
    const age = (latest.t - r.t) / 60_000;
    if (age < 35 || age > 60) continue;
    const gap = Math.abs(age - 45);
    if (best == null || gap < best.gap) best = { gap, glucose: r.glucose };
  }
  const delta45Min = best ? latest.glucose - best.glucose : undefined;
  const previous = history.length >= 2 ? history[history.length - 2].glucose : undefined;
  const trend = getEffectiveTrend(history);

  // Mealtime insulin the app locks for the calculator: first rapid-acting, else first bolus-capable.
  const options = (p.insulinTypes ?? [])
    .map(findInsulinByChipLabel)
    .filter((o): o is InsulinOption => o != null);
  const insulin = options.find((o) => o.type === "rapid") ?? options.find((o) => isBolusInsulin(o.type));

  const activeInsulin = computeActiveInsulin(snapshot.insulinLog ?? [], atMs);
  const activeCarbs = computeActiveCarbs(snapshot.foodLog ?? [], atMs);
  const tuning = patternFactorForNow(computePatternTuning(snapshot.insulinLog ?? [], atMs), at);

  const breakdown = computeDose({
    carbs,
    currentBG: latest.glucose,
    targetBG: target,
    carbRatio: eff.carbRatio,
    correctionFactor: eff.correctionFactor,
    trend: trend.glucoseTrend,
    previousBG: previous,
    insulinKind: insulin?.type,
    activeInsulinUnits: activeInsulin.totalUnits,
    prePeakIobUnits: activeInsulin.prePeakUnits,
    correctionHoldRemainingMin: activeInsulin.correctionHoldRemainingMin,
    newestBolusAgeMin: activeInsulin.lastDoseAgeMin,
    activeCarbsGrams: activeCarbs.totalGrams,
    bgDelta45Min: delta45Min,
    weightLbs: p.weightLbs,
    patternFactor: tuning.factor,
  });

  return {
    breakdown,
    bg: { value: latest.glucose, timestamp: latest.timestamp, previous, delta45Min, trend },
    target,
    settings: { ...eff, bucketLabel: MEAL_BUCKET_LABELS[eff.bucket], bucketHours: MEAL_BUCKET_HOURS[eff.bucket] },
    base: { carbRatio: baseCR, correctionFactor: baseCF },
    defaulted,
    activeInsulin,
    activeCarbs,
    tuning,
    insulin,
    carbs,
  };
}

/** A sensible starting carb amount: the median of this meal window's logged meals (14 days). */
export function typicalCarbs(snapshot: PatientSnapshot, atMs = Date.now()): number {
  const bucket = mealBucketForHour(new Date(atMs).getHours());
  const cutoff = atMs - 14 * 86_400_000;
  const carbs = (snapshot.foodLog ?? [])
    .filter((f) => {
      const t = new Date(f.timestamp).getTime();
      return t >= cutoff && t <= atMs && f.estimatedCarbs > 0 && mealBucketForHour(new Date(t).getHours()) === bucket;
    })
    .map((f) => f.estimatedCarbs)
    .sort((a, b) => a - b);
  if (!carbs.length) return 0;
  const mid = Math.floor(carbs.length / 2);
  return Math.round(carbs.length % 2 ? carbs[mid] : (carbs[mid - 1] + carbs[mid]) / 2);
}
