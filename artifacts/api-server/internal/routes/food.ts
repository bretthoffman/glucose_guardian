import { Router, type IRouter } from "express";
import { EstimateFoodCarbsBody, EstimateFoodCarbsResponse } from "@workspace/api-zod";
import OpenAI from "openai";

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

function findFood(normalized: string) {
  // 1. Exact match
  if (carbDatabase[normalized]) return carbDatabase[normalized];
  // 2. Database key is a substring of the query (longer key = more specific match)
  let best: (typeof carbDatabase)[string] | null = null;
  let bestLen = 0;
  for (const [key, val] of Object.entries(carbDatabase)) {
    if (normalized.includes(key) && key.length > bestLen) {
      best = val;
      bestLen = key.length;
    }
  }
  if (best) return best;
  // 3. Query is a substring of a database key
  for (const [key, val] of Object.entries(carbDatabase)) {
    if (key.includes(normalized) && normalized.length > 3) return val;
  }
  return null;
}

router.post("/estimate", (req, res) => {
  const body = EstimateFoodCarbsBody.parse(req.body);
  const { foodName } = body;
  const normalized = foodName.toLowerCase().trim();
  const match = findFood(normalized);
  const estimatedCarbs = match?.carbs ?? 30;
  const confidence: "high" | "medium" | "low" = match ? match.confidence : "low";
  const tips = match?.tips ?? "Estimate based on typical serving. Weigh food for best accuracy.";
  const response = EstimateFoodCarbsResponse.parse({ foodName, estimatedCarbs, confidence, tips });
  res.json(response);
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

    const prompt = `You are a diabetes nutrition expert helping a child manage their blood sugar. Analyze this food photo and provide carbohydrate estimates.

Respond ONLY with a valid JSON object in this exact format (no markdown, no extra text):
{
  "foodName": "name of the food(s) identified",
  "estimatedCarbs": <integer grams of carbohydrates>,
  "confidence": "high" | "medium" | "low",
  "portion": "description of estimated portion size",
  "tips": "1-2 sentence diabetes management tip for this food"
}

Be specific about what you see. If multiple foods, combine the total carbs and describe all items in foodName. Estimate generously for safety in diabetes management.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
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

    const rawContent = response.choices[0]?.message?.content ?? "{}";
    const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const estimatedCarbs = Number(parsed.estimatedCarbs) || 20;
    const insulinUnits = Math.round((estimatedCarbs / carbRatio) * 10) / 10;

    res.json({
      foodName: parsed.foodName || "Unknown food",
      estimatedCarbs,
      confidence: parsed.confidence || "medium",
      portion: parsed.portion || "Estimated serving",
      tips: parsed.tips || "Monitor glucose levels 2 hours after eating.",
      insulinUnits,
    });
  } catch (err) {
    console.error("Food photo analysis error:", err);
    res.status(500).json({ error: "Failed to analyze food photo. Please try again." });
  }
});

export default router;
