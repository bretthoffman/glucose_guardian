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
}

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
}): DoseBreakdown {
  const { carbs, currentBG, targetBG, carbRatio, correctionFactor, trend, previousBG } = params;

  const warnings: DoseWarning[] = [];

  const carbInsulin = carbRatio > 0 ? carbs / carbRatio : 0;

  const correctionSuppressed = currentBG < targetBG;
  let correctionInsulin = 0;
  if (!correctionSuppressed && correctionFactor > 0) {
    correctionInsulin = (currentBG - targetBG) / correctionFactor;
  }

  const trendAdj = TREND_ADJ[trend] ?? 0;
  const trendLabel = TREND_LABELS[trend] ?? "Stable →";
  const trendAdjLabel =
    trendAdj > 0 ? `+${trendAdj}` : trendAdj < 0 ? `${trendAdj}` : "0";

  const totalRaw = Math.max(0, carbInsulin + correctionInsulin + trendAdj);
  const totalDose = Math.round(totalRaw * 2) / 2;

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

  if (trend === "rapidly_falling" || trend === "falling") {
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
  };
}
