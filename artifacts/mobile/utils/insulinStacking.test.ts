import { describe, expect, it } from "vitest";
import { findRecentFastActing, formatMinutesAgo, isFastActingEntry, STACKING_WINDOW_MS, stackingWarning } from "./insulinStacking";

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
  it("finds the newest fast-acting dose inside the 2-hour window", () => {
    const r = findRecentFastActing([bolus(85, 1.5), bolus(20, 3, { authorName: "Brian" }), bolus(60)], NOW);
    expect(r).toEqual({ units: 3, minutesAgo: 20, authorName: "Brian" });
  });
  it("ignores doses outside the window, basal doses, zero units, and far-future timestamps", () => {
    expect(findRecentFastActing([bolus(125)], NOW)).toBeNull();
    expect(findRecentFastActing([{ timestamp: ago(10), units: 12, type: "basal" }], NOW)).toBeNull();
    expect(findRecentFastActing([bolus(10, 0)], NOW)).toBeNull();
    expect(findRecentFastActing([bolus(-10)], NOW)).toBeNull(); // 10 min in the future
    expect(findRecentFastActing([bolus(-0.5)], NOW)?.minutesAgo).toBe(0); // clock skew tolerated
  });
  it("respects the window constant boundary", () => {
    expect(STACKING_WINDOW_MS).toBe(120 * 60_000);
    expect(findRecentFastActing([bolus(95)], NOW, STACKING_WINDOW_MS)).not.toBeNull();
    expect(findRecentFastActing([bolus(119)], NOW, STACKING_WINDOW_MS)).not.toBeNull();
    expect(findRecentFastActing([bolus(121)], NOW, STACKING_WINDOW_MS)).toBeNull();
  });
});

describe("stackingWarning", () => {
  it("short copy: title, the last dose, who, what is still working", () => {
    const w = stackingWarning({ units: 4, minutesAgo: 45, authorName: "Mom" }, 2.63);
    expect(w.title).toBe("Beware of insulin stacking");
    expect(w.doseLine).toBe("4 u logged 45 min ago");
    expect(w.byLine).toBe("by Mom");
    expect(w.activeLine).toBe("About 2.6 u is still working");
    expect(w.message).toBe("Taking more now can add up and cause a low. Check the trend first and keep fast-acting sugar close.");
    expect(w.footnote).toBe("A reminder, not a rule. Always follow your doctor's instructions.");
  });
  it("no author, no active estimate, and no long dashes anywhere", () => {
    const w = stackingWarning({ units: 2.25, minutesAgo: 80 });
    expect(w.doseLine).toBe("2.25 u logged 1 hr 20 min ago");
    expect(w.byLine).toBeUndefined();
    expect(w.activeLine).toBeUndefined();
    expect(stackingWarning({ units: 1, minutesAgo: 5 }, 0.04).activeLine).toBeUndefined();
    expect(Object.values(stackingWarning({ units: 1, minutesAgo: 5, authorName: "A" }, 1)).join(" ")).not.toMatch(/[—–]/);
  });
});

describe("formatMinutesAgo", () => {
  it("minutes, hours, both", () => {
    expect(formatMinutesAgo(0)).toBe("just now");
    expect(formatMinutesAgo(1)).toBe("1 min ago");
    expect(formatMinutesAgo(59)).toBe("59 min ago");
    expect(formatMinutesAgo(60)).toBe("1 hr ago");
    expect(formatMinutesAgo(119)).toBe("1 hr 59 min ago");
  });
});
