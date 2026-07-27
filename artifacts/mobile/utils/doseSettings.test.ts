import { describe, expect, it } from "vitest";
import {
  effectiveDoseSettings,
  mealBucketForHour,
  normalizeDoseSettingsByTime,
} from "./doseSettings";

function atHour(h: number): Date {
  const d = new Date("2026-07-20T00:00:00");
  d.setHours(h, 30, 0, 0);
  return d;
}

describe("mealBucketForHour", () => {
  it("maps the day into breakfast/lunch/dinner/night windows", () => {
    expect(mealBucketForHour(5)).toBe("breakfast");
    expect(mealBucketForHour(9)).toBe("breakfast");
    expect(mealBucketForHour(10)).toBe("lunch");
    expect(mealBucketForHour(14)).toBe("lunch");
    expect(mealBucketForHour(15)).toBe("dinner");
    expect(mealBucketForHour(20)).toBe("dinner");
    expect(mealBucketForHour(21)).toBe("night");
    expect(mealBucketForHour(2)).toBe("night");
    expect(mealBucketForHour(4)).toBe("night");
  });
});

describe("effectiveDoseSettings", () => {
  it("returns the base values when no overrides exist", () => {
    const e = effectiveDoseSettings(20, 60, undefined, atHour(8));
    expect(e).toEqual({ carbRatio: 20, correctionFactor: 60, bucket: "breakfast", usedOverride: false });
  });

  it("applies an override only inside its window, per-value", () => {
    const byTime = { breakfast: { carbRatio: 12 } };
    const morning = effectiveDoseSettings(20, 60, byTime, atHour(8));
    expect(morning.carbRatio).toBe(12);
    expect(morning.correctionFactor).toBe(60); // ISF not overridden → base
    expect(morning.usedOverride).toBe(true);
    const evening = effectiveDoseSettings(20, 60, byTime, atHour(18));
    expect(evening.carbRatio).toBe(20);
    expect(evening.usedOverride).toBe(false);
  });

  it("ignores non-positive override values", () => {
    const e = effectiveDoseSettings(20, 60, { lunch: { carbRatio: 0, correctionFactor: -5 } }, atHour(12));
    expect(e.carbRatio).toBe(20);
    expect(e.correctionFactor).toBe(60);
    expect(e.usedOverride).toBe(false);
  });
});

describe("normalizeDoseSettingsByTime", () => {
  it("drops empty/invalid overrides and returns undefined when nothing remains", () => {
    expect(normalizeDoseSettingsByTime(undefined)).toBeUndefined();
    expect(normalizeDoseSettingsByTime({})).toBeUndefined();
    expect(normalizeDoseSettingsByTime({ lunch: {} })).toBeUndefined();
    expect(normalizeDoseSettingsByTime({ lunch: { carbRatio: 0 } })).toBeUndefined();
    expect(normalizeDoseSettingsByTime({ lunch: { carbRatio: NaN } })).toBeUndefined();
  });

  it("keeps valid values and strips the invalid ones alongside them", () => {
    expect(
      normalizeDoseSettingsByTime({ breakfast: { carbRatio: 12, correctionFactor: 0 }, night: { correctionFactor: 80 } }),
    ).toEqual({ breakfast: { carbRatio: 12 }, night: { correctionFactor: 80 } });
  });
});
