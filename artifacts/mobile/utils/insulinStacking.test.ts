import { describe, expect, it } from "vitest";
import { findRecentFastActing, isFastActingEntry, STACKING_WINDOW_MS, stackingWarning } from "./insulinStacking";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const bolus = (min: number, units = 2, extra: object = {}) => ({ timestamp: ago(min), units, type: "bolus" as const, ...extra });

describe("isFastActingEntry", () => {
  it("counts bolus/correction/manual as fast, basal never", () => {
    expect(isFastActingEntry({ type: "bolus" })).toBe(true);
    expect(isFastActingEntry({ type: "correction" })).toBe(true);
    expect(isFastActingEntry({ type: "manual" })).toBe(true);
    expect(isFastActingEntry({ type: "basal" })).toBe(false);
  });
  it("excludes a manual entry whose label resolves to a long-acting insulin, keeps unknown labels (warn-side)", () => {
    expect(isFastActingEntry({ type: "manual", insulinType: "Lantus · 100 u/mL" })).toBe(false);
    expect(isFastActingEntry({ type: "manual", insulinType: "Humalog · 100 u/mL" })).toBe(true);
    expect(isFastActingEntry({ type: "manual", insulinType: "Mystery Brand" })).toBe(true);
  });
});

describe("findRecentFastActing", () => {
  it("finds the newest fast-acting dose inside the 90-minute window", () => {
    const r = findRecentFastActing([bolus(85, 1.5), bolus(20, 3, { authorName: "Brian" }), bolus(60)], NOW);
    expect(r).toEqual({ units: 3, minutesAgo: 20, authorName: "Brian" });
  });
  it("ignores doses outside the window, basal doses, zero units, and far-future timestamps", () => {
    expect(findRecentFastActing([bolus(95)], NOW)).toBeNull();
    expect(findRecentFastActing([{ timestamp: ago(10), units: 12, type: "basal" }], NOW)).toBeNull();
    expect(findRecentFastActing([bolus(10, 0)], NOW)).toBeNull();
    expect(findRecentFastActing([bolus(-10)], NOW)).toBeNull(); // 10 min in the future
    expect(findRecentFastActing([bolus(-0.5)], NOW)?.minutesAgo).toBe(0); // clock skew tolerated
  });
  it("respects the window constant boundary", () => {
    expect(findRecentFastActing([bolus(89)], NOW, STACKING_WINDOW_MS)).not.toBeNull();
    expect(findRecentFastActing([bolus(91)], NOW, STACKING_WINDOW_MS)).toBeNull();
  });
});

describe("stackingWarning", () => {
  it("names the dose, the time, the author when known, and ends by asking", () => {
    const w = stackingWarning({ units: 2.5, minutesAgo: 35, authorName: "Brian" });
    expect(w.title).toBe("Insulin may still be active");
    expect(w.message).toContain("2.5 u of insulin was logged by Brian 35 minutes ago");
    expect(w.message).toContain("insulin stacking");
    expect(w.message).toContain("hypoglycemia");
    expect(w.message.endsWith("Are you sure?")).toBe(true);
  });
  it("handles the singular minute and the anonymous author", () => {
    expect(stackingWarning({ units: 1, minutesAgo: 1 }).message).toContain("was logged 1 minute ago");
  });
});
