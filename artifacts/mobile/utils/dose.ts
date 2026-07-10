export interface DoseBreakdown {
  carbInsulin: number;
  correctionInsulin: number;
  trendAdjustment: number;
  totalRaw: number;
  totalDose: number;
  warnings: DoseWarning[];
  trendLabel: string;
  trendAdjLabel: string;
  isLowBG: boolean;
  isHighBG: boolean;
  isSpikeDetected: boolean;
  correctionSuppressed: boolean;
  /** True when a basal (intermediate/long/ultra-long) insulin is selected — meal math suppressed. */
  basalSuppressed: boolean;
}

export type InsulinKind = "rapid" | "regular" | "intermediate" | "long" | "ultra-long" | "premixed";

const BASAL_KINDS: InsulinKind[] = ["intermediate", "long", "ultra-long"];

export interface DoseWarning {
  level: "danger" | "warning" | "info";
  message: string;
}

const TREND_ADJ: Record<string, number> = {
  rapidly_rising: 0.5,
  rising: 0.25,
  stable: 0,
  falling: -0.25,
  rapidly_falling: -0.5,
};

const TREND_LABELS: Record<string, string> = {
  rapidly_rising: "Rising fast ↑",
  rising: "Rising ↗",
  stable: "Stable →",
  falling: "Falling ↘",
  rapidly_falling: "Falling fast ↓",
};

export function computeDose(params: {
  carbs: number;
  currentBG: number;
  targetBG: number;
  carbRatio: number;
  correctionFactor: number;
  trend: string;
  previousBG?: number;
  /** Acting class of the insulin the dose is for — defaults to rapid-acting behavior. */
  insulinKind?: InsulinKind;
}): DoseBreakdown {
  const { carbs, currentBG, targetBG, carbRatio, correctionFactor, trend, previousBG, insulinKind } = params;

  const warnings: DoseWarning[] = [];
  const basalSuppressed = insulinKind != null && BASAL_KINDS.includes(insulinKind);

  const carbInsulin = !basalSuppressed && carbRatio > 0 ? carbs / carbRatio : 0;

  const correctionSuppressed = !basalSuppressed && currentBG < targetBG;
  let correctionInsulin = 0;
  if (!basalSuppressed && !correctionSuppressed && correctionFactor > 0) {
    correctionInsulin = (currentBG - targetBG) / correctionFactor;
  }

  const trendAdj = basalSuppressed ? 0 : TREND_ADJ[trend] ?? 0;
  const trendLabel = TREND_LABELS[trend] ?? "Stable →";
  const trendAdjLabel =
    trendAdj > 0 ? `+${trendAdj}` : trendAdj < 0 ? `${trendAdj}` : "0";

  const totalRaw = Math.max(0, carbInsulin + correctionInsulin + trendAdj);
  const totalDose = Math.round(totalRaw * 2) / 2;

  if (basalSuppressed) {
    warnings.push({
      level: "warning",
      message:
        "Long-acting (basal) insulin isn't dosed from carbs or corrections. Enter your prescribed basal amount manually — this calculator's math applies to mealtime insulin.",
    });
  } else if (insulinKind === "regular") {
    warnings.push({
      level: "info",
      message:
        "Regular (short-acting) insulin starts and peaks slower than rapid-acting — inject about 30 minutes before eating.",
    });
  } else if (insulinKind === "premixed") {
    warnings.push({
      level: "info",
      message:
        "Pre-mixed insulin combines fixed rapid and intermediate portions. Confirm mealtime coverage for this dose with your care team.",
    });
  }

  const isLowBG = currentBG < 90;
  const isHighBG = currentBG > 250;
  const isSpikeDetected = !!(previousBG && previousBG < 140 && currentBG > 200);

  if (isLowBG) {
    warnings.push({
      level: "danger",
      message: "Glucose is low. Consider fast-acting carbs (juice or glucose tabs) before giving insulin.",
    });
  }

  if (correctionSuppressed && !isLowBG) {
    warnings.push({
      level: "info",
      message: `BG is below target (${targetBG} mg/dL). No correction added — consider a small snack instead.`,
    });
  }

  if (isHighBG) {
    warnings.push({
      level: "warning",
      message: "Glucose is high. Monitor closely and verify with a finger stick if possible.",
    });
  }

  if (isSpikeDetected) {
    warnings.push({
      level: "warning",
      message: `Unusual spike detected (${previousBG} → ${currentBG} mg/dL). Consider verifying with a finger stick.`,
    });
  }

  if (!basalSuppressed && (trend === "rapidly_falling" || trend === "falling")) {
    warnings.push({
      level: "warning",
      message: "Glucose is falling. Trend adjustment applied. Monitor closely after dosing.",
    });
  }

  return {
    carbInsulin: Math.round(carbInsulin * 100) / 100,
    correctionInsulin: Math.round(correctionInsulin * 100) / 100,
    trendAdjustment: trendAdj,
    totalRaw: Math.round(totalRaw * 100) / 100,
    totalDose,
    warnings,
    trendLabel,
    trendAdjLabel,
    isLowBG,
    isHighBG,
    isSpikeDetected,
    correctionSuppressed,
    basalSuppressed,
  };
}
