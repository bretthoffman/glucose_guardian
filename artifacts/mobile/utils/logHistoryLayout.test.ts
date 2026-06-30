import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const logHistoryPath = join(__dirname, "../components/LogHistory.tsx");

describe("LogHistory daily-only layout", () => {
  it("does not render Day / Week / Month / Year selector tabs", () => {
    const src = readFileSync(logHistoryPath, "utf8");
    expect(src).not.toContain("VIEW_TABS");
    expect(src).not.toContain("viewTabs");
    expect(src).not.toContain("WeekView");
    expect(src).not.toContain("MonthView");
    expect(src).not.toContain("YearView");
    expect(src).not.toMatch(/label:\s*"Week"/);
    expect(src).not.toMatch(/label:\s*"Month"/);
    expect(src).not.toMatch(/label:\s*"Year"/);
  });
});
