import { Router, type IRouter } from "express";
import { EstimateFoodCarbsBody, EstimateFoodCarbsResponse } from "@workspace/api-zod";
import OpenAI from "openai";

const router: IRouter = Router();

const carbDatabase: Record<
  string,
  { carbs: number; confidence: "high" | "medium" | "low"; tips?: string }
> = {
  pizza: { carbs: 34, confidence: "high", tips: "One regular slice. Opt for thin crust to lower carbs." },
  apple: { carbs: 25, confidence: "high", tips: "Medium apple. Remove skin for slightly fewer carbs." },
  banana: { carbs: 27, confidence: "high", tips: "Medium banana. Riper bananas have higher glycemic index." },
  sandwich: { carbs: 30, confidence: "medium", tips: "Average deli sandwich on white bread." },
  spaghetti: { carbs: 45, confidence: "high", tips: "One cup cooked. Al dente has a lower glycemic index." },
  rice: { carbs: 45, confidence: "high", tips: "One cup cooked white rice. Brown rice has more fiber." },
  bread: { carbs: 15, confidence: "high", tips: "One slice white bread. Whole grain is a better choice." },
  orange: { carbs: 15, confidence: "high", tips: "Medium orange. High in vitamin C with moderate carbs." },
  milk: { carbs: 12, confidence: "high", tips: "One cup (8oz). Skim milk has slightly fewer carbs." },
  yogurt: { carbs: 17, confidence: "medium", tips: "6oz plain yogurt. Greek yogurt has fewer carbs." },
  cereal: { carbs: 30, confidence: "medium", tips: "One cup. Choose low-sugar options." },
  juice: { carbs: 26, confidence: "medium", tips: "8oz orange juice. Whole fruit is better than juice." },
  burger: { carbs: 40, confidence: "medium", tips: "Standard hamburger with bun. Lettuce wrap reduces carbs significantly." },
  hotdog: { carbs: 22, confidence: "medium", tips: "Hot dog in bun. Most carbs are in the bun." },
  cookie: { carbs: 20, confidence: "medium", tips: "Medium chocolate chip cookie." },
  cake: { carbs: 35, confidence: "medium", tips: "Small slice. Frosting adds significant carbs." },
  chips: { carbs: 15, confidence: "high", tips: "About 15 chips (1oz serving). Easy to overeat." },
  pasta: { carbs: 45, confidence: "high", tips: "One cup cooked pasta. Whole wheat is a better choice." },
  potato: { carbs: 37, confidence: "high", tips: "Medium baked potato. Toppings add more carbs." },
  corn: { carbs: 19, confidence: "high", tips: "One ear of corn. A moderate-carb vegetable." },
  peas: { carbs: 12, confidence: "high", tips: "Half cup cooked peas." },
  strawberries: { carbs: 12, confidence: "high", tips: "One cup fresh strawberries. Great low-carb fruit." },
  grapes: { carbs: 28, confidence: "high", tips: "One cup grapes. High glycemic — eat in small portions." },
  oatmeal: { carbs: 27, confidence: "high", tips: "Half cup dry oats. Steel-cut oats have a lower glycemic index." },
  pancakes: { carbs: 56, confidence: "medium", tips: "Two medium pancakes with syrup. Very high carb — plan accordingly." },
  waffle: { carbs: 45, confidence: "medium", tips: "One regular waffle without toppings." },
  muffin: { carbs: 55, confidence: "medium", tips: "Large store-bought muffin. Often higher than expected." },
  donut: { carbs: 30, confidence: "medium", tips: "One glazed donut." },
};

router.post("/estimate", (req, res) => {
  const body = EstimateFoodCarbsBody.parse(req.body);
  const { foodName } = body;
  const normalized = foodName.toLowerCase().trim();
  const match = carbDatabase[normalized];
  const estimatedCarbs = match?.carbs ?? 20;
  const confidence: "high" | "medium" | "low" = match ? match.confidence : "low";
  const tips = match?.tips ?? "Estimate based on typical serving. Weigh food for accuracy.";
  const response = EstimateFoodCarbsResponse.parse({ foodName, estimatedCarbs, confidence, tips });
  res.json(response);
});

router.post("/analyze-photo", async (req, res) => {
  try {
    const { photoBase64, mimeType = "image/jpeg", carbRatio = 15 } = req.body;
    if (!photoBase64) {
      res.status(400).json({ error: "photoBase64 is required" });
      return;
    }

    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
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
              image_url: { url: `data:${mimeType};base64,${photoBase64}`, detail: "high" },
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
