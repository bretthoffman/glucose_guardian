import { describe, expect, it } from "vitest";
import {
  isFastTrend,
  mapDexcomTrend,
  trendArrowCount,
  trendFromDiff,
  trendGaugeLabel,
} from "./trend";

describe("trend display helpers", () => {
  it("treats every `rapidly_*` state as fast (single- AND double-arrow Dexcom states)", () => {
    expect(isFastTrend(mapDexcomTrend(1))).toBe(true); // DoubleUp
    expect(isFastTrend(mapDexcomTrend(7))).toBe(true); // DoubleDown
    // SingleUp/SingleDown are grouped as rapidly_* (they fire the fast warning), so they're fast too.
    expect(isFastTrend(mapDexcomTrend(2))).toBe(true);
    expect(isFastTrend(mapDexcomTrend(6))).toBe(true);
    expect(isFastTrend(trendFromDiff(-35))).toBe(true);
    expect(isFastTrend(trendFromDiff(-20))).toBe(true);
    expect(isFastTrend(trendFromDiff(-10))).toBe(false); // "falling slowly" is not fast
  });

  it("maps fast labels for the summary gauge", () => {
    expect(trendGaugeLabel(mapDexcomTrend(1))).toBe("Rising Fast");
    expect(trendGaugeLabel(mapDexcomTrend(7))).toBe("Dropping Fast");
    expect(trendGaugeLabel(mapDexcomTrend(2))).toBe("Rising Fast");
    expect(trendGaugeLabel(mapDexcomTrend(6))).toBe("Dropping Fast");
    expect(trendGaugeLabel(trendFromDiff(0))).toBe("Stable");
  });

  it("shows two arrows for every fast state and one otherwise", () => {
    expect(trendArrowCount(mapDexcomTrend(1))).toBe(2);
    expect(trendArrowCount(mapDexcomTrend(7))).toBe(2);
    expect(trendArrowCount(mapDexcomTrend(2))).toBe(2); // SingleUp now matches its fast warning
    expect(trendArrowCount(mapDexcomTrend(6))).toBe(2); // SingleDown now matches its fast warning
    expect(trendArrowCount(mapDexcomTrend(3))).toBe(1); // FortyFiveUp — "rising slowly"
    expect(trendArrowCount(trendFromDiff(35))).toBe(2);
    expect(trendArrowCount(trendFromDiff(-35))).toBe(2);
    expect(trendArrowCount(trendFromDiff(20))).toBe(2);
    expect(trendArrowCount(trendFromDiff(10))).toBe(1); // "rising slowly"
  });
});
