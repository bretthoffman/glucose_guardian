/**
 * Forward glucose projection + fixed time-window math for the Dose-tab prediction chart.
 *
 * This is a VISUALIZATION estimate — it does NOT feed the dose calculator and never changes a
 * suggested dose. It answers "if you take the suggested dose right now, where is your glucose
 * headed?" using the SAME linear insulin/carb activity model the calculator already uses for
 * insulin-on-board / carbs-on-board (see utils/onBoard). Everything here is pure so the projection
 * and the hour-axis rounding rules stay unit-testable.
 */
import { CARB_ABSORPTION_MIN, RAPID_DIA_MIN, insulinEntryDiaMin } from "./onBoard";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";

export const FORECAST_HORIZON_MIN = 240; // 4 h of prediction to the right of "now"
export const FORECAST_STEP_MIN = 10;
/** Keep the projection on the shared 40–400 mg/dL chart canvas. */
const BG_FLOOR = 40;
const BG_CEIL = 400;

export interface ForecastPoint {
  /** Minutes after "now". */
  tMin: number;
  /** Predicted glucose (mg/dL), clamped to the chart's display range. */
  bg: number;
}

export interface GlucoseForecastInput {
  currentBG: number;
  nowMs: number;
  insulinLog: InsulinLogEntry[];
  foodLog: FoodLogEntry[];
  /** The suggested/entered dose modeled as taken right now. */
  newDoseUnits: number;
  /** Carbs entered in the calculator, modeled as eaten right now. */
  newCarbsGrams: number;
  correctionFactor: number; // ISF — mg/dL dropped per unit
  carbRatio: number; // grams covered per unit
  /** DIA for the dose taken now (rapid vs. regular); defaults to rapid. */
  newDoseDiaMin?: number;
  horizonMin?: number;
  stepMin?: number;
}

/** Linear fraction of an effect delivered by `age` minutes over its `total`-minute window. */
function actedFraction(ageMin: number, totalMin: number): number {
  if (totalMin <= 0) return 1;
  if (ageMin <= 0) return 0;
  if (ageMin >= totalMin) return 1;
  return ageMin / totalMin;
}

/** One active-agent contribution: an amount plus how far into its action window it already is. */
interface Kinetic {
  amount: number;
  ageNowMin: number;
  totalMin: number;
}

export function forecastGlucose(input: GlucoseForecastInput): ForecastPoint[] {
  const {
    currentBG,
    nowMs,
    insulinLog,
    foodLog,
    newDoseUnits,
    newCarbsGrams,
    correctionFactor,
    carbRatio,
    newDoseDiaMin = RAPID_DIA_MIN,
    horizonMin = FORECAST_HORIZON_MIN,
    stepMin = FORECAST_STEP_MIN,
  } = input;

  const isf = correctionFactor > 0 ? correctionFactor : 50;
  // 1 unit covers `carbRatio` g and drops `isf` mg/dL, so 1 g raises ≈ isf / carbRatio mg/dL.
  const gramsToMgdl = carbRatio > 0 ? isf / carbRatio : 0;

  // Insulin still acting (basal never lowers BG here — insulinEntryDiaMin returns null), plus the
  // dose being taken now. Carbs still absorbing, plus the meal being entered now.
  const insulinKinetics: Kinetic[] = [];
  for (const e of insulinLog) {
    if (!(e.units > 0)) continue;
    const dia = insulinEntryDiaMin(e);
    if (dia == null) continue;
    const ageNow = Math.max(0, (nowMs - new Date(e.timestamp).getTime()) / 60000);
    if (!Number.isFinite(ageNow) || ageNow >= dia) continue;
    insulinKinetics.push({ amount: e.units, ageNowMin: ageNow, totalMin: dia });
  }
  if (newDoseUnits > 0) {
    insulinKinetics.push({ amount: newDoseUnits, ageNowMin: 0, totalMin: newDoseDiaMin });
  }

  const carbKinetics: Kinetic[] = [];
  for (const e of foodLog) {
    if (!(e.estimatedCarbs > 0)) continue;
    const ageNow = Math.max(0, (nowMs - new Date(e.timestamp).getTime()) / 60000);
    if (!Number.isFinite(ageNow) || ageNow >= CARB_ABSORPTION_MIN) continue;
    carbKinetics.push({ amount: e.estimatedCarbs, ageNowMin: ageNow, totalMin: CARB_ABSORPTION_MIN });
  }
  if (newCarbsGrams > 0) {
    carbKinetics.push({ amount: newCarbsGrams, ageNowMin: 0, totalMin: CARB_ABSORPTION_MIN });
  }

  const points: ForecastPoint[] = [];
  for (let t = 0; t <= horizonMin + 1e-6; t += stepMin) {
    // Only the action DELIVERED between now and t moves BG from its current value.
    let drop = 0;
    for (const k of insulinKinetics) {
      const delivered =
        actedFraction(k.ageNowMin + t, k.totalMin) - actedFraction(k.ageNowMin, k.totalMin);
      drop += k.amount * isf * delivered;
    }
    let rise = 0;
    for (const k of carbKinetics) {
      const absorbed =
        actedFraction(k.ageNowMin + t, k.totalMin) - actedFraction(k.ageNowMin, k.totalMin);
      rise += k.amount * gramsToMgdl * absorbed;
    }
    const bg = Math.max(BG_FLOOR, Math.min(BG_CEIL, currentBG + rise - drop));
    points.push({ tMin: Math.round(t), bg: Math.round(bg) });
  }
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Hour-locked time window around "now". The span depends on the selected insulin's speed.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

export interface PredictionWindowConfig {
  /** Hours of real readings shown before "now". */
  historyHours: number;
  /** Hours of projection shown after "now". */
  forecastHours: number;
  /** An hour tick within this many minutes of "now" is dropped (avoids colliding with the Now marker). */
  tickHideMin: number;
}

/** Fast insulin (rapid/short/regular): a tight 3h-back / 2h-forward view. */
export const BOLUS_PREDICTION_WINDOW: PredictionWindowConfig = {
  historyHours: 3,
  forecastHours: 2,
  tickHideMin: 25,
};

/** Long-acting insulin: a wider 6h-back / 4h-forward view (kept ready for when the chart is shown
 *  in the basal view). Its ticks hide within 35 min of Now since the hours sit closer together. */
export const BASAL_PREDICTION_WINDOW: PredictionWindowConfig = {
  historyHours: 6,
  forecastHours: 4,
  tickHideMin: 35,
};

export interface PredictionWindow {
  leftMs: number;
  rightMs: number;
  spanMs: number;
  /** 0..1 x-position of "now" (floats near the middle depending on the minute). */
  nowFrac: number;
}

/** Nearest whole hour to `nowMs`; exactly :30 rounds DOWN (per the 6:30 vs 6:36 examples). */
export function anchorHourMs(nowMs: number): number {
  const d = new Date(nowMs);
  const minutes = d.getMinutes() + d.getSeconds() / 60;
  d.setMinutes(0, 0, 0);
  let ms = d.getTime();
  if (minutes > 30) ms += HOUR_MS;
  return ms;
}

/** Lock the window to whole hours so the axis reads 12pm 1pm 2pm … with "now" floating between. */
export function predictionWindow(
  nowMs: number,
  config: PredictionWindowConfig = BOLUS_PREDICTION_WINDOW,
): PredictionWindow {
  const anchor = anchorHourMs(nowMs);
  const leftMs = anchor - config.historyHours * HOUR_MS;
  const rightMs = anchor + config.forecastHours * HOUR_MS;
  const spanMs = rightMs - leftMs;
  return { leftMs, rightMs, spanMs, nowFrac: (nowMs - leftMs) / spanMs };
}

export interface PredictionHourTick {
  ms: number;
  xFrac: number;
  label: string;
  /** Hidden when within `config.tickHideMin` of "now". */
  hidden: boolean;
}

/** "6pm", "12am" — lowercase, no space, matching the reference mockup. */
export function formatHourLabel(ms: number): string {
  const h = new Date(ms).getHours();
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
}

export function predictionHourTicks(
  nowMs: number,
  config: PredictionWindowConfig = BOLUS_PREDICTION_WINDOW,
): PredictionHourTick[] {
  const { leftMs, rightMs, spanMs } = predictionWindow(nowMs, config);
  const hideMs = config.tickHideMin * 60000;
  const ticks: PredictionHourTick[] = [];
  for (let ms = leftMs; ms <= rightMs + 1; ms += HOUR_MS) {
    ticks.push({
      ms,
      xFrac: (ms - leftMs) / spanMs,
      label: formatHourLabel(ms),
      hidden: Math.abs(ms - nowMs) <= hideMs,
    });
  }
  return ticks;
}
