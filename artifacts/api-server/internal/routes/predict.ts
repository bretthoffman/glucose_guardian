import { Router, type IRouter } from "express";
import OpenAI from "openai";

const router: IRouter = Router();

const HORIZON_MIN = 90;
const STEP_MIN = 5;
const N_POINTS = HORIZON_MIN / STEP_MIN; // 18
const BG_FLOOR = 40;
const BG_CEIL = 400;

interface RefPattern {
  confidence: number;
  startBG: number | null;
  units: number;
  carbs: number;
  trendBucket: string;
  pre: { minutesBefore: number; glucose: number }[];
  post: { minutesAfter: number; glucose: number }[];
}

interface PredictRequestBody {
  currentBG: number;
  /** Last ~3h of readings, oldest → newest, as {glucose, minutesAgo}. */
  recentReadings: { glucose: number; minutesAgo: number }[];
  doseUnits: number;
  carbsGrams: number;
  insulinActionHours?: number;
  carbRatio?: number;
  correctionFactor?: number;
  currentTrend?: string;
  references?: RefPattern[];
}

const TREND_WORDS: Record<string, string> = {
  rising_fast: "rising quickly",
  rising_slow: "rising slowly",
  steady: "steady",
  falling_slow: "falling slowly",
  falling_fast: "falling quickly",
};

function buildPredictPrompt(b: PredictRequestBody): { system: string; user: string } {
  const system = `You are a glucose-prediction engine for ONE person with type 1 diabetes. Predict their interstitial glucose for the next ${HORIZON_MIN} minutes at ${STEP_MIN}-minute intervals — EXACTLY ${N_POINTS} integer values in mg/dL.

How to predict:
- Start from the current reading and continue its recent momentum, then bend it with the pending dose and carbs.
- The pending INSULIN dose lowers glucose gradually over its action window (peak around 60–90 min).
- The pending CARBS raise glucose as they absorb (fastest in the first 30–60 min).
- HISTORICAL REFERENCE PATTERNS are real past episodes from THIS SAME person with a similar dose, carb amount, starting glucose, and pre-trend. Use them as strong analogies for the SHAPE and MAGNITUDE of the response — but the current readings and pending dose/carbs take priority when they disagree.
- Keep the curve continuous from the current value and physiologically plausible. Clamp every value to ${BG_FLOOR}–${BG_CEIL}.

Output ONLY compact JSON, no prose, no code fences:
{"predictions":[v1,...,v${N_POINTS}]} where v1 is +${STEP_MIN} min and v${N_POINTS} is +${HORIZON_MIN} min.`;

  const recent = b.recentReadings?.length
    ? b.recentReadings
        .slice()
        .sort((a, r) => r.minutesAgo - a.minutesAgo)
        .map((r) => `${r.glucose}@-${r.minutesAgo}m`)
        .join(", ")
    : "none";

  const settings = [
    b.correctionFactor ? `insulin sensitivity ~${b.correctionFactor} mg/dL per unit` : "",
    b.carbRatio ? `carb ratio 1u per ${b.carbRatio}g` : "",
    b.insulinActionHours ? `insulin acts over ~${b.insulinActionHours}h` : "",
  ]
    .filter(Boolean)
    .join("; ");

  const refBlocks = (b.references ?? [])
    .map((r, i) => {
      const pre = r.pre.map((p) => `${p.glucose}@-${p.minutesBefore}m`).join(", ");
      const post = r.post.map((p) => `${p.glucose}@+${p.minutesAfter}m`).join(", ");
      return `Reference ${i + 1} (confidence ${r.confidence.toFixed(2)}): started at ${r.startBG ?? "?"} mg/dL, ${TREND_WORDS[r.trendBucket] ?? r.trendBucket}, took ${r.units}u with ${r.carbs}g carbs.
  lead-in: ${pre || "n/a"}
  what actually happened: ${post || "n/a"}`;
    })
    .join("\n\n");

  const refsSection = refBlocks
    ? `\n\nHISTORICAL REFERENCE PATTERNS (this person's own past episodes — use freely as analogies):\n${refBlocks}`
    : `\n\nHISTORICAL REFERENCE PATTERNS: none close enough — rely on the recent trajectory + dose/carb physiology.`;

  const user = `CURRENT SITUATION:
- Current glucose: ${b.currentBG} mg/dL (${TREND_WORDS[b.currentTrend ?? "steady"] ?? "steady"})
- Recent readings (glucose@minutesAgo): ${recent}
- Pending dose being taken NOW: ${b.doseUnits} units
- Carbs being eaten NOW: ${b.carbsGrams} g
${settings ? `- Settings: ${settings}` : ""}${refsSection}`;

  return { system, user };
}

/** Coerce arbitrary model output into exactly N_POINTS clamped integers, or null if unusable. */
function normalizePredictions(raw: unknown): number[] | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      const m = raw.match(/\[[\s\S]*?\]/);
      if (!m) return null;
      try {
        arr = JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  }
  if (arr && typeof arr === "object" && !Array.isArray(arr) && Array.isArray((arr as any).predictions)) {
    arr = (arr as any).predictions;
  }
  if (!Array.isArray(arr)) return null;
  const nums = arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (nums.length < 2) return null;
  // Resample to exactly N_POINTS (linear) so an over/under-length answer is still usable.
  const out: number[] = [];
  for (let i = 0; i < N_POINTS; i++) {
    const pos = (i / (N_POINTS - 1)) * (nums.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const val = nums[lo] + (nums[hi] - nums[lo]) * (pos - lo);
    out.push(Math.round(Math.max(BG_FLOOR, Math.min(BG_CEIL, val))));
  }
  return out;
}

router.post("/", async (req, res) => {
  try {
    const body = req.body as PredictRequestBody;
    if (typeof body?.currentBG !== "number") {
      return res.status(400).json({ error: "currentBG required" });
    }

    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      fetch: globalThis.fetch,
    });

    const { system, user } = buildPredictPrompt(body);
    const completion = await openai.chat.completions.create({
      model: "openai/gpt-5.2",
      max_completion_tokens: 600,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const predictions = normalizePredictions(content);
    if (!predictions) {
      return res.status(502).json({ error: "Could not parse a prediction." });
    }
    return res.json({ predictions, stepMin: STEP_MIN, horizonMin: HORIZON_MIN });
  } catch (err: any) {
    console.error("Predict error:", err?.message ?? err);
    return res.status(500).json({ error: "Prediction failed." });
  }
});

export default router;
