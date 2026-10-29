/**
 * Visit Summary math: everything the doctor report shows, computed from raw readings and logs.
 * Pure (no React Native imports) so it is unit-tested; the PDF HTML lives in visitSummaryHtml.ts and
 * the screen in components/DoctorOfficePanel.tsx.
 *
 * Ranges follow the international consensus CGM targets doctors read on every AGP report:
 * very low < 54, low 54 to 69, in range 70 to 180, high 181 to 250, very high > 250 (mg/dL).
 * Nothing here feeds dose math. It only describes what already happened.
 */

export interface SummaryReading {
  glucose: number;
  timestamp: string;
}

export interface SummaryFood {
  timestamp: string;
  foodName: string;
  estimatedCarbs: number;
  insulinUnits: number;
  fromPhoto?: boolean;
  photoUri?: string;
}

export interface SummaryInsulin {
  timestamp: string;
  units: number;
  type: "bolus" | "correction" | "manual" | "basal";
  /** e.g. "Humalog · 100 u/mL" */
  insulinType?: string;
  note?: string;
}

export interface SummaryStick {
  timestamp: string;
  glucose: number;
  cgmGlucose?: number;
  reason?: string;
  note?: string;
}

export interface SummaryAccessLog {
  timestamp: string;
  action: string;
  actor: "owner" | "caregiver" | "doctor";
}

export const MINUTE = 60_000;
export const DAY_MS = 24 * 60 * MINUTE;

const sortByTime = <T extends { timestamp: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

export function inWindow(ts: string, startMs: number, endMs: number): boolean {
  const t = Date.parse(ts);
  return Number.isFinite(t) && t >= startMs && t < endMs;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ─── Glucose overview ──────────────────────────────────────────────────────────────────────────

export interface RangeBuckets {
  veryLow: number;
  low: number;
  inRange: number;
  high: number;
  veryHigh: number;
}

export interface GlucoseStats {
  count: number;
  mean: number;
  /** Coefficient of variation, percent. */
  cv: number;
  /** Glucose Management Indicator (estimated A1C), percent. */
  gmi: number;
  /** Percent of readings in each range; they add up to 100 (rounding aside). */
  pct: RangeBuckets;
}

export function bucketOf(g: number): keyof RangeBuckets {
  if (g < 54) return "veryLow";
  if (g < 70) return "low";
  if (g <= 180) return "inRange";
  if (g <= 250) return "high";
  return "veryHigh";
}

export function glucoseStats(readings: SummaryReading[]): GlucoseStats | null {
  const vals = readings.map((r) => r.glucose).filter((g) => Number.isFinite(g) && g > 0);
  if (vals.length === 0) return null;
  const n = vals.length;
  const mean = vals.reduce((s, g) => s + g, 0) / n;
  const sd = Math.sqrt(vals.reduce((s, g) => s + (g - mean) ** 2, 0) / n);
  const counts: RangeBuckets = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 };
  for (const g of vals) counts[bucketOf(g)]++;
  const pct = (c: number) => round1((c / n) * 100);
  return {
    count: n,
    mean: Math.round(mean),
    cv: Math.round((sd / mean) * 100),
    gmi: round1(3.31 + 0.02392 * mean),
    pct: {
      veryLow: pct(counts.veryLow),
      low: pct(counts.low),
      inRange: pct(counts.inRange),
      high: pct(counts.high),
      veryHigh: pct(counts.veryHigh),
    },
  };
}

/**
 * Percent of the window the sensor was reporting. Dexcom sends a reading every 5 minutes; FreeStyle
 * Libre (through LibreLinkUp) every 15, so a Libre wearer isn't shown a third of their real wear.
 */
export function sensorWearPercent(count: number, startMs: number, endMs: number, minutesPerReading = 5): number {
  const expected = (endMs - startMs) / (minutesPerReading * MINUTE);
  if (expected <= 0) return 0;
  return Math.min(100, Math.round((count / expected) * 100));
}

// ─── Daily pattern (AGP-style percentiles by hour of day) ─────────────────────────────────────

export interface PatternPoint {
  hour: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * 24 hourly points (local time). Each hour pools its neighbors (a 3-hour window) so the bands read
 * as a smooth daily shape instead of jagged hour-to-hour noise. Hours with too little data are left
 * out; returns [] when there isn't enough for a meaningful picture.
 */
export function dailyPattern(readings: SummaryReading[]): PatternPoint[] {
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  for (const r of readings) {
    const d = new Date(r.timestamp);
    if (!Number.isFinite(d.getTime())) continue;
    byHour[d.getHours()]!.push(r.glucose);
  }
  const out: PatternPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const pool = [...byHour[(h + 23) % 24]!, ...byHour[h]!, ...byHour[(h + 1) % 24]!].sort((a, b) => a - b);
    if (pool.length < 6) continue;
    out.push({
      hour: h,
      p5: Math.round(percentile(pool, 0.05)),
      p25: Math.round(percentile(pool, 0.25)),
      p50: Math.round(percentile(pool, 0.5)),
      p75: Math.round(percentile(pool, 0.75)),
      p95: Math.round(percentile(pool, 0.95)),
    });
  }
  return out.length >= 12 ? out : [];
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2:48 AM" (local). */
export function fmtTime(ts: string | number): string {
  const d = new Date(ts);
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Oct 21" (local). */
export function fmtDay(ts: string | number): string {
  const d = new Date(ts);
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

/** "Wed Oct 21" (local). */
export function fmtWeekday(ts: string | number): string {
  return `${DOW[new Date(ts).getDay()]} ${fmtDay(ts)}`;
}

/** "Oct 8 to Oct 21, 2026": the window's first and LAST day (end is exclusive). */
export function fmtRange(startMs: number, endMs: number): string {
  const last = endMs - 1;
  return `${fmtDay(startMs)} to ${fmtDay(last)}, ${new Date(last).getFullYear()}`;
}

// ─── Lows ──────────────────────────────────────────────────────────────────────────────────────

export interface LowEpisode {
  start: string;
  /** Last reading under 70 in the run. */
  end: string;
  nadir: number;
  nadirAt: string;
}

/**
 * A low is a run of readings under 70 with no gap over 20 minutes. One stray reading only counts
 * when it is under 54, so a single sensor dip doesn't read as an event.
 */
export function lowEpisodes(readings: SummaryReading[]): LowEpisode[] {
  const sorted = sortByTime(readings);
  const out: LowEpisode[] = [];
  let run: SummaryReading[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const nadir = run.reduce((m, r) => (r.glucose < m.glucose ? r : m), run[0]!);
    if (run.length >= 2 || nadir.glucose < 54) out.push({ start: run[0]!.timestamp, end: run[run.length - 1]!.timestamp, nadir: nadir.glucose, nadirAt: nadir.timestamp });
    run = [];
  };
  for (const r of sorted) {
    if (r.glucose < 70) {
      const last = run[run.length - 1];
      if (last && Date.parse(r.timestamp) - Date.parse(last.timestamp) > 20 * MINUTE) flush();
      run.push(r);
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/** "2 AM", "12 PM", "12 AM". */
export function hourLabel(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const n = hh % 12 === 0 ? 12 : hh % 12;
  return `${n} ${hh < 12 ? "AM" : "PM"}`;
}

/** "between 2 and 4 AM" / "between 10 PM and 12 AM". */
function windowPhrase(startHour: number): string {
  const a = hourLabel(startHour);
  const b = hourLabel(startHour + 2);
  const sameHalf = a.slice(-2) === b.slice(-2);
  return sameHalf ? `between ${a.slice(0, -3)} and ${b}` : `between ${a} and ${b}`;
}

/** "between 2 and 4 AM" when most lows began in one 2-hour window (an even hour start), else null. */
export function lowWindow(episodes: LowEpisode[]): string | null {
  const w = bestLowWindow(episodes);
  return w ? windowPhrase(w.start) : null;
}

function bestLowWindow(episodes: LowEpisode[]): { start: number; count: number } | null {
  if (episodes.length < 2) return null;
  const counts = new Map<number, number>();
  for (const e of episodes) {
    const h = new Date(e.start).getHours();
    const w = h - (h % 2);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let best = -1;
  let bestCount = 0;
  for (const [w, c] of counts) if (c > bestCount || (c === bestCount && w < best)) [best, bestCount] = [w, c];
  if (bestCount < 2 || bestCount * 2 < episodes.length) return null;
  return { start: best, count: bestCount };
}

/** "4 of 6 lows started between 2 and 4 AM." when there's a real pattern. */
export function lowPattern(episodes: LowEpisode[]): string | null {
  const w = bestLowWindow(episodes);
  return w ? `${w.count} of ${episodes.length} lows started ${windowPhrase(w.start)}.` : null;
}

/** Overnight = midnight to 6 AM local. */
export function isOvernight(ts: string): boolean {
  return new Date(ts).getHours() < 6;
}

export function peakPhrase(pattern: PatternPoint[]): string | null {
  if (pattern.length === 0) return null;
  const top = pattern.reduce((m, p) => (p.p50 > m.p50 ? p : m), pattern[0]!);
  if (top.p50 <= 180) return null;
  return `Glucose runs highest around ${hourLabel(top.hour)} (typical ${top.p50} mg/dL).`;
}

// ─── Meals ─────────────────────────────────────────────────────────────────────────────────────

export interface MealRow {
  timestamp: string;
  foodName: string;
  carbs: number;
  insulin: number;
  fromPhoto: boolean;
  photoUri?: string;
  before: number | null;
  after: number | null;
  change: number | null;
}

function closestReading(sorted: SummaryReading[], targetMs: number, fromMs: number, toMs: number): SummaryReading | null {
  let best: SummaryReading | null = null;
  let bestDist = Infinity;
  for (const r of sorted) {
    const t = Date.parse(r.timestamp);
    if (t < fromMs) continue;
    if (t > toMs) break;
    const d = Math.abs(t - targetMs);
    if (d < bestDist) [best, bestDist] = [r, d];
  }
  return best;
}

/**
 * Each meal with its glucose just before eating (20 min before to 5 min after the log) and about
 * 2 hours later (the reading closest to +2 h, within 15 minutes). Newest first.
 */
export function mealRows(food: SummaryFood[], readings: SummaryReading[]): MealRow[] {
  const sorted = sortByTime(readings);
  return [...food]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .map((f) => {
      const t = Date.parse(f.timestamp);
      const b = closestReading(sorted, t, t - 20 * MINUTE, t + 5 * MINUTE);
      const a = closestReading(sorted, t + 120 * MINUTE, t + 105 * MINUTE, t + 135 * MINUTE);
      return {
        timestamp: f.timestamp,
        foodName: f.foodName,
        carbs: f.estimatedCarbs,
        insulin: f.insulinUnits,
        fromPhoto: !!f.fromPhoto,
        photoUri: f.photoUri,
        before: b?.glucose ?? null,
        after: a?.glucose ?? null,
        change: b && a ? a.glucose - b.glucose : null,
      };
    });
}

export function biggestRises(rows: MealRow[], n = 3): MealRow[] {
  return rows
    .filter((r) => r.change != null && r.change > 0)
    .sort((a, b) => (b.change ?? 0) - (a.change ?? 0))
    .slice(0, n);
}

export interface FoodGroup {
  name: string;
  times: number;
  avgCarbs: number;
  /** Average rise 2 hours after, over the times it could be measured. */
  avgChange: number | null;
}

/** Foods eaten more than once, most frequent first. Used instead of every meal on long reports. */
export function foodGroups(rows: MealRow[], limit = 15): FoodGroup[] {
  const map = new Map<string, { name: string; rows: MealRow[] }>();
  for (const r of rows) {
    const key = r.foodName.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    const g = map.get(key) ?? { name: r.foodName.trim(), rows: [] };
    g.rows.push(r);
    map.set(key, g);
  }
  return [...map.values()]
    .filter((g) => g.rows.length >= 2)
    .map((g) => {
      const changes = g.rows.map((r) => r.change).filter((c): c is number => c != null);
      return {
        name: g.name,
        times: g.rows.length,
        avgCarbs: Math.round(g.rows.reduce((s, r) => s + r.carbs, 0) / g.rows.length),
        avgChange: changes.length ? Math.round(changes.reduce((s, c) => s + c, 0) / changes.length) : null,
      };
    })
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ─── Per day ───────────────────────────────────────────────────────────────────────────────────

/** Local midnight for the day containing `ms`. */
export function localDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local day starts covering [startMs, endMs), oldest first. */
export function daysInWindow(startMs: number, endMs: number): number[] {
  const out: number[] = [];
  let d = localDayStart(startMs);
  while (d < endMs) {
    out.push(d);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    d = next.getTime();
  }
  return out;
}

export interface DayRow {
  dayStart: number;
  /** Percent low (incl. very low), in range, high (incl. very high); null when no readings. */
  low: number | null;
  inRange: number | null;
  high: number | null;
  carbs: number;
  insulin: number;
}

export function dayRows(startMs: number, endMs: number, readings: SummaryReading[], food: SummaryFood[], insulin: SummaryInsulin[]): DayRow[] {
  const days = daysInWindow(startMs, endMs);
  const idx = new Map(days.map((d, i) => [localDayKey(d), i]));
  const acc = days.map((d) => ({ dayStart: d, n: 0, low: 0, inR: 0, high: 0, carbs: 0, insulin: 0 }));
  const at = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? idx.get(localDayKey(t)) : undefined;
  };
  for (const r of readings) {
    const i = at(r.timestamp);
    if (i == null) continue;
    const a = acc[i]!;
    a.n++;
    const b = bucketOf(r.glucose);
    if (b === "veryLow" || b === "low") a.low++;
    else if (b === "inRange") a.inR++;
    else a.high++;
  }
  for (const f of food) {
    const i = at(f.timestamp);
    if (i != null) acc[i]!.carbs += f.estimatedCarbs;
  }
  for (const e of insulin) {
    const i = at(e.timestamp);
    if (i != null) acc[i]!.insulin += e.units;
  }
  return acc.map((a) => ({
    dayStart: a.dayStart,
    low: a.n ? Math.round((a.low / a.n) * 100) : null,
    inRange: a.n ? Math.round((a.inR / a.n) * 100) : null,
    high: a.n ? Math.round((a.high / a.n) * 100) : null,
    carbs: Math.round(a.carbs),
    insulin: round1(a.insulin),
  }));
}

// ─── Insulin and food averages ────────────────────────────────────────────────────────────────

export interface CareAverages {
  /** Days that had at least one insulin log; insulin averages are per logged day. */
  insulinDays: number;
  totalInsulin: number | null;
  /** Rapid-acting doses (meals and corrections from the calculator, plus manual logs). */
  bolusPerDay: number | null;
  bolusDosesPerDay: number | null;
  /** Only when basal doses were logged. */
  basalPerDay: number | null;
  foodDays: number;
  carbsPerDay: number | null;
  foodsPerDay: number | null;
}

export function careAverages(food: SummaryFood[], insulin: SummaryInsulin[]): CareAverages {
  const insDays = new Set(insulin.map((e) => localDayKey(Date.parse(e.timestamp))));
  const foodDays = new Set(food.map((f) => localDayKey(Date.parse(f.timestamp))));
  const nI = insDays.size;
  const nF = foodDays.size;
  const sum = (rows: SummaryInsulin[]) => rows.reduce((s, e) => s + e.units, 0);
  const basal = insulin.filter((e) => e.type === "basal");
  const bolus = insulin.filter((e) => e.type !== "basal");
  return {
    insulinDays: nI,
    totalInsulin: nI ? round1(sum(insulin) / nI) : null,
    bolusPerDay: nI ? round1(sum(bolus) / nI) : null,
    bolusDosesPerDay: nI ? round1(bolus.length / nI) : null,
    basalPerDay: nI && basal.length ? round1(sum(basal) / nI) : null,
    foodDays: nF,
    carbsPerDay: nF ? Math.round(food.reduce((s, f) => s + f.estimatedCarbs, 0) / nF) : null,
    foodsPerDay: nF ? round1(food.length / nF) : null,
  };
}

/** Share of meals (with a 2-hour reading) that were over 180 two hours later, percent. */
export function mealsOver180(rows: MealRow[]): number | null {
  const measured = rows.filter((r) => r.after != null);
  if (measured.length === 0) return null;
  return Math.round((measured.filter((r) => (r.after ?? 0) > 180).length / measured.length) * 100);
}

// ─── Finger sticks ─────────────────────────────────────────────────────────────────────────────

export function fingerStickSummary(sticks: SummaryStick[]): { checks: number; avgDiff: number | null } {
  const paired = sticks.filter((s) => s.cgmGlucose != null && Number.isFinite(s.cgmGlucose));
  return {
    checks: sticks.length,
    avgDiff: paired.length
      ? Math.round(paired.reduce((s, p) => s + Math.abs(p.glucose - (p.cgmGlucose as number)), 0) / paired.length)
      : null,
  };
}

// ─── Dose settings changes (from the profile's change history) ────────────────────────────────

export interface DoseChange {
  timestamp: string;
  what: "Carb ratio" | "Correction factor" | "Target";
  from: string;
  to: string;
  by: string;
}

const DOSE_RE =
  /^Dose settings changed \(([^)]*)\): CR (\S+) · Target (\S+) · ISF (\S+) → CR (\S+) · Target (\S+) · ISF (\S+)/;

const SOURCE_LABEL: Record<string, string> = {
  dashboard: "family, in the app",
  "treatment-proposal": "doctor's proposal",
  onboarding: "setup",
};

/** Every carb ratio / correction / target change logged inside the window, oldest first. */
export function doseChanges(log: SummaryAccessLog[], startMs: number, endMs: number): DoseChange[] {
  const out: DoseChange[] = [];
  for (const e of sortByTime(log)) {
    if (!inWindow(e.timestamp, startMs, endMs)) continue;
    const m = DOSE_RE.exec(e.action);
    if (!m) continue;
    const [, source, cr0, tg0, isf0, cr1, tg1, isf1] = m;
    const by = source!.startsWith("doctor") ? "doctor" : SOURCE_LABEL[source!] ?? (e.actor === "doctor" ? "doctor" : "family");
    if (cr0 !== cr1) out.push({ timestamp: e.timestamp, what: "Carb ratio", from: `1:${cr0}`, to: `1:${cr1}`, by });
    if (isf0 !== isf1) out.push({ timestamp: e.timestamp, what: "Correction factor", from: `1:${isf0}`, to: `1:${isf1}`, by });
    if (tg0 !== tg1) out.push({ timestamp: e.timestamp, what: "Target", from: `${tg0}`, to: `${tg1}`, by });
  }
  return out;
}

// ─── The whole report ──────────────────────────────────────────────────────────────────────────

export interface VisitSummaryData {
  startMs: number;
  /** Readings inside the window, oldest first (for the per-meal and per-day graphs). */
  readings: SummaryReading[];
  /** Insulin doses and finger sticks inside the window, newest first (for their log sections). */
  insulinRows: SummaryInsulin[];
  stickRows: SummaryStick[];
  endMs: number;
  days: number;
  stats: GlucoseStats | null;
  sensorWear: number;
  pattern: PatternPoint[];
  lows: LowEpisode[];
  lowPattern: string | null;
  peak: string | null;
  meals: MealRow[];
  rises: MealRow[];
  groups: FoodGroup[];
  over180: number | null;
  perDay: DayRow[];
  care: CareAverages;
  sticks: { checks: number; avgDiff: number | null };
  changes: DoseChange[];
}

export function buildVisitSummary(input: {
  days: number;
  endMs: number;
  readings: SummaryReading[];
  food: SummaryFood[];
  insulin: SummaryInsulin[];
  sticks: SummaryStick[];
  accessLog: SummaryAccessLog[];
  /** The connected CGM ("dexcom" / "libre"); sets the expected reading interval for sensor wear. */
  provider?: string | null;
}): VisitSummaryData {
  const endMs = input.endMs;
  const startMs = endMs - input.days * DAY_MS;
  const w = <T extends { timestamp: string }>(rows: T[]) => rows.filter((r) => inWindow(r.timestamp, startMs, endMs));
  const readings = w(input.readings);
  const food = w(input.food);
  const insulin = w(input.insulin);
  const pattern = dailyPattern(readings);
  const lows = lowEpisodes(readings);
  const meals = mealRows(food, readings);
  return {
    startMs,
    readings: sortByTime(readings),
    endMs,
    days: input.days,
    stats: glucoseStats(readings),
    sensorWear: sensorWearPercent(readings.length, startMs, endMs, input.provider === "libre" ? 15 : 5),
    pattern,
    lows,
    lowPattern: lowPattern(lows),
    peak: peakPhrase(pattern),
    meals,
    rises: biggestRises(meals),
    groups: foodGroups(meals),
    over180: mealsOver180(meals),
    perDay: dayRows(startMs, endMs, readings, food, insulin),
    care: careAverages(food, insulin),
    sticks: fingerStickSummary(w(input.sticks)),
    insulinRows: [...insulin].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    stickRows: w(input.sticks).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)),
    changes: doseChanges(input.accessLog, startMs, endMs),
  };
}

/** Readings in [fromMs, toMs] from an oldest-first list (binary search, so long reports stay fast). */
export function readingsBetween(sorted: SummaryReading[], fromMs: number, toMs: number): SummaryReading[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(sorted[mid]!.timestamp) < fromMs) lo = mid + 1;
    else hi = mid;
  }
  const out: SummaryReading[] = [];
  for (let i = lo; i < sorted.length; i++) {
    if (Date.parse(sorted[i]!.timestamp) > toMs) break;
    out.push(sorted[i]!);
  }
  return out;
}
