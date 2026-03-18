import type { GlucoseTrend } from "@/components/GlucoseGauge";

export interface TrendInfo {
  glucoseTrend: GlucoseTrend;
  arrow: string;
  label: string;
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
  switch (n) {
    case 1: return { glucoseTrend: "rapidly_rising", arrow: "↑↑", label: "Rising fast" };
    case 2: return { glucoseTrend: "rapidly_rising", arrow: "↑",  label: "Rising" };
    case 3: return { glucoseTrend: "rising",          arrow: "↗", label: "Rising slowly" };
    case 4: return { glucoseTrend: "stable",           arrow: "→", label: "Stable" };
    case 5: return { glucoseTrend: "falling",          arrow: "↘", label: "Falling slowly" };
    case 6: return { glucoseTrend: "rapidly_falling",  arrow: "↓", label: "Falling" };
    case 7: return { glucoseTrend: "rapidly_falling",  arrow: "↓↓", label: "Falling fast" };
    default: return { glucoseTrend: "stable",          arrow: "→", label: "Stable" };
  }
}

/**
 * Fallback trend computation from a glucose diff between two consecutive readings.
 * Used only when no Dexcom trend field is available (manual entries, LibreLink).
 */
export function trendFromDiff(diff: number): TrendInfo {
  if (diff > 30) return { glucoseTrend: "rapidly_rising", arrow: "↑↑", label: "Rising fast" };
  if (diff > 15) return { glucoseTrend: "rapidly_rising", arrow: "↑",  label: "Rising" };
  if (diff > 8)  return { glucoseTrend: "rising",          arrow: "↗", label: "Rising slowly" };
  if (diff < -30) return { glucoseTrend: "rapidly_falling", arrow: "↓↓", label: "Falling fast" };
  if (diff < -15) return { glucoseTrend: "rapidly_falling", arrow: "↓",  label: "Falling" };
  if (diff < -8)  return { glucoseTrend: "falling",          arrow: "↘", label: "Falling slowly" };
  return { glucoseTrend: "stable", arrow: "→", label: "Stable" };
}
