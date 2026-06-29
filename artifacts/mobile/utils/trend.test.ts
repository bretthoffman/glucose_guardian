import { describe, expect, it } from "vitest";
import {
  isFastTrend,
  mapDexcomTrend,
  trendArrowCount,
  trendFromDiff,
  trendGaugeLabel,
} from "./trend";

describe("trend display helpers", () => {
  it("detects fast movement from double arrows", () => {
    expect(isFastTrend(mapDexcomTrend(1))).toBe(true);
    expect(isFastTrend(mapDexcomTrend(7))).toBe(true);
    expect(isFastTrend(mapDexcomTrend(2))).toBe(false);
    expect(isFastTrend(mapDexcomTrend(6))).toBe(false);
    expect(isFastTrend(trendFromDiff(-35))).toBe(true);
    expect(isFastTrend(trendFromDiff(-20))).toBe(false);
  });

  it("maps fast labels for the summary gauge", () => {
    expect(trendGaugeLabel(mapDexcomTrend(1))).toBe("Rising Fast");
    expect(trendGaugeLabel(mapDexcomTrend(7))).toBe("Dropping Fast");
    expect(trendGaugeLabel(mapDexcomTrend(2))).toBe("Rising");
    expect(trendGaugeLabel(mapDexcomTrend(6))).toBe("Falling");
    expect(trendGaugeLabel(trendFromDiff(0))).toBe("Stable");
  });

  it("uses two arrows only for fast states", () => {
    expect(trendArrowCount(mapDexcomTrend(1))).toBe(2);
    expect(trendArrowCount(mapDexcomTrend(7))).toBe(2);
    expect(trendArrowCount(mapDexcomTrend(2))).toBe(1);
    expect(trendArrowCount(mapDexcomTrend(6))).toBe(1);
    expect(trendArrowCount(trendFromDiff(35))).toBe(2);
    expect(trendArrowCount(trendFromDiff(-35))).toBe(2);
    expect(trendArrowCount(trendFromDiff(20))).toBe(1);
  });
});
