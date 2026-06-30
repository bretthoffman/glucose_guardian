import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { T } from "../constants/theme";
import { doseScreenToggleMaxWidth } from "./doseScreenHeaderLayout";

const insulinPath = join(__dirname, "../app/(tabs)/insulin.tsx");

describe("dose screen header layout", () => {
  it("removed Dose Analytics page title from insulin screen", () => {
    const src = readFileSync(insulinPath, "utf8");
    expect(src).not.toContain("Dose Analytics");
    expect(src).not.toContain("TYPE.pageTitle");
  });

  it("places segmented control in TabGlucoseHeaderRow left slot", () => {
    const src = readFileSync(insulinPath, "utf8");
    expect(src).toContain("styles.screenToggle");
    expect(src).toMatch(/TabGlucoseHeaderRow[\s\S]*left=\{/);
    expect(src).not.toMatch(/TabGlucoseHeaderShell[\s\S]*styles\.screenToggle[\s\S]*TabGlucoseHeaderRow/);
  });

  it("uses equal-width flex segments with shrink constraints", () => {
    const src = readFileSync(insulinPath, "utf8");
    expect(src).toContain('flex: 1');
    expect(src).toContain("flexShrink: 1");
    expect(src).toContain("minWidth: 0");
  });

  it("computes toggle max width from glucose pill boundary", () => {
    const padding = T.tabGlucoseHeader.paddingHorizontal;
    const gap = T.tabGlucoseHeader.rowGap;
    expect(doseScreenToggleMaxWidth(390, 90)).toBe(390 - padding * 2 - gap - 90);
    expect(doseScreenToggleMaxWidth(320, 90)).toBeGreaterThan(0);
    expect(doseScreenToggleMaxWidth(100, 90)).toBe(0);
  });
});
