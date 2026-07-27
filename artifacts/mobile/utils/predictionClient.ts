/**
 * Prediction data for the Dose-tab chart — NO AI CALL. Convex's history matcher
 * (`predictionReferences.getReferences`) scores past dose events against the current situation and
 * returns the top-3 analogies with their REAL post-dose glucose readings. The chart draws those
 * actual outcomes directly as up-to-three dotted lines (opacity by confidence rank) instead of
 * asking a model to synthesize one line from them. If the matcher can't be reached (offline,
 * signed-out), we return `{ ok: false }` and the UI says the prediction is unavailable.
 */
import type { Id } from "../../../convex/_generated/dataModel";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import type { ForecastPoint } from "@/utils/glucoseForecast";
import type { MessagingIdentity } from "@/context/AuthContext";

export type StrengthLabel = "building" | "rough" | "good" | "strong";

/** One matched past episode: its confidence + the REAL readings that followed that dose. */
export interface PredictionMatchLine {
  confidence: number;
  /** tMin = minutes after the past dose; bg = the actual reading. Sorted by tMin. */
  points: ForecastPoint[];
}

export type PredictionResult =
  | {
      ok: true;
      /** Confidence-ordered (best first), at most 3 — possibly empty when history has no analogies. */
      matches: PredictionMatchLine[];
      strengthLabel: StrengthLabel;
      strength: number;
      referenceCount: number;
    }
  | { ok: false };

export interface PredictionParams {
  identity: MessagingIdentity;
  currentBG: number;
  doseUnits: number;
  carbsGrams: number;
  nowMs: number;
  history: { glucose: number; timestamp: string }[];
}

const UNAVAILABLE: PredictionResult = { ok: false };
const TIMEOUT_MS = 15000;

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
    const refs = await createConvexAuthClient().query(api.predictionReferences.getReferences, {
      ...idArgs,
      currentBG: Math.round(p.currentBG),
      doseUnits: p.doseUnits,
      carbsGrams: p.carbsGrams,
      nowMs: p.nowMs,
      recentReadings: recent,
    });
    if (!refs) return UNAVAILABLE;

    // Each reference's post-window IS a prediction line: the real readings that followed the
    // matched past dose, at their true values (deliberately NOT re-anchored to today's BG).
    const matches: PredictionMatchLine[] = refs.references
      .map((r) => ({
        confidence: r.confidence,
        points: r.post
          .map((pt) => ({ tMin: pt.minutesAfter, bg: pt.glucose }))
          .sort((a, b) => a.tMin - b.tMin),
      }))
      .filter((m) => m.points.length >= 2);

    return {
      ok: true,
      matches,
      strengthLabel: (refs.strengthLabel ?? "building") as StrengthLabel,
      strength: refs.strength ?? 0,
      referenceCount: refs.references.length,
    };
  } catch {
    return UNAVAILABLE;
  }
}
