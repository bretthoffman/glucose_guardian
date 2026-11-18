import { Router, type IRouter } from "express";
import { EstimateFoodCarbsBody, EstimateFoodCarbsResponse } from "@workspace/api-zod";
import OpenAI from "openai";
import { absorptionFor, lookupBarcode, normalizeBarcode } from "../barcode-lookup";

const router: IRouter = Router();

const carbDatabase: Record<
  string,
  { carbs: number; confidence: "high" | "medium" | "low"; tips?: string }
> = {
  // Breakfast
  "avocado toast": { carbs: 35, confidence: "medium", tips: "2 slices whole-grain bread + avocado. The bread is the main carb — about 15g per slice." },
  pancakes: { carbs: 56, confidence: "medium", tips: "Two medium pancakes with syrup. Very high carb — plan insulin 15 min before eating." },
  waffle: { carbs: 45, confidence: "medium", tips: "One regular waffle without toppings." },
  waffles: { carbs: 45, confidence: "medium", tips: "One regular waffle without toppings." },
  oatmeal: { carbs: 27, confidence: "high", tips: "Half cup dry oats. Steel-cut oats have a lower glycemic index." },
  bagel: { carbs: 55, confidence: "high", tips: "One plain bagel. Higher than expected — more carbs than 3 slices of bread." },
  muffin: { carbs: 55, confidence: "medium", tips: "Large store-bought muffin. Often higher than expected." },
  donut: { carbs: 30, confidence: "medium", tips: "One glazed donut." },
  "french toast": { carbs: 40, confidence: "medium", tips: "2 slices. Syrup adds significant carbs — measure carefully." },
  cereal: { carbs: 30, confidence: "medium", tips: "One cup. Choose low-sugar options." },
  granola: { carbs: 40, confidence: "medium", tips: "Half cup. Higher in carbs than it looks — measure carefully." },
  "granola bar": { carbs: 25, confidence: "medium", tips: "One bar. Check the label as brands vary widely." },
  eggs: { carbs: 1, confidence: "high", tips: "Eggs are almost zero carb — great protein choice for diabetes." },
  bacon: { carbs: 1, confidence: "high", tips: "2 strips. Nearly zero carbs — watch the protein and fat instead." },
  sausage: { carbs: 5, confidence: "medium", tips: "2 links. Check for added sugars in some brands." },
  "english muffin": { carbs: 30, confidence: "high", tips: "One English muffin. Whole-wheat version provides more fiber." },
  // Lunch / dinner
  pizza: { carbs: 34, confidence: "high", tips: "One regular slice. Opt for thin crust to lower carbs." },
  sandwich: { carbs: 30, confidence: "medium", tips: "Average deli sandwich on white bread." },
  sub: { carbs: 65, confidence: "medium", tips: "6-inch sub roll. The bread is the main carb source — ask for less bread or a wrap." },
  wrap: { carbs: 38, confidence: "medium", tips: "One flour tortilla wrap. Whole-wheat tortillas have slightly more fiber." },
  burger: { carbs: 40, confidence: "medium", tips: "Standard hamburger with bun. Lettuce wrap removes most of the carbs." },
  hamburger: { carbs: 40, confidence: "medium", tips: "Standard hamburger with bun. Lettuce wrap removes most of the carbs." },
  hotdog: { carbs: 22, confidence: "medium", tips: "Hot dog in bun. Most carbs come from the bun." },
  "hot dog": { carbs: 22, confidence: "medium", tips: "Hot dog in bun. Most carbs come from the bun." },
  tacos: { carbs: 45, confidence: "medium", tips: "2 corn tacos. Corn tortillas have fewer carbs than flour." },
  taco: { carbs: 22, confidence: "medium", tips: "One corn taco. Corn tortillas have fewer carbs than flour." },
  burrito: { carbs: 65, confidence: "medium", tips: "Full burrito. Flour tortilla + rice + beans add up quickly." },
  quesadilla: { carbs: 38, confidence: "medium", tips: "One flour tortilla quesadilla. Corn tortillas are lower carb." },
  nachos: { carbs: 45, confidence: "medium", tips: "Standard serving (~15 chips + toppings). Portion carefully." },
  "mac and cheese": { carbs: 48, confidence: "high", tips: "One cup. Pasta + cheese sauce — higher carb than expected." },
  "macaroni and cheese": { carbs: 48, confidence: "high", tips: "One cup. Pasta + cheese sauce — higher carb than expected." },
  "grilled cheese": { carbs: 30, confidence: "high", tips: "2 slices white bread. Whole-grain bread lowers the glycemic index." },
  "shrimp and grits": { carbs: 45, confidence: "medium", tips: "Standard serving. Grits are the main carb — about 25–35g per cup." },
  grits: { carbs: 30, confidence: "high", tips: "One cup cooked grits. White grits have a high glycemic index." },
  "fried chicken": { carbs: 18, confidence: "medium", tips: "2 pieces. Breading adds carbs — remove for fewer." },
  chicken: { carbs: 0, confidence: "high", tips: "Grilled or baked chicken is zero carb — a great diabetes-friendly protein." },
  steak: { carbs: 2, confidence: "high", tips: "Plain steak is nearly zero carb. Watch marinades/sauces for hidden sugar." },
  salmon: { carbs: 0, confidence: "high", tips: "Plain salmon is zero carb and high in omega-3s — great choice." },
  fish: { carbs: 5, confidence: "medium", tips: "Plain fish is very low carb. Breaded versions can add 15–20g." },
  shrimp: { carbs: 2, confidence: "high", tips: "Plain shrimp is very low carb. Breaded or sauced versions add carbs." },
  soup: { carbs: 20, confidence: "medium", tips: "One cup. Broth-based soups are lower carb than creamy ones." },
  salad: { carbs: 10, confidence: "medium", tips: "Side salad with dressing. Watch croutons, dried fruit, and sweet dressings." },
  sushi: { carbs: 30, confidence: "medium", tips: "6-piece roll. White rice is the main carb — sashimi has almost none." },
  "fried rice": { carbs: 58, confidence: "high", tips: "One cup. Higher than plain rice due to added sauces." },
  "lo mein": { carbs: 50, confidence: "medium", tips: "One cup. Noodle-based — similar to pasta in carb count." },
  dumplings: { carbs: 30, confidence: "medium", tips: "6 pieces. Wrappers add significant carbs." },
  // Sides & starches
  rice: { carbs: 45, confidence: "high", tips: "One cup cooked white rice. Brown rice has more fiber." },
  pasta: { carbs: 45, confidence: "high", tips: "One cup cooked pasta. Whole wheat is a better choice." },
  spaghetti: { carbs: 45, confidence: "high", tips: "One cup cooked. Al dente has a lower glycemic index." },
  noodles: { carbs: 43, confidence: "high", tips: "One cup cooked egg noodles. Whole-wheat lowers glycemic impact." },
  bread: { carbs: 15, confidence: "high", tips: "One slice white bread. Whole grain is a better choice." },
  toast: { carbs: 30, confidence: "high", tips: "2 slices toast. Whole grain reduces the glycemic spike." },
  potato: { carbs: 37, confidence: "high", tips: "Medium baked potato. Toppings add more carbs." },
  "french fries": { carbs: 50, confidence: "high", tips: "Medium serving (~3oz). Baked versions have similar carbs with fewer calories." },
  fries: { carbs: 50, confidence: "high", tips: "Medium serving (~3oz). Hard to under-dose for these." },
  "sweet potato": { carbs: 26, confidence: "high", tips: "Medium sweet potato. Lower glycemic index than white potato." },
  corn: { carbs: 19, confidence: "high", tips: "One ear of corn. A moderate-carb vegetable." },
  peas: { carbs: 12, confidence: "high", tips: "Half cup cooked peas." },
  // Snacks & sweets
  chips: { carbs: 15, confidence: "high", tips: "About 15 chips (1oz serving). Easy to overeat." },
  pretzels: { carbs: 23, confidence: "high", tips: "One oz (~15 small pretzels). Higher than chips due to the dough." },
  popcorn: { carbs: 18, confidence: "high", tips: "3 cups air-popped. A good low-calorie snack in small servings." },
  crackers: { carbs: 21, confidence: "high", tips: "About 5 crackers (1oz). Whole-grain options add fiber." },
  cookie: { carbs: 20, confidence: "medium", tips: "Medium chocolate chip cookie." },
  cookies: { carbs: 20, confidence: "medium", tips: "One medium cookie. Two triples the dose needed!" },
  cake: { carbs: 35, confidence: "medium", tips: "Small slice. Frosting adds significant carbs." },
  brownie: { carbs: 36, confidence: "medium", tips: "One 2-inch brownie. Dense — easy to under-estimate." },
  cheesecake: { carbs: 36, confidence: "medium", tips: "One slice. Crust and filling both add carbs." },
  pie: { carbs: 45, confidence: "medium", tips: "One slice. Crust adds significant carbs on top of the filling." },
  "ice cream": { carbs: 30, confidence: "medium", tips: "Half cup. Fat slows absorption — bolus 15 min after eating." },
  chocolate: { carbs: 25, confidence: "medium", tips: "1oz milk chocolate bar. Dark chocolate (70%+) has fewer carbs." },
  candy: { carbs: 25, confidence: "medium", tips: "Small handful. High glycemic index — acts very fast on blood sugar." },
  gummies: { carbs: 30, confidence: "medium", tips: "About 10 pieces. Fast-acting — useful for lows, but easy to overdo." },
  // Fruit
  apple: { carbs: 25, confidence: "high", tips: "Medium apple. Eat with protein to slow the sugar rise." },
  banana: { carbs: 27, confidence: "high", tips: "Medium banana. Riper bananas have a higher glycemic index." },
  orange: { carbs: 15, confidence: "high", tips: "Medium orange. High in vitamin C with moderate carbs." },
  strawberries: { carbs: 12, confidence: "high", tips: "One cup fresh strawberries. Great low-carb fruit choice." },
  grapes: { carbs: 28, confidence: "high", tips: "One cup grapes. High glycemic — eat in small portions." },
  mango: { carbs: 25, confidence: "high", tips: "Half a mango. Naturally sweet — limit to small servings." },
  pineapple: { carbs: 20, confidence: "high", tips: "Half cup chunks. High glycemic — eat in small portions." },
  watermelon: { carbs: 12, confidence: "high", tips: "One cup diced. High glycemic index despite the lower carb count." },
  avocado: { carbs: 9, confidence: "high", tips: "Half a medium avocado. Very low carb and high in healthy fats." },
  berries: { carbs: 12, confidence: "medium", tips: "One cup mixed berries. Among the lowest-carb fruits." },
  // Drinks
  milk: { carbs: 12, confidence: "high", tips: "One cup (8oz). Skim milk has slightly fewer carbs." },
  juice: { carbs: 26, confidence: "medium", tips: "8oz orange juice. Whole fruit is always better than juice." },
  smoothie: { carbs: 50, confidence: "medium", tips: "16oz fruit smoothie. Hidden carbs — count each fruit ingredient." },
  soda: { carbs: 40, confidence: "high", tips: "12oz regular soda. One of the highest-glycemic drinks — avoid or use diet." },
  // Dairy
  yogurt: { carbs: 17, confidence: "medium", tips: "6oz plain yogurt. Greek yogurt has fewer carbs — avoid flavored." },
  // Low/no carb
  water: { carbs: 0, confidence: "high", tips: "Zero carbs! Staying hydrated helps glucose stability." },
};

/**
 * Absorption-speed tags for lookup foods where it's clear-cut. Fast = mostly liquid/simple sugar
 * (~2h); slow = high fat/protein meals with a delayed rise (~4h). Everything else defaults to
 * medium (~3h) downstream. Keys must match `carbDatabase` keys.
 */
const FAST_ABSORPTION_FOODS = new Set([
  "juice", "soda", "candy", "grapes", "watermelon", "pineapple", "honey",
]);
const SLOW_ABSORPTION_FOODS = new Set([
  "pizza", "grilled cheese", "mac and cheese", "burger", "cheeseburger", "fries", "ice cream",
  "burrito", "lasagna", "fried chicken", "nuggets",
]);

function absorptionForKey(key: string | null): "fast" | "slow" | undefined {
  if (!key) return undefined;
  if (FAST_ABSORPTION_FOODS.has(key)) return "fast";
  if (SLOW_ABSORPTION_FOODS.has(key)) return "slow";
  return undefined;
}

/** Lowercase, drop a leading article and trailing punctuation, collapse spaces. */
export function normalizeFoodQuery(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/^(?:a|an|the|some)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The curated table answers only what it EXACTLY names (plus trivial singular/plural), so a fixed
 * portion can never be pinned on a longer query it doesn't describe. The old substring tiers did
 * exactly that: "rice cakes" matched "rice" (45g; real answer ~7g), "fruit salad" matched "salad".
 * Everything the table doesn't name goes to the AI estimator, which reads amounts and modifiers.
 */
export function findFood(normalized: string): { key: string; val: (typeof carbDatabase)[string] } | null {
  const candidates = [
    normalized,
    normalized.endsWith("s") ? normalized.slice(0, -1) : `${normalized}s`,
  ];
  for (const key of candidates) {
    const val = carbDatabase[key];
    if (val) return { key, val };
  }
  return null;
}

/**
 * Grams outside this window can't be real for one logged meal — a model reply outside it is
 * garbage, and garbage is treated as "no estimate", NEVER clamped into a plausible-looking number.
 */
export const MAX_GRAMS = 300;

/** Whole non-negative grams from a model field, or null when it isn't a usable number. */
export function usableGrams(value: unknown): number | null {
  const n = Number(value);
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (value === "" || !Number.isFinite(n) || n < 0 || n > MAX_GRAMS) return null;
  return Math.round(n);
}

export type FoodEstimate = {
  foodName: string;
  estimatedCarbs: number;
  confidence: "high" | "medium" | "low";
  tips?: string;
  portion?: string;
  fatGrams?: number;
  proteinGrams?: number;
  absorption?: "fast" | "medium" | "slow";
};

/**
 * Parse a model reply (text or photo prompt — same JSON contract) into a usable estimate.
 * Null = the model declined ({"known": false}) or the reply is unusable (no parseable JSON, or no
 * usable carb number). A genuine 0 stays 0: the old `|| 20` here turned "eggs, zero carbs" into
 * 20g with a real-looking name, which doses insulin at phantom carbs. Never resurrect a default.
 */
export function parseModelEstimate(raw: string, fallbackName: string): FoodEstimate | null {
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || parsed.known === false) return null;
  const estimatedCarbs = usableGrams(parsed.estimatedCarbs);
  if (estimatedCarbs == null) return null;
  const fatGrams = usableGrams(parsed.fatGrams);
  const proteinGrams = usableGrams(parsed.proteinGrams);
  const confidence =
    parsed.confidence === "high" || parsed.confidence === "low" ? parsed.confidence : "medium";
  const absorption =
    parsed.absorption === "fast" || parsed.absorption === "slow" || parsed.absorption === "medium"
      ? parsed.absorption
      : undefined;
  const text = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    foodName: text(parsed.foodName) ?? fallbackName,
    estimatedCarbs,
    confidence,
    tips: text(parsed.tips),
    portion: text(parsed.portion),
    ...(fatGrams != null ? { fatGrams } : {}),
    ...(proteinGrams != null ? { proteinGrams } : {}),
    ...(absorption ? { absorption } : {}),
  };
}

/**
 * What /estimate answers when neither the table nor the AI knows the food.
 * - Apps that sent `allowNotFound: true` get the honest shape and show their manual-entry card.
 * - Older apps can only render the estimate shape, so they get 0 carbs + low confidence + a tip
 *   asking for the label number: 0 is the SAFE failure direction (no insulin for a guess), and the
 *   card's carb bubble is editable right there. The fabricated 30g default is gone for them too.
 */
export function unknownFoodResponse(foodName: string, allowNotFound: boolean) {
  if (allowNotFound) return { found: false as const, foodName };
  return EstimateFoodCarbsResponse.parse({
    foodName,
    estimatedCarbs: 0,
    confidence: "low",
    tips: "I don't know this food yet. Type its carbs from the label, or scan the barcode or take a photo.",
  });
}

/** Ask the chat/photo model for a text-only estimate. Null = declined, unusable, or the call failed. */
async function aiEstimate(query: string): Promise<FoodEstimate | null> {
  const openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    fetch: globalThis.fetch,
  });
  const prompt = `You are a diabetes nutrition expert. Someone typed this food into a carb-counting app: "${query}". Your number sizes an insulin dose.

Respond ONLY with a valid JSON object, no markdown, in this exact format:
{"known": true, "foodName": "cleaned up name", "estimatedCarbs": <integer grams>, "fatGrams": <integer>, "proteinGrams": <integer>, "absorption": "fast" | "medium" | "slow", "confidence": "high" | "medium" | "low", "portion": "the serving you estimated for", "tips": "1-2 sentence diabetes tip"}

If the text is not a food or drink you can size with real confidence (gibberish, a brand or restaurant item you don't actually know, a medicine), respond exactly {"known": false} instead. Never guess a number for something you don't know.
Assume one typical serving unless the text states an amount; honor stated amounts ("2 slices", "half a cup", "large").
Estimate as ACCURATELY as you can: overestimating is as dangerous as underestimating, since it can cause low blood sugar. Reflect uncertainty in "confidence", not by padding the number. A true zero-carb food is 0.
"absorption" is how fast the carbs hit the bloodstream: "fast" for liquids and simple sugars, "slow" for high-fat or high-protein meals, "medium" otherwise.
In "foodName", "portion" and "tips", never use dashes between words or clauses; use a period or a comma instead.`;
  // A reasoning model: the budget covers reasoning PLUS the reply (see chat.ts for the failure
  // mode a tight budget causes). Unused budget costs nothing.
  const completion = await openai.chat.completions.create({
    model: "openai/gpt-5.2",
    max_completion_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  return parseModelEstimate(completion.choices[0]?.message?.content ?? "", query);
}

/**
 * Text lookup, three tiers: curated table (exact staples, instant, hand-written tips) → AI estimate
 * (the same model that reads food photos; it may decline) → honest unknown (unknownFoodResponse).
 * The old behavior — fabricating 30g for anything unmatched — is gone on every path.
 */
router.post("/estimate", async (req, res) => {
  const body = EstimateFoodCarbsBody.parse(req.body);
  // Sent by app versions that can render "I don't know" (the zod parse above strips extras).
  const allowNotFound = (req.body as { allowNotFound?: unknown } | undefined)?.allowNotFound === true;
  const { foodName } = body;
  const match = findFood(normalizeFoodQuery(foodName));
  if (match) {
    const response = EstimateFoodCarbsResponse.parse({
      foodName,
      estimatedCarbs: match.val.carbs,
      confidence: match.val.confidence,
      tips: match.val.tips ?? "Estimate based on typical serving. Weigh food for best accuracy.",
    });
    // `absorption` rides alongside the schema'd fields (fast sugar vs slow high-fat meals) so the
    // app's carbs-on-board window matches the food. Absent = medium.
    const absorption = absorptionForKey(match.key);
    res.json({ ...response, source: "table", ...(absorption ? { absorption } : {}) });
    return;
  }

  const ai = await aiEstimate(foodName).catch((err) => {
    console.error("Food text estimate failed:", err?.message ?? err);
    return null;
  });
  if (ai) {
    const response = EstimateFoodCarbsResponse.parse({
      foodName: ai.foodName,
      estimatedCarbs: ai.estimatedCarbs,
      confidence: ai.confidence,
      tips: ai.tips ?? "AI estimate for a typical serving. Check the label when you have one.",
    });
    res.json({
      ...response,
      source: "ai",
      ...(ai.portion ? { portion: ai.portion } : {}),
      ...(ai.fatGrams != null ? { fatGrams: ai.fatGrams } : {}),
      ...(ai.proteinGrams != null ? { proteinGrams: ai.proteinGrams } : {}),
      ...(ai.absorption ? { absorption: ai.absorption } : {}),
    });
    return;
  }

  res.json(unknownFoodResponse(foodName, allowNotFound));
});

/**
 * Packaged food by barcode → label nutrition, per serving. USDA FoodData Central first, Open Food
 * Facts as the fallback (see internal/barcode-lookup). The response carries the same fields the app's
 * result card already renders (foodName, estimatedCarbs = one serving, confidence, tips, fat/protein,
 * absorption) plus the serving details the servings picker needs.
 *   400 — not an 8–14 digit barcode · 404 — neither registry knows it ({ found: false })
 */
router.post("/barcode", async (req, res) => {
  const raw = (req.body as { code?: unknown } | undefined)?.code;
  const code = typeof raw === "string" ? normalizeBarcode(raw) : null;
  if (!code) {
    res.status(400).json({ error: "code must be an 8–14 digit barcode" });
    return;
  }
  const product = await lookupBarcode(code, {
    fetch: (url, init) => fetch(url, init),
    usdaApiKey: process.env.USDA_FDC_API_KEY,
    userAgent: "GlucoseGuardian/1.0 (api-server; barcode lookup)",
  });
  if (!product) {
    res.status(404).json({ found: false, barcode: code });
    return;
  }
  const absorption = absorptionFor(product.perServing);
  res.json({
    found: true,
    ...product,
    estimatedCarbs: product.perServing.carbs,
    confidence: "high",
    tips: `Label values for one serving${product.servingText ? ` (${product.servingText})` : ""}. Enter how many servings you're having.`,
    ...(product.perServing.fat != null ? { fatGrams: product.perServing.fat } : {}),
    ...(product.perServing.protein != null ? { proteinGrams: product.perServing.protein } : {}),
    ...(absorption ? { absorption } : {}),
  });
});

router.post("/analyze-photo", async (req, res) => {
  try {
    const { photoBase64: rawBase64, mimeType: rawMime = "image/jpeg", carbRatio = 15 } = req.body;
    if (!rawBase64) {
      res.status(400).json({ error: "photoBase64 is required" });
      return;
    }

    // Sanitize base64: remove whitespace/newlines that can break the data URL
    const photoBase64 = (rawBase64 as string).replace(/\s/g, "");
    // Normalize MIME type — proxy does not accept HEIC/HEIF
    const mimeType = (rawMime as string).toLowerCase().includes("heic") || (rawMime as string).toLowerCase().includes("heif")
      ? "image/jpeg"
      : rawMime;

    console.log(`Photo analysis: mimeType=${mimeType}, base64Length=${photoBase64.length}, prefix=${photoBase64.substring(0, 16)}`);

    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      fetch: globalThis.fetch,
    });

    const prompt = `You are a diabetes nutrition expert helping a child manage their blood sugar. Analyze this food photo and provide nutrition estimates that will inform an insulin dose.

Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):
{
  "foodName": "name of the food(s) identified",
  "estimatedCarbs": <integer grams of carbohydrates>,
  "fatGrams": <integer grams of fat>,
  "proteinGrams": <integer grams of protein>,
  "absorption": "fast" | "medium" | "slow",
  "confidence": "high" | "medium" | "low",
  "portion": "description of estimated portion size",
  "tips": "1-2 sentence diabetes management tip for this food"
}

Be specific about what you see. If multiple foods, combine the totals and describe all items in foodName.
If you cannot tell what food is in the photo, respond exactly {"known": false} instead. Never guess a number for something you can't identify.
In "foodName", "portion" and "tips", never use dashes between words or clauses ("—", "–" or " - "); use a period or a comma instead.
"absorption" is how fast the carbs will hit the bloodstream: "fast" for liquids/simple sugars (juice, soda, candy), "slow" for high-fat/high-protein meals that delay the rise (pizza, cheesy or fried foods), "medium" otherwise.
Estimate carbs as ACCURATELY as you can — this number sizes an insulin dose, so overestimating is as dangerous as underestimating (it can cause low blood sugar). Reflect uncertainty in "confidence", not by padding the number.`;

    const response = await openai.chat.completions.create({
      model: "openai/gpt-5.2",
      max_completion_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${photoBase64}` },
            },
          ],
        },
      ],
    });

    // One parser for photo and text replies. Null = the model declined or gave no usable carb
    // number — answered honestly as "couldn't estimate" (the app opens manual entry; the old code
    // here invented 20g, and `|| 20` even turned a REAL zero-carb answer into 20g).
    const est = parseModelEstimate(response.choices[0]?.message?.content ?? "", "Unknown food");
    if (!est) {
      res.json({ found: false });
      return;
    }
    const insulinUnits = Math.round((est.estimatedCarbs / carbRatio) * 10) / 10;

    res.json({
      foodName: est.foodName,
      estimatedCarbs: est.estimatedCarbs,
      confidence: est.confidence,
      portion: est.portion ?? "Estimated serving",
      tips: est.tips ?? "Monitor glucose levels 2 hours after eating.",
      insulinUnits,
      ...(est.fatGrams != null ? { fatGrams: est.fatGrams } : {}),
      ...(est.proteinGrams != null ? { proteinGrams: est.proteinGrams } : {}),
      ...(est.absorption ? { absorption: est.absorption } : {}),
    });
  } catch (err) {
    console.error("Food photo analysis error:", err);
    res.status(500).json({ error: "Failed to analyze food photo. Please try again." });
  }
});

export default router;
