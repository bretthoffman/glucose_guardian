import { describe, expect, it } from "vitest";
import {
  candidateFoods,
  headsUpBody,
  headsUpTitle,
  mealEvent,
  mealPatterns,
  patternFor,
  sameMeal,
  showHeadsUpNow,
  type HighDose,
  type HighFood,
  type HighReading,
} from "./mealHighLogic";

const NOW = Date.parse("2026-11-10T19:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A meal `daysAgo` at 12:30 UTC (7:30 AM New York). */
function meal(id: string, name: string, daysAgo: number, carbs = 48): HighFood {
  return { clientId: id, foodName: name, timestamp: iso(NOW - daysAgo * 24 * H - 6.5 * H), estimatedCarbs: carbs };
}
/** Readings every 5 minutes for 5 hours after a meal, following `curve(minutes) → mg/dL`. */
function curve(f: HighFood, fn: (min: number) => number): HighReading[] {
  const t0 = Date.parse(f.timestamp);
  return Array.from({ length: 61 }, (_, i) => ({ ms: t0 + i * 5 * 60_000, glucose: Math.round(fn(i * 5)) }));
}
/** Bella's pancake mornings: 197 → 352 at 2 h → still ~290 at 3 to 4 h. */
const stuckHigh = (m: number) => (m <= 120 ? 197 + (155 * m) / 120 : 352 - ((m - 120) * 62) / 120);
/** A meal that comes back down on its own. */
const cameDown = (m: number) => (m <= 90 ? 142 + m : 232 - (m - 90) * 0.6);
const dose = (f: HighFood, units: number, minAfter = 0, linked = true): HighDose => ({
  timestamp: iso(Date.parse(f.timestamp) + minAfter * 60_000),
  units,
  type: minAfter > 30 ? "correction" : "bolus",
  ...(linked && minAfter <= 30 ? { foodLogId: f.clientId } : {}),
});

describe("one past meal", () => {
  it("stayed high: dosed, over 250 at 2 hours, more insulin, still over 250 at 3 to 4 hours", () => {
    const p = meal("p1", "Pancakes with syrup", 7);
    const e = mealEvent(p, [p], [dose(p, 3), dose(p, 1.5, 130)], curve(p, stuckHigh), 250)!;
    expect(e.outcome).toBe("stayedHigh");
    expect(e).toMatchObject({ startBg: 197, mealUnits: 3, extra: [{ units: 1.5 }] });
    expect(e.peak).toBeGreaterThan(340);
    expect(e.laterBg).toBeGreaterThan(250);
  });

  it("isn't 'stayed high' without extra insulin, or when it came back down", () => {
    const p = meal("p1", "Pancakes", 7);
    expect(mealEvent(p, [p], [dose(p, 3)], curve(p, stuckHigh), 250)!.outcome).toBe("fine");
    expect(mealEvent(p, [p], [dose(p, 3), dose(p, 1, 130)], curve(p, cameDown), 250)!.outcome).toBe("fine");
  });

  it("can't be judged with no dose, a snack on top, or missing sensor data", () => {
    const p = meal("p1", "Pancakes", 7);
    const snack = { ...meal("s1", "Apple juice", 7, 15), timestamp: iso(Date.parse(p.timestamp) + 100 * 60_000) };
    expect(mealEvent(p, [p], [], curve(p, stuckHigh), 250)).toBeNull();
    expect(mealEvent(p, [p, snack], [dose(p, 3), dose(p, 1.5, 130)], curve(p, stuckHigh), 250)).toBeNull();
    expect(mealEvent(p, [p], [dose(p, 3), dose(p, 1.5, 130)], curve(p, stuckHigh).slice(0, 20), 250)).toBeNull();
  });

  it("an unlinked bolus within 30 minutes counts as the meal dose; basal never does", () => {
    const p = meal("p1", "Pancakes", 7);
    const e = mealEvent(p, [p], [dose(p, 3, 10, false), { ...dose(p, 12, 0), type: "basal", foodLogId: undefined }, dose(p, 1.5, 130)], curve(p, stuckHigh), 250)!;
    expect(e.mealUnits).toBe(3);
    expect(mealEvent(p, [p], [{ ...dose(p, 12, 0), type: "basal", foodLogId: undefined }], curve(p, stuckHigh), 250)).toBeNull();
  });

  it("a low after the meal is a low, whatever came before", () => {
    const p = meal("p1", "Pancakes", 7);
    const e = mealEvent(p, [p], [dose(p, 3), dose(p, 2, 130)], curve(p, (m) => (m < 280 ? stuckHigh(m) : 62)), 250)!;
    expect(e.outcome).toBe("wentLow");
  });
});

describe("meals", () => {
  const p1 = meal("p1", "Pancakes with syrup", 2);
  const p2 = meal("p2", "pancakes", 9);
  const p3 = meal("p3", "Pancakes + berries", 16, 42);
  const w1 = meal("w1", "Waffles", 3);
  const all = [p1, p2, p3, w1];
  const doses = [dose(p1, 3), dose(p1, 1.5, 130), dose(p2, 2.5), dose(p2, 1, 125), dose(p3, 2.5), dose(w1, 2.5)];
  const readings = [...curve(p1, stuckHigh), ...curve(p2, stuckHigh), ...curve(p3, cameDown), ...curve(w1, stuckHigh)];

  it("flags pancakes (2 of the last 3 stayed high) and not a meal eaten once", () => {
    const pats = mealPatterns({ foods: all, doses, readings, high: 250, nowMs: NOW });
    expect(pats).toHaveLength(1);
    expect(pats[0]).toMatchObject({ foodName: "Pancakes with syrup", stayedHigh: 2, avgMealUnits: 2.75, avgExtraUnits: 1.25 });
    expect(pats[0]!.events.map((e) => e.outcome)).toEqual(["stayedHigh", "stayedHigh", "fine"]);
    expect(patternFor("Pancakes", pats)?.foodName).toBe("Pancakes with syrup");
    expect(patternFor("Pizza", pats)).toBeNull();
  });

  it("a higher line can clear it, and one low after that meal clears it", () => {
    expect(mealPatterns({ foods: all, doses, readings, high: 330, nowMs: NOW })).toHaveLength(0);
    const low = [...curve(p1, stuckHigh), ...curve(p2, stuckHigh), ...curve(p3, (m) => (m > 200 ? 64 : cameDown(m)))];
    expect(mealPatterns({ foods: all, doses, readings: low, high: 250, nowMs: NOW })).toHaveLength(0);
  });

  it("only 1 of the last 3 stuck high is not enough", () => {
    const one = [...curve(p1, stuckHigh), ...curve(p2, cameDown), ...curve(p3, cameDown)];
    expect(mealPatterns({ foods: all, doses, readings: one, high: 250, nowMs: NOW })).toHaveLength(0);
  });

  it("only repeat meals need sensor data", () => {
    expect(candidateFoods(all, NOW).map((f) => f.clientId)).toEqual(["p1", "p2", "p3"]);
    expect(sameMeal("Pancakes + berries", "pancakes")).toBe(true);
  });
});

describe("showing it", () => {
  it("never while low, dropping or with insulin still working", () => {
    expect(showHeadsUpNow({ bg: 197, target: 120, falling: false, activeUnits: 0 })).toBe(true);
    expect(showHeadsUpNow({ bg: 110, target: 120, falling: false, activeUnits: 0 })).toBe(false);
    expect(showHeadsUpNow({ bg: 197, target: 120, falling: true, activeUnits: 0 })).toBe(false);
    expect(showHeadsUpNow({ bg: 197, target: 120, falling: false, activeUnits: 1.2 })).toBe(false);
    expect(showHeadsUpNow({ bg: null, target: 120, falling: false, activeUnits: 0 })).toBe(false);
  });

  it("says what happened in plain words, with no dose number", () => {
    const p1 = meal("p1", "pancakes", 2);
    const p2 = meal("p2", "pancakes", 9);
    const pats = mealPatterns({
      foods: [p1, p2],
      doses: [dose(p1, 3), dose(p1, 1.5, 130), dose(p2, 3), dose(p2, 1, 130)],
      readings: [...curve(p1, stuckHigh), ...curve(p2, stuckHigh)],
      high: 250,
      nowMs: NOW,
    });
    expect(headsUpTitle("pancakes", "Bella")).toBe("Pancakes kept Bella high last time, even with extra insulin");
    const body = headsUpBody(pats[0]!, 250, "Bella");
    expect(body).toBe("The last 2 times, Bella was still over 250 three to four hours after eating, even after more insulin. This meal may need a higher dose up front.");
    expect(body).not.toMatch(/\d+(\.\d+)?\s?u\b/);
    expect(body).not.toMatch(/—/);
  });
});
