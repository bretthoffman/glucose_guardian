import { describe, expect, it } from "vitest";
import {
  doseAmountsEqual,
  filterDoseInputText,
  finalizeManualDoseInput,
  formatDoseAmount,
  formatSuggestedDoseLine,
  isValidDoseInputText,
  roundToQuarterUnits,
} from "./doseOverride";

describe("roundToQuarterUnits", () => {
  it("rounds to nearest 0.25", () => {
    expect(roundToQuarterUnits(1.79)).toBe(1.75);
    expect(roundToQuarterUnits(1.9)).toBe(2);
    expect(roundToQuarterUnits(1.12)).toBe(1);
    expect(roundToQuarterUnits(1.13)).toBe(1.25);
    expect(roundToQuarterUnits(4.62)).toBe(4.5);
    expect(roundToQuarterUnits(4.63)).toBe(4.75);
    expect(roundToQuarterUnits(0.12)).toBe(0);
    expect(roundToQuarterUnits(0.13)).toBe(0.25);
  });
});

describe("formatDoseAmount", () => {
  it("drops unnecessary decimals", () => {
    expect(formatDoseAmount(1)).toBe("1");
    expect(formatDoseAmount(1.0)).toBe("1");
    expect(formatDoseAmount(2)).toBe("2");
    expect(formatDoseAmount(1.5)).toBe("1.5");
    expect(formatDoseAmount(1.75)).toBe("1.75");
  });
});

describe("filterDoseInputText", () => {
  it("rejects letters and extra decimals", () => {
    expect(filterDoseInputText("1.65a")).toBe("1.65");
    expect(filterDoseInputText("1.659")).toBe("1.65");
    expect(filterDoseInputText("1..2")).toBe("1.2");
  });

  it("allows intermediate editing states", () => {
    expect(isValidDoseInputText("1.")).toBe(true);
    expect(isValidDoseInputText("1.0")).toBe(true);
    expect(isValidDoseInputText(".5")).toBe(true);
  });
});

describe("finalizeManualDoseInput", () => {
  it("normalizes leading dot and rounds", () => {
    expect(finalizeManualDoseInput(".5")).toBe(0.5);
    expect(finalizeManualDoseInput("1.79")).toBe(1.75);
  });

  it("returns null for empty", () => {
    expect(finalizeManualDoseInput("")).toBe(null);
    expect(finalizeManualDoseInput(".")).toBe(null);
  });
});

describe("doseAmountsEqual", () => {
  it("treats equivalent quarter-unit representations as equal", () => {
    expect(doseAmountsEqual(1, 1.0)).toBe(true);
    expect(doseAmountsEqual(1.0, 1.0)).toBe(true);
    expect(doseAmountsEqual(1.5, 1.5)).toBe(true);
    expect(doseAmountsEqual(1.5, 1.5)).toBe(true);
    expect(doseAmountsEqual(1.25, 1.25)).toBe(true);
  });

  it("detects real mismatches", () => {
    expect(doseAmountsEqual(1.5, 2)).toBe(false);
    expect(doseAmountsEqual(0, 1)).toBe(false);
  });
});

describe("formatSuggestedDoseLine", () => {
  it("uses singular unit for exactly 1", () => {
    expect(formatSuggestedDoseLine(1)).toBe("Suggested dose: 1 unit");
    expect(formatSuggestedDoseLine(1.0)).toBe("Suggested dose: 1 unit");
  });

  it("uses plural units otherwise", () => {
    expect(formatSuggestedDoseLine(1.25)).toBe("Suggested dose: 1.25 units");
    expect(formatSuggestedDoseLine(1.5)).toBe("Suggested dose: 1.5 units");
    expect(formatSuggestedDoseLine(1.75)).toBe("Suggested dose: 1.75 units");
    expect(formatSuggestedDoseLine(2)).toBe("Suggested dose: 2 units");
    expect(formatSuggestedDoseLine(0)).toBe("Suggested dose: 0 units");
  });
});
