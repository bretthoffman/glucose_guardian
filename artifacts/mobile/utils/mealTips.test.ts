import { describe, expect, it } from "vitest";
import { canSeeMealTips, dayPartOf, mealTip, mealWords, sameMeal, similarPastMeals, tipAllowedToday, waysToHelp } from "./mealTips";

const NOW = Date.parse("2026-10-26T16:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const meal = (name: string, hoursAgo: number) => ({ foodName: name, timestamp: iso(NOW - hoursAgo * 3600_000) });
/** Readings every 5 min for 2.5 h after a meal, peaking at `peak`. */
const after = (m: { timestamp: string }, peak: number) =>
  Array.from({ length: 31 }, (_, i) => ({ timestamp: iso(Date.parse(m.timestamp) + i * 5 * 60_000), glucose: i === 12 ? peak : 140 }));

describe("matching meals", () => {
  it("matches the same meal however it was named", () => {
    expect(mealWords("Waffles with syrup + Berries")).toEqual(["waffle", "syrup", "berrie"]);
    expect(sameMeal("Waffles with syrup", "waffles")).toBe(true);
    expect(sameMeal("Waffles with syrup", "Pizza slice")).toBe(false);
  });
  it("newest 3, skipping the meal just eaten", () => {
    const log = [meal("waffles", 1), meal("waffles", 24), meal("waffles", 48), meal("waffles", 72), meal("waffles", 96), meal("pizza", 30)];
    expect(similarPastMeals("Waffles with syrup", log, NOW).map((m) => m.timestamp)).toEqual([log[1]!.timestamp, log[2]!.timestamp, log[3]!.timestamp]);
  });
});

describe("mealTip", () => {
  const past = [meal("waffles", 24), meal("waffles", 48), meal("waffles", 72)];
  it("tips when most past times went over 250, with protein ideas and their carbs", () => {
    const readings = [...after(past[0]!, 280), ...after(past[1]!, 265), ...after(past[2]!, 190)];
    const tip = mealTip({ foodName: "Waffles", pastMeals: past, readings, name: "Bella" });
    expect(tip?.text).toBe("2 of the last 3 times Bella had this, readings went over 250 within a couple of hours. Adding some protein can soften that rise.");
    expect(tip?.ideas.map((i) => i.name)).toContain("Scrambled egg");
    expect(tip?.text).not.toMatch(/bad|avoid|don't|shouldn't|unit|insulin/i);
  });
  it("no tip without enough history, when it went fine, or when the meal has protein already", () => {
    expect(mealTip({ foodName: "Waffles", pastMeals: past.slice(0, 1), readings: after(past[0]!, 300) })).toBeNull();
    const fine = [...after(past[0]!, 180), ...after(past[1]!, 200), ...after(past[2]!, 260)];
    expect(mealTip({ foodName: "Waffles", pastMeals: past, readings: fine })).toBeNull();
    const high = [...after(past[0]!, 300), ...after(past[1]!, 300)];
    expect(mealTip({ foodName: "Waffles", proteinGrams: 20, pastMeals: past, readings: high })).toBeNull();
  });
});

describe("waysToHelp", () => {
  it("finds the part of the day with the most highs (local time) and asks the doctor about insulin", () => {
    const readings = [];
    const start = Date.parse("2026-10-12T00:00:00Z");
    for (let i = 0; i < 14 * 288; i++) {
      const t = start + i * 5 * 60_000;
      const localHour = new Date(t - 4 * 3600_000).getUTCHours();
      readings.push({ timestamp: iso(t), glucose: localHour >= 6 && localHour < 9 ? 230 : 130 });
    }
    const w = waysToHelp(readings, 180, "Bella", -240);
    expect(w?.part).toBe("breakfast");
    expect(w?.intro).toContain("after breakfast");
    expect(w?.ideas.some((i) => i.askDoctor)).toBe(true);
  });
  it("nothing when there's too little data or no clear pattern", () => {
    expect(waysToHelp([{ timestamp: iso(NOW), glucose: 300 }], 180, "Bella", 0)).toBeNull();
    const flat = Array.from({ length: 14 * 288 }, (_, i) => ({ timestamp: iso(NOW - i * 300_000), glucose: 120 }));
    expect(waysToHelp(flat, 180, "Bella", 0)).toBeNull();
  });
  it("day parts", () => {
    expect(dayPartOf(7)).toBe("breakfast");
    expect(dayPartOf(12)).toBe("lunch");
    expect(dayPartOf(18)).toBe("dinner");
    expect(dayPartOf(2)).toBe("overnight");
  });
});

describe("who sees tips", () => {
  it("guardians always, caregivers unless off, Child Mode only if on, once a day", () => {
    expect(canSeeMealTips({ isChildMode: false, isCaregiver: false })).toBe(true);
    expect(canSeeMealTips({ isChildMode: false, isCaregiver: true })).toBe(true);
    expect(canSeeMealTips({ isChildMode: false, isCaregiver: true, mealTipsCaregivers: false })).toBe(false);
    expect(canSeeMealTips({ isChildMode: true, isCaregiver: false })).toBe(false);
    expect(canSeeMealTips({ isChildMode: true, isCaregiver: false, mealTipsChildMode: true })).toBe(true);
    expect(tipAllowedToday("2026-10-26", "2026-10-26")).toBe(false);
    expect(tipAllowedToday("2026-10-25", "2026-10-26")).toBe(true);
  });
});
