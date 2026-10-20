import { describe, expect, it } from "vitest";
import {
  findQuickFood,
  formatCarbs,
  formatRecentWhen,
  isQuickFood,
  mealInsulinUnits,
  recentFoods,
  splitFoodName,
} from "./quickFoods";

describe("splitFoodName", () => {
  it("splits at the first parenthesis", () => {
    expect(splitFoodName("Two plain toaster waffles (frozen/boxed-style)")).toEqual({
      title: "Two plain toaster waffles",
      detail: "frozen/boxed-style",
    });
  });
  it("tolerates a missing closing parenthesis and nested ones", () => {
    expect(splitFoodName("Breaded fish sticks (about 6 pieces, Gorton's")).toEqual({
      title: "Breaded fish sticks",
      detail: "about 6 pieces, Gorton's",
    });
    expect(splitFoodName("Pizza (thin crust (white))")).toEqual({ title: "Pizza", detail: "thin crust (white)" });
  });
  it("leaves plain names whole", () => {
    expect(splitFoodName("1 waffle cookie")).toEqual({ title: "1 waffle cookie" });
    expect(splitFoodName("(odd) name")).toEqual({ title: "(odd) name" });
    expect(splitFoodName("Rice ()")).toEqual({ title: "Rice" });
  });
});

describe("formatCarbs", () => {
  it("whole numbers stay whole, otherwise one decimal", () => {
    expect(formatCarbs(45)).toBe("45");
    expect(formatCarbs(5.5)).toBe("5.5");
    expect(formatCarbs(5.54)).toBe("5.5");
    expect(formatCarbs(4.96)).toBe("5");
  });
});

describe("recentFoods", () => {
  const log = [
    { id: "a", timestamp: "2026-10-19T12:00:00Z", foodName: "Apple", estimatedCarbs: 25 },
    { id: "b", timestamp: "2026-10-20T08:05:00Z", foodName: "Toaster waffles", estimatedCarbs: 32 },
    { id: "c", timestamp: "2026-10-18T19:00:00Z", foodName: "apple ", estimatedCarbs: 20 },
    { id: "d", timestamp: "2026-10-19T19:40:00Z", foodName: "1 waffle cookie", estimatedCarbs: 45 },
    { id: "e", timestamp: "bad", foodName: "Ghost", estimatedCarbs: 1 },
    { id: "f", timestamp: "2026-10-17T10:00:00Z", foodName: "  ", estimatedCarbs: 1 },
  ];
  it("newest first, one row per food (its latest entry), bad rows skipped", () => {
    expect(recentFoods(log).map((e) => e.id)).toEqual(["b", "d", "a"]);
  });
  it("respects the limit", () => {
    expect(recentFoods(log, 2).map((e) => e.id)).toEqual(["b", "d"]);
  });
});

describe("formatRecentWhen", () => {
  const now = new Date(2026, 9, 20, 12, 0);
  it("today, yesterday, weekday, then a date", () => {
    expect(formatRecentWhen(new Date(2026, 9, 20, 8, 5).toISOString(), now)).toBe("Today · 8:05 AM");
    expect(formatRecentWhen(new Date(2026, 9, 19, 19, 40).toISOString(), now)).toBe("Yesterday · 7:40 PM");
    expect(formatRecentWhen(new Date(2026, 9, 18, 0, 0).toISOString(), now)).toBe("Sun · 12:00 AM");
    expect(formatRecentWhen(new Date(2026, 9, 3, 12, 30).toISOString(), now)).toBe("Oct 3 · 12:30 PM");
  });
});

describe("isQuickFood / findQuickFood", () => {
  const list = [{ name: "1 waffle cookie", carbs: 5.5 }, { name: "Apple" }];
  it("matches ignoring case and spaces", () => {
    expect(isQuickFood(list, " 1 WAFFLE cookie")).toBe(true);
    expect(isQuickFood(list, "Pear")).toBe(false);
    expect(findQuickFood(list, "apple")).toEqual({ name: "Apple" });
  });
});

describe("mealInsulinUnits", () => {
  it("logged carbs ÷ carb ratio, to 0.1 u", () => {
    expect(mealInsulinUnits(5.5, 10)).toBe(0.6);
    expect(mealInsulinUnits(45, 10)).toBe(4.5);
    expect(mealInsulinUnits(32, 12)).toBe(2.7);
  });
  it("never negative or infinite", () => {
    expect(mealInsulinUnits(30, 0)).toBe(0);
    expect(mealInsulinUnits(-5, 10)).toBe(0);
    expect(mealInsulinUnits(NaN, 10)).toBe(0);
  });
});

import { favoritesFromServer } from "./quickFoods";
describe("favoritesFromServer", () => {
  it("an empty list stays empty (no starter foods); missing means unknown", () => {
    expect(favoritesFromServer([])).toEqual([]);
    expect(favoritesFromServer(null)).toBeNull();
    expect(favoritesFromServer(undefined)).toBeNull();
    expect(favoritesFromServer([{ name: "Apple", carbs: 25 }, { name: " " }, "Rice"])).toEqual([{ name: "Apple", carbs: 25 }, { name: "Rice" }]);
  });
});

import { editQuickFood } from "./quickFoods";
describe("editQuickFood", () => {
  const list = [{ name: "1 waffle cookie", carbs: 45 }, { name: "Apple", carbs: 25 }, { name: "Waffle cookie" }];
  it("changes name and carbs in place", () => {
    expect(editQuickFood(list, "apple", "Green apple", 20)).toEqual([{ name: "1 waffle cookie", carbs: 45 }, { name: "Green apple", carbs: 20 }, { name: "Waffle cookie" }]);
  });
  it("drops a different favorite that ends up with the same name", () => {
    expect(editQuickFood(list, "1 waffle cookie", "waffle cookie", 5.5)).toEqual([{ name: "waffle cookie", carbs: 5.5 }, { name: "Apple", carbs: 25 }]);
  });
  it("blank name keeps the old one; unknown food leaves the list alone", () => {
    expect(editQuickFood(list, "Apple", "  ", 30)[1]).toEqual({ name: "Apple", carbs: 30 });
    expect(editQuickFood(list, "Pear", "Pear", 1)).toBe(list);
  });
});
