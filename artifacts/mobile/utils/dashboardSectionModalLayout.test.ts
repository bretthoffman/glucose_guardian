import { describe, expect, it } from "vitest";
import { dashboardModalMaxBodyHeight } from "./dashboardSectionModalLayout";

describe("dashboardModalMaxBodyHeight", () => {
  it("returns a bounded scroll region with a sensible minimum", () => {
    expect(dashboardModalMaxBodyHeight(844, 47, 34)).toBeGreaterThanOrEqual(240);
    expect(dashboardModalMaxBodyHeight(400, 0, 0)).toBe(240);
  });

  it("shrinks as safe-area and tab-bar insets grow", () => {
    const compact = dashboardModalMaxBodyHeight(800, 20, 20);
    const padded = dashboardModalMaxBodyHeight(800, 60, 40);
    expect(compact).toBeGreaterThan(padded);
  });
});
