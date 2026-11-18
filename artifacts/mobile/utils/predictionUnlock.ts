/**
 * The Predict feature's unlock gate. Predictions are matched against the profile's OWN logged
 * history (utils/predictionClient → /predict), so a brand-new profile has nothing to match against
 * and would get junk forecasts. The Insulin page keeps the section visible but locked until the
 * profile has logs on PREDICTION_UNLOCK_DAYS distinct days.
 *
 * "A day of logs" = a distinct LOCAL calendar day with at least one log of any kind (insulin dose,
 * meal, or finger stick). Several logs on one day count once; the days need not be consecutive;
 * a backfilled Add Entry onto a past day counts for that day, since it is real history the matcher
 * can use. Pooled care-circle logs all count — the lock is per profile, not per device.
 */
export const PREDICTION_UNLOCK_DAYS = 7;

/** Distinct local calendar days covered by these timestamps (invalid ones are ignored). */
export function distinctLogDayCount(timestamps: readonly string[]): number {
  const days = new Set<string>();
  for (const ts of timestamps) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return days.size;
}

/** Whole days still to log before predictions unlock; 0 means unlocked. */
export function predictionDaysRemaining(distinctDays: number): number {
  return Math.max(0, PREDICTION_UNLOCK_DAYS - distinctDays);
}
