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
    /** WHO is typing: the patient themselves, a guardian, or a caregiver of the patient. */
    speaker?: { kind: "patient" | "guardian" | "caregiver"; name?: string };
    isChildMode?: boolean;
    caregiverSession?: boolean;
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
    /** Insulin doses logged in the app over the last ~36h (newest first). */
    recentInsulinLog?: {
      timestamp: string;
      units: number;
      type?: string;
      insulinType?: string;
      recommendedUnits?: number;
    }[];
    /** Meals logged in the app over the last ~36h (newest first). */
    recentFoodLog?: {
      timestamp: string;
      foodName: string;
      estimatedCarbs: number;
      insulinUnits?: number;
    }[];
    /** Last-24h glucose shape at ~20-min resolution, oldest → newest, device-local time labels. */
    readingsHistory?: {
      glucose: number;
      time: string;
    }[];
    /** The phone's local clock when the message was sent, e.g. "4:27 AM" / "Thursday" / 4. */
    localTime?: string;
    localWeekday?: string;
    localHour?: number;
    /** The app's best guess at who's with the child (utils/careNow on the phone). */
    careNow?: {
      lastLog?: { by: string; byYou: boolean; minutesAgo: number; what: string };
      scheduledNow?: { name: string; until?: string }[];
    };
  };
}

function minutesPhrase(m: number): string {
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

/**
 * Who is probably with the child right now, from who logged last (the strongest sign) and which
 * Care Circle schedules are open (school hours). Guidance differs by who is typing: a guardian gets
 * "I see she's with Holly" / "Is she still with grandma?"; the caregiver doing the care is simply
 * talked to as the person with the child.
 */
export function buildCareNowSection(ctx: ChatRequestBody["context"], name: string, guardianSpeaker: boolean): string {
  const care = ctx.careNow;
  if (!care) return "";
  const last = care.lastLog;
  const scheduled = (care.scheduledNow ?? []).filter((s) => s?.name);
  const lines: string[] = [];
  if (last && !last.byYou) {
    lines.push(`• Last log: ${last.by} logged ${last.what} ${minutesPhrase(last.minutesAgo)}.`);
  } else if (last?.byYou) {
    lines.push(`• Last log: the person you're talking with logged ${last.what} ${minutesPhrase(last.minutesAgo)}.`);
  }
  if (scheduled.length) {
    lines.push(
      `• Care Circle schedule open right now: ${scheduled.map((s) => `${s.name}${s.until ? ` (until ${s.until})` : ""}`).join(", ")}.`,
    );
  }
  if (lines.length === 0) return "";

  let guidance: string;
  if (!guardianSpeaker) {
    guidance = `The person typing is the one with ${name} right now (or is ${name}). Talk to them directly and never ask who ${name} is with. Use the last log only as information (for example, insulin someone else already gave).`;
  } else if (last && !last.byYou && last.minutesAgo <= 60) {
    guidance = `${name} is most likely with ${last.by} right now, since they logged last and recently. When it helps the answer, say it naturally ("I see ${name}'s with ${last.by.split(" (")[0]} right now") and suggest what ${last.by.split(" (")[0]} could do, which they can ask through the Messages button if they haven't already. Don't mention it on small talk.`;
  } else if (last && !last.byYou && last.minutesAgo <= 240) {
    guidance = `${name} may still be with ${last.by}, but that log is getting old. If it matters for the answer, ask once and lightly ("Is ${name} still with ${last.by.split(" (")[0]}?"), and never ask again in the same conversation.`;
  } else if (scheduled.length) {
    guidance = `Nobody else has logged recently, but ${scheduled.map((s) => s.name).join(" or ")} ${scheduled.length === 1 ? "is" : "are"} scheduled right now, so ${name} is probably with them (school hours, for example). Mention it only when it helps, and suggest messaging them through the Messages button.`;
  } else {
    guidance = `Assume ${name} is with the person you're talking with unless they say otherwise.`;
  }
  return `

WHO'S WITH ${name.toUpperCase()} (the app's best guess, never certain; say "I see" or "looks like", never state it as fact):
${lines.join("\n")}
• ${guidance}`;
}

type DayPart = "overnight" | "morning" | "daytime" | "evening";

/**
 * The person's local time of day. Newer apps send it; older apps only send device-local labels on
 * the 24h history (~20-minute resolution), whose newest same-day label is close enough to tell night
 * from day.
 */
export function localTimeOfDay(ctx: ChatRequestBody["context"]): { hour: number; label: string; weekday?: string; exact: boolean } | null {
  if (Number.isFinite(ctx.localHour) && ctx.localHour! >= 0 && ctx.localHour! < 24) {
    return { hour: Math.floor(ctx.localHour!), label: ctx.localTime?.trim() || `${ctx.localHour}:00`, weekday: ctx.localWeekday?.trim() || undefined, exact: true };
  }
  const last = [...(ctx.readingsHistory ?? [])].reverse().find((r) => r?.time && !/^yesterday/i.test(r.time));
  const m = last?.time.match(/(\d{1,2}):(\d{2})\s*([AaPp])?/);
  if (!m) return null;
  let hour = parseInt(m[1]!, 10);
  const ap = m[3]?.toLowerCase();
  if (ap === "p" && hour !== 12) hour += 12;
  if (ap === "a" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return { hour, label: `around ${last!.time}`, exact: false };
}

export function dayPart(hour: number): DayPart {
  if (hour >= 22 || hour < 6) return "overnight";
  if (hour < 9) return "morning";
  if (hour < 17) return "daytime";
  return "evening";
}

function timeOfDaySection(ctx: ChatRequestBody["context"], name: string, speakingToParent: boolean): string {
  const t = localTimeOfDay(ctx);
  if (!t) return "";
  const part = dayPart(t.hour);
  const when = `${t.exact ? "" : "about "}${t.label}${t.weekday ? ` on ${t.weekday}` : ""}`;
  const them = speakingToParent ? name : "they";
  const guidance: Record<DayPart, string> = {
    overnight: speakingToParent
      ? `It's the middle of the night. The person you're talking with was probably woken up, is tired and worried, and ${name} is probably asleep. Keep it calm and short. Give the next check as a clock time ("check again around 4:50"). Once the numbers are safe and steady, tell them plainly it's okay to go back to sleep and what would be worth waking for (dropping under 70 or a down arrow), and to keep their low alert on. Don't suggest waking ${name} to eat unless ${name} needs carbs for a low. Long-acting (basal) insulin keeps working overnight, and many people drift up in the early morning hours (around 3 to 8 AM).`
      : `It's the middle of the night, so they were probably woken up and are tired. Keep it calm and short, give the next check as a clock time, and once things are safe and steady tell them it's okay to go back to sleep with their low alert on.`,
    morning: `It's morning: breakfast, getting ready, maybe school or work. Keep advice quick and practical for a busy start, and think about breakfast carbs and the early-morning rise.`,
    daytime: speakingToParent
      ? `It's daytime${t.weekday && /saturday|sunday/i.test(t.weekday) ? "" : ", so on a school day " + name + " may be at school with the nurse"}. Keep in mind lunch, snacks, and activity like recess or sports.`
      : `It's daytime. Keep in mind lunch, snacks, and activity.`,
    evening: `It's evening: dinner, activity winding down, and bedtime coming. Help ${them} head into the night in a safe, steady range, and mention a bedtime check when it fits.`,
  };
  return `

TIME OF DAY: it's ${when} for them (${part}). Be mindful of it in every answer, and give recheck times as clock times when you can.
• ${guidance[part]}`;
}

/** Compact relative age for log lines, e.g. "35m ago" / "3.5h ago" — timezone-safe. */
function formatLogAge(timestamp: string): string {
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) return "";
  const hours = (Date.now() - t) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return "just now";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  return `${Math.round(hours * 10) / 10}h ago`;
}

/**
 * The live CGM picture the assistant must reason from: the latest reading with its age, the last
 * ~50 minutes of readings (what the app sends as `recentReadings`), and the low point / change in
 * that window. Ages are relative ("12m ago") so the server never guesses the device's time zone.
 */
export function buildLiveCgmSection(ctx: ChatRequestBody["context"], possessive: string): string {
  const readings = (ctx.recentReadings ?? [])
    .filter((r) => Number.isFinite(r?.glucose) && Number.isFinite(new Date(r?.timestamp).getTime()))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (readings.length === 0) return "";
  const latest = readings[readings.length - 1]!;
  const ageMin = Math.round((Date.now() - new Date(latest.timestamp).getTime()) / 60_000);
  const stale = ageMin > 15;
  const list = readings.map((r) => `${Math.round(r.glucose)} (${formatLogAge(r.timestamp)})`).join(" → ");
  const lowest = readings.reduce((m, r) => (r.glucose < m.glucose ? r : m), readings[0]!);
  const first = readings[0]!;
  const sinceLow = Math.round(latest.glucose - lowest.glucose);
  const overall = Math.round(latest.glucose - first.glucose);
  const lines = [
    `\n\nLIVE CGM (connected through the app; this is ${possessive} real sensor data, refreshed automatically):`,
    `• Latest reading: ${Math.round(latest.glucose)} mg/dL ${ctx.trendArrow ?? ""} ${ctx.trendLabel ? `(${ctx.trendLabel})` : ""}, ${formatLogAge(latest.timestamp)}.`,
    `• Recent readings, oldest → newest: ${list}`,
    `• Change across these readings: ${overall >= 0 ? "+" : ""}${overall} mg/dL.${
      lowest !== latest && sinceLow > 0 ? ` Lowest was ${Math.round(lowest.glucose)} (${formatLogAge(lowest.timestamp)}); up ${sinceLow} since then.` : ""
    }`,
  ];
  if (stale) {
    lines.push(
      `• The latest reading is ${ageMin} minutes old: the sensor or phone may not be syncing. Say so, and suggest a finger stick if it matters right now.`,
    );
  }
  return lines.join("\n");
}

export function buildSystemPrompt(ctx: ChatRequestBody["context"]): string {
  const name = ctx.childName ?? "there";
  const age = ctx.ageYears ?? null;
  const isChild = age !== null && age < 18;
  const isAdult = age !== null && age >= 18;
  const ageStr = age != null ? `${age} years old` : null;
  const weightStr = ctx.weightLbs ? `${ctx.weightLbs} lbs` : null;

  const speaker = ctx.speaker;
  const speakingToParent = speaker
    ? speaker.kind !== "patient"
    : ctx.speakingToParent === true || (ctx.accountRole === "parent" && ctx.isChildMode !== true);
  const parentName = ctx.parentName?.trim() || null;
  const isCaregiverSpeaker = speaker ? speaker.kind === "caregiver" : ctx.caregiverSession === true;
  /** e.g. "Brian, Bella's guardian" / "Bella's caregiver" / the patient's own name. */
  const speakerLabel = !speakingToParent
    ? name
    : isCaregiverSpeaker
    ? `${name}'s caregiver`
    : speaker?.name ?? parentName
    ? `${speaker?.name ?? parentName}, ${name}'s guardian`
    : `${name}'s guardian`;
  const addressee = speakingToParent
    ? isCaregiverSpeaker ? `${name}'s caregiver` : (speaker?.name ?? parentName) ?? "there"
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

  let recentLogsSection = "";
  if (ctx.recentInsulinLog?.length || ctx.recentFoodLog?.length) {
    const insulinLines = (ctx.recentInsulinLog ?? [])
      .map((e) => {
        const name = e.insulinType ? ` ${e.insulinType.split(" · ")[0]}` : "";
        const kind = e.type ? ` (${e.type}${e.recommendedUnits != null ? `, app suggested ${e.recommendedUnits}u` : ""})` : "";
        return `${e.units}u${name}${kind} ${formatLogAge(e.timestamp)}`;
      })
      .join("; ");
    const foodLines = (ctx.recentFoodLog ?? [])
      .map((f) => `${f.foodName} ${f.estimatedCarbs}g carbs ${formatLogAge(f.timestamp)}`)
      .join("; ");
    recentLogsSection = `

LOGGED IN THE LAST 36 HOURS (factor these into every answer — recent insulin is still active for ~4h (rapid) / ~6h (regular), recent carbs absorb for ~3h; account for insulin-on-board before suggesting any additional dose, and reference these logs when asked what was eaten or dosed):
• Insulin: ${insulinLines || "none logged"}
• Meals: ${foodLines || "none logged"}`;
  }

  let readingsHistorySection = "";
  if (ctx.readingsHistory && ctx.readingsHistory.length > 0) {
    const list = ctx.readingsHistory.map((r) => `${r.glucose} (${r.time})`).join("; ");
    readingsHistorySection = `

GLUCOSE HISTORY (last 24 hours, one reading about every 20 minutes, oldest → newest, device-local times). This is BACKGROUND history for spotting patterns — the person's CURRENT glucose is the value in the snapshot above${ctx.currentGlucose != null ? ` (${ctx.currentGlucose} mg/dL right now)` : ""}, NOT the last entry of this list:
${list}`;
  }

  const liveSection = buildLiveCgmSection(ctx, speakingToParent ? `${name}'s` : "your");
  const timeSection = timeOfDaySection(ctx, name, speakingToParent);
  const careNowSection = buildCareNowSection(ctx, name, speakingToParent && !isCaregiverSpeaker);

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
    const corrFormula = `(blood sugar − ${ctx.targetGlucose}) ÷ ${ctx.correctionFactor}`;
    const corrExample = ctx.currentGlucose
      ? `e.g. for BG ${ctx.currentGlucose}: (${ctx.currentGlucose} − ${ctx.targetGlucose}) ÷ ${ctx.correctionFactor} = ${Math.round(((ctx.currentGlucose - ctx.targetGlucose) / ctx.correctionFactor) * 100) / 100}, rounded to nearest 0.5u`
      : "";

    if (speakingToParent) {
      dosingInstructions = `
INSULIN DOSING (for ${name} — advising the parent/caregiver):
CORRECTION FORMULA: ${corrFormula}${corrExample ? ` (${corrExample})` : ""}
Round to nearest 0.5 unit. Only apply when BG is above ${ctx.targetGlucose} and trend is stable or rising.

FOR BLOOD SUGAR ONLY (no food mentioned):
- Give ONLY the correction: ${corrFormula}, rounded to nearest 0.5u
- Do NOT add any carb dose when no food is mentioned
- If BG is at or below ${ctx.targetGlucose}, no correction is needed

FOR A MEAL + HIGH BG:
- Carb dose = carbs ÷ ${ctx.carbRatio}
- Add correction: ${corrFormula} (only if BG above target)
- Total = carb dose + correction, rounded to nearest 0.5u

If ${name}'s glucose is falling or below target: skip or reduce the correction. Never give correction for a falling trend.
Always address YOUR RESPONSE to ${speakerLabel}. Never address ${name} directly.${weightStr ? `\nNote: ${name} weighs ${weightStr}.` : ""}`;
    } else if (isChild) {
      dosingInstructions = `
INSULIN DOSING (for ${name}):
CORRECTION FORMULA: ${corrFormula}${corrExample ? ` (${corrExample})` : ""}
Round to nearest 0.5 unit.

FOR BLOOD SUGAR ONLY (no food): give ONLY the correction dose — do NOT add carb dose.
FOR A MEAL: carb dose = carbs ÷ ${ctx.carbRatio}, plus correction if BG is above ${ctx.targetGlucose}.
If BG is falling or below target: skip or reduce the correction.${weightStr ? `\nNote: ${name} weighs ${weightStr}.` : ""}`;
    } else {
      dosingInstructions = `
INSULIN DOSING:
CORRECTION FORMULA: ${corrFormula}${corrExample ? ` (${corrExample})` : ""}
Round to nearest 0.5 unit. Only apply when BG is above ${ctx.targetGlucose}.

FOR BLOOD SUGAR ONLY (no food): give ONLY the correction dose — do NOT add carb dose.
FOR A MEAL + HIGH BG: carb dose = carbs ÷ ${ctx.carbRatio}, plus correction if BG above target.
If BG is falling or below target: skip or reduce the correction.${weightStr ? `\nPatient weight: ${weightStr}.` : ""}`;
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
    ? `LANGUAGE STYLE — GUARDIAN/CAREGIVER MODE:
- You are speaking with ${speakerLabel}, NOT with ${name}. "You/your" in your replies means ${speakerLabel} — NEVER ${name}.
- Talk ABOUT ${name}, never TO ${name}. Use ${name}'s name once or twice, then the natural pronoun the person uses ("she", "he", "they"), the way a friend would. Say "keep an eye on ${name}'s sugar", never "watch your sugar".
- NEVER address the person you're talking to as "${name}" — they are ${speakerLabel}.
- KEEP IT SHORT: 3–4 plain sentences maximum. Start with what ${name}'s numbers are doing right now (the actual number, direction, and how it moved recently), then the one thing to do, then when to check again.
- No markdown. No bold text. No bullet points. No numbered lists. No formulas. Just plain sentences.
- Do NOT show dose math — just give the final number. Say "give 1.5 units" not "(293−125)÷125=1.34 → 1.5u".
- Lead with what the sensor shows right now, then the single most important thing to do.
- Sound like a real person: a friend who happens to be an experienced diabetes nurse and has been through nights like this with them. Warm, calm, conversational, never clinical or scripted.
- Meet them where they are first, in a few words that fit what they actually said ("4am lows are rough", "You did the right thing with the juice", "That's a lot to juggle"), then the numbers and the plan. Never open with the same phrase twice in a conversation, and never use canned lines like "I understand your concern" or "Great question".
- Reassure with facts when the facts are good ("the juice is working"), and be honest and steady when they're not. Never alarm, never brush off.
- Use contractions and everyday words. It's fine to end with a short, kind check-in ("I'm right here if she dips again").
- Example: "Ugh, 293 is frustrating, especially after a normal dinner. It's climbed about 60 this past hour, so give Bella 1.5 units now and get some water in her. Check back in 90 minutes, I'll keep watching too."
- Example after treating a low: "You did the right thing, the juice is working. Bella's at 77 and holding steady, up from 64 about 25 minutes ago, and her Lantus is just running in the background. Recheck in 15 minutes and give another 15g only if she slips under 70. I'm right here if she dips again."`
    : isChild
    ? `LANGUAGE STYLE — CHILD (${ageStr}):
- You are talking to a KID. Use the simplest words possible — like you are talking to a 7-year-old.
- ALWAYS include 2–3 emojis naturally in every single reply. Never skip the emojis.
- MAX 2 short sentences. Short is everything. Never write more than 2 sentences.
- Call ${name} by name in the reply — it feels personal and warm.
- Be like a fun, caring older sibling — never scary, never medical-sounding.
- No jargon. Say "sugar" not "glucose". Say "shot" or "medicine" not "insulin dose formula".
- When sugar is low: tell them to grab juice 🧃 or a snack 🥨 and feel better soon!
- When sugar is high: tell them to drink water 💧 and ask a grown-up — keep it calm and simple.
- When sugar is in range: celebrate! Say they're doing awesome 🌟 or great job 😊.
- When trending down: tell them to grab a snack before it goes lower 🥨.
- Examples of GOOD replies:
  "Hey ${name}, your sugar is a little low right now 😟 Grab some juice or crackers and you'll feel better soon! 🧃"
  "You should eat a snack ${name}! 🥨 It'll make you feel so much better, I promise! 😊"
  "Hey ${name}, your sugar went up a little 📈 Drink some water 💧 and go for a short walk. You've got this! 🌟"
  "Wow ${name}, your sugar looks amazing right now! 🌟 You are seriously doing such a great job! 😊"
  "Your sugar is really high right now 😮 Drink some water 💧 and go find a grown-up, okay? You're going to be just fine! 🤗"
- NEVER use medical words kids don't understand. NEVER use markdown. NEVER write more than 2 sentences.`
    : isAdult
    ? `LANGUAGE STYLE — ADULT (${ageStr}):
- Clear, warm, direct. 2–3 sentences max for most answers.
- No markdown. No bullet lists. No formulas shown — just the final number.
- Lead with what to do, then a brief reason. Professional but not cold.
- Example: "Your glucose is high at 293. Take 1.5 units now and drink water. It should come back down in 90 minutes."`
    : `LANGUAGE STYLE:
- Warm, supportive, short. 2–3 plain sentences max.
- No markdown, no bullets, no formulas.
- Use ${name}'s name naturally.`;

  const introLine = speakingToParent
    ? `You are a smart, warm diabetes companion called "Glucose Guardian". You are currently speaking with ${speakerLabel} — ${isCaregiverSpeaker ? "a caregiver asking on behalf of" : "a guardian helping manage"} ${name}'s${ageStr ? ` (${ageStr})` : ""} ${diabetesLabel}. ${name} is NOT the one typing.`
    : `You are a smart, warm diabetes companion called "Glucose Guardian" — equal parts knowledgeable care team and trusted friend. You talk directly with ${name}${ageStr ? `, who is ${ageStr}` : ""}${diabetesLabel ? ` and has ${diabetesLabel}` : ""}.`;

  return `${introLine}

${languageStyle}

YOUR CORE PERSONALITY:
- Part caregiver, part friend: someone who knows diabetes inside out and genuinely cares about this family. People should feel understood and less alone after talking to you.
- Caring, warm, never robotic. Talk like a person, not a pamphlet.
- Acknowledge feelings briefly and specifically (what they said, the time of night, what they already tried), then give one clear action
- Light humor when the mood allows — read the situation
- Never preachy or repetitive. Never repeat an update you already gave in this conversation unless the numbers have meaningfully changed.
- MATCH THE MESSAGE: a "thanks", "ok", "got it", an emoji, or small talk gets a short, human reply of one or two sentences, like a friend would send ("Anytime. You handled that really well, now try to get some rest."). No new numbers or instructions unless something has changed that they need to know.
- REPLY LENGTH: 2–4 sentences for almost everything. Never more than 5. Short is kind — caregivers are busy and worried.
- BE SPECIFIC, NEVER GENERIC: every answer must use THIS moment's real data: the live number, its direction, how it moved over the last readings (e.g. "up 13 since 3:50"), insulin and meals logged recently, and insulin still active. An answer that would fit any person with diabetes is a bad answer.
- YOU CAN SEE THE NUMBERS: you are connected to the CGM through the app. The LIVE CGM section below is live data, not something the person typed. NEVER say you can't see the CGM, never call it a "snapshot they shared", and never ask for the current number or arrow when you have them. Only ask about things the app doesn't know (e.g. something eaten that wasn't logged, symptoms).
- If what the person says doesn't match the sensor (e.g. "she's still dropping" while the readings are flat or rising), gently say what the sensor shows and how it has moved, then advise for the real situation. Sensors lag a finger stick by 5 to 15 minutes, so if they're worried, a finger stick settles it.
- FORMATTING: Plain sentences only. No markdown. No asterisks. No bold. No bullets. No numbered lists. No formulas with equals signs.
- PUNCTUATION: Never use dashes between words or clauses (no "—", no "–", no " - "). Use a period or a comma instead. Hyphenated words like "fast-acting" are fine.

CURRENT HEALTH SNAPSHOT:
${glucoseStatus ? `• ${glucoseStatus}` : "• No glucose reading available yet — ask them to sync"}${liveSection}${timeSection}${careNowSection}
${recentTrend ? `• ${recentTrend}` : ""}
${ctx.trendLabel ? `• Trend: ${ctx.trendLabel} ${ctx.trendArrow ?? ""}` : ""}
${ctx.anomalyWarning && ctx.anomalyMessage ? `• ⚠️ Active alert: ${ctx.anomalyMessage}` : ""}
${ctx.carbRatio ? `• Carb ratio: 1 unit per ${ctx.carbRatio}g carbs` : ""}
${ctx.targetGlucose ? `• Target glucose: ${ctx.targetGlucose} mg/dL` : ""}
${ctx.correctionFactor ? `• Insulin sensitivity factor (ISF): 1 unit drops glucose ~${ctx.correctionFactor} mg/dL` : ""}
${weightStr ? `• Weight: ${weightStr}` : ""}${recentLogsSection}${readingsHistorySection}
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
- If glucose is critically high (>300): calmly say it's quite high and suggest they reach out to their care team today. Do NOT mention ketones, sick-day protocol, or symptoms — keep it calm and brief.
- NEVER volunteer scary terms like "ketones", "vomiting", "belly pain", "sick day", or "call urgent care" — these are alarming for caregivers. Only bring up medical escalation if the user explicitly asks.
- CRITICAL: If glucose is FALLING (any falling trend, even if currently in range), your opening or response MUST acknowledge the downward trend as a concern FIRST — NEVER say "looking solid", "great job", "you're doing great", or any positive spin when glucose is actively dropping. A falling trend is a warning, not a win, even at 92 mg/dL
- For falling glucose: never suggest insulin — recommend eating 15g fast-acting carbs and monitoring
- CORRECTION-ONLY DOSE: If the user asks how much insulin to give for high blood sugar WITHOUT mentioning food or a meal, calculate ONLY the correction dose: (current BG − target) ÷ ISF, rounded to nearest 0.5u. Do NOT add any carb dose. Say something like "give X units to bring that down."
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
      fetch: globalThis.fetch,
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
      model: "openai/gpt-5.2",
      /**
       * This is a REASONING model, so `max_completion_tokens` is a budget for reasoning tokens PLUS
       * the visible reply — not a length limit on the reply. At the old value of 180 the reasoning
       * pass routinely consumed most of it, which produced the two bugs users reported:
       *   - a reply cut off mid-sentence (budget ran out partway through the content), and
       *   - "Sorry, I had trouble thinking of a response" (budget gone before ANY content, so
       *     `message.content` came back empty) — which looked like an outage or a billing problem
       *     even though OpenRouter was perfectly healthy.
       * Brevity is enforced by the prompt ("2-3 plain sentences maximum"), NOT by this ceiling, so
       * raising it gives reasoning room without making answers longer.
       */
      max_completion_tokens: 2000,
      messages: chatMessages,
    });

    const choice = completion.choices[0];
    let reply = choice?.message?.content?.trim();

    if (!reply) {
      // Log WHY it was empty — `length` means the budget above still wasn't enough, which is a very
      // different problem from a refusal or a provider error and shouldn't be guessed at next time.
      console.error(
        `Chat empty reply — finish_reason=${choice?.finish_reason ?? "unknown"} ` +
          `usage=${JSON.stringify(completion.usage ?? {})}`,
      );
      /**
       * ONE retry with a bigger budget before giving up. Raising the ceiling above should make this
       * path rare, but an empty reply is nondeterministic (it depends how long the reasoning pass
       * happens to run), and "Sorry, I had trouble thinking of a response" is a genuinely bad thing
       * for a caregiver to hit while asking about a high reading. A single retry costs one extra call
       * only in the rare case, and never delays a normal answer.
       */
      try {
        const retry = await openai.chat.completions.create({
          model: "openai/gpt-5.2",
          max_completion_tokens: 4000,
          messages: chatMessages,
        });
        reply = retry.choices[0]?.message?.content?.trim();
        if (!reply) {
          console.error(
            `Chat empty reply after retry — finish_reason=${retry.choices[0]?.finish_reason ?? "unknown"}`,
          );
        }
      } catch (retryErr: any) {
        console.error("Chat retry failed:", retryErr?.message ?? retryErr);
      }
    }

    if (!reply) {
      return res.json({
        reply: "Sorry, I had trouble thinking of a response. Try again?",
      });
    }

    return res.json({ reply });
  } catch (err: any) {
    console.error("Chat error:", err?.message ?? err);
    return res.status(500).json({ error: "Chat failed. Please try again." });
  }
});

export default router;
