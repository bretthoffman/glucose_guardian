import { describe, expect, it } from "vitest";
import { PREDICTION_UNLOCK_DAYS, distinctLogDayCount, predictionDaysRemaining } from "./predictionUnlock";

/** Local wall-clock moment → the ISO string the logs store. Keeps the tests timezone-safe. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe("distinctLogDayCount", () => {
  it("counts a day once no matter how many logs it has", () => {
    expect(distinctLogDayCount([at(2026, 11, 17, 8), at(2026, 11, 17, 12), at(2026, 11, 17, 21)])).toBe(1);
  });

  it("splits on the local midnight, not on 24h gaps", () => {
    expect(distinctLogDayCount([at(2026, 11, 17, 23, 50), at(2026, 11, 18, 0, 10)])).toBe(2);
  });

  it("does not require consecutive days and ignores invalid timestamps", () => {
    expect(distinctLogDayCount([at(2026, 11, 1), at(2026, 11, 9), at(2026, 11, 17), "not-a-date", ""])).toBe(3);
  });

  it("mixes sources freely (insulin, meals, finger sticks all count)", () => {
    expect(distinctLogDayCount([at(2026, 11, 15, 7), at(2026, 11, 16, 13), at(2026, 11, 16, 18)])).toBe(2);
  });
});

describe("predictionDaysRemaining", () => {
  it("starts at the full requirement and reaches 0 exactly at unlock", () => {
    expect(predictionDaysRemaining(0)).toBe(PREDICTION_UNLOCK_DAYS);
    expect(predictionDaysRemaining(1)).toBe(6);
    expect(predictionDaysRemaining(6)).toBe(1);
    expect(predictionDaysRemaining(7)).toBe(0);
  });

  it("never goes negative for long histories", () => {
    expect(predictionDaysRemaining(250)).toBe(0);
  });
});
