import { describe, expect, it } from "vitest";
import { computeDose } from "./dose";
import { computeActiveCarbs } from "./onBoard";
import { isLowTreatment, withoutLowTreatments } from "./lowTreatment";

describe("low treatments and the dose calculator", () => {
  const now = Date.now();
  const log = [
    { id: "a", timestamp: new Date(now - 10 * 60_000).toISOString(), foodName: "Low treated: 4 glucose tabs", estimatedCarbs: 16, insulinUnits: 0, confidence: "high" as const, fromPhoto: false },
    { id: "b", timestamp: new Date(now - 20 * 60_000).toISOString(), foodName: "Apple slices", estimatedCarbs: 15, insulinUnits: 1, confidence: "high" as const, fromPhoto: false },
  ];

  it("recognises only entries logged by Treated a Low", () => {
    expect(isLowTreatment(log[0]!)).toBe(true);
    expect(isLowTreatment(log[1]!)).toBe(false);
    expect(isLowTreatment({ foodName: "Lowfat yogurt" })).toBe(false);
    expect(withoutLowTreatments(log).map((f) => f.id)).toEqual(["b"]);
  });

  it("the calculator no longer adds insulin to cover the juice or tabs given for a low", () => {
    const base = { carbs: 0, currentBG: 110, targetBG: 110, carbRatio: 15, correctionFactor: 50, trend: "stable" };
    const all = computeActiveCarbs(log, now).totalGrams;
    const forDose = computeActiveCarbs(withoutLowTreatments(log), now).totalGrams;
    expect(forDose).toBeLessThan(all);
    const before = computeDose({ ...base, activeCarbsGrams: all });
    const after = computeDose({ ...base, activeCarbsGrams: forDose });
    expect(after.activeCarbInsulin).toBeLessThan(before.activeCarbInsulin);
    // Never more insulin than before.
    expect(after.totalDose).toBeLessThanOrEqual(before.totalDose);
  });
});
