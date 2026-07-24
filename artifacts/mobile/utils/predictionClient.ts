/**
 * Orchestrates the AI prediction for the Dose-tab chart (see PREDICTION_AI_PLAN_01.md):
 *   1. ask Convex (`predictionReferences.getReferences`) for the top-3 historical analogies + strength,
 *   2. POST the current situation + references to the api-server `/api/predict` model gateway,
 *   3. turn the 18 returned values into `ForecastPoint[]` for the chart.
 * Any failure (offline, route not deployed, unparseable) falls back to the local linear
 * `forecastGlucose` model so the chart is never empty. Only ever called on an explicit Predict tap.
 */
import type { Id } from "../../../convex/_generated/dataModel";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { apiUrl } from "@/utils/api-base-url";
import { forecastGlucose, type ForecastPoint } from "@/utils/glucoseForecast";
import type { FoodLogEntry, InsulinLogEntry, MessagingIdentity } from "@/context/AuthContext";

export type StrengthLabel = "building" | "rough" | "good" | "strong";

export interface PredictionResult {
  forecast: ForecastPoint[];
  source: "ai" | "local";
  strengthLabel: StrengthLabel;
  strength: number;
  referenceCount: number;
}

export interface PredictionParams {
  identity: MessagingIdentity;
  currentBG: number;
  doseUnits: number;
  carbsGrams: number;
  nowMs: number;
  history: { glucose: number; timestamp: string }[];
  insulinLog: InsulinLogEntry[];
  foodLog: FoodLogEntry[];
  correctionFactor: number;
  carbRatio: number;
  newDoseDiaMin: number;
}

const HORIZON_MIN = 90;
const STEP_MIN = 5;
const N_POINTS = HORIZON_MIN / STEP_MIN;

function identityArgs(identity: MessagingIdentity) {
  if (!identity) return null;
  if (identity.kind === "code") return { code: identity.code } as const;
  return { userId: identity.userId as Id<"users">, passwordHash: identity.passwordHash } as const;
}

/** The local linear projection — the graceful degrade path, also used verbatim as the old behavior. */
function localFallback(p: PredictionParams): PredictionResult {
  const forecast = forecastGlucose({
    currentBG: p.currentBG,
    nowMs: p.nowMs,
    insulinLog: p.insulinLog,
    foodLog: p.foodLog,
    newDoseUnits: p.doseUnits,
    newCarbsGrams: p.carbsGrams,
    correctionFactor: p.correctionFactor,
    carbRatio: p.carbRatio,
    newDoseDiaMin: p.newDoseDiaMin,
    horizonMin: HORIZON_MIN,
    stepMin: STEP_MIN,
  });
  return { forecast, source: "local", strengthLabel: "building", strength: 0, referenceCount: 0 };
}

const TIMEOUT_MS = 25000;

/** Never leave the caller hanging: whichever settles first — the real run or a fallback timeout. */
export async function runPrediction(p: PredictionParams): Promise<PredictionResult> {
  return Promise.race([
    doRun(p),
    new Promise<PredictionResult>((resolve) => setTimeout(() => resolve(localFallback(p)), TIMEOUT_MS)),
  ]);
}

async function doRun(p: PredictionParams): Promise<PredictionResult> {
  const idArgs = identityArgs(p.identity);
  if (!idArgs) return localFallback(p);

  const cutoff = p.nowMs - 3 * 60 * 60 * 1000;
  const recent = p.history
    .filter((h) => new Date(h.timestamp).getTime() >= cutoff)
    .map((h) => ({ glucose: h.glucose, ms: new Date(h.timestamp).getTime() }))
    .sort((a, b) => a.ms - b.ms);

  try {
    // References are best-effort — a null (unauthorized/offline) still lets the model predict from
    // the recent trajectory + physiology.
    let refs: Awaited<ReturnType<typeof fetchRefs>> = null;
    try {
      refs = await fetchRefs(idArgs, p, recent);
    } catch {
      refs = null;
    }

    const res = await fetch(apiUrl("/api/predict"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentBG: Math.round(p.currentBG),
        recentReadings: recent.map((r) => ({
          glucose: r.glucose,
          minutesAgo: Math.max(0, Math.round((p.nowMs - r.ms) / 60000)),
        })),
        doseUnits: p.doseUnits,
        carbsGrams: p.carbsGrams,
        insulinActionHours: Math.round(p.newDoseDiaMin / 60),
        carbRatio: p.carbRatio,
        correctionFactor: p.correctionFactor,
        currentTrend: refs?.currentTrend,
        references: refs?.references ?? [],
      }),
    });
    if (!res.ok) return localFallback(p);
    const data = await res.json();
    const preds: unknown = data?.predictions;
    if (!Array.isArray(preds) || preds.length < 2) return localFallback(p);

    const forecast: ForecastPoint[] = [{ tMin: 0, bg: Math.round(p.currentBG) }];
    preds.slice(0, N_POINTS).forEach((v, i) => {
      const bg = Number(v);
      if (Number.isFinite(bg)) forecast.push({ tMin: (i + 1) * STEP_MIN, bg: Math.round(bg) });
    });
    if (forecast.length < 2) return localFallback(p);

    return {
      forecast,
      source: "ai",
      strengthLabel: (refs?.strengthLabel ?? "building") as StrengthLabel,
      strength: refs?.strength ?? 0,
      referenceCount: refs?.references.length ?? 0,
    };
  } catch {
    return localFallback(p);
  }
}

function fetchRefs(
  idArgs: NonNullable<ReturnType<typeof identityArgs>>,
  p: PredictionParams,
  recent: { glucose: number; ms: number }[],
) {
  return createConvexAuthClient().query(api.predictionReferences.getReferences, {
    ...idArgs,
    currentBG: Math.round(p.currentBG),
    doseUnits: p.doseUnits,
    carbsGrams: p.carbsGrams,
    nowMs: p.nowMs,
    recentReadings: recent,
  });
}
