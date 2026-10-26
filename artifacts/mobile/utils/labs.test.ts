import { describe, expect, it } from "vitest";
import { a1cChange, a1cResults, estimateVsLab, formatLabDate, formatLabValue, parseLabDate, sortLabs } from "./labs";

const lab = (takenOn: string, value: number | undefined, test = "a1c", extra: object = {}) => ({ id: takenOn, test, name: "A1C", value, unit: "%", takenOn, source: "manual" as const, ...extra });

describe("labs", () => {
  it("formats dates and values", () => {
    expect(formatLabDate("2026-10-26")).toBe("Oct 26, 2026");
    expect(formatLabValue({ value: 7.8, unit: "%" })).toBe("7.8%");
    expect(formatLabValue({ value: 142, unit: "mg/dL" })).toBe("142 mg/dL");
    expect(formatLabValue({ valueText: "Negative" })).toBe("Negative");
  });
  it("sorts newest first and picks A1Cs", () => {
    const list = [lab("2026-04-13", 7.2), lab("2026-10-26", 7.8), lab("2026-08-17", 8.1), lab("2026-10-26", undefined, "celiac", { valueText: "Negative" })];
    expect(sortLabs(list)[0]!.takenOn).toBe("2026-10-26");
    expect(a1cResults(list).map((l) => l.value)).toEqual([7.8, 8.1, 7.2]);
  });
  it("describes the change and the estimate gap plainly", () => {
    expect(a1cChange({ value: 7.8 }, { value: 8.1, takenOn: "2026-08-17" })).toBe("Down 0.3 since Aug 17, 2026");
    expect(a1cChange({ value: 7.8 }, undefined)).toBeNull();
    expect(estimateVsLab(7.8, 7.6)).toContain("within 0.2 of the lab");
    expect(estimateVsLab(7.8, 7.8)).toContain("the same as the lab");
    expect(estimateVsLab(8.4, 7.6)).toContain("0.8 lower than the lab");
  });
  it("reads typed dates", () => {
    expect(parseLabDate("10/26/2026")).toBe("2026-10-26");
    expect(parseLabDate("Oct 26, 2026")).toBe("2026-10-26");
    expect(parseLabDate("2026-10-26")).toBe("2026-10-26");
    expect(parseLabDate("2/30/2026")).toBeNull();
    expect(parseLabDate("yesterday")).toBeNull();
  });
});
