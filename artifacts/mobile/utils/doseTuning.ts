import type { InsulinLogEntry } from "@/context/AuthContext";
import { MEAL_BUCKET_LABELS, mealBucketForHour, type MealBucket } from "./doseSettings";

/**
 * Pattern tuning — learns from the family's own logs, never from silently changing settings.
 *
 * Every logged dose stores the calculator's recommendation (`recommendedUnits`) next to what was
 * actually given (`units`). When, for a given time-of-day bucket, the given doses consistently run
 * above or below the recommendations, the calculator applies a BOUNDED, VISIBLE multiplier to its
 * suggestion (shown as its own "Pattern adjustment" line) and the Insights panel suggests reviewing
 * the ratio with the care team. The user's carb ratio / correction factor are never modified.
 *
 * Feedback loop stability: `recommendedUnits` is stored AFTER the pattern adjustment, so once the
 * family starts agreeing with adjusted recommendations the ratios converge to 1 and the factor
 * decays back toward neutral on its own.
 */
export const TUNING_WINDOW_DAYS = 14;
export const TUNING_MIN_SAMPLES = 5;
/** Ratios inside ±this of 1 are treated as agreement (no adjustment). */
export const TUNING_DEAD_ZONE = 0.15;
/** The factor is always clamped to this band — tuning can nudge, never take over. */
export const TUNING_FACTOR_MIN = 0.75;
export const TUNING_FACTOR_MAX = 1.25;
/** Per-entry ratio outlier guard (a one-off 4× dose must not swing the median band). */
const RATIO_CLAMP_MIN = 0.25;
const RATIO_CLAMP_MAX = 4;
/** Recommendations below this are skipped — ratios against near-zero recs are meaningless. */
const MIN_RECOMMENDED_UNITS = 0.5;

export interface BucketTuning {
  bucket: MealBucket;
  /** Multiplier the calculator applies for doses in this bucket (1 = no adjustment). */
  factor: number;
  /** Median of given ÷ recommended across the window (before clamping to the factor band). */
  medianRatio: number;
  sampleCount: number;
}

export type PatternTuning = Record<MealBucket, BucketTuning>;

export interface TuningSuggestion {
  bucket: MealBucket;
  /** e.g. "Breakfast doses run ~40% above the recommendation" */
  title: string;
  body: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const neutral = (bucket: MealBucket): BucketTuning => ({ bucket, factor: 1, medianRatio: 1, sampleCount: 0 });

export function computePatternTuning(insulinLog: InsulinLogEntry[], nowMs: number): PatternTuning {
  const cutoff = nowMs - TUNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const ratios: Record<MealBucket, number[]> = { breakfast: [], lunch: [], dinner: [], night: [] };

  for (const entry of insulinLog) {
    if (entry.type === "basal") continue;
    if (entry.recommendedUnits == null || entry.recommendedUnits < MIN_RECOMMENDED_UNITS) continue;
    if (!(entry.units > 0)) continue;
    const t = new Date(entry.timestamp).getTime();
    if (!Number.isFinite(t) || t < cutoff || t > nowMs) continue;
    const ratio = Math.min(RATIO_CLAMP_MAX, Math.max(RATIO_CLAMP_MIN, entry.units / entry.recommendedUnits));
    ratios[mealBucketForHour(new Date(entry.timestamp).getHours())].push(ratio);
  }

  const out = {} as PatternTuning;
  for (const bucket of Object.keys(ratios) as MealBucket[]) {
    const list = ratios[bucket];
    if (list.length < TUNING_MIN_SAMPLES) {
      out[bucket] = neutral(bucket);
      continue;
    }
    const m = median(list);
    const factor =
      Math.abs(m - 1) < TUNING_DEAD_ZONE ? 1 : Math.min(TUNING_FACTOR_MAX, Math.max(TUNING_FACTOR_MIN, m));
    out[bucket] = {
      bucket,
      factor: Math.round(factor * 100) / 100,
      medianRatio: Math.round(m * 100) / 100,
      sampleCount: list.length,
    };
  }
  return out;
}

/** The factor to hand computeDose for a dose being calculated right now. */
export function patternFactorForNow(tuning: PatternTuning, at: Date): BucketTuning {
  return tuning[mealBucketForHour(at.getHours())];
}

/**
 * Care-team review suggestions for buckets with an active adjustment. These say "your setting may
 * need updating" — the app never updates the setting itself.
 */
export function tuningSuggestions(tuning: PatternTuning): TuningSuggestion[] {
  const out: TuningSuggestion[] = [];
  for (const bucket of Object.keys(tuning) as MealBucket[]) {
    const t = tuning[bucket];
    if (t.factor === 1) continue;
    const pct = Math.round(Math.abs(t.medianRatio - 1) * 100);
    const dir = t.medianRatio > 1 ? "above" : "below";
    const label = MEAL_BUCKET_LABELS[bucket];
    out.push({
      bucket,
      title: `${label} doses run ~${pct}% ${dir} the recommendation`,
      body:
        t.medianRatio > 1
          ? `Across ${t.sampleCount} recent ${label.toLowerCase()} doses, the amount actually given was typically ~${pct}% more than suggested. The calculator now nudges its ${label.toLowerCase()} suggestions up (shown as "Pattern adjustment"), but the better fix is a settings review — your ${label.toLowerCase()} carb ratio or correction factor may be too weak. Discuss with your care team before changing them.`
          : `Across ${t.sampleCount} recent ${label.toLowerCase()} doses, the amount actually given was typically ~${pct}% less than suggested. The calculator now nudges its ${label.toLowerCase()} suggestions down (shown as "Pattern adjustment"). Consider reviewing these settings with your care team.`,
    });
  }
  return out;
}
