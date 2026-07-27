import { describe, expect, it } from "vitest";
import { buildDoseWarning, computeDose, type DoseWarningContext } from "./dose";

const BASE = {
  carbs: 30,
  currentBG: 180,
  targetBG: 120,
  carbRatio: 15,
  correctionFactor: 50,
  trend: "stable",
};

describe("computeDose insulinKind", () => {
  it("defaults to rapid-acting behavior when insulinKind is omitted", () => {
    const dose = computeDose(BASE);
    expect(dose.carbInsulin).toBe(2); // 30 ÷ 15
    expect(dose.correctionInsulin).toBe(1.2); // (180 − 120) ÷ 50
    expect(dose.totalDose).toBe(3); // 3.2 → nearest ½
    expect(dose.basalSuppressed).toBe(false);
  });

  it("rapid matches the default behavior exactly", () => {
    expect(computeDose({ ...BASE, insulinKind: "rapid" })).toEqual(computeDose(BASE));
  });

  it("suppresses carb, correction, and trend math for basal insulins", () => {
    for (const insulinKind of ["long", "ultra-long", "intermediate"] as const) {
      const dose = computeDose({ ...BASE, trend: "rising", insulinKind });
      expect(dose.basalSuppressed).toBe(true);
      expect(dose.carbInsulin).toBe(0);
      expect(dose.correctionInsulin).toBe(0);
      expect(dose.trendAdjustment).toBe(0);
      expect(dose.totalDose).toBe(0);
      expect(dose.warnings.some((w) => w.message.includes("basal"))).toBe(true);
    }
  });

  it("basal suppression does not claim a trend adjustment was applied", () => {
    const dose = computeDose({ ...BASE, trend: "rapidly_falling", insulinKind: "long" });
    expect(dose.warnings.some((w) => w.message.includes("Trend adjustment applied"))).toBe(false);
  });

  it("keeps the low-BG safety note even for basal insulin (folded into the basal message)", () => {
    const dose = computeDose({ ...BASE, currentBG: 80, insulinKind: "long" });
    expect(dose.isLowBG).toBe(true);
    expect(dose.warnings).toHaveLength(1);
    expect(dose.warnings[0].message.toLowerCase()).toContain("low");
    expect(dose.warnings[0].message).toContain("basal");
  });

  it("regular keeps the dose math but adds a pre-meal timing note", () => {
    const dose = computeDose({ ...BASE, insulinKind: "regular" });
    expect(dose.totalDose).toBe(computeDose(BASE).totalDose);
    expect(dose.basalSuppressed).toBe(false);
    expect(dose.warnings.some((w) => w.level === "info" && w.message.includes("30 minutes"))).toBe(true);
  });

  it("premixed keeps the dose math but adds a care-team note", () => {
    const dose = computeDose({ ...BASE, insulinKind: "premixed" });
    expect(dose.totalDose).toBe(computeDose(BASE).totalDose);
    expect(dose.warnings.some((w) => w.level === "info" && w.message.includes("Pre-mixed"))).toBe(true);
  });
});

describe("computeDose blended warnings — only ever one, merged", () => {
  it("blends low + falling into a single amber caution and says 'instead of'", () => {
    const dose = computeDose({ ...BASE, currentBG: 70, trend: "falling" });
    expect(dose.warnings).toHaveLength(1);
    const [w] = dose.warnings;
    expect(w.level).toBe("warning");
    expect(w.message).toContain("low and falling");
    expect(w.message).toContain("instead of giving insulin");
    expect(w.message).not.toContain("before giving insulin");
  });

  it("shows low without the 'and falling' when the trend is not falling", () => {
    const dose = computeDose({ ...BASE, currentBG: 70, trend: "stable" });
    expect(dose.warnings).toHaveLength(1);
    expect(dose.warnings[0].message).toContain("Glucose is low.");
    expect(dose.warnings[0].message).not.toContain("falling");
  });

  it("keeps below-target as a neutral purple info note when steady", () => {
    const dose = computeDose({ ...BASE, currentBG: 96, trend: "stable" });
    expect(dose.warnings).toHaveLength(1);
    expect(dose.warnings[0].level).toBe("info");
    expect(dose.warnings[0].message).toContain("below target");
  });

  it("escalates below-target + falling to an amber caution", () => {
    const dose = computeDose({ ...BASE, currentBG: 96, trend: "falling" });
    expect(dose.warnings).toHaveLength(1);
    expect(dose.warnings[0].level).toBe("warning");
    expect(dose.warnings[0].message).toContain("below your target and falling");
  });
});

describe("buildDoseWarning priority + blending", () => {
  const CTX: DoseWarningContext = {
    basalSuppressed: false,
    isLowBG: false,
    isBelowTarget: false,
    isHighBG: false,
    isVeryHighBG: false,
    isSpike: false,
    isFalling: false,
    iobCovers: false,
    iobUnits: 0,
    iobDiscounted: false,
    cappedAtMax: false,
    maxDoseCap: 10,
    targetBG: 120,
    currentBG: 150,
  };

  it("returns null when nothing applies", () => {
    expect(buildDoseWarning(CTX)).toBeNull();
  });

  it("high + spike merges the spike reading into the high caution", () => {
    const w = buildDoseWarning({ ...CTX, isHighBG: true, isSpike: true, previousBG: 120, currentBG: 260 })!;
    expect(w.level).toBe("warning");
    expect(w.message).toContain("high after a sharp rise");
    expect(w.message).toContain("120 → 260");
  });

  it("high + falling reads 'high but already falling'", () => {
    const w = buildDoseWarning({ ...CTX, isHighBG: true, isFalling: true, currentBG: 300 })!;
    expect(w.message).toContain("high but already falling");
  });

  it("low outranks a lower-priority IOB note", () => {
    const w = buildDoseWarning({ ...CTX, isLowBG: true, iobCovers: true, iobUnits: 3, currentBG: 70 })!;
    expect(w.message).toContain("Glucose is low");
    expect(w.message).not.toContain("on board");
  });

  it("surfaces the IOB note only when no glucose situation applies", () => {
    const w = buildDoseWarning({ ...CTX, iobCovers: true, iobUnits: 2.5 })!;
    expect(w.level).toBe("info");
    expect(w.message).toContain("2.5u on board");
  });
});

describe("computeDose insulin-on-board / carbs-on-board (net model)", () => {
  it("credits surplus IOB against the correction only", () => {
    // BASE: carbs 2u + correction 1.2u. 1u IOB (no COB) → credit 1u off the correction → 2.2 raw.
    const dose = computeDose({ ...BASE, activeInsulinUnits: 1 });
    expect(dose.activeInsulinUnits).toBe(1);
    expect(dose.iobCredit).toBe(1);
    expect(dose.correctionApplied).toBeCloseTo(0.2, 5);
    expect(dose.totalRaw).toBe(2.2);
    expect(dose.totalDose).toBe(2);
  });

  it("NEVER reduces the carb dose, even when IOB dwarfs the correction (the Rec-0 collapse fix)", () => {
    // 5u IOB fully covers the 1.2u correction, but the 2u meal bolus must survive intact.
    const dose = computeDose({ ...BASE, activeInsulinUnits: 5 });
    expect(dose.iobCredit).toBeCloseTo(1.2, 5);
    expect(dose.correctionApplied).toBe(0);
    expect(dose.carbInsulin).toBe(2);
    expect(dose.totalDose).toBe(2);
    expect(dose.warnings.some((w) => w.message.includes("covers the correction"))).toBe(true);
  });

  it("adds absorbing carbs the insulin on board does not cover", () => {
    // 15g ÷ 15 CR = 1u of uncovered carbs (no IOB) on top of BASE's 3.2.
    const dose = computeDose({ ...BASE, activeCarbsGrams: 15 });
    expect(dose.activeCarbInsulin).toBe(1);
    expect(dose.uncoveredCarbInsulin).toBe(1);
    expect(dose.totalRaw).toBe(4.2);
  });

  it("nets a covered meal: carbs on board cancel against the insulin logged for them", () => {
    // 30g COB (2u worth) balances 2u IOB — no credit, no uncovered carbs — back to BASE.
    const dose = computeDose({ ...BASE, activeCarbsGrams: 30, activeInsulinUnits: 2 });
    expect(dose.iobCredit).toBe(0);
    expect(dose.uncoveredCarbInsulin).toBe(0);
    expect(dose.totalDose).toBe(computeDose(BASE).totalDose);
  });

  it("partially-covered meal: only the surplus IOB credits the correction", () => {
    // COB 15g = 1u; IOB 1.5u → net 0.5u credit; correction 1.2 → 0.7 applied; carbs untouched.
    const dose = computeDose({ ...BASE, activeCarbsGrams: 15, activeInsulinUnits: 1.5 });
    expect(dose.iobCredit).toBeCloseTo(0.5, 5);
    expect(dose.correctionApplied).toBeCloseTo(0.7, 5);
    expect(dose.totalRaw).toBeCloseTo(2.7, 5);
  });

  it("ignores IOB and COB entirely in basal mode", () => {
    const dose = computeDose({ ...BASE, insulinKind: "long", activeInsulinUnits: 3, activeCarbsGrams: 40 });
    expect(dose.activeInsulinUnits).toBe(0);
    expect(dose.activeCarbInsulin).toBe(0);
    expect(dose.totalDose).toBe(0);
  });

  it("screenshot-day regression: a chained lunch dose no longer collapses toward zero", () => {
    // Lunch (45g) 76 min after a 2u breakfast dose, BG 150: the old model subtracted the whole
    // IOB from the meal and recommended ~0.5u less; carbs must now be fully covered.
    const dose = computeDose({
      ...BASE,
      carbs: 45,
      currentBG: 150,
      activeInsulinUnits: 1.39, // breakfast tail
      activeCarbsGrams: 0, // breakfast carbs finished absorbing faster than the insulin tail
    });
    expect(dose.carbInsulin).toBe(3); // 45 ÷ 15 — untouched by the tail
    // The 0.6u correction is what the tail credits (capped at the correction, never the meal).
    expect(dose.iobCredit).toBeCloseTo(0.6, 5);
    expect(dose.totalDose).toBe(3);
  });
});

describe("computeDose hyperglycemia regime", () => {
  it("zeroes a falling-trend reduction while glucose is high (the 400-mg/dL case)", () => {
    const dose = computeDose({ ...BASE, carbs: 0, currentBG: 400, trend: "falling" });
    expect(dose.trendAdjustment).toBe(0);
    expect(dose.hyperTrendZeroed).toBe(true);
    // (400 − 120) ÷ 50 = 5.6 base + 10% resistance bump (≥300) = 6.16
    expect(dose.correctionInsulin).toBeCloseTo(5.6, 2);
    expect(dose.resistanceBump).toBeCloseTo(0.56, 2);
    expect(dose.totalRaw).toBeCloseTo(6.16, 2);
  });

  it("keeps the falling reduction below the high threshold", () => {
    const dose = computeDose({ ...BASE, carbs: 0, currentBG: 200, trend: "falling" });
    expect(dose.trendAdjustment).toBeCloseTo(-0.5, 5); // −25 ÷ 50
    expect(dose.hyperTrendZeroed).toBe(false);
  });

  it("adds the resistance bump only at very high glucose", () => {
    expect(computeDose({ ...BASE, currentBG: 299 }).resistanceBump).toBe(0);
    const dose = computeDose({ ...BASE, currentBG: 300 });
    expect(dose.resistanceBump).toBeCloseTo(((300 - 120) / 50) * 0.1, 2);
    expect(dose.warnings.some((w) => w.message.includes("ketones"))).toBe(true);
  });

  it("half-credits IOB when glucose is high and provably not falling despite it", () => {
    const flat = computeDose({ ...BASE, carbs: 0, currentBG: 300, activeInsulinUnits: 2, bgDelta45Min: 5 });
    expect(flat.iobDiscounted).toBe(true);
    expect(flat.iobCredit).toBe(1); // 2u surplus × 0.5
    expect(flat.warnings.some((w) => w.message.includes("checking the injection site"))).toBe(true);
    const dropping = computeDose({ ...BASE, carbs: 0, currentBG: 300, activeInsulinUnits: 2, bgDelta45Min: -40 });
    expect(dropping.iobDiscounted).toBe(false);
    expect(dropping.iobCredit).toBe(2);
  });

  it("does not discount IOB at normal glucose regardless of the delta", () => {
    const dose = computeDose({ ...BASE, currentBG: 180, activeInsulinUnits: 1, bgDelta45Min: 10 });
    expect(dose.iobDiscounted).toBe(false);
  });
});

describe("computeDose ISF-scaled trend adjustment", () => {
  it("scales the trend adjustment by the correction factor", () => {
    expect(computeDose({ ...BASE, trend: "rising" }).trendAdjustment).toBeCloseTo(0.5, 5); // 25 ÷ 50
    expect(
      computeDose({ ...BASE, correctionFactor: 100, trend: "rising" }).trendAdjustment,
    ).toBeCloseTo(0.25, 5);
    expect(
      computeDose({ ...BASE, correctionFactor: 25, trend: "rapidly_rising" }).trendAdjustment,
    ).toBeCloseTo(2, 5); // 50 ÷ 25, at the cap
  });

  it("caps the adjustment at ±2u for very sensitive ratios", () => {
    expect(computeDose({ ...BASE, correctionFactor: 10, trend: "rapidly_rising" }).trendAdjustment).toBe(2);
  });
});

describe("computeDose pattern factor + safety cap", () => {
  it("applies a visible pattern multiplier without touching the component pieces", () => {
    const dose = computeDose({ ...BASE, patternFactor: 1.2 });
    expect(dose.subTotal).toBeCloseTo(3.2, 5);
    expect(dose.patternFactor).toBe(1.2);
    expect(dose.patternDelta).toBeCloseTo(0.64, 2);
    expect(dose.totalRaw).toBeCloseTo(3.84, 2);
  });

  it("caps at 10u when weight is unknown and warns", () => {
    const dose = computeDose({ ...BASE, carbs: 300 }); // 20u of carbs
    expect(dose.maxDoseCap).toBe(10);
    expect(dose.cappedAtMax).toBe(true);
    expect(dose.totalDose).toBe(10);
    expect(dose.warnings.some((w) => w.message.includes("capped at 10u"))).toBe(true);
  });

  it("derives the cap from weight when known (~0.2 u/kg, clamped)", () => {
    const dose = computeDose({ ...BASE, carbs: 300, weightLbs: 88 }); // ≈ 40 kg → 8u
    expect(dose.maxDoseCap).toBe(8);
    expect(dose.totalDose).toBe(8);
    // A small child never gets capped below the 3u floor; a large teen never above 15u.
    expect(computeDose({ ...BASE, weightLbs: 22 }).maxDoseCap).toBe(3);
    expect(computeDose({ ...BASE, weightLbs: 400 }).maxDoseCap).toBe(15);
  });
});
