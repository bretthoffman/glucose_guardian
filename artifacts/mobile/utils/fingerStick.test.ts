import { describe, expect, it } from "vitest";
import {
  CGM_MATCH_WINDOW_MS,
  compareFingerStick,
  comparisonSentence,
  comparisonShort,
  isTrendMovingFast,
  matchCgmReading,
  parseMeterInput,
  reasonLabel,
} from "./fingerStick";

const at = (iso: string) => new Date(iso).getTime();

describe("matchCgmReading", () => {
  const readings = [
    { glucose: 200, timestamp: "2026-10-19T15:05:00Z" },
    { glucose: 214, timestamp: "2026-10-19T15:15:00Z", dexcomTrend: "SingleUp" },
    { glucose: 220, timestamp: "2026-10-19T15:10:00Z" },
  ];
  it("picks the reading nearest in time, in any order", () => {
    expect(matchCgmReading(readings, at("2026-10-19T15:14:00Z"))).toEqual({ glucose: 214, timestamp: "2026-10-19T15:15:00Z", trend: "SingleUp" });
    expect(matchCgmReading(readings, at("2026-10-19T15:09:00Z"))?.glucose).toBe(220);
  });
  it("returns null when nothing is within the window", () => {
    expect(matchCgmReading(readings, at("2026-10-19T15:15:00Z") + CGM_MATCH_WINDOW_MS + 1)).toBeNull();
    expect(matchCgmReading([], Date.now())).toBeNull();
  });
  it("accepts a reading exactly at the edge of the window", () => {
    expect(matchCgmReading(readings, at("2026-10-19T15:15:00Z") + CGM_MATCH_WINDOW_MS)?.glucose).toBe(214);
  });
});

describe("parseMeterInput", () => {
  it("accepts whole mg/dL in range", () => {
    expect(parseMeterInput("182")).toBe(182);
    expect(parseMeterInput(" 20 ")).toBe(20);
    expect(parseMeterInput("600")).toBe(600);
  });
  it("rejects empty, decimals, words and out-of-range values", () => {
    for (const bad of ["", "19", "601", "1820", "18.2", "abc", "-50"]) expect(parseMeterInput(bad)).toBeNull();
  });
});

describe("compareFingerStick (15/15 benchmark)", () => {
  it("under 100: within 15 mg/dL is close", () => {
    expect(compareFingerStick(78, 64)).toMatchObject({ diff: -14, direction: "lower", verdict: "close" });
    expect(compareFingerStick(70, 86)).toMatchObject({ diff: 16, verdict: "different" });
  });
  it("100 and above: within 15% is close", () => {
    expect(compareFingerStick(182, 214)).toMatchObject({ diff: 32, pct: 18, direction: "higher", verdict: "different" });
    expect(compareFingerStick(200, 230)).toMatchObject({ diff: 30, verdict: "close" });
    expect(compareFingerStick(100, 116)).toMatchObject({ verdict: "different" });
  });
  it("identical values", () => {
    expect(compareFingerStick(120, 120)).toMatchObject({ diff: 0, direction: "same", verdict: "close" });
  });
});

describe("wording", () => {
  it("sentences and short forms", () => {
    expect(comparisonSentence(compareFingerStick(182, 214))).toBe("The CGM read 32 higher (+18%)");
    expect(comparisonSentence(compareFingerStick(78, 64))).toBe("The CGM read 14 lower (−18%)");
    expect(comparisonSentence(compareFingerStick(120, 120))).toBe("The CGM matched exactly");
    expect(comparisonShort(compareFingerStick(182, 214))).toBe("32 higher");
    expect(comparisonShort(compareFingerStick(120, 120))).toBe("exact match");
  });
  it("reason labels", () => {
    expect(reasonLabel("seemed_off")).toBe("Number seemed off");
    expect(reasonLabel(undefined)).toBeNull();
  });
});

describe("isTrendMovingFast", () => {
  it("fast arrows and codes", () => {
    for (const t of ["SingleUp", "DoubleDown", "doubleUp", "1", "7", "rising quickly"]) expect(isTrendMovingFast(t)).toBe(true);
  });
  it("steady or gentle trends", () => {
    for (const t of [undefined, "", "Flat", "FortyFiveUp", "4", "3", "stable"]) expect(isTrendMovingFast(t)).toBe(false);
  });
});
