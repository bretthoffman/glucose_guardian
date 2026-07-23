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
  /** Dose contribution of carbs still absorbing from recent food logs (COB ÷ carb ratio). */
  activeCarbInsulin: number;
  /** Insulin-on-board subtracted from the total (0 when none active). */
  activeInsulinUnits: number;
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

export interface DoseWarningContext {
  basalSuppressed: boolean;
  insulinKind?: InsulinKind;
  isLowBG: boolean;
  isBelowTarget: boolean;
  isHighBG: boolean;
  isSpike: boolean;
  isFalling: boolean;
  iobCovers: boolean;
  iobUnits: number;
  targetBG: number;
  previousBG?: number;
  currentBG: number;
}

const mkWarn = (level: "warning" | "info", message: string): DoseWarning => ({ level, message });

/**
 * The SINGLE dose warning to show (or null). Situations that used to stack — e.g. "low" + "falling"
 * — are blended into one message here, dropping redundant advice, and a higher-priority safety
 * situation wins over lower-priority informational notes. Cautionary states use level "warning"
 * (rendered amber, ⚠); neutral / FYI states use "info" (rendered purple, ⓘ).
 */
export function buildDoseWarning(ctx: DoseWarningContext): DoseWarning | null {
  const { isFalling } = ctx;

  // Basal insulin: the meal/correction premise doesn't apply — fold in any acute glucose caution.
  if (ctx.basalSuppressed) {
    const lead = ctx.isLowBG
      ? "Glucose is low — treat it first. "
      : ctx.isHighBG
      ? "Glucose is high — verify with a finger stick. "
      : "";
    return mkWarn(
      "warning",
      `${lead}Long-acting (basal) insulin isn't dosed from carbs or corrections — enter your prescribed amount manually. This calculator's math is for mealtime insulin.`,
    );
  }

  // Low glucose — treat the low; don't give insulin.
  if (ctx.isLowBG) {
    return mkWarn(
      "warning",
      `Glucose is low${isFalling ? " and falling" : ""}. Consider fast-acting carbs (juice or glucose tabs) instead of giving insulin.`,
    );
  }

  // High glucose, optionally after a sharp spike or while already falling.
  if (ctx.isHighBG) {
    if (ctx.isSpike) {
      return mkWarn(
        "warning",
        `Glucose is high after a sharp rise (${ctx.previousBG} → ${ctx.currentBG} mg/dL). Verify with a finger stick before dosing, then monitor closely.`,
      );
    }
    if (isFalling) {
      return mkWarn(
        "warning",
        "Glucose is high but already falling. Verify with a finger stick and monitor closely after dosing.",
      );
    }
    return mkWarn("warning", "Glucose is high. Verify with a finger stick if possible and monitor closely.");
  }

  // A sharp rise that hasn't crossed the high threshold yet.
  if (ctx.isSpike) {
    return mkWarn(
      "warning",
      `Unusual spike detected (${ctx.previousBG} → ${ctx.currentBG} mg/dL). Verify with a finger stick before dosing.`,
    );
  }

  // Below target (not low): correction is suppressed. Neutral info — unless it's also falling.
  if (ctx.isBelowTarget) {
    if (isFalling) {
      return mkWarn(
        "warning",
        "Glucose is below your target and falling. No correction is added — have a small snack instead of insulin and monitor closely.",
      );
    }
    return mkWarn(
      "info",
      `BG is below target (${ctx.targetBG} mg/dL). No correction added — consider a small snack instead.`,
    );
  }

  // In range but trending down.
  if (isFalling) {
    return mkWarn(
      "warning",
      "Glucose is falling, so a trend adjustment is applied — monitor closely after dosing.",
    );
  }

  // Recent insulin already covers the calculated dose (neutral FYI).
  if (ctx.iobCovers) {
    return mkWarn(
      "info",
      `Recent insulin is still active (${Math.round(ctx.iobUnits * 100) / 100}u on board) and already covers this — no additional dose suggested.`,
    );
  }

  // Insulin-type timing reminders (only when nothing more pressing applies).
  if (ctx.insulinKind === "regular") {
    return mkWarn(
      "info",
      "Regular (short-acting) insulin starts and peaks slower than rapid-acting — inject about 30 minutes before eating.",
    );
  }
  if (ctx.insulinKind === "premixed") {
    return mkWarn(
      "info",
      "Pre-mixed insulin combines fixed rapid and intermediate portions. Confirm mealtime coverage for this dose with your care team.",
    );
  }

  return null;
}

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
  /** Insulin-on-board from recent logged doses (see utils/onBoard) — subtracted from the total. */
  activeInsulinUnits?: number;
  /** Carbs-on-board from recent food logs, in grams — dosed like carbs typed into the field. */
  activeCarbsGrams?: number;
}): DoseBreakdown {
  const {
    carbs, currentBG, targetBG, carbRatio, correctionFactor, trend, previousBG, insulinKind,
    activeInsulinUnits: activeInsulinParam, activeCarbsGrams,
  } = params;

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

  const activeCarbInsulin =
    !basalSuppressed && carbRatio > 0 && activeCarbsGrams != null && activeCarbsGrams > 0
      ? activeCarbsGrams / carbRatio
      : 0;
  const iobUnits =
    !basalSuppressed && activeInsulinParam != null && activeInsulinParam > 0
      ? activeInsulinParam
      : 0;

  const preIobTotal = Math.max(0, carbInsulin + activeCarbInsulin + correctionInsulin + trendAdj);
  const totalRaw = Math.max(0, preIobTotal - iobUnits);
  const totalDose = Math.round(totalRaw * 2) / 2;

  const isLowBG = currentBG < 90;
  const isHighBG = currentBG > 250;
  const isSpikeDetected = !!(previousBG && previousBG < 140 && currentBG > 200);

  // A single, blended warning (see buildDoseWarning) — never a stack of separate messages.
  const warning = buildDoseWarning({
    basalSuppressed,
    insulinKind,
    isLowBG,
    isBelowTarget: correctionSuppressed && !isLowBG,
    isHighBG,
    isSpike: isSpikeDetected,
    isFalling: !basalSuppressed && (trend === "rapidly_falling" || trend === "falling"),
    iobCovers: iobUnits > 0 && preIobTotal > 0 && totalRaw === 0,
    iobUnits,
    targetBG,
    previousBG,
    currentBG,
  });
  const warnings: DoseWarning[] = warning ? [warning] : [];

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
    activeCarbInsulin: Math.round(activeCarbInsulin * 100) / 100,
    activeInsulinUnits: Math.round(iobUnits * 100) / 100,
  };
}
