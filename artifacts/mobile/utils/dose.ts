export interface DoseBreakdown {
  carbInsulin: number;
  /** Base correction from (BG − target) ÷ ISF, BEFORE the resistance bump / trend / IOB credit. */
  correctionInsulin: number;
  /** Extra correction insulin added above very-high glucose (insulin resistance bump). */
  resistanceBump: number;
  trendAdjustment: number;
  /** True when a falling-trend reduction was zeroed because glucose is above the high threshold. */
  hyperTrendZeroed: boolean;
  totalRaw: number;
  totalDose: number;
  warnings: DoseWarning[];
  trendLabel: string;
  trendAdjLabel: string;
  isLowBG: boolean;
  isHighBG: boolean;
  isVeryHighBG: boolean;
  isSpikeDetected: boolean;
  correctionSuppressed: boolean;
  /** True when a basal (intermediate/long/ultra-long) insulin is selected — meal math suppressed. */
  basalSuppressed: boolean;
  /** Insulin equivalent of ALL carbs still absorbing from recent food logs (COB ÷ carb ratio). */
  activeCarbInsulin: number;
  /** Raw insulin-on-board from recent doses (curvilinear decay) — informational. */
  activeInsulinUnits: number;
  /**
   * The in-flight credit actually subtracted — only ever from the correction portion, never from
   * carb insulin (matches commercial bolus calculators). Equals min(net in-flight insulin,
   * correction + trend), after any effectiveness discount.
   */
  iobCredit: number;
  /** True when the IOB credit was discounted because glucose isn't falling despite it. */
  iobDiscounted: boolean;
  /** Carbs still absorbing that recent insulin does NOT cover, as insulin (added to the dose). */
  uncoveredCarbInsulin: number;
  /** Correction portion after trend and the in-flight credit (never below 0). */
  correctionApplied: number;
  /** Sum of the visible cards: carbInsulin + uncoveredCarbInsulin + correctionApplied. */
  subTotal: number;
  /** Pattern-tuning multiplier applied to the subtotal (1 when none). */
  patternFactor: number;
  /** Units the pattern adjustment added (+) or removed (−) from the subtotal. */
  patternDelta: number;
  /** The safety ceiling for a single suggestion; totalRaw is clipped to it. */
  maxDoseCap: number;
  /** True when the suggestion hit the safety cap. */
  cappedAtMax: boolean;
}

export type InsulinKind = "rapid" | "regular" | "intermediate" | "long" | "ultra-long" | "premixed";

const BASAL_KINDS: InsulinKind[] = ["intermediate", "long", "ultra-long"];

export interface DoseWarning {
  level: "danger" | "warning" | "info";
  message: string;
}

/**
 * Trend arrows as a projected glucose change over the next ~30 min (mg/dL), per the published
 * CGM trend-arrow consensus method — the dose adjustment is this delta ÷ the user's correction
 * factor, so it automatically scales to the person (a toddler with ISF 150 gets a small nudge,
 * a teen with ISF 25 a meaningful one). The old flat ±0.25/0.5u fit only one body size.
 */
const TREND_DELTA_30MIN: Record<string, number> = {
  rapidly_rising: 50,
  rising: 25,
  stable: 0,
  falling: -25,
  rapidly_falling: -50,
};

/** Trend adjustment never exceeds this many units in either direction. */
const TREND_ADJ_MAX_UNITS = 2;

const TREND_LABELS: Record<string, string> = {
  rapidly_rising: "Rising fast ↑↑",
  rising: "Rising ↗",
  stable: "Stable →",
  falling: "Falling ↘",
  rapidly_falling: "Falling fast ↓↓",
};

/** Glucose at/above this is "high" (warnings + hyper handling of falling-trend reductions). */
export const HIGH_BG_THRESHOLD = 250;
/**
 * At/above this, corrections commonly under-perform (insulin resistance at very high glucose) —
 * the correction gets a modest bump and the warning adds a ketone check.
 */
export const VERY_HIGH_BG_THRESHOLD = 300;
const RESISTANCE_FACTOR = 1.1;

/**
 * If glucose hasn't fallen at least this much over the recent window while high, in-flight
 * insulin is demonstrably not landing — only half of it is credited against the correction.
 */
const EFFECTIVENESS_MIN_FALL_MGDL = 10;
const IOB_EFFECTIVENESS_DISCOUNT = 0.5;

/** Single-suggestion safety ceiling: ~0.2 u/kg when weight is known (clamped), else 10u. */
const MAX_BOLUS_NO_WEIGHT_UNITS = 10;
const MAX_BOLUS_UNITS_PER_KG = 0.2;
const MAX_BOLUS_FLOOR_UNITS = 3;
const MAX_BOLUS_CEIL_UNITS = 15;
const KG_PER_LB = 0.45359237;

export function maxDoseCapUnits(weightLbs?: number): number {
  if (weightLbs != null && weightLbs > 0) {
    const cap = weightLbs * KG_PER_LB * MAX_BOLUS_UNITS_PER_KG;
    return Math.min(MAX_BOLUS_CEIL_UNITS, Math.max(MAX_BOLUS_FLOOR_UNITS, Math.round(cap * 2) / 2));
  }
  return MAX_BOLUS_NO_WEIGHT_UNITS;
}

export interface DoseWarningContext {
  basalSuppressed: boolean;
  insulinKind?: InsulinKind;
  isLowBG: boolean;
  isBelowTarget: boolean;
  isHighBG: boolean;
  isVeryHighBG: boolean;
  isSpike: boolean;
  isFalling: boolean;
  iobCovers: boolean;
  iobUnits: number;
  iobDiscounted: boolean;
  cappedAtMax: boolean;
  maxDoseCap: number;
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

  // High glucose, optionally after a sharp spike or while already falling. Very-high adds the
  // ketone check; an ineffective-IOB situation adds the site/pen check — both fold in here so the
  // single-warning rule holds.
  if (ctx.isHighBG) {
    const ketones = ctx.isVeryHighBG
      ? " Check for ketones — corrections can be less effective this high, so the suggestion includes a small extra correction."
      : "";
    const siteCheck = ctx.iobDiscounted
      ? " Earlier insulin doesn't appear to be lowering glucose, so only part of it is credited — consider checking the injection site or pen."
      : "";
    if (ctx.isSpike) {
      return mkWarn(
        "warning",
        `Glucose is high after a sharp rise (${ctx.previousBG} → ${ctx.currentBG} mg/dL). Verify with a finger stick before dosing, then monitor closely.${ketones}${siteCheck}`,
      );
    }
    if (isFalling) {
      return mkWarn(
        "warning",
        `Glucose is high but already falling. Verify with a finger stick and monitor closely after dosing.${ketones}${siteCheck}`,
      );
    }
    return mkWarn(
      "warning",
      `Glucose is high. Verify with a finger stick if possible and monitor closely.${ketones}${siteCheck}`,
    );
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

  // Recent insulin already covers the calculated correction (neutral FYI).
  if (ctx.iobCovers) {
    return mkWarn(
      "info",
      `Recent insulin is still active (${Math.round(ctx.iobUnits * 100) / 100}u on board) and already covers the correction — only carbs are dosed.`,
    );
  }

  // The suggestion hit the safety ceiling.
  if (ctx.cappedAtMax) {
    return mkWarn(
      "warning",
      `The calculated dose was capped at ${ctx.maxDoseCap}u for safety. If a larger dose is truly needed, confirm it with your care team before giving it.`,
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
  /** Insulin-on-board from recent logged doses (see utils/onBoard) — credits the correction. */
  activeInsulinUnits?: number;
  /** Carbs-on-board from recent food logs, in grams — balanced against insulin-on-board. */
  activeCarbsGrams?: number;
  /** Glucose change over roughly the last 45 min (mg/dL) — powers the IOB-effectiveness check. */
  bgDelta45Min?: number;
  /** Patient weight — sets the single-dose safety cap (10u ceiling when unknown). */
  weightLbs?: number;
  /** Pattern-tuning multiplier from utils/doseTuning (1 = no adjustment). Always shown, never hidden. */
  patternFactor?: number;
}): DoseBreakdown {
  const {
    carbs, currentBG, targetBG, carbRatio, correctionFactor, trend, previousBG, insulinKind,
    activeInsulinUnits: activeInsulinParam, activeCarbsGrams, bgDelta45Min, weightLbs,
  } = params;

  const basalSuppressed = insulinKind != null && BASAL_KINDS.includes(insulinKind);

  const isLowBG = currentBG < 90;
  const isHighBG = currentBG >= HIGH_BG_THRESHOLD;
  const isVeryHighBG = currentBG >= VERY_HIGH_BG_THRESHOLD;
  const isSpikeDetected = !!(previousBG && previousBG < 140 && currentBG > 200);

  // ── Carb insulin: the meal portion. NEVER reduced by insulin-on-board (the prior dose was for
  // prior food) — matching commercial bolus calculators. ──
  const carbInsulin = !basalSuppressed && carbRatio > 0 ? carbs / carbRatio : 0;

  // ── Correction: (BG − target) ÷ ISF, suppressed below target; a modest resistance bump when
  // glucose is very high (corrections under-deliver up there). ──
  const correctionSuppressed = !basalSuppressed && currentBG < targetBG;
  let correctionInsulin = 0;
  if (!basalSuppressed && !correctionSuppressed && correctionFactor > 0) {
    correctionInsulin = (currentBG - targetBG) / correctionFactor;
  }
  const resistanceBump = isVeryHighBG && correctionInsulin > 0 ? correctionInsulin * (RESISTANCE_FACTOR - 1) : 0;

  // ── Trend adjustment: projected 30-min change ÷ ISF (scales with the person), capped. A falling
  // reduction is zeroed above the high threshold — at 300+, "falling" is not a reason to shave the
  // correction that's still clearly needed. ──
  let trendAdj = 0;
  let hyperTrendZeroed = false;
  if (!basalSuppressed && correctionFactor > 0) {
    const delta = TREND_DELTA_30MIN[trend] ?? 0;
    trendAdj = Math.max(-TREND_ADJ_MAX_UNITS, Math.min(TREND_ADJ_MAX_UNITS, delta / correctionFactor));
    if (isHighBG && trendAdj < 0) {
      trendAdj = 0;
      hyperTrendZeroed = (TREND_DELTA_30MIN[trend] ?? 0) < 0;
    }
    trendAdj = Math.round(trendAdj * 100) / 100;
  }
  const trendLabel = TREND_LABELS[trend] ?? "Stable →";
  const trendAdjLabel = trendAdj > 0 ? `+${trendAdj}` : trendAdj < 0 ? `${trendAdj}` : "0";

  // ── In-flight balance: insulin still working vs carbs still absorbing (as insulin). A surplus
  // of insulin credits the CORRECTION only; a surplus of carbs is uncovered food that this dose
  // must also cover. ──
  const activeCarbInsulin =
    !basalSuppressed && carbRatio > 0 && activeCarbsGrams != null && activeCarbsGrams > 0
      ? activeCarbsGrams / carbRatio
      : 0;
  const iobUnits =
    !basalSuppressed && activeInsulinParam != null && activeInsulinParam > 0
      ? activeInsulinParam
      : 0;

  const netInFlight = iobUnits - activeCarbInsulin;

  const correctionPlusTrend = Math.max(0, correctionInsulin + resistanceBump + trendAdj);

  let iobCredit = 0;
  let iobDiscounted = false;
  let uncoveredCarbInsulin = 0;
  if (!basalSuppressed) {
    if (netInFlight > 0) {
      let credit = netInFlight;
      // Effectiveness check: high glucose that is NOT falling despite in-flight insulin means that
      // insulin demonstrably isn't landing — credit only half of it (and say so in the warning).
      if (isHighBG && bgDelta45Min != null && bgDelta45Min > -EFFECTIVENESS_MIN_FALL_MGDL) {
        credit *= IOB_EFFECTIVENESS_DISCOUNT;
        iobDiscounted = true;
      }
      iobCredit = Math.min(credit, correctionPlusTrend);
    } else if (netInFlight < 0) {
      uncoveredCarbInsulin = -netInFlight;
    }
  }

  const correctionApplied = Math.max(0, correctionPlusTrend - iobCredit);
  const subTotal = Math.max(0, carbInsulin + uncoveredCarbInsulin + correctionApplied);

  // ── Pattern tuning: a visible, bounded multiplier learned from how this family's logged doses
  // compare to recommendations at this time of day. The user's own settings are never changed. ──
  const patternFactor =
    !basalSuppressed && params.patternFactor != null && params.patternFactor > 0 ? params.patternFactor : 1;
  const patternAdjusted = subTotal * patternFactor;
  const patternDelta = patternAdjusted - subTotal;

  // ── Safety ceiling. ──
  const maxDoseCap = maxDoseCapUnits(weightLbs);
  const cappedAtMax = !basalSuppressed && patternAdjusted > maxDoseCap;
  const totalRaw = basalSuppressed ? 0 : Math.min(patternAdjusted, maxDoseCap);
  const totalDose = Math.round(totalRaw * 2) / 2;

  // A single, blended warning (see buildDoseWarning) — never a stack of separate messages.
  const warning = buildDoseWarning({
    basalSuppressed,
    insulinKind,
    isLowBG,
    isBelowTarget: correctionSuppressed && !isLowBG,
    isHighBG,
    isVeryHighBG,
    isSpike: isSpikeDetected,
    isFalling: !basalSuppressed && (trend === "rapidly_falling" || trend === "falling"),
    iobCovers: iobCredit > 0 && correctionPlusTrend > 0 && correctionApplied === 0,
    iobUnits,
    iobDiscounted,
    cappedAtMax,
    maxDoseCap,
    targetBG,
    previousBG,
    currentBG,
  });
  const warnings: DoseWarning[] = warning ? [warning] : [];

  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    carbInsulin: r2(carbInsulin),
    correctionInsulin: r2(correctionInsulin),
    resistanceBump: r2(resistanceBump),
    trendAdjustment: trendAdj,
    hyperTrendZeroed,
    totalRaw: r2(totalRaw),
    totalDose,
    warnings,
    trendLabel,
    trendAdjLabel,
    isLowBG,
    isHighBG,
    isVeryHighBG,
    isSpikeDetected,
    correctionSuppressed,
    basalSuppressed,
    activeCarbInsulin: r2(activeCarbInsulin),
    activeInsulinUnits: r2(iobUnits),
    iobCredit: r2(iobCredit),
    iobDiscounted,
    uncoveredCarbInsulin: r2(uncoveredCarbInsulin),
    correctionApplied: r2(correctionApplied),
    subTotal: r2(subTotal),
    patternFactor: r2(patternFactor),
    patternDelta: r2(patternDelta),
    maxDoseCap,
    cappedAtMax,
  };
}
