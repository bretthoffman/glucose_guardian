/**
 * Time-of-day dose settings. The base carb ratio / correction factor stay exactly what the user
 * set; a family can OPTIONALLY override either value for a meal window (breakfast insulin need is
 * commonly the day's highest). At dose time the calculator picks override ?? base — nothing is ever
 * silently changed underneath the user.
 */
export type MealBucket = "breakfast" | "lunch" | "dinner" | "night";

export interface DoseSettingsOverride {
  carbRatio?: number;
  correctionFactor?: number;
}

export type DoseSettingsByTime = Partial<Record<MealBucket, DoseSettingsOverride>>;

export const MEAL_BUCKETS: MealBucket[] = ["breakfast", "lunch", "dinner", "night"];

export const MEAL_BUCKET_LABELS: Record<MealBucket, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  night: "Night",
};

/** Hour ranges: breakfast 5–10, lunch 10–15, dinner 15–21, night 21–5. */
export function mealBucketForHour(hour: number): MealBucket {
  if (hour >= 5 && hour < 10) return "breakfast";
  if (hour >= 10 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 21) return "dinner";
  return "night";
}

export const MEAL_BUCKET_HOURS: Record<MealBucket, string> = {
  breakfast: "5 AM – 10 AM",
  lunch: "10 AM – 3 PM",
  dinner: "3 PM – 9 PM",
  night: "9 PM – 5 AM",
};

export interface EffectiveDoseSettings {
  carbRatio: number;
  correctionFactor: number;
  bucket: MealBucket;
  /** True when either value came from a time-of-day override rather than the base settings. */
  usedOverride: boolean;
}

/** Override ?? base for the bucket containing `at` (invalid override values ≤ 0 are ignored). */
export function effectiveDoseSettings(
  baseCarbRatio: number,
  baseCorrectionFactor: number,
  byTime: DoseSettingsByTime | undefined,
  at: Date,
): EffectiveDoseSettings {
  const bucket = mealBucketForHour(at.getHours());
  const o = byTime?.[bucket];
  const cr = o?.carbRatio != null && o.carbRatio > 0 ? o.carbRatio : baseCarbRatio;
  const cf = o?.correctionFactor != null && o.correctionFactor > 0 ? o.correctionFactor : baseCorrectionFactor;
  return {
    carbRatio: cr,
    correctionFactor: cf,
    bucket,
    usedOverride: cr !== baseCarbRatio || cf !== baseCorrectionFactor,
  };
}

/** Drops empty override objects; returns undefined when nothing remains (keeps profiles clean). */
export function normalizeDoseSettingsByTime(
  byTime: DoseSettingsByTime | undefined,
): DoseSettingsByTime | undefined {
  if (!byTime) return undefined;
  const out: DoseSettingsByTime = {};
  for (const bucket of MEAL_BUCKETS) {
    const o = byTime[bucket];
    if (!o) continue;
    const cleaned: DoseSettingsOverride = {};
    if (o.carbRatio != null && Number.isFinite(o.carbRatio) && o.carbRatio > 0) cleaned.carbRatio = o.carbRatio;
    if (o.correctionFactor != null && Number.isFinite(o.correctionFactor) && o.correctionFactor > 0) {
      cleaned.correctionFactor = o.correctionFactor;
    }
    if (Object.keys(cleaned).length > 0) out[bucket] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
