/**
 * "Meal high heads-up" (pure, unit-tested). Finds meals that kept the person high even after extra
 * insulin, so the calculator can say "this meal may need a higher dose up front". It NEVER suggests a
 * number and never changes the dose math: it only reports what happened the last few times.
 *
 * A past meal STAYED HIGH when all of these are true:
 *  - a dose was given for it (linked to the meal, or a bolus within 30 minutes of it);
 *  - readings went over `high` between 1 and 2½ hours after eating;
 *  - one or more extra doses were given after (45 minutes to 4 hours after eating);
 *  - readings were still over `high` 3 to 4 hours after eating (the middle reading of that hour);
 *  - no other food was logged from 10 minutes to 4 hours after (otherwise it isn't just this meal).
 * A past meal WENT LOW when any reading under 70 came within 5 hours after it.
 *
 * A meal is FLAGGED when, of the last 3 times it was eaten with enough sensor data, at least 2 stayed
 * high, and none of the times it was eaten in the window went low.
 *
 * Used by the app's calculator (convex/mealHigh.ts → the meal's pattern) and the Doctor Portal list.
 */

export const DEFAULT_HIGH = 250;
export const HIGH_CHOICES = [200, 250, 300] as const;
export const LOW_LINE = 70;
/** How far back past meals are looked at. */
export const LOOKBACK_DAYS = 45;
/** Compare against at most this many past times a meal was eaten. */
export const LAST_TIMES = 3;
/** Of those, at least this many must have stayed high. */
export const MIN_STAYED_HIGH = 2;

const MIN = 60_000;

// ── Matching meals ──────────────────────────────────────────────────────────────────────────

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

// ── One past meal ───────────────────────────────────────────────────────────────────────────

export interface HighFood {
  clientId: string;
  foodName: string;
  timestamp: string;
  estimatedCarbs: number;
}
export interface HighDose {
  timestamp: string;
  units: number;
  type: string;
  foodLogId?: string;
}
export interface HighReading {
  glucose: number;
  ms: number;
}

export type MealOutcome = "stayedHigh" | "wentLow" | "fine";

export interface MealEvent {
  foodName: string;
  /** Meal time (ms). */
  at: number;
  carbs: number;
  /** Reading closest to the meal (within 20 minutes before to 10 after), when there is one. */
  startBg: number | null;
  mealUnits: number;
  /** Highest reading 1 to 2½ hours after. */
  peak: number;
  peakAt: number;
  /** Extra doses given 45 minutes to 4 hours after, in order. */
  extra: { at: number; units: number }[];
  /** The middle reading 3 to 4 hours after. */
  laterBg: number;
  laterAt: number;
  outcome: MealOutcome;
}

function median(xs: HighReading[]): HighReading | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a.glucose - b.glucose);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * What happened after one meal, or null when it can't be judged: no dose for it, another meal on top
 * of it, or not enough sensor data (a reading 1 to 2½ hours after and two or more 3 to 4 hours after).
 */
export function mealEvent(
  food: HighFood,
  foods: HighFood[],
  doses: HighDose[],
  readings: HighReading[],
  high: number,
): MealEvent | null {
  const t0 = Date.parse(food.timestamp);
  if (!Number.isFinite(t0)) return null;
  const rel = (ts: string) => (Date.parse(ts) - t0) / MIN;

  // Another meal or snack on top of this one: can't tell what caused what.
  if (foods.some((f) => f.clientId !== food.clientId && rel(f.timestamp) > 10 && rel(f.timestamp) <= 240)) return null;

  const fast = doses.filter((d) => d.type !== "basal" && d.units > 0);
  const linked = fast.filter((d) => d.foodLogId === food.clientId);
  const mealDoses = linked.length
    ? linked
    : fast.filter((d) => !d.foodLogId && rel(d.timestamp) >= -30 && rel(d.timestamp) <= 30);
  if (mealDoses.length === 0) return null;
  const mealUnits = mealDoses.reduce((s, d) => s + d.units, 0);
  const extra = fast
    .filter((d) => !mealDoses.includes(d) && rel(d.timestamp) > 45 && rel(d.timestamp) <= 240)
    .filter((d) => !d.foodLogId || d.foodLogId === food.clientId)
    .map((d) => ({ at: Date.parse(d.timestamp), units: d.units }))
    .sort((a, b) => a.at - b.at);

  const window = (fromMin: number, toMin: number) =>
    readings.filter((r) => r.ms >= t0 + fromMin * MIN && r.ms <= t0 + toMin * MIN);
  const peakWindow = window(60, 150);
  const laterWindow = window(180, 240);
  if (peakWindow.length === 0 || laterWindow.length < 2) return null;
  const peakR = peakWindow.reduce((m, r) => (r.glucose > m.glucose ? r : m));
  const laterR = median(laterWindow)!;
  const start = window(-20, 10).sort((a, b) => Math.abs(a.ms - t0) - Math.abs(b.ms - t0))[0] ?? null;

  const wentLow = window(0, 300).some((r) => r.glucose < LOW_LINE);
  const stayedHigh = peakR.glucose > high && extra.length > 0 && laterR.glucose > high;
  return {
    foodName: food.foodName,
    at: t0,
    carbs: food.estimatedCarbs,
    startBg: start?.glucose ?? null,
    mealUnits,
    peak: peakR.glucose,
    peakAt: peakR.ms,
    extra,
    laterBg: laterR.glucose,
    laterAt: laterR.ms,
    outcome: wentLow ? "wentLow" : stayedHigh ? "stayedHigh" : "fine",
  };
}

// ── Meals ───────────────────────────────────────────────────────────────────────────────────

export interface MealPattern {
  /** The newest name it was logged under. */
  foodName: string;
  /** All the times looked at (newest first, up to LAST_TIMES). */
  events: MealEvent[];
  stayedHigh: number;
  /** Average of the later (3 to 4 hour) readings on the times it stayed high. */
  avgLater: number;
  avgCarbs: number;
  avgMealUnits: number;
  avgExtraUnits: number;
  /** Local hour of the newest time it stayed high, for "breakfast / lunch / dinner". */
  lastAt: number;
}

/**
 * Group meals by name (sameMeal), judge each time it was eaten, and keep the meals that kept the
 * person high at least MIN_STAYED_HIGH of their last LAST_TIMES judged times, with no low after any
 * of them. Newest pattern first.
 */
export function mealPatterns(input: {
  foods: HighFood[];
  doses: HighDose[];
  readings: HighReading[];
  high: number;
  nowMs: number;
}): MealPattern[] {
  const since = input.nowMs - LOOKBACK_DAYS * 24 * 60 * MIN;
  const recent = input.foods
    .filter((f) => {
      const t = Date.parse(f.timestamp);
      // Only meals whose 4-hour window is over.
      return t >= since && t <= input.nowMs - 240 * MIN && mealWords(f.foodName).length > 0;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const groups: HighFood[][] = [];
  for (const f of recent) {
    const g = groups.find((grp) => sameMeal(grp[0]!.foodName, f.foodName));
    if (g) g.push(f);
    else groups.push([f]);
  }

  const out: MealPattern[] = [];
  for (const g of groups) {
    if (g.length < MIN_STAYED_HIGH) continue;
    const judged = g
      .map((f) => mealEvent(f, input.foods, input.doses, input.readings, input.high))
      .filter((e): e is MealEvent => e != null);
    if (judged.some((e) => e.outcome === "wentLow")) continue;
    const last = judged.slice(0, LAST_TIMES);
    const high = last.filter((e) => e.outcome === "stayedHigh");
    if (high.length < MIN_STAYED_HIGH) continue;
    const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100;
    out.push({
      foodName: g[0]!.foodName,
      events: last,
      stayedHigh: high.length,
      avgLater: Math.round(avg(high.map((e) => e.laterBg))),
      avgCarbs: Math.round(avg(high.map((e) => e.carbs))),
      avgMealUnits: avg(high.map((e) => e.mealUnits)),
      avgExtraUnits: avg(high.map((e) => e.extra.reduce((s, x) => s + x.units, 0))),
      lastAt: high[0]!.at,
    });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * The meals worth judging: from the lookback window, only meals eaten at least twice (so a backend
 * can load sensor data for just these). Newest first, at most `cap`.
 */
export function candidateFoods(foods: HighFood[], nowMs: number, cap = 60): HighFood[] {
  const since = nowMs - LOOKBACK_DAYS * 24 * 60 * MIN;
  const recent = foods
    .filter((f) => {
      const t = Date.parse(f.timestamp);
      return t >= since && t <= nowMs - 240 * MIN && mealWords(f.foodName).length > 0;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return recent.filter((f) => recent.some((o) => o !== f && sameMeal(o.foodName, f.foodName))).slice(0, cap);
}

/** The flagged pattern for the meal being dosed now, if any. */
export function patternFor(foodName: string, patterns: MealPattern[]): MealPattern | null {
  if (!foodName.trim()) return null;
  return patterns.find((p) => sameMeal(p.foodName, foodName) || p.events.some((e) => sameMeal(e.foodName, foodName))) ?? null;
}

/**
 * Whether to show the heads-up right now. Never while below target, dropping, or with a fair amount
 * of insulin still active (a bigger dose then could stack into a low).
 */
export function showHeadsUpNow(input: { bg: number | null; target: number; falling: boolean; activeUnits: number }): boolean {
  if (input.bg == null) return false;
  if (input.bg < input.target) return false;
  if (input.falling) return false;
  if (input.activeUnits >= 1) return false;
  return true;
}

/** "Pancakes kept Bella high last time, even with extra insulin" */
export function headsUpTitle(foodName: string, name: string | null): string {
  const who = name ? name : "you";
  const meal = foodName.trim().replace(/\s+/g, " ");
  const short = meal.length > 40 ? `${meal.slice(0, 38).trimEnd()}...` : meal;
  return `${short.charAt(0).toUpperCase()}${short.slice(1)} kept ${who} high last time, even with extra insulin`;
}

/** "2 of the last 3 times, she was still over 250 four hours later." */
export function headsUpBody(p: MealPattern, high: number, name: string | null): string {
  const times = p.stayedHigh === p.events.length ? `The last ${p.events.length} times` : `${p.stayedHigh} of the last ${p.events.length} times`;
  const who = name ? `${name} was` : "you were";
  return `${times}, ${who} still over ${high} three to four hours after eating, even after more insulin. This meal may need a higher dose up front.`;
}

/** Breakfast / Lunch / Dinner / Overnight from a local hour. */
export function mealTimeOfDay(localHour: number): "Breakfast" | "Lunch" | "Dinner" | "Overnight" {
  if (localHour >= 5 && localHour < 10) return "Breakfast";
  if (localHour >= 10 && localHour < 15) return "Lunch";
  if (localHour >= 15 && localHour < 21) return "Dinner";
  return "Overnight";
}
