import { describe, expect, it, vi } from "vitest";
import {
  absorptionFor,
  gtin14,
  gtinEquals,
  lookupBarcode,
  normalizeBarcode,
  OFF_PRODUCT_URL,
  parsePackageGrams,
  productFromOpenFoodFacts,
  productFromUsdaSearch,
  USDA_SEARCH_URL,
} from "./barcode-lookup";

// Captured from the live registries (Cheerios, UPC 016000275287), trimmed to the fields used.
const USDA_CHEERIOS = {
  totalHits: 1,
  foods: [
    {
      fdcId: 2517161,
      description: "CHEERIOS CEREAL",
      dataType: "Branded",
      gtinUpc: "00016000275287",
      brandOwner: "General Mills",
      brandName: "Cheerios",
      servingSize: 20.0,
      servingSizeUnit: "GRM",
      householdServingFullText: "3/4 cup (20g) (age 1-3 years)",
      packageWeight: "18 ONZ",
      // FDC repeats every nutrient under several derivations; the FIRST set is the per-100 label basis.
      foodNutrients: [
        { nutrientId: 1003, value: 12.8 }, { nutrientId: 1004, value: 6.41 }, { nutrientId: 1005, value: 74.4 },
        { nutrientId: 1008, value: 359 }, { nutrientId: 2000, value: 5.13 }, { nutrientId: 1079, value: 10.3 },
        { nutrientId: 1003, value: 12.8 }, { nutrientId: 1005, value: 74.4 },
        { nutrientId: 1003, value: 5.56 }, { nutrientId: 1005, value: 21.6 }, { nutrientId: 1079, value: 2.5 },
      ],
    },
  ],
};
const OFF_CHEERIOS = {
  status: 1,
  product: {
    code: "0016000275287",
    product_name: "Cheerios",
    brands: "Cheerios",
    serving_size: "39g",
    serving_quantity: 39,
    product_quantity: 510.29141625,
    nutriments: {
      carbohydrates_100g: 74.3589743589744, carbohydrates_serving: 29, sugars_serving: 2, fiber_serving: 4,
      fat_serving: 2.5, proteins_serving: 5, "energy-kcal_serving": 140,
    },
  },
};

describe("barcode normalization", () => {
  it("keeps digits only and accepts 8–14 digit codes", () => {
    expect(normalizeBarcode(" 0-16000-27528-7 ")).toBe("016000275287");
    expect(normalizeBarcode("1234567")).toBeNull();
    expect(normalizeBarcode("123456789012345")).toBeNull();
    expect(normalizeBarcode("")).toBeNull();
    expect(normalizeBarcode("00000000000000")).toBeNull(); // all zeros is not a code
  });
  it("pads to the 14-digit GTIN USDA indexes and compares codes without leading zeros", () => {
    expect(gtin14("016000275287")).toBe("00016000275287");
    expect(gtinEquals("016000275287", "00016000275287")).toBe(true);
    expect(gtinEquals("016000275287", "016000275288")).toBe(false);
    expect(gtinEquals(undefined, "1")).toBe(false);
    expect(gtinEquals("0000", "000000")).toBe(false); // blank vs blank is not a match
  });
});

describe("parsePackageGrams", () => {
  it("reads USDA package weights in their common spellings", () => {
    expect(parsePackageGrams("18 ONZ")).toBeCloseTo(510.3, 0);
    expect(parsePackageGrams("510 g")).toBe(510);
    expect(parsePackageGrams("18 oz/1 lb 2 oz/510 g")).toBe(510);
    expect(parsePackageGrams("12 FL OZ")).toBeCloseTo(354.9, 0);
    expect(parsePackageGrams("1 lb 2 oz")).toBeCloseTo(510.3, 0);
    expect(parsePackageGrams("family size")).toBeNull();
    expect(parsePackageGrams(undefined)).toBeNull();
  });
});

describe("productFromUsdaSearch", () => {
  it("maps a matching branded food: per-100 label values scaled to the serving, servings per package derived", () => {
    const p = productFromUsdaSearch(USDA_CHEERIOS, "016000275287");
    expect(p).not.toBeNull();
    expect(p!.source).toBe("usda");
    expect(p!.foodName).toBe("Cheerios Cereal"); // title-cased; brand already in the name, not repeated
    expect(p!.brand).toBe("Cheerios");
    expect(p!.servingSize).toEqual({ amount: 20, unit: "g" });
    expect(p!.servingText).toBe("3/4 cup (20g) (age 1-3 years)");
    expect(p!.per100?.carbs).toBe(74.4);
    expect(p!.perServing).toEqual({ carbs: 14.9, fiber: 2.1, sugars: 1, fat: 1.3, protein: 2.6, calories: 72 });
    expect(p!.servingsPerContainer).toBe(26); // 510 g / 20 g = 25.5 → 26
  });
  it("refuses a near miss whose UPC is not the scanned code, and a food with no carbohydrate value", () => {
    expect(productFromUsdaSearch(USDA_CHEERIOS, "016000275288")).toBeNull();
    const noCarbs = { foods: [{ ...USDA_CHEERIOS.foods[0], foodNutrients: [{ nutrientId: 1003, value: 1 }] }] };
    expect(productFromUsdaSearch(noCarbs, "016000275287")).toBeNull();
    expect(productFromUsdaSearch({ foods: [] }, "016000275287")).toBeNull();
    expect(productFromUsdaSearch(null, "016000275287")).toBeNull();
  });
  it("prefixes the brand when the description lacks it, and treats an unknown serving unit as per-100", () => {
    const f = { ...USDA_CHEERIOS.foods[0], description: "HONEY NUT O'S", brandName: "Acme", servingSizeUnit: "EACH", packageWeight: undefined };
    const p = productFromUsdaSearch({ foods: [f] }, "016000275287")!;
    expect(p.foodName).toBe("Acme Honey Nut O's");
    expect(p.servingSize).toBeUndefined();
    expect(p.perServing.carbs).toBe(74.4);
    expect(p.servingsPerContainer).toBeUndefined();
  });
  it("calls a package that is a hair under one serving a single serving (a 12 fl oz can vs a 355 ml serving)", () => {
    const can = { ...USDA_CHEERIOS.foods[0], description: "COLA", servingSize: 355, servingSizeUnit: "MLT", packageWeight: "12 FL OZ" };
    expect(productFromUsdaSearch({ foods: [can] }, "016000275287")!.servingsPerContainer).toBe(1);
  });
});

describe("productFromOpenFoodFacts", () => {
  it("uses the registry's per-serving values and derives servings per package", () => {
    const p = productFromOpenFoodFacts(OFF_CHEERIOS, "016000275287")!;
    expect(p.source).toBe("openfoodfacts");
    expect(p.foodName).toBe("Cheerios");
    expect(p.servingSize).toEqual({ amount: 39, unit: "g" });
    expect(p.perServing).toEqual({ carbs: 29, fiber: 4, sugars: 2, fat: 2.5, protein: 5, calories: 140 });
    expect(p.per100?.carbs).toBeCloseTo(74.36, 1);
    expect(p.servingsPerContainer).toBe(13); // 510 g / 39 g = 13.08
  });
  it("falls back to scaling per-100 values when no per-serving figures exist, and rejects unknown codes", () => {
    const scaled = { status: 1, product: { product_name: "Crackers", brands: "Brand, Other", serving_quantity: "30", nutriments: { carbohydrates_100g: 70, sugars_100g: 10 } } };
    const p = productFromOpenFoodFacts(scaled, "1")!;
    expect(p.foodName).toBe("Brand Crackers");
    expect(p.perServing).toEqual({ carbs: 21, sugars: 3 });
    expect(productFromOpenFoodFacts({ status: 0 }, "1")).toBeNull();
    expect(productFromOpenFoodFacts({ status: 1, product: { product_name: "X", nutriments: {} } }, "1")).toBeNull();
  });
});

describe("lookupBarcode", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  it("asks USDA first with the 14-digit GTIN and returns its product", async () => {
    const fetch = vi.fn(async (url: string) => (url.startsWith(USDA_SEARCH_URL) ? ok(USDA_CHEERIOS) : ok(OFF_CHEERIOS)));
    const p = await lookupBarcode("016000275287", { fetch, usdaApiKey: "k" });
    expect(p?.source).toBe("usda");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toContain("query=00016000275287");
    expect(fetch.mock.calls[0]![0]).toContain("api_key=k");
  });
  it("falls through to Open Food Facts when USDA has no match or fails, and uses DEMO_KEY without a key", async () => {
    const fetch = vi.fn(async (url: string) => (url.startsWith(USDA_SEARCH_URL) ? ok({ foods: [] }) : ok(OFF_CHEERIOS)));
    const p = await lookupBarcode("016000275287", { fetch });
    expect(p?.source).toBe("openfoodfacts");
    expect(fetch.mock.calls[0]![0]).toContain("api_key=DEMO_KEY");
    expect(fetch.mock.calls[1]![0]).toBe(`${OFF_PRODUCT_URL}/016000275287.json?fields=code,product_name,brands,serving_size,serving_quantity,product_quantity,nutriments`);

    const failing = vi.fn(async (url: string) => {
      if (url.startsWith(USDA_SEARCH_URL)) throw new Error("down");
      return ok(OFF_CHEERIOS);
    });
    expect((await lookupBarcode("016000275287", { fetch: failing }))?.source).toBe("openfoodfacts");
  });
  it("returns null when neither registry knows the code", async () => {
    const fetch = vi.fn(async () => ok({ foods: [], status: 0 }));
    expect(await lookupBarcode("016000275287", { fetch })).toBeNull();
  });
});

describe("absorptionFor", () => {
  it("classes sugar-dominant carbs fast, fatty items slow, the rest medium", () => {
    expect(absorptionFor({ carbs: 40, sugars: 38 })).toBe("fast");
    expect(absorptionFor({ carbs: 40, sugars: 5, fat: 18 })).toBe("slow");
    expect(absorptionFor({ carbs: 40, sugars: 5, fat: 3 })).toBe("medium");
    expect(absorptionFor({ carbs: 0 })).toBeUndefined();
  });
});
