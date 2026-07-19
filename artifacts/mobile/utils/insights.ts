// Relative import (not the "@/" alias) so this pure module is resolvable by the unit-test runner too.
import { COLORS } from "../constants/colors";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";
import type { GlucoseEntry } from "@/context/GlucoseContext";
import { getEffectiveTrend } from "./trend";

/**
 * Insights & Recommendations engine — surfaced from the Home screen's trend-pill popup.
 *
 * LIVE-FIRST: cards about lows and highs are split into CURRENT state (driven by the latest
 * reading plus the live trend/rate of movement) and EARLIER-TODAY episodes (past tense, with the
 * time they happened) — a low from this morning must not read as "hypoglycemia detected" all day.
 * Pattern cards (meal spikes, dosing timing, time-of-day, TIR) still analyze the full 24h window.
 */
const LOW_THRESH = 70;
const HIGH_THRESH = 180;

export interface Suggestion {
  icon: string;
  title: string;
  body: string;
  color: string;
  priority: number;
  chatPrompt: string;
  tag?: string;
}

function hourOf(ts: string) {
  return new Date(ts).getHours();
}

function avgGlucoseInWindow(readings: GlucoseEntry[], fromHour: number, toHour: number): number | null {
  const slice = readings.filter((r) => {
    const h = hourOf(r.timestamp);
    return h >= fromHour && h < toHour;
  });
  if (slice.length < 2) return null;
  return Math.round(slice.reduce((s, r) => s + r.glucose, 0) / slice.length);
}

export function analyzeReadings(
  readings: GlucoseEntry[],
  targetGlucose: number,
  isMinor: boolean,
  foodLog: FoodLogEntry[],
  insulinLog: InsulinLogEntry[],
  nowMs: number = Date.now(),
): Suggestion[] {
  if (readings.length === 0) return [];
  const suggestions: Suggestion[] = [];
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const recentFood = foodLog.filter((f) => new Date(f.timestamp).getTime() >= cutoff);
  const recentInsulin = insulinLog.filter((i) => new Date(i.timestamp).getTime() >= cutoff);

  const sorted = [...readings].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const latest = sorted[sorted.length - 1];

  const lows = readings.filter((r) => r.glucose < LOW_THRESH);
  const highs = readings.filter((r) => r.glucose > HIGH_THRESH);
  const inRange = readings.filter((r) => r.glucose >= LOW_THRESH && r.glucose <= HIGH_THRESH);
  const timeInRange = Math.round((inRange.length / readings.length) * 100);
  const avg = Math.round(readings.reduce((s, r) => s + r.glucose, 0) / readings.length);
  const trend = getEffectiveTrend(sorted).glucoseTrend;
  const falling = trend === "falling" || trend === "rapidly_falling";
  const rising = trend === "rising" || trend === "rapidly_rising";

  // Signed movement rate (mg/dL per minute) from the two newest readings — current-state cards
  // speak to HOW FAST glucose is moving, not just the direction.
  let ratePerMin: number | null = null;
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2];
    const dtMin =
      (new Date(latest.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 60_000;
    if (Number.isFinite(dtMin) && dtMin > 0) {
      ratePerMin = Math.round(((latest.glucose - prev.glucose) / Math.max(dtMin, 0.5)) * 10) / 10;
    }
  }
  const rateNote =
    ratePerMin != null && Math.abs(ratePerMin) >= 0.5
      ? ` (~${Math.abs(ratePerMin)} mg/dL per minute)`
      : "";
  const fmtClock = (ts: string) =>
    new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // ── Priority 1: CURRENT low — else a recovered "earlier today" note ───────────────────────
  const currentlyLow = latest.glucose < LOW_THRESH;
  if (currentlyLow) {
    suggestions.push({
      icon: "🧃",
      tag: "URGENT",
      title: isMinor ? "Sugar is low — drink juice!" : "Hypoglycemia — treat now",
      body: isMinor
        ? `Your sugar is ${latest.glucose} mg/dL right now${falling ? " and still going down" : ""}. Drink 4 oz of juice or eat 4 glucose tablets and tell an adult!`
        : `Glucose is ${latest.glucose} mg/dL right now${
            falling ? ` and still falling${rateNote}` : rising ? " and starting to recover" : ""
          }. Treat with 15–20g fast-acting carbs${rising ? " if you haven't already" : ""} and recheck in 15 min.`,
      color: COLORS.danger,
      priority: 1,
      chatPrompt: isMinor
        ? "My blood sugar is low right now. What should I do?"
        : `My glucose is ${latest.glucose} mg/dL right now${falling ? " and still falling" : ""}. Walk me through treating this low and how to prevent the next one.`,
    });
  } else if (lows.length > 0) {
    const worstLow = lows.reduce((min, r) => (r.glucose < min.glucose ? r : min), lows[0]);
    suggestions.push({
      icon: "✅",
      tag: "EARLIER TODAY",
      title: isMinor ? "You had a low earlier — all better now" : "Earlier low — recovered",
      body: isMinor
        ? `Your sugar dropped to ${worstLow.glucose} mg/dL at ${fmtClock(worstLow.timestamp)}, but you're back at ${latest.glucose} now. Great job treating it!`
        : `Glucose dropped to ${worstLow.glucose} mg/dL at ${fmtClock(worstLow.timestamp)} and has recovered (${latest.glucose} now). Watch for rebound lows, and consider what caused it — a large dose or a missed snack.`,
      color: COLORS.accent,
      priority: 4,
      chatPrompt: `I had a low of ${worstLow.glucose} mg/dL at ${fmtClock(worstLow.timestamp)} and I've recovered to ${latest.glucose} now. What likely caused it and how do I prevent the next one?`,
    });
  }

  // ── Priority 2: Rapidly falling trend ─────────────────────────────────
  if (trend === "rapidly_falling" || trend === "falling") {
    suggestions.push({
      icon: "🍎",
      tag: "ACT NOW",
      title: isMinor ? "Sugar is dropping — eat a snack!" : "Falling glucose — act now",
      body: isMinor
        ? "Your sugar is going down. Eat a small snack like an apple or crackers now!"
        : `Glucose is trending down${rateNote}. Have 15g fast-acting carbs. If you recently dosed, insulin may still be peaking — hold your next dose until BG stabilizes.`,
      color: COLORS.warning,
      priority: 2,
      chatPrompt: isMinor
        ? "My blood sugar keeps dropping. What snacks should I eat and when?"
        : "My glucose is falling quickly. Can you explain the best strategy for treating a falling trend and how to avoid going low?",
    });
  }

  // ── Priority 3: Rising trend → activity suggestion ─────────────────────
  if (trend === "rapidly_rising" || trend === "rising") {
    suggestions.push({
      icon: "🚶",
      tag: "TIP",
      title: isMinor ? "Try a short walk to help!" : "Rising glucose — try activity",
      body: isMinor
        ? "Your sugar is going up! A 10–15 min walk or active play after meals can help bring it back down naturally."
        : `Glucose is rising${rateNote}. A brisk 10–15 min walk can reduce glucose 20–40 mg/dL without extra insulin — especially effective 30–60 min after a meal.`,
      color: COLORS.warning,
      priority: 3,
      chatPrompt: isMinor
        ? "My blood sugar keeps going up. Can walking really help? What else can I do?"
        : "My glucose is rising and I want to know how exercise affects blood sugar. When should I walk vs when should I take a correction dose?",
    });
  }

  // ── Priority 4: Post-meal spike pattern from food log ─────────────────
  if (recentFood.length > 0) {
    let spikeCount = 0;
    let totalSpike = 0;
    let highCarbMeal = false;
    for (const meal of recentFood) {
      const mealTime = new Date(meal.timestamp).getTime();
      const before = readings.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= mealTime - 20 * 60000 && t <= mealTime;
      });
      const after = readings.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= mealTime + 45 * 60000 && t <= mealTime + 100 * 60000;
      });
      if (before.length > 0 && after.length > 0) {
        const beforeAvg = before.reduce((s, r) => s + r.glucose, 0) / before.length;
        const afterPeak = Math.max(...after.map((r) => r.glucose));
        if (afterPeak - beforeAvg > 60) {
          spikeCount++;
          totalSpike += afterPeak - beforeAvg;
        }
      }
      if (meal.estimatedCarbs > 60) highCarbMeal = true;
    }

    if (spikeCount > 0) {
      const avgSpike = Math.round(totalSpike / spikeCount);
      suggestions.push({
        icon: "⏱️",
        tag: "PATTERN",
        title: isMinor ? "Big jumps after meals!" : "Post-meal spike detected",
        body: isMinor
          ? `Your sugar jumped about ${avgSpike} mg/dL after eating. Giving insulin 10–15 min before your meal can help a lot!`
          : `Glucose spiked ~${avgSpike} mg/dL above pre-meal baseline. Try pre-bolusing 10–15 min before eating. Adding fiber or protein slows carb absorption.`,
        color: COLORS.warning,
        priority: 4,
        chatPrompt: isMinor
          ? "My blood sugar goes up a lot after meals. Can giving insulin sooner help? What foods slow it down?"
          : `I'm seeing post-meal spikes of ~${avgSpike} mg/dL. Can you explain pre-bolusing timing, and how meal composition (protein, fiber, fat) affects glucose peaks?`,
      });
    }

    if (highCarbMeal && spikeCount === 0) {
      suggestions.push({
        icon: "🥗",
        tag: "MEAL TIP",
        title: isMinor ? "Balance carbs with protein!" : "Meal composition tip",
        body: isMinor
          ? "You ate a carb-heavy meal! Adding protein or veggies to your plate helps sugar rise more slowly."
          : "You logged a high-carb meal. Adding fiber (veggies, legumes) or protein slows digestion and reduces glucose peaks — aim for 25–30g carbs per meal.",
        color: COLORS.accent,
        priority: 5,
        chatPrompt: isMinor
          ? "How can I eat carbs without making my blood sugar go too high? What should I add to my meals?"
          : "I have a high-carb diet and want to understand how to balance meals for better glucose control. What's the role of protein, fat, and fiber?",
      });
    }
  }

  // ── Priority 5: Insulin timing analysis ──────────────────────────────
  if (recentFood.length > 0 && recentInsulin.length > 0) {
    let lateBolusCount = 0;
    for (const meal of recentFood) {
      const mealTime = new Date(meal.timestamp).getTime();
      const nearbyInsulin = recentInsulin.filter((i) => {
        const t = new Date(i.timestamp).getTime();
        return Math.abs(t - mealTime) < 60 * 60000;
      });
      for (const dose of nearbyInsulin) {
        const doseTime = new Date(dose.timestamp).getTime();
        if (doseTime > mealTime + 5 * 60000) lateBolusCount++;
      }
    }
    if (lateBolusCount > 0) {
      suggestions.push({
        icon: "💉",
        tag: "TIMING",
        title: isMinor ? "Give insulin before eating!" : "Insulin timing opportunity",
        body: isMinor
          ? "It looks like you got your shot after eating. Giving it 10–15 min before meals helps prevent big sugar spikes!"
          : `Insulin was given after ${lateBolusCount === 1 ? "a meal" : `${lateBolusCount} meals`}. Dosing 10–15 min before meals lets insulin peak alongside carb absorption, reducing post-meal spikes significantly.`,
        color: COLORS.primary,
        priority: 5,
        chatPrompt: isMinor
          ? "Why is it better to take insulin before eating instead of after? How do I know when to take it?"
          : "I've been dosing insulin after meals and seeing spikes. Can you explain optimal pre-bolus timing and how to calculate it based on my insulin type?",
      });
    }
  }

  // ── Priority 6: Time-of-day patterns ─────────────────────────────────
  const morningAvg  = avgGlucoseInWindow(readings, 5, 9);
  const midnightAvg = avgGlucoseInWindow(readings, 0, 4);
  const eveningAvg  = avgGlucoseInWindow(readings, 20, 24);
  const afternoonAvg = avgGlucoseInWindow(readings, 12, 15);

  // Dawn phenomenon: morning notably higher than late-night
  if (morningAvg !== null && midnightAvg !== null && morningAvg - midnightAvg > 40) {
    suggestions.push({
      icon: "🌅",
      tag: "PATTERN",
      title: isMinor ? "Morning sugars creeping up!" : "Dawn phenomenon detected",
      body: isMinor
        ? `Your sugar tends to rise while you sleep — from around ${midnightAvg} to ${morningAvg} mg/dL by morning. This is normal but your care team can help!`
        : `Morning average (${morningAvg} mg/dL) is ${morningAvg - midnightAvg} mg/dL higher than late-night (${midnightAvg} mg/dL). This suggests a dawn phenomenon — discuss basal insulin timing with your endocrinologist.`,
      color: COLORS.accent,
      priority: 6,
      chatPrompt: isMinor
        ? "Why does my blood sugar go up while I'm sleeping? Is that normal? What can we do about it?"
        : `I'm seeing a dawn phenomenon pattern — my glucose rises ~${morningAvg - midnightAvg} mg/dL overnight. Can you explain the physiology and what basal adjustments might help?`,
    });
  }

  // Post-lunch pattern
  if (afternoonAvg !== null && afternoonAvg > HIGH_THRESH + 20) {
    suggestions.push({
      icon: "☀️",
      tag: "PATTERN",
      title: isMinor ? "Afternoon sugar runs high!" : "Consistent afternoon elevation",
      body: isMinor
        ? `Your sugar tends to be around ${afternoonAvg} mg/dL in the afternoon. Try a lighter lunch or giving insulin a little sooner before eating!`
        : `Afternoon average ${afternoonAvg} mg/dL suggests post-lunch drift. Consider pre-bolusing 15 min before lunch, reducing refined carbs, or a short walk after eating.`,
      color: COLORS.warning,
      priority: 6,
      chatPrompt: isMinor
        ? "Why does my blood sugar go high every afternoon? What can I do at lunch to help?"
        : `My afternoon glucose consistently runs around ${afternoonAvg} mg/dL. Can you help me identify whether this is a lunch spike, insufficient lunch dose, or something else?`,
    });
  }

  // Evening highs (stress / dinner spike)
  if (eveningAvg !== null && eveningAvg > HIGH_THRESH + 20) {
    suggestions.push({
      icon: "🌙",
      tag: "PATTERN",
      title: isMinor ? "Evening sugars are a bit high" : "Evening glucose elevation",
      body: isMinor
        ? `Your sugar is often around ${eveningAvg} mg/dL in the evening. A smaller dinner and a short walk after eating can help a lot!`
        : `Evening average ${eveningAvg} mg/dL suggests dinner or stress elevation. Evening cortisol spikes are common — try a 10-min post-dinner walk and consider whether your dinner dose or timing needs adjustment.`,
      color: COLORS.accent,
      priority: 7,
      chatPrompt: isMinor
        ? "My blood sugar is high in the evenings. Does stress or dinner cause it? What should I do?"
        : `I'm seeing consistently elevated glucose in the evenings around ${eveningAvg} mg/dL. Can you explain the role of stress hormones, dinner composition, and what adjustments might help?`,
    });
  }

  // ── Priority 3–7: CURRENT high — else a recovered "earlier today" note ────────────────────
  const currentlyHigh = latest.glucose > HIGH_THRESH;
  if (currentlyHigh) {
    const peakHigh = Math.max(...highs.map((r) => r.glucose));
    suggestions.push({
      icon: "💧",
      tag: falling ? "IMPROVING" : "HYDRATION",
      title: isMinor
        ? falling ? "High sugar is coming down!" : "High sugar — drink water!"
        : falling ? "Elevated but falling" : "Elevated now — stay hydrated",
      body: isMinor
        ? falling
          ? `Your sugar is ${latest.glucose} mg/dL and coming down${rateNote}. Keep sipping water — you're on the right track!`
          : `Your sugar is ${latest.glucose} mg/dL right now. Drink a big glass of water — it helps your body process sugar more efficiently!`
        : falling
          ? `Glucose is ${latest.glucose} mg/dL and trending down${rateNote}. Don't stack another correction on insulin that's still working — recheck before any further dose.`
          : `Glucose is ${latest.glucose} mg/dL now${rising ? ` and rising${rateNote}` : ""} (today's peak ${peakHigh}). Dehydration worsens insulin resistance — aim for 8–12 oz water per hour, and pre-bolus 10–15 min before your next meal.`,
      color: COLORS.warning,
      priority: 3,
      chatPrompt: `My glucose is ${latest.glucose} mg/dL right now${falling ? " and falling" : rising ? " and rising" : ""}. What should I do, and how much does hydration actually help?`,
    });
  } else if (highs.length > 0) {
    const worstHigh = highs.reduce((max, r) => (r.glucose > max.glucose ? r : max), highs[0]);
    suggestions.push({
      icon: "📉",
      tag: "EARLIER TODAY",
      title: isMinor ? "Sugar was high earlier — back down now" : "Earlier high — back in range",
      body: isMinor
        ? `Your sugar peaked at ${worstHigh.glucose} mg/dL at ${fmtClock(worstHigh.timestamp)} but it's ${latest.glucose} now. Nice recovery!`
        : `Glucose peaked at ${worstHigh.glucose} mg/dL at ${fmtClock(worstHigh.timestamp)} and is back at ${latest.glucose} now. If highs follow meals, pre-bolusing 10–15 min earlier can blunt the spike.`,
      color: COLORS.accent,
      priority: 7,
      chatPrompt: `My glucose peaked at ${worstHigh.glucose} mg/dL at ${fmtClock(worstHigh.timestamp)} today and has come back to ${latest.glucose}. What can I do to reduce those peaks?`,
    });
  }

  // ── Priority 8: Low time-in-range → care team ─────────────────────────
  if (timeInRange < 50 && readings.length >= 4) {
    suggestions.push({
      icon: "👨‍⚕️",
      tag: "REVIEW",
      title: "Talk to your care team",
      body: isMinor
        ? `You were in your safe zone ${timeInRange}% of the time today. Your doctor might want to look at your settings!`
        : `Time-in-range is ${timeInRange}% (goal: 70%+). Bring this chart to your endocrinologist — your carb ratio or correction factor may need an adjustment.`,
      color: COLORS.primary,
      priority: 8,
      chatPrompt: isMinor
        ? "I wasn't in my safe blood sugar zone very much today. What does that mean and what can my doctor do to help?"
        : `My time-in-range is only ${timeInRange}%. What questions should I ask my endocrinologist about adjusting my insulin settings?`,
    });
  }

  // ── Priority 9: Consistently elevated + stable ────────────────────────
  if (avg > HIGH_THRESH && trend === "stable" && lows.length === 0) {
    suggestions.push({
      icon: "🍽️",
      tag: "MEAL TIP",
      title: isMinor ? "Try smaller meal portions" : "Consistently elevated — adjust meals",
      body: isMinor
        ? "Your sugar has been running a bit high. Smaller portions, fewer sugary drinks, and more protein can really help!"
        : `Average ${avg} mg/dL with a stable trend suggests consistent post-meal drift. Try pre-bolusing, smaller portions, more fiber, and a short walk after each meal.`,
      color: COLORS.accent,
      priority: 9,
      chatPrompt: isMinor
        ? "My blood sugar has been high after meals. What foods and portions help keep it lower?"
        : `My average glucose is ${avg} mg/dL. Can you explain how meal composition, portion size, and timing all affect post-meal glucose control?`,
    });
  }

  // ── Priority 10: Excellent control — only while actually in range right now ───────────────
  if (
    timeInRange >= 70 &&
    lows.length === 0 &&
    readings.length >= 3 &&
    latest.glucose >= LOW_THRESH &&
    latest.glucose <= HIGH_THRESH
  ) {
    suggestions.push({
      icon: "🌟",
      tag: "GREAT",
      title: isMinor ? "Amazing sugar control!" : "Excellent glucose control",
      body: isMinor
        ? `You were in your safe zone ${timeInRange}% of the time — incredible! Keep up whatever you're doing!`
        : `Time-in-range: ${timeInRange}%. Average: ${avg} mg/dL. Your management is right on track — keep your current meal timing and dose strategy.`,
      color: COLORS.success,
      priority: 10,
      chatPrompt: isMinor
        ? "I've been doing really well with my blood sugar! What else can I do to keep it up?"
        : `I'm achieving ${timeInRange}% time-in-range with an average of ${avg} mg/dL. What advanced strategies could help me push this even higher?`,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 5);
}
