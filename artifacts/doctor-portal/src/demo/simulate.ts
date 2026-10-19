import type { CGMReading, FoodLogEntry, InsulinLogEntry } from "@doctor-portal/api-client-react";
import type { DemoFood, DemoPerson, MealSlot } from "./people";

/**
 * Simulated CGM, meals and insulin for the demo patients. Glucose is computed for any moment from
 * the day's events — meals (absorbed over ~2–4 h), insulin (acting over ~4–5 h), activity, the
 * dawn rise and a smooth wobble — so it always runs up to "now" and every view agrees with the
 * logs. Each day's events come from a random generator seeded by patient + date, so they're the
 * same on every load.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const READING_MS = 5 * MIN;
/** Days of history the demo has (older windows come back empty). */
export const DEMO_HISTORY_DAYS = 120;

// ─── deterministic randomness ────────────────────────────────────────────────────────────────

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── local-time days ─────────────────────────────────────────────────────────────────────────

export function dayStartOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function shiftDay(dayStart: number, by: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + by);
  return d.getTime();
}

function atHour(dayStart: number, hours: number): number {
  const d = new Date(dayStart);
  const h = Math.floor(hours);
  d.setHours(h, Math.round((hours - h) * 60), 0, 0);
  return d.getTime();
}

function dayKey(dayStart: number): string {
  const d = new Date(dayStart);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const historyStart = () => dayStartOf(Date.now() - DEMO_HISTORY_DAYS * DAY);

// ─── a day's events ──────────────────────────────────────────────────────────────────────────

export interface SimMeal {
  id: string;
  t: number;
  slot: MealSlot;
  food: DemoFood;
  carbs: number;
  fromPhoto: boolean;
  author: string;
  /** Share of the carbs that raise glucose (type 2: the body covers some; <1 also when the dose overshoots). */
  share: number;
  /** Mealtime dose taken for it (0 when none). */
  units: number;
}

export interface SimDose {
  id: string;
  t: number;
  units: number;
  type: "bolus" | "correction" | "basal";
  insulinType: string;
  foodLogId?: string;
  recommended?: number;
  adjusted: boolean;
  author: string;
  note?: string;
  /** Fades with this earlier moment (the meal a late correction answers). */
  settleFrom?: number;
}

interface SimActivity {
  start: number;
  end: number;
  drop: number;
}

interface DayPlan {
  meals: SimMeal[];
  doses: SimDose[];
  activities: SimActivity[];
}

const SLOT_SETTING: Record<MealSlot, string> = {
  breakfast: "breakfast",
  lunch: "lunch",
  snack: "lunch",
  dinner: "dinner",
  bedtime: "night",
};

function carbRatioFor(person: DemoPerson, slot: MealSlot): number {
  return person.doseSettingsByTime?.[SLOT_SETTING[slot]]?.carbRatio ?? person.carbRatio;
}

const roundHalf = (u: number) => Math.round(u * 2) / 2;

const plans = new Map<string, DayPlan>();

function planDay(person: DemoPerson, dayStart: number): DayPlan {
  const key = `${person.code}:${dayKey(dayStart)}`;
  const cached = plans.get(key);
  if (cached) return cached;
  const plan: DayPlan = { meals: [], doses: [], activities: [] };
  plans.set(key, plan);

  const r = seeded(hash(key));
  const dow = new Date(dayStart).getDay();
  const weekend = dow === 0 || dow === 6;
  const prev = dayStart > historyStart() ? planDay(person, shiftDay(dayStart, -1)) : null;
  const sofar = () => (prev ? [prev, plan] : [plan]);

  for (const a of person.activities ?? []) {
    if (!a.days.includes(dow) || r() > (a.chance ?? 1)) continue;
    const start = atHour(dayStart, a.at + (r() - 0.5) * 0.25);
    plan.activities.push({ start, end: start + a.hours * HOUR, drop: a.drop * (0.8 + r() * 0.4) });
  }

  plan.doses.push({
    id: `${key}:basal`,
    t: atHour(dayStart, person.basal.hour + (r() - 0.5) * 0.5),
    units: person.basal.units,
    type: "basal",
    insulinType: person.basal.insulin,
    adjusted: false,
    author: person.basal.loggedBy,
  });

  for (const mp of person.meals) {
    if ((mp.days === "weekdays" && weekend) || (mp.days === "weekends" && !weekend)) continue;
    if (r() > (mp.chance ?? 1)) continue;
    const t = atHour(dayStart, mp.at[0] + r() * (mp.at[1] - mp.at[0]));
    const special = mp.special?.day === dow ? mp.special : null;
    const food = special?.food ?? mp.foods[Math.floor(r() * mp.foods.length)]!;
    const carbs = special?.carbs ?? Math.round(mp.carbs[0] + r() * (mp.carbs[1] - mp.carbs[0]));
    const author = weekend ? mp.loggedBy.weekend : mp.loggedBy.weekday;
    const id = `${key}:${mp.slot}`;
    const meal: SimMeal = {
      id,
      t,
      slot: mp.slot,
      food,
      carbs,
      fromPhoto: r() < 0.4,
      author,
      share: (mp.noBolus ? 1 - (person.ownInsulin ?? 0) : 1) * (mp.insulinNeed ?? 1),
      units: 0,
    };
    plan.meals.push(meal);
    if (mp.noBolus) continue;

    const h = person.habits;
    if (r() < h.missBolus) {
      // No dose with the meal; noticed when glucose climbs, then corrected.
      plan.doses.push({
        id: `${id}:fix`,
        t: t + (2 + r()) * HOUR,
        units: roundHalf((carbs / person.carbRatio) * (0.4 + r() * 0.2)),
        type: "correction",
        insulinType: person.rapid,
        adjusted: false,
        author,
        note: "Correction: high after a missed meal dose",
        settleFrom: t,
      });
      continue;
    }
    const before = rawGlucose(person, t, sofar());
    const correction =
      before > person.targetGlucose + 70 ? (0.5 * (before - person.targetGlucose)) / person.correctionFactor : 0;
    const recommended = Math.round((carbs / carbRatioFor(person, mp.slot) + correction) * 10) / 10;
    let units = recommended;
    const b = r();
    if (b < h.overBolus) units *= 1.3;
    else if (b < h.overBolus + h.underBolus) units *= 0.7;
    if (r() < h.adjusts) units += r() < 0.5 ? -0.5 : 0.5;
    units = Math.max(0.5, roundHalf(units));
    meal.units = units;
    const late = r() < h.lateBolus;
    plan.doses.push({
      id: `${id}:dose`,
      t: late ? t + (20 + r() * 40) * MIN : t - r() * 12 * MIN,
      units,
      type: "bolus",
      insulinType: person.rapid,
      foodLogId: id,
      recommended,
      adjusted: units !== roundHalf(recommended),
      author,
    });
  }

  // Type 2: a mid-morning check, corrected when well above target.
  if (person.ownInsulin) {
    const t = atHour(dayStart, 10.5 + r() * 0.5);
    const g = rawGlucose(person, t, sofar());
    if (g > 210) {
      plan.doses.push({
        id: `${key}:morning-fix`,
        t,
        units: roundHalf((0.5 * (g - person.targetGlucose)) / person.correctionFactor),
        type: "correction",
        insulinType: person.rapid,
        adjusted: false,
        author: person.basal.loggedBy,
        note: "Morning correction",
      });
    }
  }
  return plan;
}

// ─── glucose ─────────────────────────────────────────────────────────────────────────────────

const ABSORB_MIN = { fast: 20, medium: 38, slow: 60 } as const;
const INSULIN_MIN = 66;

/** Cumulative share absorbed after `m` minutes (gamma, shape 2). */
const absorbed = (m: number, tau: number) => 1 - (1 + m / tau) * Math.exp(-m / tau);
/** Effects fade after ~5 h, so an uncovered meal (or a big correction) doesn't linger for days. */
const settle = (m: number) => (m <= 300 ? 1 : Math.exp(-(m - 300) / 180));

function rawGlucose(person: DemoPerson, t: number, days: DayPlan[]): number {
  const m0 = t / MIN;
  const seed = hash(person.code);
  const p1 = ((seed % 997) / 997) * 2 * Math.PI;
  const p2 = (((seed >>> 10) % 991) / 991) * 2 * Math.PI;
  const p3 = (((seed >>> 20) % 983) / 983) * 2 * Math.PI;
  const wobble =
    person.noise *
    (0.55 * Math.sin((2 * Math.PI * m0) / 97 + p1) +
      0.3 * Math.sin((2 * Math.PI * m0) / 233 + p2) +
      0.15 * Math.sin((2 * Math.PI * m0) / 611 + p3));
  const d = new Date(t);
  const hour = d.getHours() + d.getMinutes() / 60;
  let g = person.base + wobble + person.dawn * Math.exp(-(((hour - 6.3) / 1.6) ** 2));

  for (const day of days) {
    for (const meal of day.meals) {
      if (meal.t > t) continue;
      const m = (t - meal.t) / MIN;
      const rise = (person.correctionFactor / carbRatioFor(person, meal.slot)) * meal.carbs * meal.share;
      g += rise * absorbed(m, ABSORB_MIN[meal.food.absorption]) * settle(m);
    }
    for (const dose of day.doses) {
      if (dose.t > t || dose.type === "basal") continue;
      const m = (t - dose.t) / MIN;
      g -= dose.units * person.correctionFactor * absorbed(m, INSULIN_MIN) * settle((t - (dose.settleFrom ?? dose.t)) / MIN);
    }
    for (const a of day.activities) {
      if (t <= a.start) continue;
      const ramp = Math.min(1, (Math.min(t, a.end) - a.start) / (40 * MIN));
      const after = t > a.end ? Math.exp(-(t - a.end) / (100 * MIN)) : 1;
      g -= a.drop * ramp * after;
    }
  }
  return g;
}

export function glucoseAt(person: DemoPerson, t: number): number {
  const today = dayStartOf(t);
  const g = rawGlucose(person, t, [planDay(person, shiftDay(today, -1)), planDay(person, today)]);
  const jitter = (hash(`${person.code}:${Math.floor(t / READING_MS)}`) % 5) - 2;
  return Math.max(40, Math.min(400, Math.round(g + jitter)));
}

function trendFor(perMinute: number): string {
  if (perMinute >= 3) return "DoubleUp";
  if (perMinute >= 2) return "SingleUp";
  if (perMinute >= 1) return "FortyFiveUp";
  if (perMinute > -1) return "Flat";
  if (perMinute > -2) return "FortyFiveDown";
  if (perMinute > -3) return "SingleDown";
  return "DoubleDown";
}

/** CGM readings every 5 minutes in [from, to], never past now. */
export function readingsBetween(person: DemoPerson, fromMs: number, toMs: number): CGMReading[] {
  const offset = (hash(person.code) % 300) * 1000;
  const end = Math.min(toMs, Date.now());
  let t = Math.ceil((Math.max(fromMs, historyStart()) - offset) / READING_MS) * READING_MS + offset;
  const out: CGMReading[] = [];
  for (; t <= end; t += READING_MS) {
    const value = glucoseAt(person, t);
    const trend = trendFor((value - glucoseAt(person, t - 15 * MIN)) / 15);
    out.push({ value, trend, timestamp: new Date(t).toISOString() });
  }
  return out;
}

// ─── logs ────────────────────────────────────────────────────────────────────────────────────

export type DemoFoodEntry = FoodLogEntry & { hasPhoto: boolean };

export function mealById(person: DemoPerson, id: string): SimMeal | undefined {
  const [, date] = id.split(":");
  if (!date) return undefined;
  const [y, mo, d] = date.split("-").map(Number);
  const plan = planDay(person, new Date(y!, mo! - 1, d!).getTime());
  return plan.meals.find((m) => m.id === id);
}

/** Food and insulin logged in [from, to] (never past now), newest first. */
export function logsBetween(
  person: DemoPerson,
  fromMs: number,
  toMs: number,
): { food: DemoFoodEntry[]; insulin: InsulinLogEntry[] } {
  const now = Date.now();
  const start = Math.max(fromMs, historyStart());
  const end = Math.min(toMs, now);
  const food: DemoFoodEntry[] = [];
  const insulin: InsulinLogEntry[] = [];
  for (let day = dayStartOf(start); day <= end; day = shiftDay(day, 1)) {
    const plan = planDay(person, day);
    for (const m of plan.meals) {
      if (m.t < start || m.t > end) continue;
      food.push({
        id: m.id,
        timestamp: new Date(m.t).toISOString(),
        foodName: m.food.name,
        estimatedCarbs: m.carbs,
        insulinUnits: m.units,
        confidence: m.fromPhoto && m.carbs > 60 ? "medium" : "high",
        fromPhoto: m.fromPhoto,
        fatGrams: m.food.fat,
        proteinGrams: m.food.protein,
        absorption: m.food.absorption,
        authorName: m.author,
        hasPhoto: m.fromPhoto,
      });
    }
    for (const d of plan.doses) {
      if (d.t < start || d.t > end) continue;
      insulin.push({
        id: d.id,
        timestamp: new Date(d.t).toISOString(),
        units: d.units,
        type: d.type,
        ...(d.note ? { note: d.note } : {}),
        ...(d.foodLogId ? { foodLogId: d.foodLogId } : {}),
        insulinType: d.insulinType,
        ...(d.recommended != null ? { recommendedUnits: d.recommended } : {}),
        ...(d.adjusted ? { manualOverride: true } : {}),
        authorName: d.author,
      });
    }
  }
  const newestFirst = (a: { timestamp: string }, b: { timestamp: string }) => b.timestamp.localeCompare(a.timestamp);
  return { food: food.sort(newestFirst), insulin: insulin.sort(newestFirst) };
}

// ─── summaries (alerts, assistant) ───────────────────────────────────────────────────────────

/** Urgent lows (<55) and highs (>250) that started in the last `hours`. */
export function urgentEpisodes(person: DemoPerson, hours: number) {
  const readings = readingsBetween(person, Date.now() - hours * HOUR, Date.now());
  const out: { kind: "urgent_low" | "urgent_high"; t: number; value: number }[] = [];
  let state: "low" | "high" | null = null;
  for (const r of readings) {
    const next = r.value < 55 ? "low" : r.value > 250 ? "high" : null;
    if (next && next !== state) {
      out.push({ kind: next === "low" ? "urgent_low" : "urgent_high", t: Date.parse(r.timestamp), value: r.value });
    }
    state = next;
  }
  return out;
}

export function summarize(person: DemoPerson, days: number) {
  const now = Date.now();
  const readings = readingsBetween(person, now - days * DAY, now);
  const n = readings.length || 1;
  const values = readings.map((r) => r.value);
  const avg = values.reduce((a, v) => a + v, 0) / n;
  const pct = (test: (v: number) => boolean) => Math.round((values.filter(test).length / n) * 100);
  let lows = 0;
  let overnightLows = 0;
  let inLow = false;
  for (const r of readings) {
    const low = r.value < 70;
    if (low && !inLow) {
      lows++;
      if (new Date(r.timestamp).getHours() < 6) overnightLows++;
    }
    inLow = low;
  }
  return {
    days,
    avg: Math.round(avg),
    gmi: Math.round((3.31 + 0.02392 * avg) * 10) / 10,
    inRange: pct((v) => v >= 70 && v <= 180),
    below: pct((v) => v < 70),
    above: pct((v) => v > 180),
    lows,
    overnightLows,
  };
}
