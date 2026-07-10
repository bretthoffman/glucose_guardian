import { describe, expect, it } from "vitest";
import { computeBasalDose } from "./basalDose";

const TARGET = 120;

describe("computeBasalDose baseline", () => {
  it("prefers the last logged basal dose over the weight estimate", () => {
    const dose = computeBasalDose({
      weightLbs: 110,
      lastBasalUnits: 14,
      fastingReadings: [],
      targetBG: TARGET,
    });
    expect(dose.baselineSource).toBe("lastDose");
    expect(dose.baselineUnits).toBe(14);
    expect(dose.totalDose).toBe(14);
  });

  it("falls back to a 0.2 u/kg starting estimate from weight", () => {
    const dose = computeBasalDose({ weightLbs: 110, fastingReadings: [], targetBG: TARGET });
    // 110 lb ≈ 49.9 kg → 0.2 u/kg ≈ 10 u
    expect(dose.baselineSource).toBe("weight");
    expect(dose.baselineUnits).toBe(10);
    expect(dose.totalDose).toBe(10);
  });

  it("returns no suggestion without a logged dose or weight", () => {
    const dose = computeBasalDose({ fastingReadings: [], targetBG: TARGET });
    expect(dose.baselineSource).toBeNull();
    expect(dose.baselineUnits).toBeNull();
    expect(dose.totalDose).toBe(0);
    expect(dose.warnings.some((w) => w.message.includes("enter your prescribed amount"))).toBe(true);
  });
});

describe("computeBasalDose fasting titration", () => {
  it("nudges up when the fasting average runs well above target", () => {
    const dose = computeBasalDose({
      lastBasalUnits: 12,
      fastingReadings: [180, 185, 175],
      targetBG: TARGET,
    });
    expect(dose.fastingAvg).toBe(180);
    expect(dose.fastingAdjustment).toBe(2);
    expect(dose.totalDose).toBe(14);
  });

  it("nudges up by one when moderately above target", () => {
    const dose = computeBasalDose({
      lastBasalUnits: 12,
      fastingReadings: [150, 145],
      targetBG: TARGET,
    });
    expect(dose.fastingAdjustment).toBe(1);
    expect(dose.totalDose).toBe(13);
  });

  it("reduces the dose and warns when a morning low appears", () => {
    const dose = computeBasalDose({
      lastBasalUnits: 12,
      fastingReadings: [65, 130, 140],
      targetBG: TARGET,
    });
    expect(dose.hadMorningLow).toBe(true);
    expect(dose.fastingAdjustment).toBe(-2);
    expect(dose.totalDose).toBe(10);
    expect(dose.warnings.some((w) => w.level === "danger")).toBe(true);
  });

  it("does not titrate on top of a fresh weight estimate", () => {
    const dose = computeBasalDose({
      weightLbs: 110,
      fastingReadings: [180, 185, 175],
      targetBG: TARGET,
    });
    expect(dose.baselineSource).toBe("weight");
    expect(dose.fastingAdjustment).toBe(0);
    expect(dose.totalDose).toBe(10);
  });

  it("needs at least two fasting readings before trusting the average", () => {
    const dose = computeBasalDose({
      lastBasalUnits: 12,
      fastingReadings: [190],
      targetBG: TARGET,
    });
    expect(dose.fastingAvg).toBeNull();
    expect(dose.fastingAdjustment).toBe(0);
  });

  it("stays flat when fasting is in range", () => {
    const dose = computeBasalDose({
      lastBasalUnits: 12,
      fastingReadings: [110, 125, 118],
      targetBG: TARGET,
    });
    expect(dose.fastingAdjustment).toBe(0);
    expect(dose.totalDose).toBe(12);
  });
});
