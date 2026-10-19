import type {
  CGMReading,
  FoodLogEntry,
  InsulinLogEntry,
  PatientSnapshot,
} from "@doctor-portal/api-client-react";
import { glucoseStatus, zonesFromSnapshot, type GlucoseZones } from "./glucose-metrics";
import { readingAfter, readingBefore, type EventReading } from "./meal-glucose";
import { mealHasViewablePhoto } from "./meal-photo";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type DoseType = InsulinLogEntry["type"]; // "bolus" | "correction" | "manual" | "basal"
export type Direction = "up" | "down" | "stable";

export interface DayMeal {
  id: string;
  slot: MealSlot;
  timestamp: string;
  name: string;
  carbs: number;
  fatGrams: number | null;
  proteinGrams: number | null;
  absorption: "fast" | "medium" | "slow" | null;
  fromPhoto: boolean;
  /** A photo the portal can show (uploaded full-size, or the synced thumbnail). */
  hasPhoto: boolean;
  units: number | null;
  doseType: DoseType | null;
  insulinType: string | null;
  recommendedUnits: number | null;
  manualOverride: boolean;
  /** Care Circle member who logged the meal, and who logged the insulin for it. */
  mealBy: string | null;
  doseBy: string | null;
  /** Last reading before the meal and the reading nearest 2 h after — with when each was taken. */
  before: EventReading | null;
  after: EventReading | null;
  preGlucose: number | null;
  postGlucose: number | null;
  direction: Direction | null;
}

export interface DayEvent {
  id: string;
  timestamp: string;
  kind: "meal" | "correction" | "insulin";
  label: string;
  slot?: MealSlot;
  carbs: number | null;
  before: EventReading | null;
  after: EventReading | null;
  preGlucose: number | null;
  postGlucose: number | null;
  units: number | null;
  doseType: DoseType | null;
  insulinType: string | null;
  recommendedUnits: number | null;
  manualOverride: boolean;
  mealBy: string | null;
  doseBy: string | null;
  note: string;
  fromPhoto: boolean;
}

export interface DayMarker {
  ts: number;
  kind: "meal" | "correction" | "insulin";
  carbs: number | null;
  units: number | null;
}

export interface DaySummary {
  totalCarbs: number;
  totalInsulin: number;
  basal: number;
  bolus: number;
  correction: number;
  bolusCount: number;
  correctionCount: number;
  tir: number | null;
  avg: number | null;
  gmi: string | null;
  lastMeal: DayMeal | null;
  completeness: number;
  readingCount: number;
}

export interface DayFlag {
  id: string;
  title: string;
  detail: string;
  severity: "high" | "warning" | "info";
}

export interface DayPattern {
  id: string;
  title: string;
  detail: string;
  tone: "good" | "warn" | "info";
}

export interface DayRatios {
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
  targetLow?: number;
  targetHigh?: number;
}

export interface DayReview {
  key: string;
  date: Date;
  zones: GlucoseZones;
  readings: CGMReading[];
  meals: DayMeal[];
  events: DayEvent[];
  markers: DayMarker[];
  summary: DaySummary;
  flags: DayFlag[];
  patterns: DayPattern[];
  ratios: DayRatios;
  dayStartMs: number;
  dayEndMs: number;
}

export interface DayChip {
  key: string;
  date: Date;
  weekday: string;
  label: string;
  meals: number;
  insulin: number;
  hasHigh: boolean;
  hasData: boolean;
  hasNotes: boolean;
  isToday: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ms = (t: string) => new Date(t).getTime();
const MIN = 60 * 1000;

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function dayKeyOf(timestamp: string): string {
  return localDayKey(new Date(timestamp));
}

function startOfDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function slotForHour(h: number): MealSlot {
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

export const SLOT_LABEL: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function gmiFromAvg(avg: number): string {
  return (3.31 + 0.02392 * avg).toFixed(1);
}

function directionOf(pre: number | null, post: number | null): Direction | null {
  if (pre == null || post == null) return null;
  const d = post - pre;
  if (d > 15) return "up";
  if (d < -15) return "down";
  return "stable";
}

// ─── Calendar strip ──────────────────────────────────────────────────────────
// These run over the full history (months of 5-minute readings), so each is a single pass —
// no spreading large arrays into Math.max, no per-day rescans.

/** Latest timestamp (ms) across the given lists, or null when they are all empty. */
function latestMs(...lists: ({ timestamp: string }[] | undefined)[]): number | null {
  let max: number | null = null;
  for (const list of lists) {
    for (const x of list ?? []) {
      const t = ms(x.timestamp);
      if (max == null || t > max) max = t;
    }
  }
  return max;
}

export function defaultDayKey(s: PatientSnapshot): string {
  // Prefer the most recent day that has meals or insulin (the richest review), else latest data.
  const lastEvent = latestMs(s.foodLog, s.insulinLog);
  if (lastEvent != null) return localDayKey(new Date(lastEvent));
  return localDayKey(new Date(latestMs(s.glucoseReadings) ?? Date.now()));
}

interface DayCounts {
  meals: number;
  insulin: number;
  readings: number;
  hasHigh: boolean;
}

/** Per-day meal/insulin/reading counts in one pass over the snapshot. */
function indexDays(s: PatientSnapshot, zones: GlucoseZones): Map<string, DayCounts> {
  const days = new Map<string, DayCounts>();
  const at = (timestamp: string) => {
    const key = dayKeyOf(timestamp);
    let d = days.get(key);
    if (!d) {
      d = { meals: 0, insulin: 0, readings: 0, hasHigh: false };
      days.set(key, d);
    }
    return d;
  };
  for (const f of s.foodLog ?? []) at(f.timestamp).meals++;
  for (const l of s.insulinLog ?? []) at(l.timestamp).insulin++;
  for (const r of s.glucoseReadings ?? []) {
    const d = at(r.timestamp);
    d.readings++;
    if (r.value >= zones.urgentHigh) d.hasHigh = true;
  }
  return days;
}

function chipFor(counts: DayCounts | undefined, key: string, todayKey: string): DayChip {
  const date = startOfDay(key);
  const meals = counts?.meals ?? 0;
  const insulin = counts?.insulin ?? 0;
  return {
    key,
    date,
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    meals,
    insulin,
    hasHigh: counts?.hasHigh ?? false,
    hasData: meals > 0 || insulin > 0 || (counts?.readings ?? 0) > 0,
    hasNotes: false,
    isToday: key === todayKey,
  };
}

/** Move a day key by `delta` days, handling month/year boundaries. */
export function shiftDayKey(key: string, delta: number): string {
  const d = startOfDay(key);
  d.setDate(d.getDate() + delta);
  return localDayKey(d);
}

/** Earliest and latest local day keys present in the snapshot. */
export function dayKeyBounds(s: PatientSnapshot): { earliest: string; latest: string } {
  let min: number | null = null;
  let max: number | null = null;
  for (const list of [s.glucoseReadings, s.insulinLog, s.foodLog]) {
    for (const x of list ?? []) {
      const t = ms(x.timestamp);
      if (min == null || t < min) min = t;
      if (max == null || t > max) max = t;
    }
  }
  if (min == null || max == null) {
    const t = localDayKey(new Date());
    return { earliest: t, latest: t };
  }
  return { earliest: localDayKey(new Date(min)), latest: localDayKey(new Date(max)) };
}

/** Set of day keys that have any data — used to dot days in the date picker. */
export function dataDayKeySet(s: PatientSnapshot): Set<string> {
  const set = new Set<string>();
  const add = (arr?: { timestamp: string }[]) => arr?.forEach((x) => set.add(dayKeyOf(x.timestamp)));
  add(s.glucoseReadings);
  add(s.insulinLog);
  add(s.foodLog);
  return set;
}

/** Calendar chips for every day in [startKey, endKey] (inclusive). */
export function buildDayChips(s: PatientSnapshot, startKey: string, endKey: string): DayChip[] {
  const days = indexDays(s, zonesFromSnapshot(s));
  const todayKey = localDayKey(new Date());
  const chips: DayChip[] = [];
  let key = startKey;
  let guard = 0;
  while (key <= endKey && guard < 366) {
    chips.push(chipFor(days.get(key), key, todayKey));
    key = shiftDayKey(key, 1);
    guard++;
  }
  return chips;
}

// ─── Day review ──────────────────────────────────────────────────────────────

export function buildDayReview(s: PatientSnapshot, key: string): DayReview {
  const zones = zonesFromSnapshot(s);
  const dayStart = startOfDay(key);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * MIN;

  const allReadings = s.glucoseReadings ?? [];
  const readings = [...allReadings]
    .filter((r) => dayKeyOf(r.timestamp) === key)
    .sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  const foods = [...(s.foodLog ?? [])]
    .filter((f) => dayKeyOf(f.timestamp) === key)
    .sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  const insulin = [...(s.insulinLog ?? [])]
    .filter((l) => dayKeyOf(l.timestamp) === key)
    .sort((a, b) => ms(a.timestamp) - ms(b.timestamp));

  const usedInsulinIds = new Set<string>();
  const insulinForFood = (food: FoodLogEntry): InsulinLogEntry | null => {
    const linked = insulin.find((l) => l.foodLogId === food.id && !usedInsulinIds.has(l.id));
    if (linked) return linked;
    // Fall back to a bolus within 25 min of the meal.
    let best: InsulinLogEntry | null = null;
    let bestGap = Infinity;
    for (const l of insulin) {
      if (usedInsulinIds.has(l.id) || l.type === "correction" || l.type === "basal") continue;
      const gap = Math.abs(ms(l.timestamp) - ms(food.timestamp));
      if (gap <= 25 * MIN && gap < bestGap) {
        best = l;
        bestGap = gap;
      }
    }
    return best;
  };

  const meals: DayMeal[] = foods.map((food) => {
    const dose = insulinForFood(food);
    if (dose) usedInsulinIds.add(dose.id);
    const t = ms(food.timestamp);
    // Look across the whole history so a late dinner still gets its after-midnight 2 h reading.
    const before = readingBefore(allReadings, t);
    const after = readingAfter(allReadings, t);
    const pre = before?.value ?? null;
    const post = after?.value ?? null;
    return {
      id: food.id,
      slot: slotForHour(new Date(food.timestamp).getHours()),
      timestamp: food.timestamp,
      name: food.foodName,
      carbs: food.estimatedCarbs,
      fatGrams: food.fatGrams ?? null,
      proteinGrams: food.proteinGrams ?? null,
      absorption: food.absorption ?? null,
      fromPhoto: food.fromPhoto,
      hasPhoto: mealHasViewablePhoto(food),
      units: dose?.units ?? null,
      doseType: dose?.type ?? null,
      insulinType: dose?.insulinType ?? null,
      recommendedUnits: dose?.recommendedUnits ?? null,
      manualOverride: dose?.manualOverride ?? false,
      mealBy: food.authorName ?? null,
      doseBy: dose?.authorName ?? null,
      before,
      after,
      preGlucose: pre,
      postGlucose: post,
      direction: directionOf(pre, post),
    };
  });

  // Events = meals + any insulin not already attached to a meal.
  const events: DayEvent[] = meals.map((m) => ({
    id: `meal-${m.id}`,
    timestamp: m.timestamp,
    kind: "meal",
    label: SLOT_LABEL[m.slot],
    slot: m.slot,
    carbs: m.carbs,
    before: m.before,
    after: m.after,
    preGlucose: m.preGlucose,
    postGlucose: m.postGlucose,
    units: m.units,
    doseType: m.doseType,
    insulinType: m.insulinType,
    recommendedUnits: m.recommendedUnits,
    manualOverride: m.manualOverride,
    mealBy: m.mealBy,
    doseBy: m.doseBy,
    note: m.name,
    fromPhoto: m.fromPhoto,
  }));
  for (const l of insulin) {
    if (usedInsulinIds.has(l.id)) continue;
    const t = ms(l.timestamp);
    const isCorr = l.type === "correction";
    const before = readingBefore(allReadings, t);
    const after = isCorr ? readingAfter(allReadings, t) : null;
    const label =
      l.type === "correction"
        ? "Correction"
        : l.type === "basal"
          ? "Basal"
          : l.type === "manual"
            ? "Manual dose"
            : "Bolus";
    events.push({
      id: `ins-${l.id}`,
      timestamp: l.timestamp,
      kind: isCorr ? "correction" : "insulin",
      label,
      carbs: null,
      before,
      after,
      preGlucose: before?.value ?? null,
      postGlucose: after?.value ?? null,
      units: l.units,
      doseType: l.type,
      insulinType: l.insulinType ?? null,
      recommendedUnits: l.recommendedUnits ?? null,
      manualOverride: l.manualOverride ?? false,
      mealBy: null,
      doseBy: l.authorName ?? null,
      note: l.note ?? "",
      fromPhoto: false,
    });
  }
  events.sort((a, b) => ms(a.timestamp) - ms(b.timestamp));

  const markers: DayMarker[] = events
    .filter((e) => e.kind !== "insulin" || e.units != null)
    .map((e) => ({
      ts: ms(e.timestamp),
      kind: e.kind,
      carbs: e.carbs,
      units: e.units,
    }));

  // Summary
  const values = readings.map((r) => r.value);
  const n = values.length;
  const avg = n ? Math.round(values.reduce((a, b) => a + b, 0) / n) : null;
  const tir = n
    ? Math.round((values.filter((v) => v >= zones.low && v <= zones.high).length / n) * 100)
    : null;
  const sum = (arr: InsulinLogEntry[]) => arr.reduce((a, l) => a + l.units, 0);
  const summary: DaySummary = {
    totalCarbs: foods.reduce((a, f) => a + f.estimatedCarbs, 0),
    totalInsulin: sum(insulin),
    basal: sum(insulin.filter((l) => l.type === "manual")),
    bolus: sum(insulin.filter((l) => l.type === "bolus")),
    correction: sum(insulin.filter((l) => l.type === "correction")),
    bolusCount: insulin.filter((l) => l.type === "bolus").length,
    correctionCount: insulin.filter((l) => l.type === "correction").length,
    tir,
    avg,
    gmi: avg != null ? gmiFromAvg(avg) : null,
    lastMeal: meals.length ? meals[meals.length - 1] : null,
    completeness: completenessFor(key, readings.length, dayStartMs, dayEndMs),
    readingCount: n,
  };

  const ratios: DayRatios = {
    carbRatio: s.profile.carbRatio,
    correctionFactor: s.profile.correctionFactor,
    targetGlucose: s.profile.targetGlucose,
    targetLow: s.alertPreferences?.lowThreshold ?? zones.low,
    targetHigh: s.alertPreferences?.highThreshold ?? zones.high,
  };

  return {
    key,
    date: dayStart,
    zones,
    readings,
    meals,
    events,
    markers,
    summary,
    flags: buildFlags(meals, insulin, zones),
    patterns: buildPatterns(readings, zones),
    ratios,
    dayStartMs,
    dayEndMs,
  };
}

function completenessFor(key: string, readingCount: number, startMs: number, endMs: number): number {
  const now = Date.now();
  const cap = Math.min(now, endMs);
  const elapsedMin = Math.max(5 * 60, (cap - startMs) / MIN); // at least a few hours of expectation
  const expected = Math.max(1, Math.round(elapsedMin / 5));
  return Math.min(100, Math.round((readingCount / expected) * 100));
}

// ─── Clinical flags ──────────────────────────────────────────────────────────

function buildFlags(meals: DayMeal[], insulin: InsulinLogEntry[], zones: GlucoseZones): DayFlag[] {
  const flags: DayFlag[] = [];

  for (const m of meals) {
    if (m.postGlucose != null && m.postGlucose > zones.high) {
      const sev = m.postGlucose >= zones.urgentHigh ? "high" : "warning";
      flags.push({
        id: `hyper-${m.id}`,
        title: `Post-${SLOT_LABEL[m.slot]} Hyperglycemia`,
        detail: `Post-meal glucose reached ${m.postGlucose} mg/dL. Consider adjusting ${m.slot} carb ratio or timing.`,
        severity: sev,
      });
    }
    if (m.units == null && m.carbs >= 15) {
      flags.push({
        id: `noins-${m.id}`,
        title: `Missing insulin for ${SLOT_LABEL[m.slot]}`,
        detail: `${m.carbs}g logged with no bolus recorded. Confirm the dose was given.`,
        severity: "warning",
      });
    }
    if (
      m.units != null &&
      m.postGlucose != null &&
      m.preGlucose != null &&
      m.postGlucose - m.preGlucose > 60 &&
      m.postGlucose > zones.high
    ) {
      flags.push({
        id: `under-${m.id}`,
        title: `Possible under-bolus at ${SLOT_LABEL[m.slot]}`,
        detail: `Glucose rose ${m.postGlucose - m.preGlucose} mg/dL after ${m.units}u for ${m.carbs}g.`,
        severity: "warning",
      });
    }
  }

  // Late correction: a correction dose more than 60 min after a high meal post-reading.
  const corrections = insulin.filter((l) => l.type === "correction");
  if (corrections.length) {
    flags.push({
      id: "corr",
      title: corrections.length > 1 ? "Multiple correction doses" : "Correction dose given",
      detail: `${corrections.length} correction${corrections.length > 1 ? "s" : ""} totaling ${corrections
        .reduce((a, l) => a + l.units, 0)
        .toFixed(1)}u. Review for stacking.`,
      severity: "info",
    });
  }

  return flags;
}

// ─── Daily patterns ──────────────────────────────────────────────────────────

function buildPatterns(readings: CGMReading[], zones: GlucoseZones): DayPattern[] {
  const out: DayPattern[] = [];
  if (!readings.length) return out;

  const inWindow = (from: number, to: number) =>
    readings.filter((r) => {
      const h = new Date(r.timestamp).getHours();
      return h >= from && h < to;
    });

  const evening = inWindow(18, 23);
  if (evening.length >= 3) {
    const highs = evening.filter((r) => r.value > zones.high).length / evening.length;
    if (highs > 0.4) {
      out.push({
        id: "evening",
        title: "Evening highs",
        detail: `Glucose >${zones.high} mg/dL after dinner`,
        tone: "warn",
      });
    }
  }

  const afternoon = inWindow(13, 16);
  if (afternoon.length >= 3 && Math.max(...afternoon.map((r) => r.value)) > zones.high) {
    out.push({
      id: "afternoon",
      title: "Afternoon spike",
      detail: "Recurring spike around 2–3 PM",
      tone: "warn",
    });
  }

  const overnight = inWindow(0, 6);
  if (overnight.length >= 3) {
    const inRange =
      overnight.filter((r) => r.value >= zones.low && r.value <= zones.high).length /
      overnight.length;
    const lows = overnight.some((r) => r.value < zones.low);
    if (lows) {
      out.push({
        id: "overnight-low",
        title: "Overnight lows",
        detail: "One or more readings below range (12–6 AM)",
        tone: "warn",
      });
    } else if (inRange >= 0.7) {
      out.push({
        id: "overnight-good",
        title: "Good overnight control",
        detail: `Overnight in range ${Math.round(inRange * 100)}% of the time`,
        tone: "good",
      });
    }
  }

  return out;
}
