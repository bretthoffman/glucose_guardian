import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_FOODS,
  insertQuickFood,
  moveQuickFood,
  parseStoredQuickFoods,
  quickFoodNames,
  quickFoodsFromServer,
  removeQuickFood,
  updateQuickFoodCarbs,
} from "./quickFoods";

const names = quickFoodNames;

describe("insertQuickFood", () => {
  it("inserts first, keeps everything else, and has no cap by default", () => {
    const next = insertQuickFood(DEFAULT_QUICK_FOODS, { name: "Salad", carbs: 8 });
    expect(next[0]).toEqual({ name: "Salad", carbs: 8 });
    expect(next).toHaveLength(DEFAULT_QUICK_FOODS.length + 1);
    expect(names(next).slice(1)).toEqual(names(DEFAULT_QUICK_FOODS));
  });

  it("moves an existing item to the front without duplicating, keeping stored carbs when none are given", () => {
    const next = insertQuickFood(DEFAULT_QUICK_FOODS, "pasta");
    expect(next[0]).toEqual({ name: "pasta", carbs: 43 });
    expect(next).toHaveLength(DEFAULT_QUICK_FOODS.length);
    expect(names(next).filter((n) => n.toLowerCase() === "pasta")).toHaveLength(1);
  });

  it("lets new carbs replace stored ones, trims names, and ignores empty input", () => {
    expect(insertQuickFood(DEFAULT_QUICK_FOODS, { name: "Pasta", carbs: 50 })[0]).toEqual({ name: "Pasta", carbs: 50 });
    expect(insertQuickFood(DEFAULT_QUICK_FOODS, "  Salad  ")[0]).toEqual({ name: "Salad" });
    expect(insertQuickFood(DEFAULT_QUICK_FOODS, "   ")).toEqual(DEFAULT_QUICK_FOODS);
  });

  it("still honors an explicit maximum", () => {
    expect(insertQuickFood(DEFAULT_QUICK_FOODS, "Salad", 8)).toHaveLength(8);
  });
});

describe("updateQuickFoodCarbs / removeQuickFood / moveQuickFood", () => {
  it("updates carbs in place and returns the same list when nothing changes", () => {
    const list = [{ name: "Apple" }, { name: "Rice", carbs: 45 }];
    expect(updateQuickFoodCarbs(list, "apple", 25)).toEqual([{ name: "Apple", carbs: 25 }, { name: "Rice", carbs: 45 }]);
    expect(updateQuickFoodCarbs(list, "Nope", 25)).toBe(list);
    expect(updateQuickFoodCarbs(list, "Rice", 45)).toBe(list);
    expect(updateQuickFoodCarbs(list, "Rice", -1)).toBe(list);
  });

  it("removes by name, case-insensitively", () => {
    expect(names(removeQuickFood(DEFAULT_QUICK_FOODS, "MILK"))).not.toContain("Milk");
    expect(removeQuickFood(DEFAULT_QUICK_FOODS, "Nope")).toEqual(DEFAULT_QUICK_FOODS);
  });

  it("moves an item to a new position with indices clamped", () => {
    const list = ["A", "B", "C", "D"].map((name) => ({ name }));
    expect(names(moveQuickFood(list, 3, 0))).toEqual(["D", "A", "B", "C"]);
    expect(names(moveQuickFood(list, 0, 2))).toEqual(["B", "C", "A", "D"]);
    expect(names(moveQuickFood(list, 1, 99))).toEqual(["A", "C", "D", "B"]);
    expect(moveQuickFood(list, 2, 2)).toBe(list);
  });
});

describe("parseStoredQuickFoods / quickFoodsFromServer", () => {
  it("reads both the legacy name list and the item list, and rejects junk", () => {
    expect(parseStoredQuickFoods(JSON.stringify(["A", "B"]))).toEqual([{ name: "A" }, { name: "B" }]);
    expect(parseStoredQuickFoods(JSON.stringify([{ name: "A", carbs: 12 }, "B"]))).toEqual([{ name: "A", carbs: 12 }, { name: "B" }]);
    expect(parseStoredQuickFoods(null)).toBeNull();
    expect(parseStoredQuickFoods("not json")).toBeNull();
    expect(parseStoredQuickFoods(JSON.stringify({ a: 1 }))).toBeNull();
    expect(parseStoredQuickFoods(JSON.stringify([]))).toBeNull();
    expect(parseStoredQuickFoods(JSON.stringify([1, "", "Ok", { carbs: 3 }]))).toEqual([{ name: "Ok" }]);
  });

  it("prefers the server's items over its names-only field, and falls back cleanly", () => {
    expect(quickFoodsFromServer([{ name: "A", carbs: 5 }], ["A", "B"])).toEqual([{ name: "A", carbs: 5 }]);
    expect(quickFoodsFromServer(null, ["A", "B"])).toEqual([{ name: "A" }, { name: "B" }]);
    expect(quickFoodsFromServer([], [])).toEqual([]);
    expect(quickFoodsFromServer(null, null)).toBeNull();
  });
});
