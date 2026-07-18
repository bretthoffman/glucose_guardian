import { describe, expect, it } from "vitest";
import { insertQuickFood, parseStoredQuickFoods } from "./quickFoods";

const DEFAULTS = ["Apple", "Pizza", "Rice", "Banana", "Sandwich", "Oatmeal", "Pasta", "Milk"];

describe("insertQuickFood", () => {
  it("inserts first and pushes the last item off, keeping the length constant", () => {
    const next = insertQuickFood(DEFAULTS, "Salad", DEFAULTS.length);
    expect(next).toEqual(["Salad", "Apple", "Pizza", "Rice", "Banana", "Sandwich", "Oatmeal", "Pasta"]);
    expect(next).toHaveLength(DEFAULTS.length);
  });

  it("moves an existing item to the front without duplicating or dropping anything", () => {
    const next = insertQuickFood(DEFAULTS, "pasta", DEFAULTS.length);
    expect(next).toEqual(["pasta", "Apple", "Pizza", "Rice", "Banana", "Sandwich", "Oatmeal", "Milk"]);
    expect(next).toHaveLength(DEFAULTS.length);
  });

  it("trims the saved name and ignores empty input", () => {
    expect(insertQuickFood(DEFAULTS, "  Salad  ", DEFAULTS.length)[0]).toBe("Salad");
    expect(insertQuickFood(DEFAULTS, "   ", DEFAULTS.length)).toEqual(DEFAULTS);
  });
});

describe("parseStoredQuickFoods", () => {
  it("round-trips a valid list and rejects junk", () => {
    expect(parseStoredQuickFoods(JSON.stringify(["A", "B"]))).toEqual(["A", "B"]);
    expect(parseStoredQuickFoods(null)).toBeNull();
    expect(parseStoredQuickFoods("not json")).toBeNull();
    expect(parseStoredQuickFoods(JSON.stringify({ a: 1 }))).toBeNull();
    expect(parseStoredQuickFoods(JSON.stringify([]))).toBeNull();
    expect(parseStoredQuickFoods(JSON.stringify([1, "", "Ok"]))).toEqual(["Ok"]);
  });
});
