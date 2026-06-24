/**
 * Estimated-A1C range helpers for the Dose page.
 *
 * Pure (no react-native imports) so the range list, rolling-window math, A1C estimate, status, and
 * grammatical copy are unit-testable. `1D` is a rolling last-24h window, consistent with the other
 * options (each is a rolling `days * 24h` window).
 */
// Relative import (not the "@/" alias) so this pure module is resolvable by the unit-test runner too.
import { COLORS } from "../constants/colors";

/** Selectable Estimated-A1C windows in days, in display order. `1` = last 24 hours. */
export type A1cRange = 1 | 3 | 7 | 14 | 30 | 90;

export const A1C_RANGES: A1cRange[] = [1, 3, 7, 14, 30, 90];

/** Default selected range — unchanged by adding 1D. */
export const DEFAULT_A1C_RANGE: A1cRange = 14;

/** Rolling-window cutoff (epoch ms): readings/logs at or after this fall within the selected range. */
export function rangeCutoffMs(days: A1cRange, now: number): number {
  return now - days * 24 * 60 * 60 * 1000;
}

/** Grammatical range phrase: "day" for 1, "N days" for every other value (avoids "1 days"). */
export function rangePhrase(days: A1cRange): string {
  return days === 1 ? "day" : `${days} days`;
}

/** ADAG-style estimated A1C (%) from an average glucose (mg/dL). */
export function estimateA1C(avgBg: number): number {
  return Math.round(((avgBg + 46.7) / 28.7) * 10) / 10;
}

export function a1cLabel(a1c: number): { label: string; emoji: string; color: string } {
  if (a1c < 7) return { label: "Good", emoji: "✅", color: COLORS.success };
  if (a1c < 8) return { label: "Needs Attention", emoji: "⚠️", color: COLORS.warning };
  return { label: "High Risk", emoji: "🚨", color: COLORS.danger };
}

/** Supporting copy. Range-dependent text uses `rangePhrase` so 1D reads "over the last day". */
export function a1cInsight(avgBg: number, timeRange: A1cRange): string {
  const a1c = estimateA1C(avgBg);
  if (a1c < 7) {
    if (timeRange <= 7) return `Your estimated A1C is looking great over the last ${rangePhrase(timeRange)}. Keep up the current routine!`;
    return `Excellent glucose control over the last ${rangePhrase(timeRange)}. Consistent time-in-range is the key driver.`;
  }
  if (a1c < 8) {
    return `Your A1C estimate suggests some room for improvement. Focus on post-meal control and consistent meal timing to bring this down.`;
  }
  return `Frequent highs are impacting your estimated A1C. Improving post-meal control and reviewing meal insulin timing could lower it meaningfully.`;
}
