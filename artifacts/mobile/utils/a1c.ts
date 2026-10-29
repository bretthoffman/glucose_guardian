/**
 * Estimated-A1C range helpers for the Dose page.
 *
 * Pure (no react-native imports) so the range list, rolling-window math, A1C estimate, status, and
 * grammatical copy are unit-testable. `1D` is a rolling last-24h window, consistent with the other
 * options (each is a rolling `days * 24h` window).
 */
// Relative import (not the "@/" alias) so this pure module is resolvable by the unit-test runner too.
import { COLORS } from "../constants/colors";

/**
 * Selectable Estimated-A1C windows in days. An A1C reflects about 3 months, and the CGM consensus
 * (Battelino et al., Diabetes Care 2019) needs at least 14 days of readings with the sensor worn at
 * least 70% of the time, so shorter windows aren't offered.
 */
export type A1cRange = 14 | 30 | 90;

export const A1C_RANGES: A1cRange[] = [14, 30, 90];

/** Default: 90 days, the window an A1C actually reflects (aggregated server-side, so it's cheap). */
export const DEFAULT_A1C_RANGE: A1cRange = 90;

/** Minimum days of readings and sensor wear for the estimate to mean anything (consensus). */
export const MIN_A1C_DAYS = 14;
export const MIN_SENSOR_WEAR_PCT = 70;

/** Common A1C goal for most children and adults with diabetes (ADA). Each family's doctor may differ. */
export const DEFAULT_A1C_GOAL = 7;

/** Rolling-window cutoff (epoch ms): readings/logs at or after this fall within the selected range. */
export function rangeCutoffMs(days: number, now: number): number {
  return now - days * 24 * 60 * 60 * 1000;
}

/** Grammatical range phrase: "day" for 1, "N days" for every other value (avoids "1 days"). */
export function rangePhrase(days: number): string {
  return days === 1 ? "day" : `${days} days`;
}

/**
 * Estimated A1C from CGM: the Glucose Management Indicator (GMI, %), the formula the CGM consensus
 * and Dexcom Clarity use: 3.31 + 0.02392 × mean glucose (mg/dL). Same as the visit-summary PDF.
 */
export function estimateA1C(avgBg: number): number {
  return Math.round((3.31 + 0.02392 * avgBg) * 10) / 10;
}

/** Readings a sensor sends per day: Dexcom every 5 minutes; Libre (LibreLinkUp history) every 15. */
export function readingsPerDay(provider: string | null | undefined): number {
  return provider === "libre" ? 96 : 288;
}

/**
 * The CGM behind a set of readings, from how far apart they are: Dexcom about every 5 minutes, Libre
 * (LibreLinkUp history) about every 15. For a phone that has no CGM of its own connected, like a
 * co-guardian's. Null when there are too few readings to tell.
 */
export function inferProviderFromReadings(timestamps: readonly string[]): "dexcom" | "libre" | null {
  const ms = timestamps
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < ms.length; i++) {
    const g = (ms[i]! - ms[i - 1]!) / 60_000;
    if (g > 0.5 && g < 60) gaps.push(g); // ignore duplicates and sensor-off stretches
  }
  if (gaps.length < 6) return null;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return median > 10 ? "libre" : "dexcom";
}

/** Percent of the time the sensor was sending readings over `days` (capped at 100). */
export function sensorWearPct(count: number, days: number, provider: string | null | undefined): number {
  if (days <= 0) return 0;
  return Math.min(100, Math.round((count / (days * readingsPerDay(provider))) * 100));
}

export type A1cReadiness = "ready" | "low_wear" | "too_few_days";

/** Whether an estimate can be shown: 14+ days of readings; under 70% wear it shows with a caution. */
export function a1cReadiness(availableDays: number, wearPct: number): A1cReadiness {
  if (availableDays < MIN_A1C_DAYS) return "too_few_days";
  if (wearPct < MIN_SENSOR_WEAR_PCT) return "low_wear";
  return "ready";
}

/** Plain status against the goal: no alarm words, no emoji. */
export function a1cLabel(a1c: number, goal: number = DEFAULT_A1C_GOAL): { label: string; color: string } {
  if (a1c <= goal) return { label: `At or under ${goal}%`, color: COLORS.success };
  return { label: `Above ${goal}%`, color: COLORS.warning };
}

/** Supporting copy: factual, kind, and never about insulin doses. */
export function a1cInsight(a1c: number, goal: number = DEFAULT_A1C_GOAL): string {
  if (a1c <= goal) {
    return `At or under ${goal}%, the goal most care teams use. Your doctor may set a different one.`;
  }
  return `Above ${goal}%, the goal most care teams use. See Ways to help below, and talk with your doctor about a goal that fits.`;
}
