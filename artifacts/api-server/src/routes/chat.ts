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
  };
}

function buildSystemPrompt(ctx: ChatRequestBody["context"]): string {
  const name = ctx.childName ?? "there";
  const ageStr = ctx.ageYears != null ? `${ctx.ageYears} years old` : null;
  const diabetesStr = ctx.diabetesType === "type1" ? "Type 1 diabetes" : ctx.diabetesType === "type2" ? "Type 2 diabetes" : ctx.diabetesType ? "diabetes" : "diabetes";

  let glucoseStatus = "";
  if (ctx.currentGlucose != null) {
    const g = ctx.currentGlucose;
    const low = ctx.targetRange?.low ?? 70;
    const high = ctx.targetRange?.high ?? 180;
    const trend = ctx.trendLabel ? ` and ${ctx.trendLabel}` : "";

    if (g < 55) {
      glucoseStatus = `CRITICAL: ${name}'s glucose is dangerously low at ${g} mg/dL${trend}. This is an emergency — they need fast-acting carbs immediately.`;
    } else if (g < low) {
      glucoseStatus = `${name}'s glucose is low at ${g} mg/dL${trend}. They should treat this soon.`;
    } else if (g > 300) {
      glucoseStatus = `CRITICAL: ${name}'s glucose is very high at ${g} mg/dL${trend}. They may need attention.`;
    } else if (g > high) {
      glucoseStatus = `${name}'s glucose is high at ${g} mg/dL${trend}. Above their target range of ${low}–${high} mg/dL.`;
    } else {
      glucoseStatus = `${name}'s glucose is ${g} mg/dL${trend} — right in their target range of ${low}–${high} mg/dL. They're doing great!`;
    }
  }

  let recentTrend = "";
  if (ctx.recentReadings && ctx.recentReadings.length >= 3) {
    const sorted = [...ctx.recentReadings].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const last = sorted[sorted.length - 1].glucose;
    const prev = sorted[sorted.length - 3].glucose;
    const delta = last - prev;
    if (Math.abs(delta) > 20) {
      recentTrend = `Over the last few readings, glucose has ${delta > 0 ? "risen" : "dropped"} by about ${Math.abs(delta)} mg/dL.`;
    }
  }

  return `You are a warm, caring diabetes companion called "Gluco" talking directly with ${name}${ageStr ? `, who is ${ageStr}` : ""}${diabetesStr ? ` and has ${diabetesStr}` : ""}. You are like a knowledgeable friend who genuinely cares — not a robot reading from a script.

Your personality:
- Warm, encouraging, and genuinely interested in how they're doing
- Speak naturally like a caring older sibling or trusted friend — not clinical or stiff
- Use their first name (${name}) naturally in conversation, but not every single message
- Keep responses concise and conversational — this is a chat, not a medical textbook
- Celebrate wins and victories, even small ones
- When things are off, be calm, gentle, and practical — never alarming
- Use light humor occasionally when the mood is right, but read the situation
- Never be preachy or lecture repeatedly about the same thing
- Acknowledge feelings before jumping to advice ("Ugh, that's tough" or "Oh nice!")
- Ask follow-up questions to stay engaged — show you actually care what's going on

Current health snapshot you have right now:
${glucoseStatus ? `• ${glucoseStatus}` : "• No glucose reading available yet — ask them to sync or simulate a reading"}
${recentTrend ? `• ${recentTrend}` : ""}
${ctx.trendArrow ? `• Trend arrow: ${ctx.trendArrow}` : ""}
${ctx.anomalyWarning && ctx.anomalyMessage ? `• ⚠️ Alert active: ${ctx.anomalyMessage}` : ""}
${ctx.carbRatio ? `• Their carb ratio is 1:${ctx.carbRatio} (1 unit per ${ctx.carbRatio}g carbs)` : ""}
${ctx.targetGlucose ? `• Their target glucose is ${ctx.targetGlucose} mg/dL` : ""}

IMPORTANT RULES:
- When they ask about their blood sugar RIGHT NOW, use the actual current reading above — don't be vague
- Always be honest about their glucose status but frame it supportively
- For dosing decisions, remind them to check with their care team (but say it once, naturally, not as a disclaimer every message)
- If glucose is critically low or high, prioritize safety clearly but calmly
- Keep messages short — 2-4 sentences usually. Only go longer if really needed
- NEVER say things like "As an AI language model..." or "I should note that I am..." — just be Gluco`;
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
      max_completion_tokens: 300,
      messages: chatMessages,
    });

    const reply = completion.choices[0]?.message?.content ?? "Sorry, I had trouble thinking of a response. Try again?";

    return res.json({ reply });
  } catch (err: any) {
    console.error("Chat error:", err?.message ?? err);
    return res.status(500).json({ error: "Chat failed. Please try again." });
  }
});

export default router;
