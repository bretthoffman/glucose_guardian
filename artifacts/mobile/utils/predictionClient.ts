/**
 * Orchestrates the AI prediction for the Dose-tab chart (see PREDICTION_AI_PLAN_01.md):
 *   1. ask Convex (`predictionReferences.getReferences`) for the top-3 historical analogies + strength,
 *   2. POST the current situation + references to the api-server `/api/predict` model gateway,
 *   3. turn the 18 returned values into `ForecastPoint[]` for the chart.
 * There is NO local-math fallback — the AI prediction is the only prediction. If it can't be produced
 * (offline, route not deployed, unparseable, timed out), we return `{ ok: false }` and the UI says the
 * prediction is unavailable rather than silently showing a lesser estimate. Called only on an explicit
 * Predict tap.
 */
import type { Id } from "../../../convex/_generated/dataModel";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { apiUrl } from "@/utils/api-base-url";
import type { ForecastPoint } from "@/utils/glucoseForecast";
import type { MessagingIdentity } from "@/context/AuthContext";

export type StrengthLabel = "building" | "rough" | "good" | "strong";

export type PredictionResult =
  | { ok: true; forecast: ForecastPoint[]; strengthLabel: StrengthLabel; strength: number; referenceCount: number }
  | { ok: false };

export interface PredictionParams {
  identity: MessagingIdentity;
  currentBG: number;
  doseUnits: number;
  carbsGrams: number;
  nowMs: number;
  history: { glucose: number; timestamp: string }[];
  correctionFactor: number;
  carbRatio: number;
  newDoseDiaMin: number;
}

const UNAVAILABLE: PredictionResult = { ok: false };
const HORIZON_MIN = 90;
const STEP_MIN = 5;
const N_POINTS = HORIZON_MIN / STEP_MIN;
const TIMEOUT_MS = 25000;

function identityArgs(identity: MessagingIdentity) {
  if (!identity) return null;
  if (identity.kind === "code") return { code: identity.code } as const;
  return { userId: identity.userId as Id<"users">, passwordHash: identity.passwordHash } as const;
}

/** Never leave the caller hanging: whichever settles first — the real run or an unavailable timeout. */
export async function runPrediction(p: PredictionParams): Promise<PredictionResult> {
  return Promise.race([
    doRun(p),
    new Promise<PredictionResult>((resolve) => setTimeout(() => resolve(UNAVAILABLE), TIMEOUT_MS)),
  ]);
}

async function doRun(p: PredictionParams): Promise<PredictionResult> {
  const idArgs = identityArgs(p.identity);
  if (!idArgs) return UNAVAILABLE;

  const cutoff = p.nowMs - 3 * 60 * 60 * 1000;
  const recent = p.history
    .filter((h) => new Date(h.timestamp).getTime() >= cutoff)
    .map((h) => ({ glucose: h.glucose, ms: new Date(h.timestamp).getTime() }))
    .sort((a, b) => a.ms - b.ms);

  try {
    // References are best-effort — a null (unauthorized/offline) still lets the model predict from
    // the recent trajectory + physiology; only a failed model call marks the prediction unavailable.
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
    if (!res.ok) return UNAVAILABLE;
    const data = await res.json();
    const preds: unknown = data?.predictions;
    if (!Array.isArray(preds) || preds.length < 2) return UNAVAILABLE;

    const forecast: ForecastPoint[] = [{ tMin: 0, bg: Math.round(p.currentBG) }];
    preds.slice(0, N_POINTS).forEach((v, i) => {
      const bg = Number(v);
      if (Number.isFinite(bg)) forecast.push({ tMin: (i + 1) * STEP_MIN, bg: Math.round(bg) });
    });
    if (forecast.length < 2) return UNAVAILABLE;

    return {
      ok: true,
      forecast,
      strengthLabel: (refs?.strengthLabel ?? "building") as StrengthLabel,
      strength: refs?.strength ?? 0,
      referenceCount: refs?.references.length ?? 0,
    };
  } catch {
    return UNAVAILABLE;
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
