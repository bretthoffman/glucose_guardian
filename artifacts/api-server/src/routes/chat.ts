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
    parentName?: string;
    accountRole?: "parent" | "adult";
    speakingToParent?: boolean;
    isChildMode?: boolean;
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

  const speakingToParent =
    ctx.speakingToParent === true ||
    (ctx.accountRole === "parent" && ctx.isChildMode !== true);
  const parentName = ctx.parentName?.trim() || null;
  const addressee = speakingToParent
    ? parentName ?? "there"
    : name;

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
    const who = speakingToParent ? `${name}'s glucose` : "Glucose";
    const whoLower = speakingToParent ? `${name}'s glucose` : "glucose";

    if (g < 55) {
      glucoseStatus = `CRITICAL LOW: ${who} is ${g} mg/dL ${arrow} — dangerously low, needs fast-acting carbs immediately.`;
    } else if (g < low) {
      glucoseStatus = `LOW: ${who} is ${g} mg/dL ${arrow} — below target range of ${low}–${high} mg/dL. Needs treatment soon.`;
    } else if (g > 300) {
      glucoseStatus = `CRITICAL HIGH: ${who} is ${g} mg/dL ${arrow} — very high. May need correction + extra monitoring.`;
    } else if (g > high) {
      glucoseStatus = `HIGH: ${who} is ${g} mg/dL ${arrow} — above target range of ${low}–${high} mg/dL.`;
    } else {
      const isFalling = trend.includes("falling");
      if (isFalling) {
        glucoseStatus = `TRENDING DOWN: ${who} is ${g} mg/dL ${arrow} — currently in range but falling toward the low threshold of ${low} mg/dL. Watch closely.`;
      } else {
        glucoseStatus = `IN RANGE: ${who} is ${g} mg/dL ${arrow} — within target range of ${low}–${high} mg/dL.${speakingToParent ? "" : " Great job!"}`;
      }
    }

    if (speakingToParent) {
      if (trend.includes("rapidly rising") || trend.includes("rising fast")) {
        trendGuidance = `${name}'s glucose is rising quickly. If ${name} is about to eat, consider a pre-bolus 10–15 min before the meal. Monitor closely over the next 30 minutes.`;
      } else if (trend.includes("rising")) {
        trendGuidance = `${name}'s glucose is trending up. A small correction with the next meal dose may help. Light activity after eating can also help bring it back into range.`;
      } else if (trend.includes("rapidly falling") || trend.includes("falling fast")) {
        trendGuidance = `${name}'s glucose is dropping quickly — give 15g fast-acting carbs (juice or glucose tabs) now before doing anything else. Do not give insulin right now.`;
      } else if (trend.includes("falling")) {
        trendGuidance = `${name}'s ${whoLower} is trending down. Give a small snack before any meal dose. Skip or reduce any correction if ${name}'s glucose is near the low end.`;
      } else {
        trendGuidance = `${name}'s glucose is stable — normal routine is fine.`;
      }
    } else {
      if (trend.includes("rapidly rising") || trend.includes("rising fast")) {
        trendGuidance = `${whoLower} is rising quickly. If eating, consider taking insulin 10–15 minutes before the meal (pre-bolus). Avoid adding high-carb extras. Monitor closely over the next 30 minutes.`;
      } else if (trend.includes("rising")) {
        trendGuidance = `${whoLower} is trending up. If eating, consider a slight correction with the meal dose. Light activity after eating can help bring it back into range.`;
      } else if (trend.includes("rapidly falling") || trend.includes("falling fast")) {
        trendGuidance = `${whoLower} is dropping quickly — treat the low first with 15g fast-acting carbs (juice or glucose tabs) before doing anything else. Do not take insulin right now.`;
      } else if (trend.includes("falling")) {
        trendGuidance = `${whoLower} is trending down. Eat a small snack before any meal dose. Reduce or skip the correction component if glucose is near the low end.`;
      } else {
        trendGuidance = `${whoLower} is stable. Normal routine is fine — follow the standard meal dose calculation.`;
      }
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
    if (speakingToParent) {
      dosingInstructions = `
INSULIN DOSING (for ${name} — you are advising the parent/caregiver):
When asked about a meal or correction for ${name}:
1. Carb dose = grams of carbs ÷ ${ctx.carbRatio} (1 unit per ${ctx.carbRatio}g carbs)
2. Correction dose = (${name}'s current glucose − ${ctx.targetGlucose}) ÷ ${ctx.correctionFactor}
   - Only add correction if ${name}'s glucose is above target AND trending stable or up
   - If ${name}'s glucose is falling or low, skip or reduce the correction entirely
3. Total = carb dose + correction dose (do not round until the very end; round to nearest 0.5 unit)
4. Timing: if ${name}'s glucose is rising, suggest injecting 10–15 min before eating; if stable or falling, inject just before or with the meal.
${weightStr ? `5. Note: ${name} weighs ${weightStr}, factored into their carb ratio and correction factor.` : ""}
Always address YOUR RESPONSE to the parent (${parentName ?? "the caregiver"}) — e.g. "You'll want to give ${name} about X units." Never address ${name} directly.
Recommend confirming significant dose changes with the care team.`;
    } else if (isChild) {
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

  const languageStyle = speakingToParent
    ? `LANGUAGE STYLE — PARENT/CAREGIVER MODE:
- You are speaking with ${parentName ? `${parentName}` : "the parent or caregiver"}, NOT the child.
- Refer to the child by name (${name}) in the third person.
- KEEP IT SHORT: 2–3 plain sentences maximum. One clear action, one brief reason.
- No markdown. No bold text. No bullet points. No numbered lists. No formulas. Just plain sentences.
- Do NOT show dose math — just give the final number. Say "give 1.5 units" not "(293−125)÷125=1.34 → 1.5u".
- Lead with the single most important thing to do right now, then a brief reason.
- Warm but direct. Speak like a knowledgeable friend, not a medical textbook.
- Example: "Bella's glucose is high at 293. Give her 1.5 units now and offer some water. Check back in 90 minutes."`
    : isChild
    ? `LANGUAGE STYLE — CHILD (${ageStr}):
- Friendly, short, encouraging — like a cool older sibling who gets diabetes.
- 2–3 short sentences. No jargon. No formulas. Just plain words.
- No markdown, no bullet points, no bold.
- Use ${name}'s name naturally. Be upbeat and reassuring — never scary.
- Example: "Your sugar is a little high right now. Take 1.5 units and drink some water. You've totally got this!"`
    : isAdult
    ? `LANGUAGE STYLE — ADULT (${ageStr}):
- Clear, warm, direct. 2–3 sentences max for most answers.
- No markdown. No bullet lists. No formulas shown — just the final number.
- Lead with what to do, then a brief reason. Professional but not cold.
- Example: "Your glucose is high at 293. Take 1.5 units now and drink water — it should come back down in 90 minutes."`
    : `LANGUAGE STYLE:
- Warm, supportive, short. 2–3 plain sentences max.
- No markdown, no bullets, no formulas.
- Use ${name}'s name naturally.`;

  const introLine = speakingToParent
    ? `You are a smart, warm diabetes companion called "Glucose Guardian". You are currently speaking with ${parentName ? `${parentName}` : "the parent or caregiver"} — the parent or guardian managing ${name}'s${ageStr ? ` (${ageStr})` : ""} ${diabetesLabel}.`
    : `You are a smart, warm diabetes companion called "Glucose Guardian" — equal parts knowledgeable care team and trusted friend. You talk directly with ${name}${ageStr ? `, who is ${ageStr}` : ""}${diabetesLabel ? ` and has ${diabetesLabel}` : ""}.`;

  return `${introLine}

${languageStyle}

YOUR CORE PERSONALITY:
- Caring, warm, never robotic
- Acknowledge feelings briefly, then give one clear action
- Light humor when the mood allows — read the situation
- Never preachy or repetitive
- REPLY LENGTH: 2–3 sentences for almost everything. Never more than 4. Short is kind — caregivers are busy and worried.
- FORMATTING: Plain sentences only. No markdown. No asterisks. No bold. No bullets. No numbered lists. No formulas with equals signs.

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
- CRITICAL: If glucose is FALLING (any falling trend, even if currently in range), your opening or response MUST acknowledge the downward trend as a concern FIRST — NEVER say "looking solid", "great job", "you're doing great", or any positive spin when glucose is actively dropping. A falling trend is a warning, not a win, even at 92 mg/dL
- For falling glucose: never suggest insulin — recommend eating 15g fast-acting carbs and monitoring
- Say the "consult your care team" reminder at most once per conversation — not after every message
- When giving a dose, state ONLY the final rounded number (e.g., "give 1.5 units"). Never show the formula — the app already displays the full calculation.
- NEVER say "As an AI language model..." or "I should note that I'm an AI" — just be Glucose Guardian`;
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
      max_completion_tokens: 180,
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
