import { describe, it, expect } from "vitest";
import {
  A1C_RANGES,
  DEFAULT_A1C_RANGE,
  a1cInsight,
  a1cLabel,
  a1cReadiness,
  estimateA1C,
  rangeCutoffMs,
  rangePhrase,
  readingsPerDay,
  sensorWearPct,
} from "./a1c";

describe("Estimated-A1C ranges", () => {
  it("only offers windows an A1C estimate needs (14+ days), defaulting to 90", () => {
    expect(A1C_RANGES).toEqual([14, 30, 90]);
    expect(DEFAULT_A1C_RANGE).toBe(90);
  });
  it("rolling cutoffs and phrases", () => {
    const now = 1_700_000_000_000;
    expect(rangeCutoffMs(14, now)).toBe(now - 14 * 86_400_000);
    expect(rangePhrase(1)).toBe("day");
    expect(rangePhrase(90)).toBe("90 days");
  });
});

describe("estimateA1C is GMI (same as the PDF and Dexcom Clarity)", () => {
  it("3.31 + 0.02392 × mean", () => {
    expect(estimateA1C(120)).toBe(6.2);
    expect(estimateA1C(154)).toBe(7);
    expect(estimateA1C(179)).toBe(7.6);
    expect(estimateA1C(200)).toBe(8.1);
  });
});

describe("sensor wear and readiness", () => {
  it("counts readings against what the sensor sends per day", () => {
    expect(readingsPerDay("dexcom")).toBe(288);
    expect(readingsPerDay("libre")).toBe(96);
    expect(sensorWearPct(288 * 14, 14, "dexcom")).toBe(100);
    expect(sensorWearPct(288 * 7, 14, "dexcom")).toBe(50);
    expect(sensorWearPct(96 * 14, 14, "libre")).toBe(100);
    expect(sensorWearPct(99999, 14, "dexcom")).toBe(100);
  });
  it("needs 14 days; under 70% wear it's shown with a caution", () => {
    expect(a1cReadiness(13, 100)).toBe("too_few_days");
    expect(a1cReadiness(14, 69)).toBe("low_wear");
    expect(a1cReadiness(90, 94)).toBe("ready");
  });
});

describe("labels and copy", () => {
  it("plain status against the goal, no alarm words", () => {
    expect(a1cLabel(6.9).label).toBe("At or under 7%");
    expect(a1cLabel(7.6).label).toBe("Above 7%");
    expect(a1cLabel(8.1, 7.5).label).toBe("Above 7.5%");
    expect(a1cInsight(7.6)).not.toMatch(/risk|bad|poor/i);
  });
  it("copy never has long dashes", () => {
    expect(a1cInsight(6)).not.toContain("—");
    expect(a1cInsight(9)).not.toContain("—");
  });
});
