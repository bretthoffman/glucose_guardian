/**
 * Meal tips and "Ways to help" (pure, unit-tested).
 *
 * Tips come from the person's OWN data, never from generic rules about "good" and "bad" foods:
 *  - mealTip: when a meal like this one has run high after most of the last few times, suggest an
 *    easy food to ADD (protein), with its carbs, so it can go on the meal in one tap.
 *  - waysToHelp: the part of the day with the most time above range over the last two weeks, with a
 *    few ideas. Anything about insulin timing or amounts always says to ask the doctor.
 *
 * Wording rules: ideas to add, never foods to forbid; no shame words; no insulin advice.
 */
export interface TipReading {
  glucose: number;
  timestamp: string;
}
export interface TipMeal {
  foodName: string;
  timestamp: string;
}

/** Above this after a meal counts as a big rise (mg/dL). */
export const TIP_HIGH = 250;
/** Look this long after a past meal for its peak. */
export const TIP_WINDOW_MIN = 150;
/** Compare against at most this many past meals like this one. */
export const TIP_LOOKBACK = 3;

const STOP = new Set(["with", "and", "the", "a", "of", "on", "in", "some", "plus", "w", "&", "side", "small", "large", "big"]);

/** Meaningful words in a meal name: "Waffles with syrup + Berries" → ["waffle", "syrup", "berrie"]. */
export function mealWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.endsWith("s") ? w.slice(0, -1) : w));
}

/** Same meal? At least half of the smaller meal's words match. */
export function sameMeal(a: string, b: string): boolean {
  const wa = new Set(mealWords(a));
  const wb = new Set(mealWords(b));
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.5;
}

/** The last few past meals like this one (newest first), skipping anything in the last 3 hours. */
export function similarPastMeals(foodName: string, log: TipMeal[], nowMs: number): TipMeal[] {
  return log
    .filter((m) => nowMs - Date.parse(m.timestamp) > 3 * 3600_000 && sameMeal(foodName, m.foodName))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, TIP_LOOKBACK);
}

/** Highest reading in the window after a meal, or null when there's no sensor data for it. */
export function peakAfter(meal: TipMeal, readings: TipReading[]): number | null {
  const t0 = Date.parse(meal.timestamp);
  let peak: number | null = null;
  for (const r of readings) {
    const t = Date.parse(r.timestamp);
    if (t >= t0 && t <= t0 + TIP_WINDOW_MIN * 60_000) peak = peak == null ? r.glucose : Math.max(peak, r.glucose);
  }
  return peak;
}

export interface ProteinIdea {
  name: string;
  carbs: number;
}
/** Easy protein adds with their carbs (whole foods kids eat; nothing that's a choking risk). */
export const PROTEIN_IDEAS: ProteinIdea[] = [
  { name: "Scrambled egg", carbs: 1 },
  { name: "Plain Greek yogurt", carbs: 6 },
  { name: "Cheese stick", carbs: 1 },
];

export interface MealTip {
  text: string;
  ideas: ProteinIdea[];
}

/**
 * A tip for this meal, or null. Needs at least 2 past meals with sensor data, and most of them
 * (2 of 2, 2 of 3) over TIP_HIGH. Skipped when the meal already has plenty of protein.
 */
export function mealTip(input: {
  foodName: string;
  proteinGrams?: number;
  pastMeals: TipMeal[];
  readings: TipReading[];
  name?: string;
}): MealTip | null {
  if ((input.proteinGrams ?? 0) >= 15) return null;
  const peaks = input.pastMeals.map((m) => peakAfter(m, input.readings)).filter((p): p is number => p != null);
  if (peaks.length < 2) return null;
  const high = peaks.filter((p) => p > TIP_HIGH).length;
  if (high < 2) return null;
  const name = input.name?.trim();
  const times = high === peaks.length ? `The last ${peaks.length} times` : `${high} of the last ${peaks.length} times`;
  const had = name ? `${name} had this` : "this meal was logged";
  return {
    text: `${times} ${had}, readings went over ${TIP_HIGH} within a couple of hours. Adding some protein can soften that rise.`,
    ideas: PROTEIN_IDEAS,
  };
}

export type DayPart = "breakfast" | "lunch" | "dinner" | "overnight";

/** Local hour → part of the day. */
export function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 10) return "breakfast";
  if (hour >= 10 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 21) return "dinner";
  return "overnight";
}

export interface WaysToHelp {
  part: DayPart;
  /** Percent of that part's readings above the high line. */
  pctHigh: number;
  intro: string;
  ideas: { title: string; body: string; askDoctor?: boolean }[];
}

const IDEAS: Record<DayPart, WaysToHelp["ideas"]> = {
  breakfast: [
    { title: "Add protein at breakfast.", body: "Eggs, yogurt or cheese next to cereal or waffles softens the morning rise." },
    { title: "A little movement before school.", body: "A short walk or play helps the morning numbers." },
    { title: "Ask the doctor about breakfast timing.", body: "Giving insulin a little before eating may help. Your doctor decides.", askDoctor: true },
  ],
  lunch: [
    { title: "Pack protein or fiber with lunch.", body: "A cheese stick, turkey, beans or veggies next to the main dish." },
    { title: "Share the pattern with the school nurse.", body: "Lunchtime highs are easier to plan for together." },
    { title: "Ask the doctor about lunch at school.", body: "Timing and carb counts at school can be tricky. Your doctor can help.", askDoctor: true },
  ],
  dinner: [
    { title: "A short walk or play after dinner.", body: "About 15 minutes of moving helps evening numbers." },
    { title: "Add protein or veggies at dinner.", body: "Filling half the plate with them slows the rise." },
    { title: "Ask the doctor about evening highs.", body: "They can look at the pattern with you.", askDoctor: true },
  ],
  overnight: [
    { title: "Look at the bedtime snack.", body: "A snack with protein tends to keep nights steadier than a sweet one." },
    { title: "Check before bed.", body: "A bedtime number helps catch a night high early." },
    { title: "Ask the doctor about overnight highs.", body: "Overnight patterns are worth a look at the next visit.", askDoctor: true },
  ],
};

const PART_WORDS: Record<DayPart, string> = {
  breakfast: "after breakfast",
  lunch: "around lunch",
  dinner: "in the evening",
  overnight: "overnight",
};

/**
 * The part of the day with the most time above `high` (needs 7+ days of readings and at least 10%
 * of that part high), with a few ideas. `tzOffsetMin` = minutes to add to UTC for local time.
 */
export function waysToHelp(readings: TipReading[], high: number, name: string | null, tzOffsetMin: number): WaysToHelp | null {
  if (readings.length < 7 * 96) return null;
  const counts: Record<DayPart, { n: number; hi: number }> = {
    breakfast: { n: 0, hi: 0 },
    lunch: { n: 0, hi: 0 },
    dinner: { n: 0, hi: 0 },
    overnight: { n: 0, hi: 0 },
  };
  for (const r of readings) {
    const local = new Date(Date.parse(r.timestamp) + tzOffsetMin * 60_000);
    const c = counts[dayPartOf(local.getUTCHours())];
    c.n++;
    if (r.glucose > high) c.hi++;
  }
  let best: DayPart | null = null;
  let bestPct = 0;
  for (const part of Object.keys(counts) as DayPart[]) {
    const { n, hi } = counts[part];
    if (n < 50) continue;
    const pct = Math.round((hi / n) * 100);
    if (pct > bestPct) {
      bestPct = pct;
      best = part;
    }
  }
  if (!best || bestPct < 10) return null;
  return {
    part: best,
    pctHigh: bestPct,
    intro: `Over the last two weeks, ${name ? `${name}'s` : "your"} highs happened most ${PART_WORDS[best]}. A few ideas:`,
    ideas: IDEAS[best],
  };
}

/** Who sees tips: guardians always; caregivers and nurses unless turned off; Child Mode only if on. */
export function canSeeMealTips(input: {
  isChildMode: boolean;
  isCaregiver: boolean;
  mealTipsCaregivers?: boolean;
  mealTipsChildMode?: boolean;
}): boolean {
  if (input.isChildMode) return input.mealTipsChildMode === true;
  if (input.isCaregiver) return input.mealTipsCaregivers !== false;
  return true;
}

/** At most one meal tip a day: true when the last one shown was on an earlier local day. */
export function tipAllowedToday(lastShownDate: string | null, today: string): boolean {
  return lastShownDate !== today;
}
