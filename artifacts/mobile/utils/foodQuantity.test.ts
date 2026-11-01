import { describe, expect, it } from "vitest";
import { carbsForCount, carbsForOne, nameWithCount, parseCount, scaleOptional } from "./foodQuantity";

describe("how many on a food", () => {
  it("one waffle in the photo, three eaten: three times the carbs", () => {
    expect(carbsForCount(15, 1, 3)).toBe(45);
    expect(scaleOptional(4, 3)).toBe(12);
    expect(scaleOptional(undefined, 3)).toBeUndefined();
  });

  it("keeps a typed correction when the count changes", () => {
    // The AI said 15 g, the parent typed 20 g for one, then picked 3.
    expect(carbsForCount(20, 1, 3)).toBe(60);
    // And back down to 2.
    expect(carbsForCount(60, 3, 2)).toBe(40);
  });

  it("names the log entry with the count", () => {
    expect(nameWithCount("Waffle", 3)).toBe("3 × Waffle");
    expect(nameWithCount("Waffle", 1)).toBe("Waffle");
  });

  it("a favorite remembers the carbs for one", () => {
    expect(carbsForOne(45, 3)).toBe(15);
    expect(carbsForOne(45, 1)).toBe(45);
  });

  it("reads the picker safely", () => {
    expect(parseCount("3")).toBe(3);
    expect(parseCount("")).toBe(1);
    expect(parseCount("0")).toBe(1);
    expect(parseCount("150")).toBe(99);
  });
});
