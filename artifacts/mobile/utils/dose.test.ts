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
    isSpike: false,
    isFalling: false,
    iobCovers: false,
    iobUnits: 0,
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

describe("computeDose insulin-on-board / carbs-on-board", () => {
  it("subtracts active insulin from the total", () => {
    // BASE raw = 3.2; minus 1u IOB → 2.2 → rounded 2
    const dose = computeDose({ ...BASE, activeInsulinUnits: 1 });
    expect(dose.activeInsulinUnits).toBe(1);
    expect(dose.totalRaw).toBe(2.2);
    expect(dose.totalDose).toBe(2);
  });

  it("floors at zero and explains when IOB covers the whole dose", () => {
    const dose = computeDose({ ...BASE, activeInsulinUnits: 5 });
    expect(dose.totalDose).toBe(0);
    expect(dose.warnings.some((w) => w.message.includes("already covers"))).toBe(true);
  });

  it("adds absorbing carbs like typed carbs", () => {
    // 15g ÷ 15 CR = +1u on top of BASE's 3.2 raw
    const dose = computeDose({ ...BASE, activeCarbsGrams: 15 });
    expect(dose.activeCarbInsulin).toBe(1);
    expect(dose.totalRaw).toBe(4.2);
  });

  it("nets a covered meal: carbs on board cancel against the insulin logged for them", () => {
    // 30g COB adds 2u; 2u IOB subtracts it — back to BASE
    const dose = computeDose({ ...BASE, activeCarbsGrams: 30, activeInsulinUnits: 2 });
    expect(dose.totalDose).toBe(computeDose(BASE).totalDose);
  });

  it("ignores IOB and COB entirely in basal mode", () => {
    const dose = computeDose({ ...BASE, insulinKind: "long", activeInsulinUnits: 3, activeCarbsGrams: 40 });
    expect(dose.activeInsulinUnits).toBe(0);
    expect(dose.activeCarbInsulin).toBe(0);
    expect(dose.totalDose).toBe(0);
  });
});
