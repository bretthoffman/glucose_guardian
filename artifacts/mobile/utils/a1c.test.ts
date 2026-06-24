import { describe, it, expect } from "vitest";
import {
  A1C_RANGES,
  DEFAULT_A1C_RANGE,
  a1cInsight,
  a1cLabel,
  estimateA1C,
  rangeCutoffMs,
  rangePhrase,
} from "./a1c";

describe("Estimated-A1C range list", () => {
  it("includes 1D first, immediately before 3D, preserving the rest", () => {
    expect(A1C_RANGES).toEqual([1, 3, 7, 14, 30, 90]);
    expect(A1C_RANGES[0]).toBe(1);
  });
  it("default range stays 14D (adding 1D does not change the default)", () => {
    expect(DEFAULT_A1C_RANGE).toBe(14);
  });
});

describe("rangeCutoffMs — rolling windows (1D = last 24h)", () => {
  const now = 1_700_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  it("1D = now − 24h", () => expect(rangeCutoffMs(1, now)).toBe(now - DAY));
  it("3D = now − 72h", () => expect(rangeCutoffMs(3, now)).toBe(now - 3 * DAY));
  it("14D = now − 14 days", () => expect(rangeCutoffMs(14, now)).toBe(now - 14 * DAY));
});

describe("rangePhrase — singular vs plural", () => {
  it("1 → 'day'", () => expect(rangePhrase(1)).toBe("day"));
  it("every other value → 'N days'", () => {
    expect(rangePhrase(3)).toBe("3 days");
    expect(rangePhrase(7)).toBe("7 days");
    expect(rangePhrase(30)).toBe("30 days");
    expect(rangePhrase(90)).toBe("90 days");
  });
});

describe("a1cInsight — grammatical range-dependent copy", () => {
  const goodAvg = 100; // estimateA1C ≈ 5.1 → "good" branch (mentions the range)

  it("1D reads 'over the last day.' — never '1 day' or '1 days'", () => {
    const s = a1cInsight(goodAvg, 1);
    expect(s).toContain("over the last day.");
    expect(s).not.toContain("1 day");
    expect(s).not.toContain("1 days");
  });

  it("3D/7D use plural days", () => {
    expect(a1cInsight(goodAvg, 3)).toContain("over the last 3 days.");
    expect(a1cInsight(goodAvg, 7)).toContain("over the last 7 days.");
  });

  it("14/30/90 use plural days", () => {
    expect(a1cInsight(goodAvg, 14)).toContain("over the last 14 days.");
    expect(a1cInsight(goodAvg, 30)).toContain("over the last 30 days.");
    expect(a1cInsight(goodAvg, 90)).toContain("over the last 90 days.");
  });

  it("higher-A1C branches contain no range-number wording", () => {
    expect(a1cInsight(160, 1)).not.toMatch(/\bday\b/); // a1c ≈ 7.2
    expect(a1cInsight(220, 1)).not.toMatch(/\bday\b/); // a1c ≈ 9.3
  });
});

describe("estimateA1C + a1cLabel", () => {
  it("estimateA1C follows the ADAG formula", () => {
    expect(estimateA1C(100)).toBe(5.1);
    expect(estimateA1C(154)).toBe(7);
  });
  it("a1cLabel thresholds", () => {
    expect(a1cLabel(6.9).label).toBe("Good");
    expect(a1cLabel(7.5).label).toBe("Needs Attention");
    expect(a1cLabel(8.1).label).toBe("High Risk");
  });
});
