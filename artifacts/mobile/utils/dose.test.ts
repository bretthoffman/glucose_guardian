import { describe, expect, it } from "vitest";
import { computeDose } from "./dose";

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

  it("keeps the low-BG safety warning even for basal insulin", () => {
    const dose = computeDose({ ...BASE, currentBG: 80, insulinKind: "long" });
    expect(dose.isLowBG).toBe(true);
    expect(dose.warnings.some((w) => w.level === "danger")).toBe(true);
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
