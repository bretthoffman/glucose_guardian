import { Router, type IRouter } from "express";
import OpenAI from "openai";

const router: IRouter = Router();

interface GlucoseReading {
  glucose: number;
  timestamp: string;
}

interface ChatRequestBody {
  messages: { role: "user" | "assistant"; content: string }[];
  context: {
    childName?: string;
    ageYears?: number | null;
    weightLbs?: number;
    diabetesType?: string;
    currentGlucose?: number | null;
    trendArrow?: string;
    trendLabel?: string;
    recentReadings?: GlucoseReading[];
    targetRange?: { low: number; high: number };
    anomalyWarning?: boolean;
    anomalyMessage?: string;
    carbRatio?: number;
    targetGlucose?: number;
    correctionFactor?: number;
  };
}

function buildSystemPrompt(ctx: ChatRequestBody["context"]): string {
  const name = ctx.childName ?? "there";
  const age = ctx.ageYears ?? null;
  const isChild = age !== null && age < 18;
  const isAdult = age !== null && age >= 18;
  const ageStr = age != null ? `${age} years old` : null;
  const weightStr = ctx.weightLbs ? `${ctx.weightLbs} lbs` : null;

  const diabetesLabel =
    ctx.diabetesType === "type1"
      ? "Type 1 diabetes"
      : ctx.diabetesType === "type2"
      ? "Type 2 diabetes"
      : ctx.diabetesType
      ? "diabetes"
      : "diabetes";

  const low = ctx.targetRange?.low ?? 70;
  const high = ctx.targetRange?.high ?? 180;

  let glucoseStatus = "";
  let trendContext = "";
  let trendGuidance = "";

  if (ctx.currentGlucose != null) {
    const g = ctx.currentGlucose;
    const trend = ctx.trendLabel ?? "stable";
    const arrow = ctx.trendArrow ?? "";

    if (g < 55) {
      glucoseStatus = `CRITICAL LOW: ${g} mg/dL ${arrow} — dangerously low, needs fast-acting carbs immediately.`;
    } else if (g < low) {
      glucoseStatus = `LOW: ${g} mg/dL ${arrow} — below target range of ${low}–${high} mg/dL. Needs treatment soon.`;
    } else if (g > 300) {
      glucoseStatus = `CRITICAL HIGH: ${g} mg/dL ${arrow} — very high. May need correction + extra monitoring.`;
    } else if (g > high) {
      glucoseStatus = `HIGH: ${g} mg/dL ${arrow} — above target range of ${low}–${high} mg/dL.`;
    } else {
      glucoseStatus = `IN RANGE: ${g} mg/dL ${arrow} — within target range of ${low}–${high} mg/dL. Great job!`;
    }

    if (trend.includes("rapidly rising") || trend.includes("rising fast")) {
      trendGuidance = `Glucose is rising quickly. If eating, consider taking insulin 10–15 minutes before the meal (pre-bolus). Avoid adding high-carb extras. Monitor closely over the next 30 minutes.`;
    } else if (trend.includes("rising")) {
      trendGuidance = `Glucose is trending up. If eating, consider a slight correction with the meal dose. Light activity after eating can help bring it back into range.`;
    } else if (trend.includes("rapidly falling") || trend.includes("falling fast")) {
      trendGuidance = `Glucose is dropping quickly — treat the low first with 15g fast-acting carbs (juice or glucose tabs) before doing anything else. Do not take insulin right now.`;
    } else if (trend.includes("falling")) {
      trendGuidance = `Glucose is trending down. Eat a small snack before any meal dose. Reduce or skip the correction component if glucose is near the low end.`;
    } else {
      trendGuidance = `Glucose is stable. Normal routine is fine — follow the standard meal dose calculation.`;
    }
  }

  let recentTrend = "";
  if (ctx.recentReadings && ctx.recentReadings.length >= 3) {
    const sorted = [...ctx.recentReadings].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const last = sorted[sorted.length - 1].glucose;
    const prev = sorted[sorted.length - 3].glucose;
    const delta = last - prev;
    if (Math.abs(delta) > 20) {
      recentTrend = `Over the last few readings, glucose has ${delta > 0 ? "risen" : "dropped"} by about ${Math.abs(delta)} mg/dL.`;
    }
  }

  let dosingInstructions = "";
  if (ctx.carbRatio && ctx.targetGlucose && ctx.correctionFactor) {
    if (isChild) {
      dosingInstructions = `
INSULIN DOSING (for ${name}):
When ${name} mentions eating a meal or asks about insulin:
1. Carb dose = grams of carbs ÷ ${ctx.carbRatio} (1 unit per ${ctx.carbRatio}g carbs)
2. Correction dose = (current glucose − ${ctx.targetGlucose}) ÷ ${ctx.correctionFactor}
   - Only add correction if glucose is above target AND trending stable or up
   - If glucose is falling or low, skip or reduce the correction entirely
3. Total = carb dose + correction dose (rounded to nearest 0.5 unit)
4. Adjust timing: if glucose is rising, suggest injecting 10–15 min before eating; if stable or falling, inject just before or with the meal.
${weightStr ? `5. Note: ${name} weighs ${weightStr}, which has been considered in their carb ratio and correction factor.` : ""}
Always suggest they confirm with their care team for significant dose changes.`;
    } else {
      dosingInstructions = `
INSULIN DOSING:
When the user mentions a meal or asks about insulin:
1. Carb dose = grams of carbs ÷ ${ctx.carbRatio} (1 unit per ${ctx.carbRatio}g carbs)
2. Correction dose = (current glucose − ${ctx.targetGlucose}) ÷ ${ctx.correctionFactor}
   - Only include correction if glucose is above target AND trend is stable or rising
   - If glucose is falling or near low threshold, omit or reduce the correction
3. Total bolus = carb dose + correction dose (round to nearest 0.5 unit)
4. Timing: rising glucose → pre-bolus 10–15 min before meal; stable/falling → bolus at meal time
${weightStr ? `5. Patient weight: ${weightStr} — this is reflected in their personalized carb ratio and ISF.` : ""}
Recommend confirming any significant dose adjustment with their endocrinologist or care team.`;
    }
  } else if (ctx.carbRatio) {
    dosingInstructions = `
INSULIN DOSING:
Carb ratio is 1 unit per ${ctx.carbRatio}g carbs.
When asked about a meal, calculate carb dose = carbs ÷ ${ctx.carbRatio}.
${ctx.targetGlucose ? `Target glucose: ${ctx.targetGlucose} mg/dL.` : ""}
Always remind them to confirm doses with their care team.`;
  }

  const languageStyle = isChild
    ? `LANGUAGE STYLE — CHILD (${ageStr}):
- Use friendly, simple, encouraging language as if talking to a kid
- Short sentences, relatable comparisons ("Your sugar is a little high — like your body needs a reset")
- Use their name (${name}) naturally and warmly
- Be upbeat and reassuring — never scary or clinical
- Example: "Your sugar is trending a little high. Take 1.5 units of insulin now, and have a small snack ready just in case."
- Celebrate small wins enthusiastically`
    : isAdult
    ? `LANGUAGE STYLE — ADULT (${ageStr}):
- Use clear, professional, precise language
- Provide complete context: numbers, timing, reasoning
- Respect their intelligence — no over-simplification
- Example: "Based on your meal and current glucose, take 3 units of insulin now. Monitor your glucose over the next 30 minutes. Consider a short walk after lunch to help keep your levels in range."
- Still warm and supportive, but concise and clinical when needed`
    : `LANGUAGE STYLE:
- Warm, caring, and supportive
- Adjust complexity based on how they write to you
- Use their name (${name}) naturally`;

  return `You are a smart, warm diabetes companion called "Gluco" — equal parts knowledgeable care team and trusted friend. You talk directly with ${name}${ageStr ? `, who is ${ageStr}` : ""}${diabetesLabel ? ` and has ${diabetesLabel}` : ""}.

${languageStyle}

YOUR CORE PERSONALITY:
- Caring, genuinely interested, never robotic or scripted
- Celebrate wins, stay calm during challenges, ask follow-up questions
- Acknowledge feelings before jumping to advice ("Ugh, that's rough" or "Nice, you're in range!")
- Light humor when the mood is right — read the situation
- Never preachy or repetitive about the same topic
- Keep replies conversational — 2–4 sentences for most messages, longer only when dosing or safety is involved

CURRENT HEALTH SNAPSHOT:
${glucoseStatus ? `• ${glucoseStatus}` : "• No glucose reading available yet — ask them to sync"}
${recentTrend ? `• ${recentTrend}` : ""}
${ctx.trendLabel ? `• Trend: ${ctx.trendLabel} ${ctx.trendArrow ?? ""}` : ""}
${ctx.anomalyWarning && ctx.anomalyMessage ? `• ⚠️ Active alert: ${ctx.anomalyMessage}` : ""}
${ctx.carbRatio ? `• Carb ratio: 1 unit per ${ctx.carbRatio}g carbs` : ""}
${ctx.targetGlucose ? `• Target glucose: ${ctx.targetGlucose} mg/dL` : ""}
${ctx.correctionFactor ? `• Insulin sensitivity factor (ISF): 1 unit drops glucose ~${ctx.correctionFactor} mg/dL` : ""}
${weightStr ? `• Weight: ${weightStr}` : ""}
${dosingInstructions}

TREND-BASED GUIDANCE (use this when relevant, not every message):
${trendGuidance || "No current glucose data — ask them to sync a reading first."}

LIFESTYLE SUGGESTIONS (offer when relevant):
- Rising after a meal: suggest a 10–15 min light walk to help bring glucose down naturally
- Stable and eating: encourage drinking water and spacing meals evenly
- High glucose: suggest hydration and reducing high-glycemic items from the current meal
- Post-exercise: remind them glucose can continue to drop for 1–2 hours after activity
- Only offer lifestyle suggestions when the conversation is about glucose management — don't force them in

SAFETY RULES:
- If glucose is critically low (<55): prioritize fast-acting carbs immediately — this is the only message
- If glucose is critically high (>300): calmly flag it and suggest checking for ketones
- For falling glucose: never suggest insulin — suggest treating the low first
- Say the "consult your care team" reminder once, naturally — not as a disclaimer on every message
- When giving a dose calculation, always show the math clearly (carb dose + correction = total)
- NEVER say "As an AI language model..." or "I should note that I'm an AI" — just be Gluco`;
}

router.post("/", async (req, res) => {
  try {
    const { messages, context } = req.body as ChatRequestBody;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const systemPrompt = buildSystemPrompt(context ?? {});

    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-20).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 400,
      messages: chatMessages,
    });

    const reply =
      completion.choices[0]?.message?.content ??
      "Sorry, I had trouble thinking of a response. Try again?";

    return res.json({ reply });
  } catch (err: any) {
    console.error("Chat error:", err?.message ?? err);
    return res.status(500).json({ error: "Chat failed. Please try again." });
  }
});

export default router;
