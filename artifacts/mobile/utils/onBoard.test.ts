import { describe, expect, it } from "vitest";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";
import {
  CARB_ABSORPTION_MIN,
  RAPID_DIA_MIN,
  computeActiveCarbs,
  computeActiveInsulin,
  formatAgeShort,
  insulinEntryDiaMin,
} from "./onBoard";

const NOW = new Date("2026-07-18T12:00:00Z").getTime();

function insulinEntry(overrides: Partial<InsulinLogEntry>): InsulinLogEntry {
  return {
    id: "i1",
    timestamp: new Date(NOW).toISOString(),
    units: 2,
    type: "bolus",
    ...overrides,
  };
}

function foodEntry(overrides: Partial<FoodLogEntry>): FoodLogEntry {
  return {
    id: "f1",
    timestamp: new Date(NOW).toISOString(),
    foodName: "Apple",
    estimatedCarbs: 10,
    insulinUnits: 0,
    confidence: "high",
    fromPhoto: false,
    ...overrides,
  };
}

function minutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString();
}

describe("insulinEntryDiaMin", () => {
  it("uses 4h for rapid, 6h for regular, and excludes basal", () => {
    expect(insulinEntryDiaMin({ type: "bolus", insulinType: "Humalog · 100 u/mL" })).toBe(240);
    expect(insulinEntryDiaMin({ type: "bolus", insulinType: "Humulin R · 100 u/mL" })).toBe(360);
    expect(insulinEntryDiaMin({ type: "manual", insulinType: "Lantus · 100 u/mL" })).toBeNull();
    expect(insulinEntryDiaMin({ type: "basal" })).toBeNull();
  });

  it("counts unknown-type entries as rapid (safe direction)", () => {
    expect(insulinEntryDiaMin({ type: "manual" })).toBe(RAPID_DIA_MIN);
  });
});

describe("computeActiveInsulin", () => {
  it("decays along the curvilinear activity curve (less remaining than linear past the peak)", () => {
    // Halfway through a 240m DIA: the bilinear curve (peak at 72m) has delivered ~64% of the
    // action, leaving R(120) = (240−120)² ÷ ((240−72)·240) ≈ 0.357 → 4u ≈ 1.43u (linear said 2u).
    const log = [insulinEntry({ units: 4, timestamp: minutesAgo(120) })];
    const iob = computeActiveInsulin(log, NOW);
    expect(iob.totalUnits).toBe(1.43);
    expect(iob.doseCount).toBe(1);
    expect(iob.lastDoseUnits).toBe(4);
    expect(iob.lastDoseAgeMin).toBe(120);
  });

  it("reports MORE remaining than linear before the activity peak", () => {
    // 30m into a 240m DIA (peak 72m): delivered = 30² ÷ (72·240) ≈ 5.2% → R ≈ 0.948 (linear: 0.875).
    const log = [insulinEntry({ units: 4, timestamp: minutesAgo(30) })];
    expect(computeActiveInsulin(log, NOW).totalUnits).toBeCloseTo(3.79, 2);
  });

  it("drops doses past their DIA and ignores basal entries", () => {
    const log = [
      insulinEntry({ id: "a", units: 4, timestamp: minutesAgo(300) }), // rapid, expired
      insulinEntry({ id: "b", units: 20, type: "basal", insulinType: "Lantus · 100 u/mL", timestamp: minutesAgo(30) }),
    ];
    const iob = computeActiveInsulin(log, NOW);
    expect(iob.totalUnits).toBe(0);
    expect(iob.doseCount).toBe(0);
  });

  it("sums multiple active doses and reports the newest", () => {
    const log = [
      insulinEntry({ id: "a", units: 2, timestamp: minutesAgo(60) }),  // R(60) ≈ 0.792 → 1.58
      insulinEntry({ id: "b", units: 4, timestamp: minutesAgo(180) }), // R(180) ≈ 0.089 → 0.36
    ];
    const iob = computeActiveInsulin(log, NOW);
    expect(iob.totalUnits).toBe(1.94);
    expect(iob.doseCount).toBe(2);
    expect(iob.lastDoseUnits).toBe(2);
    expect(iob.lastDoseAgeMin).toBe(60);
  });

  it("counts future-dated (backdating typo) entries at full strength", () => {
    const log = [insulinEntry({ units: 3, timestamp: minutesAgo(-30) })];
    expect(computeActiveInsulin(log, NOW).totalUnits).toBe(3);
  });
});

describe("computeActiveCarbs", () => {
  it("decays carbs over the absorption window", () => {
    const log = [foodEntry({ estimatedCarbs: 30, timestamp: minutesAgo(90) })]; // halfway through 180m
    const cob = computeActiveCarbs(log, NOW);
    expect(cob.totalGrams).toBe(15);
    expect(cob.entryCount).toBe(1);
    expect(cob.lastEntryGrams).toBe(30);
    expect(cob.lastEntryAgeMin).toBe(90);
  });

  it("drops meals past the absorption window", () => {
    const log = [foodEntry({ estimatedCarbs: 30, timestamp: minutesAgo(CARB_ABSORPTION_MIN + 1) })];
    expect(computeActiveCarbs(log, NOW).totalGrams).toBe(0);
  });
});

describe("formatAgeShort", () => {
  it("formats compact ages", () => {
    expect(formatAgeShort(null)).toBe("just now");
    expect(formatAgeShort(0.4)).toBe("just now");
    expect(formatAgeShort(32)).toBe("32m");
    expect(formatAgeShort(60)).toBe("1h");
    expect(formatAgeShort(80)).toBe("1h 20m");
  });
});
