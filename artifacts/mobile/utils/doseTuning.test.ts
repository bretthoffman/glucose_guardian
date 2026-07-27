import { describe, expect, it } from "vitest";
import type { InsulinLogEntry } from "@/context/AuthContext";
import { computePatternTuning, patternFactorForNow, tuningSuggestions } from "./doseTuning";

const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();

/** An entry `daysAgo` at local hour `hour` with the given units/rec. */
function entry(
  daysAgo: number,
  hour: number,
  units: number,
  recommendedUnits: number | undefined,
  over: Partial<InsulinLogEntry> = {},
): InsulinLogEntry {
  const d = new Date(NOW - daysAgo * 24 * 60 * 60 * 1000);
  d.setHours(hour, 15, 0, 0);
  return {
    id: `i_${daysAgo}_${hour}_${Math.random()}`,
    timestamp: d.toISOString(),
    units,
    type: "bolus",
    recommendedUnits,
    ...over,
  };
}

/** Six breakfast doses (hour 7) where the family gave `ratio`× the recommendation. */
function breakfastLog(ratio: number): InsulinLogEntry[] {
  return [1, 2, 3, 4, 5, 6].map((d) => entry(d, 7, 1 * ratio, 1));
}

describe("computePatternTuning", () => {
  it("returns neutral factors with too few samples", () => {
    const t = computePatternTuning(breakfastLog(2).slice(0, 4), NOW);
    expect(t.breakfast.factor).toBe(1);
    expect(t.breakfast.sampleCount).toBe(0);
  });

  it("detects consistent over-dosing in a bucket and clamps the factor to 1.25", () => {
    const t = computePatternTuning(breakfastLog(2), NOW);
    expect(t.breakfast.sampleCount).toBe(6);
    expect(t.breakfast.medianRatio).toBe(2);
    expect(t.breakfast.factor).toBe(1.25); // clamped
    expect(t.lunch.factor).toBe(1); // untouched buckets stay neutral
  });

  it("stays neutral inside the ±15% dead zone", () => {
    const t = computePatternTuning(breakfastLog(1.1), NOW);
    expect(t.breakfast.factor).toBe(1);
    expect(t.breakfast.medianRatio).toBeCloseTo(1.1, 5);
  });

  it("detects consistent under-dosing and clamps at 0.75", () => {
    const t = computePatternTuning(breakfastLog(0.5), NOW);
    expect(t.breakfast.factor).toBe(0.75);
  });

  it("uses the median, so a single outlier dose cannot move the factor", () => {
    const log = [...breakfastLog(1), entry(7, 7, 8, 1)]; // six agreements + one 8× outlier
    expect(computePatternTuning(log, NOW).breakfast.factor).toBe(1);
  });

  it("ignores basal doses, tiny recommendations, entries missing a rec, and stale entries", () => {
    const log = [
      ...breakfastLog(2).map((e) => ({ ...e, type: "basal" as const })),
      ...[1, 2, 3, 4, 5, 6].map((d) => entry(d, 7, 2, 0.25)), // rec below the 0.5u floor
      ...[1, 2, 3, 4, 5, 6].map((d) => entry(d, 7, 2, undefined)),
      ...[20, 21, 22, 23, 24, 25].map((d) => entry(d, 7, 2, 1)), // outside the 14-day window
    ];
    expect(computePatternTuning(log, NOW).breakfast.factor).toBe(1);
  });

  it("patternFactorForNow picks the bucket containing the given time", () => {
    const t = computePatternTuning(breakfastLog(2), NOW);
    const morning = new Date(NOW);
    morning.setHours(8, 0, 0, 0);
    const evening = new Date(NOW);
    evening.setHours(18, 0, 0, 0);
    expect(patternFactorForNow(t, morning).factor).toBe(1.25);
    expect(patternFactorForNow(t, evening).factor).toBe(1);
  });

  it("tuningSuggestions describes only adjusted buckets and points to a care-team review", () => {
    const s = tuningSuggestions(computePatternTuning(breakfastLog(2), NOW));
    expect(s).toHaveLength(1);
    expect(s[0].bucket).toBe("breakfast");
    expect(s[0].title).toContain("above the recommendation");
    expect(s[0].body).toContain("care team");
    expect(tuningSuggestions(computePatternTuning([], NOW))).toHaveLength(0);
  });
});
