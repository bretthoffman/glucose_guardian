import type { GlucoseTrend } from "@/components/GlucoseGauge";

export interface TrendInfo {
  glucoseTrend: GlucoseTrend;
  arrow: string;
  label: string;
  /** True only for the MAXIMUM trend speed (Dexcom DoubleUp/DoubleDown) — the two-arrow states. */
  veryFast?: boolean;
}

/**
 * Dexcom trend values — returned as either a number (1–7) or a string name
 * depending on the Share API firmware version:
 *   1 / "DoubleUp"      ↑↑  > 3 mg/dL/min
 *   2 / "SingleUp"      ↑   2–3 mg/dL/min
 *   3 / "FortyFiveUp"   ↗   1–2 mg/dL/min
 *   4 / "Flat"          →   < 1 mg/dL/min
 *   5 / "FortyFiveDown" ↘   1–2 mg/dL/min falling
 *   6 / "SingleDown"    ↓   2–3 mg/dL/min falling
 *   7 / "DoubleDown"    ↓↓  > 3 mg/dL/min falling
 */
const DEXCOM_STRING_MAP: Record<string, number> = {
  DoubleUp: 1,
  SingleUp: 2,
  FortyFiveUp: 3,
  Flat: 4,
  FortyFiveDown: 5,
  SingleDown: 6,
  DoubleDown: 7,
};

export function mapDexcomTrend(trend: number | string): TrendInfo {
  const n = typeof trend === "string" ? (DEXCOM_STRING_MAP[trend] ?? 4) : trend;
  // The app groups Dexcom's 7 states into 5 (`glucoseTrend`): SingleUp/SingleDown (2–3 mg/dL/min)
  // stay grouped with DoubleUp/DoubleDown as `rapidly_*` — the "fast" states that drive the trend
  // warning, the trend alerts, and the dose trend-adjustment. Visually though, only the MAXIMUM
  // speed (DoubleUp/DoubleDown, >3 mg/dL/min) shows the double arrow; Single* shows one arrow with
  // a "fast" label, and Double* reads "very fast".
  switch (n) {
    case 1: return { glucoseTrend: "rapidly_rising", arrow: "↑↑", label: "Rising very fast", veryFast: true };
    case 2: return { glucoseTrend: "rapidly_rising",  arrow: "↑", label: "Rising fast" };
    case 3: return { glucoseTrend: "rising",          arrow: "↗", label: "Rising slowly" };
    case 4: return { glucoseTrend: "stable",           arrow: "→", label: "Stable" };
    case 5: return { glucoseTrend: "falling",          arrow: "↘", label: "Falling slowly" };
    case 6: return { glucoseTrend: "rapidly_falling",  arrow: "↓", label: "Falling fast" };
    case 7: return { glucoseTrend: "rapidly_falling", arrow: "↓↓", label: "Falling very fast", veryFast: true };
    default: return { glucoseTrend: "stable",          arrow: "→", label: "Stable" };
  }
}

/**
 * Single source-of-truth trend resolver.
 * Prefer the Dexcom CGM trend field; fall back to diff-based calculation.
 * Use this everywhere: insulin tab, chat, dashboard — so they all agree.
 */
export function getEffectiveTrend(
  history: { glucose: number; timestamp: string; dexcomTrend?: number | string }[]
): TrendInfo {
  if (history.length === 0) return { glucoseTrend: "stable", arrow: "→", label: "Stable" };
  const latest = history[history.length - 1];
  if (latest.dexcomTrend != null) return mapDexcomTrend(latest.dexcomTrend);
  if (history.length < 2) return { glucoseTrend: "stable", arrow: "→", label: "Stable" };
  const diff = latest.glucose - history[history.length - 2].glucose;
  return trendFromDiff(diff);
}

/**
 * Fallback trend computation from a glucose diff between two consecutive readings.
 * Used only when no Dexcom trend field is available (manual entries, LibreLink).
 */
export function trendFromDiff(diff: number): TrendInfo {
  // Same grouping as mapDexcomTrend. A 5-min diff over 15 mg/dL ≈ >3 mg/dL/min — the Dexcom
  // Double* band — so the diff-based fast tier is the two-arrow "very fast" state.
  if (diff > 15) return { glucoseTrend: "rapidly_rising", arrow: "↑↑", label: "Rising very fast", veryFast: true };
  if (diff > 8)  return { glucoseTrend: "rising",          arrow: "↗", label: "Rising slowly" };
  if (diff < -15) return { glucoseTrend: "rapidly_falling", arrow: "↓↓", label: "Falling very fast", veryFast: true };
  if (diff < -8)  return { glucoseTrend: "falling",          arrow: "↘", label: "Falling slowly" };
  return { glucoseTrend: "stable", arrow: "→", label: "Stable" };
}

/**
 * True for the "fast" trend states. Derived from the `glucoseTrend` CATEGORY — the same field the
 * trend warning and the dose trend-adjustment key off — so the two-arrow gauge, the "Rising/Dropping
 * Fast" warning, and the dose math can never disagree about what counts as fast.
 */
export function isFastTrend(info: TrendInfo): boolean {
  return info.glucoseTrend === "rapidly_rising" || info.glucoseTrend === "rapidly_falling";
}

/** Compact summary-card label (title case; fast falls read "Dropping …"). */
export function trendGaugeLabel(info: TrendInfo): string {
  switch (info.label) {
    case "Rising fast":
      return "Rising Fast";
    case "Rising very fast":
      return "Rising Very Fast";
    case "Falling fast":
      return "Dropping Fast";
    case "Falling very fast":
      return "Dropping Very Fast";
    case "Rising slowly":
      return "Rising slowly";
    case "Falling slowly":
      return "Falling slowly";
    default:
      return info.label;
  }
}

/** Two arrows are reserved for the MAXIMUM trend speed; every other state shows one. */
export function trendArrowCount(info: TrendInfo): 1 | 2 {
  return info.veryFast ? 2 : 1;
}
