import { describe, expect, it } from "vitest";
import { MAX_GRAMS, findFood, normalizeFoodQuery, parseModelEstimate, unknownFoodResponse, usableGrams } from "./food";

describe("normalizeFoodQuery", () => {
  it("lowercases, drops a leading article and trailing punctuation, collapses spaces", () => {
    expect(normalizeFoodQuery("  The  Pizza! ")).toBe("pizza");
    expect(normalizeFoodQuery("an Apple")).toBe("apple");
    expect(normalizeFoodQuery("some mac   and cheese.")).toBe("mac and cheese");
  });
});

describe("findFood (curated table)", () => {
  it("answers exact staples, singular or plural", () => {
    expect(findFood("pizza")?.val.carbs).toBe(34);
    expect(findFood("waffle")?.val.carbs).toBe(45);
    expect(findFood("pretzel")?.val.carbs).toBe(23); // table key is "pretzels"
    expect(findFood("cookies")?.val.carbs).toBe(20);
  });

  it("no longer pins a table portion on a longer query it doesn't describe", () => {
    // The old substring tiers: "rice cakes" matched "rice" (45g; real ~7g) and
    // "fruit salad" matched "salad" (10g). Those now fall through to the AI tier.
    expect(findFood("rice cakes")).toBeNull();
    expect(findFood("fruit salad")).toBeNull();
    expect(findFood("chicken salad sandwich")).toBeNull();
    expect(findFood("2 slices of pizza")).toBeNull();
  });
});

describe("usableGrams", () => {
  it("keeps real values, zero included, and rounds", () => {
    expect(usableGrams(0)).toBe(0);
    expect(usableGrams(45.4)).toBe(45);
    expect(usableGrams("12")).toBe(12);
  });

  it("rejects everything that can't size a dose instead of clamping it", () => {
    expect(usableGrams(-1)).toBeNull();
    expect(usableGrams(MAX_GRAMS + 1)).toBeNull();
    expect(usableGrams("abc")).toBeNull();
    expect(usableGrams("")).toBeNull();
    expect(usableGrams(undefined)).toBeNull();
    expect(usableGrams(null)).toBeNull();
    expect(usableGrams(NaN)).toBeNull();
  });
});

describe("parseModelEstimate", () => {
  const full = JSON.stringify({
    known: true,
    foodName: "Chicken fried rice",
    estimatedCarbs: 52,
    fatGrams: 14,
    proteinGrams: 20,
    absorption: "slow",
    confidence: "medium",
    portion: "one cup",
    tips: "High fat slows the rise.",
  });

  it("parses a full reply, fenced or not", () => {
    const est = parseModelEstimate(full, "x")!;
    expect(est.estimatedCarbs).toBe(52);
    expect(est.absorption).toBe("slow");
    expect(parseModelEstimate("```json\n" + full + "\n```", "x")?.estimatedCarbs).toBe(52);
  });

  it("keeps a genuine zero-carb answer at 0 (the old || 20 turned eggs into 20g)", () => {
    const est = parseModelEstimate(JSON.stringify({ foodName: "Scrambled eggs", estimatedCarbs: 0 }), "x")!;
    expect(est.estimatedCarbs).toBe(0);
  });

  it("returns null when the model declines or gives no usable number", () => {
    expect(parseModelEstimate(JSON.stringify({ known: false }), "x")).toBeNull();
    expect(parseModelEstimate(JSON.stringify({ foodName: "Mystery" }), "x")).toBeNull();
    expect(parseModelEstimate(JSON.stringify({ foodName: "Mystery", estimatedCarbs: "lots" }), "x")).toBeNull();
    expect(parseModelEstimate(JSON.stringify({ foodName: "Mystery", estimatedCarbs: 900 }), "x")).toBeNull();
    expect(parseModelEstimate("not json at all", "x")).toBeNull();
    expect(parseModelEstimate("", "x")).toBeNull();
  });

  it("falls back to the given name and drops invalid optional fields", () => {
    const est = parseModelEstimate(JSON.stringify({ estimatedCarbs: 30, absorption: "warp", confidence: "sure" }), "Fallback name")!;
    expect(est.foodName).toBe("Fallback name");
    expect(est.absorption).toBeUndefined();
    expect(est.confidence).toBe("medium");
  });
});

describe("unknownFoodResponse", () => {
  it("is honest for apps that can render it", () => {
    expect(unknownFoodResponse("dragon stew", true)).toEqual({ found: false, foodName: "dragon stew" });
  });

  it("gives older apps 0 carbs and low confidence, never a fabricated number", () => {
    const legacy = unknownFoodResponse("dragon stew", false) as { estimatedCarbs: number; confidence: string; tips?: string };
    expect(legacy.estimatedCarbs).toBe(0);
    expect(legacy.confidence).toBe("low");
    expect(legacy.tips).toContain("Type its carbs");
  });
});
