/**
 * Barcode → packaged-food nutrition. Two registries, tried in order:
 *  1. USDA FoodData Central "Branded" foods (authoritative US labels; needs an API key — `DEMO_KEY`
 *     works for development at a low rate limit). FDC only matches a UPC when it is queried as the
 *     14-digit GTIN (zero-padded), and it returns nutrients PER 100 g/ml, so per-serving values are
 *     derived from `servingSize`.
 *  2. Open Food Facts (community-maintained, no key) as the fallback for what USDA lacks. It reports
 *     per-serving values directly when it has them.
 *
 * Everything here is pure and fetch-injected so it is unit-tested against real captured responses;
 * the Express route is a thin wrapper.
 */

export type NutrientSet = { carbs: number; fiber?: number; sugars?: number; fat?: number; protein?: number; calories?: number };

export type BarcodeProduct = {
  source: "usda" | "openfoodfacts";
  /** The scanned code, digits only. */
  barcode: string;
  foodName: string;
  brand?: string;
  /** Label serving, when the registry states it (grams or millilitres). */
  servingSize?: { amount: number; unit: "g" | "ml" };
  /** Household serving text, e.g. "3/4 cup (20g)". */
  servingText?: string;
  /** Servings in the package when it can be derived from the package size; undefined = unknown. */
  servingsPerContainer?: number;
  perServing: NutrientSet;
  per100?: NutrientSet;
};

/** Digits only; a retail barcode is 8–14 digits (EAN-8, UPC-A/E, EAN-13, GTIN-14). */
export function normalizeBarcode(raw: string): string | null {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  // All zeros is not a code — and it would compare equal to any registry entry with a blank UPC.
  return /[1-9]/.test(digits) ? digits : null;
}

/** Zero-pad to the 14-digit GTIN form USDA indexes. */
export function gtin14(code: string): string {
  return code.padStart(14, "0");
}

/** Same code regardless of leading zeros (UPC-A "016…" vs GTIN-14 "00016…"). */
export function gtinEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.replace(/\D+/g, "").replace(/^0+/, "");
  const y = b.replace(/\D+/g, "").replace(/^0+/, "");
  return x.length > 0 && x === y; // two blank codes are not "the same product"
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Grams (or millilitres) in a package from USDA's free-text `packageWeight` ("18 ONZ", "510 g",
 * "18 oz/1 lb 2 oz/510 g", "12 FL OZ"). Prefers an explicit metric figure when several are given.
 */
export function parsePackageGrams(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const metric = t.match(/(\d+(?:\.\d+)?)\s*(g|grm|gram|grams|ml|mlt)\b/);
  if (metric) return Number(metric[1]);
  const flOz = t.match(/(\d+(?:\.\d+)?)\s*fl\.?\s*oz/);
  if (flOz) return Number(flOz[1]) * 29.5735;
  const lb = t.match(/(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)\b/);
  const oz = t.match(/(\d+(?:\.\d+)?)\s*(oz|onz|ounce|ounces)\b/);
  if (lb || oz) return (lb ? Number(lb[1]) * 453.592 : 0) + (oz ? Number(oz[1]) * 28.3495 : 0);
  return null;
}

function servingsFrom(packageAmount: number | null, servingAmount: number | undefined): number | undefined {
  if (!packageAmount || !servingAmount || servingAmount <= 0) return undefined;
  const n = packageAmount / servingAmount;
  if (!Number.isFinite(n) || n < 0.5) return undefined;
  // Labels say "about 26 servings" — whole numbers read right. Anything up to 1.5 is a single-serving
  // package; that includes a hair UNDER 1 (a 12 fl oz can is 354.9 ml against a 355 ml serving).
  return n < 1.5 ? 1 : Math.round(n);
}

// ── USDA FoodData Central ──
const USDA_NUTRIENT = { protein: 1003, fat: 1004, carbs: 1005, calories: 1008, fiber: 1079, sugars: 2000 } as const;

type UsdaFood = {
  description?: string;
  gtinUpc?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  packageWeight?: string;
  foodNutrients?: { nutrientId?: number; value?: number }[];
};

/**
 * Map a search response to a product. Only a food whose `gtinUpc` is the scanned code counts — the
 * search is full-text, and a near miss would be a different product. Nutrients are read from the
 * FIRST entry per id: FDC lists each nutrient several times under different derivations, and the
 * first set is the label's per-100 basis (the later sets can be per-serving restatements).
 */
export function productFromUsdaSearch(json: unknown, code: string): BarcodeProduct | null {
  const foods = (json as { foods?: UsdaFood[] } | null)?.foods;
  if (!Array.isArray(foods)) return null;
  const food = foods.find((f) => gtinEquals(f.gtinUpc, code));
  if (!food || !food.description) return null;
  const first = new Map<number, number>();
  for (const n of food.foodNutrients ?? []) {
    if (typeof n.nutrientId === "number" && typeof n.value === "number" && !first.has(n.nutrientId)) first.set(n.nutrientId, n.value);
  }
  const carbs100 = first.get(USDA_NUTRIENT.carbs);
  if (carbs100 == null) return null;
  const per100: NutrientSet = { carbs: carbs100 };
  const fiber = first.get(USDA_NUTRIENT.fiber), sugars = first.get(USDA_NUTRIENT.sugars);
  const fat = first.get(USDA_NUTRIENT.fat), protein = first.get(USDA_NUTRIENT.protein), kcal = first.get(USDA_NUTRIENT.calories);
  if (fiber != null) per100.fiber = fiber;
  if (sugars != null) per100.sugars = sugars;
  if (fat != null) per100.fat = fat;
  if (protein != null) per100.protein = protein;
  if (kcal != null) per100.calories = kcal;

  const unitRaw = (food.servingSizeUnit ?? "").toUpperCase();
  const unit: "g" | "ml" | null = unitRaw === "GRM" || unitRaw === "G" ? "g" : unitRaw === "MLT" || unitRaw === "ML" ? "ml" : null;
  const servingAmount = typeof food.servingSize === "number" && food.servingSize > 0 && unit ? food.servingSize : undefined;
  const scale = (servingAmount ?? 100) / 100;
  const perServing: NutrientSet = { carbs: round1(per100.carbs * scale) };
  for (const k of ["fiber", "sugars", "fat", "protein", "calories"] as const) {
    const v = per100[k];
    if (v != null) perServing[k] = k === "calories" ? Math.round(v * scale) : round1(v * scale);
  }

  const brand = food.brandName?.trim() || food.brandOwner?.trim() || undefined;
  const name = titleCase(food.description.trim());
  const product: BarcodeProduct = {
    source: "usda",
    barcode: code,
    foodName: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    perServing,
    per100,
  };
  if (brand) product.brand = brand;
  if (servingAmount && unit) product.servingSize = { amount: servingAmount, unit };
  const household = food.householdServingFullText?.trim();
  if (household) product.servingText = household;
  const spc = servingsFrom(parsePackageGrams(food.packageWeight), servingAmount);
  if (spc != null) product.servingsPerContainer = spc;
  return product;
}

/** FDC descriptions are often SHOUTED ("CHEERIOS CEREAL"); title-case them for display. */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_m, pre, ch) => pre + ch.toUpperCase());
}

// ── Open Food Facts ──
type OffProduct = {
  product_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  product_quantity?: number | string;
  nutriments?: Record<string, unknown>;
};

export function productFromOpenFoodFacts(json: unknown, code: string): BarcodeProduct | null {
  const body = json as { status?: number; product?: OffProduct } | null;
  const p = body?.product;
  if (!p || body?.status === 0) return null;
  const n = p.nutriments ?? {};
  const num = (k: string): number | undefined => {
    const v = n[k];
    return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const carbsServing = num("carbohydrates_serving");
  const carbs100 = num("carbohydrates_100g");
  const servingQty = typeof p.serving_quantity === "number" ? p.serving_quantity : Number(p.serving_quantity);
  const servingAmount = Number.isFinite(servingQty) && servingQty > 0 ? servingQty : undefined;
  // Per serving straight from the registry when present; otherwise scale the per-100 figures.
  const scale = servingAmount != null ? servingAmount / 100 : null;
  const pick = (servingKey: string, per100Key: string, whole = false): number | undefined => {
    const s = num(servingKey);
    if (s != null) return whole ? Math.round(s) : round1(s);
    const h = num(per100Key);
    return h != null && scale != null ? (whole ? Math.round(h * scale) : round1(h * scale)) : undefined;
  };
  const carbs = carbsServing != null ? round1(carbsServing) : carbs100 != null && scale != null ? round1(carbs100 * scale) : undefined;
  if (carbs == null || !p.product_name?.trim()) return null;
  const perServing: NutrientSet = { carbs };
  const fiber = pick("fiber_serving", "fiber_100g"), sugars = pick("sugars_serving", "sugars_100g");
  const fat = pick("fat_serving", "fat_100g"), protein = pick("proteins_serving", "proteins_100g"), kcal = pick("energy-kcal_serving", "energy-kcal_100g", true);
  if (fiber != null) perServing.fiber = fiber;
  if (sugars != null) perServing.sugars = sugars;
  if (fat != null) perServing.fat = fat;
  if (protein != null) perServing.protein = protein;
  if (kcal != null) perServing.calories = kcal;

  const brand = p.brands?.split(",")[0]?.trim() || undefined;
  const name = p.product_name.trim();
  const product: BarcodeProduct = {
    source: "openfoodfacts",
    barcode: code,
    foodName: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    perServing,
  };
  if (brand) product.brand = brand;
  if (carbs100 != null) {
    const per100: NutrientSet = { carbs: carbs100 };
    const f = num("fiber_100g"), s = num("sugars_100g"), fa = num("fat_100g"), pr = num("proteins_100g"), k = num("energy-kcal_100g");
    if (f != null) per100.fiber = f;
    if (s != null) per100.sugars = s;
    if (fa != null) per100.fat = fa;
    if (pr != null) per100.protein = pr;
    if (k != null) per100.calories = k;
    product.per100 = per100;
  }
  if (servingAmount != null) {
    const unit: "g" | "ml" = /ml/i.test(p.serving_size ?? "") ? "ml" : "g";
    product.servingSize = { amount: servingAmount, unit };
  }
  const servingText = p.serving_size?.trim();
  if (servingText) product.servingText = servingText;
  const pq = typeof p.product_quantity === "number" ? p.product_quantity : Number(p.product_quantity);
  const spc = servingsFrom(Number.isFinite(pq) && pq > 0 ? pq : null, servingAmount);
  if (spc != null) product.servingsPerContainer = spc;
  return product;
}

// ── Orchestration ──
export type LookupDeps = {
  fetch: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  /** USDA key; `DEMO_KEY` is used when absent (fine for development, tightly rate-limited). */
  usdaApiKey?: string;
  userAgent?: string;
};

export const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
export const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const OFF_FIELDS = "code,product_name,brands,serving_size,serving_quantity,product_quantity,nutriments";

/** USDA first, Open Food Facts second; null when neither knows the code. Registry errors fall through. */
export async function lookupBarcode(code: string, deps: LookupDeps): Promise<BarcodeProduct | null> {
  const ua = deps.userAgent ?? "GlucoseGuardian/1.0";
  try {
    const key = encodeURIComponent(deps.usdaApiKey?.trim() || "DEMO_KEY");
    const url = `${USDA_SEARCH_URL}?api_key=${key}&query=${gtin14(code)}&dataType=Branded&pageSize=5`;
    const res = await deps.fetch(url, { headers: { "User-Agent": ua } });
    if (res.ok) {
      const product = productFromUsdaSearch(await res.json(), code);
      if (product) return product;
    }
  } catch {
    /* registry unreachable — try the next one */
  }
  try {
    const res = await deps.fetch(`${OFF_PRODUCT_URL}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`, { headers: { "User-Agent": ua } });
    if (res.ok) {
      const product = productFromOpenFoodFacts(await res.json(), code);
      if (product) return product;
    }
  } catch {
    /* unreachable */
  }
  return null;
}

/**
 * Carb absorption class for the app's carbs-on-board window, from the label: sugar-dominant carbs
 * hit fast, high-fat items slow, everything else medium. Mirrors the keyword classes the name
 * lookup uses (see routes/food.ts) but reads the numbers instead of guessing from a name.
 */
export function absorptionFor(perServing: NutrientSet): "fast" | "medium" | "slow" | undefined {
  const { carbs, sugars, fat } = perServing;
  if (!(carbs > 0)) return undefined;
  if (fat != null && fat >= 15) return "slow";
  if (sugars != null && sugars / carbs >= 0.6) return "fast";
  return "medium";
}
