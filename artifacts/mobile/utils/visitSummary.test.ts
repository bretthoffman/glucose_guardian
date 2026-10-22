import { describe, expect, it } from "vitest";
import {
  biggestRises,
  buildVisitSummary,
  careAverages,
  dailyPattern,
  dayRows,
  doseChanges,
  fmtRange,
  foodGroups,
  glucoseStats,
  hourLabel,
  lowEpisodes,
  lowPattern,
  mealRows,
  sensorWearPercent,
  type SummaryReading,
} from "./visitSummary";
import { buildVisitSummaryHtml, esc, visitSummaryFileName } from "./visitSummaryHtml";

const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const MIN = 60_000;

/** Readings every 5 minutes from `start` for `count` readings, glucose from fn(i). */
function series(start: string, count: number, fn: (i: number) => number): SummaryReading[] {
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, i) => ({ timestamp: new Date(t0 + i * 5 * MIN).toISOString(), glucose: fn(i) }));
}

describe("glucoseStats", () => {
  it("computes buckets, mean, GMI and CV", () => {
    const r = [50, 60, 100, 150, 200, 300].map((g, i) => ({ glucose: g, timestamp: at(2026, 10, 1, 8, i) }));
    const s = glucoseStats(r)!;
    expect(s.count).toBe(6);
    expect(s.mean).toBe(143);
    expect(s.pct).toEqual({ veryLow: 16.7, low: 16.7, inRange: 33.3, high: 16.7, veryHigh: 16.7 });
    expect(s.gmi).toBeCloseTo(3.31 + 0.02392 * (860 / 6), 1);
    expect(s.cv).toBeGreaterThan(50);
  });
  it("returns null with no readings", () => {
    expect(glucoseStats([])).toBeNull();
  });
  it("treats 70 and 180 as in range, 54 as low", () => {
    const s = glucoseStats([70, 180, 54].map((g, i) => ({ glucose: g, timestamp: at(2026, 10, 1, 8, i) })))!;
    expect(s.pct.inRange).toBe(66.7);
    expect(s.pct.low).toBe(33.3);
  });
});

describe("sensor wear", () => {
  it("is readings over expected 5-minute readings, capped at 100", () => {
    expect(sensorWearPercent(144, 0, 86_400_000)).toBe(50);
    expect(sensorWearPercent(400, 0, 86_400_000)).toBe(100);
  });
});

describe("lows", () => {
  it("groups consecutive readings under 70 and ignores a single mild dip", () => {
    const r = [
      ...series(at(2026, 10, 20, 2, 0), 4, () => 62), // episode (4 readings)
      ...series(at(2026, 10, 20, 2, 20), 3, () => 110),
      { timestamp: at(2026, 10, 20, 9, 0), glucose: 66 }, // lone mild dip: not counted
      { timestamp: at(2026, 10, 20, 15, 0), glucose: 50 }, // lone reading under 54: counted
    ];
    const eps = lowEpisodes(r);
    expect(eps).toHaveLength(2);
    expect(eps[0]!.nadir).toBe(62);
    expect(eps[1]!.nadir).toBe(50);
  });
  it("names the 2-hour window when most lows start there", () => {
    const eps = [
      { start: at(2026, 10, 15, 2, 30), end: at(2026, 10, 15, 2, 40), nadir: 60, nadirAt: at(2026, 10, 15, 2, 40) },
      { start: at(2026, 10, 16, 3, 10), end: at(2026, 10, 16, 3, 20), nadir: 60, nadirAt: at(2026, 10, 16, 3, 20) },
      { start: at(2026, 10, 17, 14, 0), end: at(2026, 10, 17, 14, 5), nadir: 60, nadirAt: at(2026, 10, 17, 14, 5) },
    ];
    expect(lowPattern(eps)).toBe("2 of 3 lows started between 2 and 4 AM.");
    expect(lowPattern(eps.slice(2))).toBeNull();
  });
  it("labels hours", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(19)).toBe("7 PM");
    expect(hourLabel(24)).toBe("12 AM");
  });
});

describe("daily pattern", () => {
  it("needs enough hours and orders percentiles", () => {
    expect(dailyPattern(series(at(2026, 10, 1, 0), 12, () => 120))).toEqual([]);
    const p = dailyPattern(series(at(2026, 10, 1, 0), 288 * 3, (i) => 100 + (i % 50)));
    expect(p).toHaveLength(24);
    for (const pt of p) {
      expect(pt.p5).toBeLessThanOrEqual(pt.p25);
      expect(pt.p25).toBeLessThanOrEqual(pt.p50);
      expect(pt.p75).toBeLessThanOrEqual(pt.p95);
    }
  });
});

describe("meals", () => {
  const readings = [
    { timestamp: at(2026, 10, 19, 17, 50), glucose: 128 },
    { timestamp: at(2026, 10, 19, 19, 54), glucose: 281 },
    { timestamp: at(2026, 10, 20, 7, 15), glucose: 110 },
  ];
  const food = [
    { timestamp: at(2026, 10, 19, 17, 55), foodName: "Pizza", estimatedCarbs: 56, insulinUnits: 3.7, fromPhoto: true },
    { timestamp: at(2026, 10, 20, 7, 20), foodName: "Cheerios", estimatedCarbs: 28, insulinUnits: 1.9 },
    { timestamp: at(2026, 10, 20, 12, 0), foodName: "pizza ", estimatedCarbs: 40, insulinUnits: 2.7 },
  ];
  it("pairs each meal with the reading before and about 2 hours after, newest first", () => {
    const rows = mealRows(food, readings);
    expect(rows.map((r) => r.foodName)).toEqual(["pizza ", "Cheerios", "Pizza"]);
    expect(rows[2]).toMatchObject({ before: 128, after: 281, change: 153, fromPhoto: true });
    expect(rows[1]).toMatchObject({ before: 110, after: null, change: null });
    expect(rows[0]).toMatchObject({ before: null, after: null });
  });
  it("ranks the biggest rises and groups repeat foods case-insensitively", () => {
    const rows = mealRows(food, readings);
    expect(biggestRises(rows).map((r) => r.change)).toEqual([153]);
    const groups = foodGroups(rows);
    expect(groups).toEqual([{ name: "pizza", times: 2, avgCarbs: 48, avgChange: 153 }]);
  });
});

describe("per day and averages", () => {
  it("splits each local day into low / in range / high and sums logs", () => {
    const start = Date.parse(at(2026, 10, 20, 0));
    const end = Date.parse(at(2026, 10, 22, 0));
    const r = [
      { timestamp: at(2026, 10, 20, 8), glucose: 60 },
      { timestamp: at(2026, 10, 20, 9), glucose: 120 },
      { timestamp: at(2026, 10, 20, 10), glucose: 200 },
      { timestamp: at(2026, 10, 20, 11), glucose: 140 },
    ];
    const days = dayRows(start, end, r, [{ timestamp: at(2026, 10, 20, 12), foodName: "x", estimatedCarbs: 30, insulinUnits: 2 }], [{ timestamp: at(2026, 10, 20, 12), units: 2, type: "bolus" }]);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ low: 25, inRange: 50, high: 25, carbs: 30, insulin: 2 });
    expect(days[1]).toMatchObject({ low: null, inRange: null, carbs: 0 });
  });
  it("averages insulin per day that had insulin logs, basal separately", () => {
    const c = careAverages(
      [{ timestamp: at(2026, 10, 20, 8), foodName: "a", estimatedCarbs: 40, insulinUnits: 2 }],
      [
        { timestamp: at(2026, 10, 20, 8), units: 2, type: "bolus" },
        { timestamp: at(2026, 10, 20, 21), units: 6, type: "basal" },
        { timestamp: at(2026, 10, 21, 8), units: 4, type: "manual" },
      ],
    );
    expect(c).toMatchObject({ insulinDays: 2, totalInsulin: 6, bolusPerDay: 3, bolusDosesPerDay: 1, basalPerDay: 3, carbsPerDay: 40, foodsPerDay: 1 });
  });
});

describe("dose changes", () => {
  it("reads carb ratio, correction and target changes from the access log in the window", () => {
    const log = [
      { timestamp: at(2026, 10, 14, 9), actor: "owner" as const, action: "Dose settings changed (dashboard): CR 18 · Target 120 · ISF 60 → CR 15 · Target 120 · ISF 60" },
      { timestamp: at(2026, 10, 16, 9), actor: "doctor" as const, action: "Dose settings changed (doctor-portal): CR 15 · Target 120 · ISF 60 → CR 15 · Target 110 · ISF 55" },
      { timestamp: at(2026, 9, 1, 9), actor: "owner" as const, action: "Dose settings changed (dashboard): CR 20 · Target 120 · ISF 60 → CR 18 · Target 120 · ISF 60" },
      { timestamp: at(2026, 10, 15, 9), actor: "owner" as const, action: "Doctor code generated" },
    ];
    const ch = doseChanges(log, Date.parse(at(2026, 10, 8, 0)), Date.parse(at(2026, 10, 22, 0)));
    expect(ch).toEqual([
      { timestamp: log[0]!.timestamp, what: "Carb ratio", from: "1:18", to: "1:15", by: "family, in the app" },
      { timestamp: log[1]!.timestamp, what: "Correction factor", from: "1:60", to: "1:55", by: "doctor" },
      { timestamp: log[1]!.timestamp, what: "Target", from: "120", to: "110", by: "doctor" },
    ]);
  });
});

describe("visit summary document", () => {
  const end = Date.parse(at(2026, 10, 22, 0));
  const readings = series(at(2026, 10, 8, 0), 288 * 14, (i) => 140 + Math.round(40 * Math.sin(i / 20)));
  const food = Array.from({ length: 40 }, (_, i) => ({
    timestamp: new Date(Date.parse(at(2026, 10, 8, 12)) + i * 8 * 3600_000).toISOString(),
    foodName: i === 3 ? `<script>alert("x")</script> Tots` : `Food ${i % 5}`,
    estimatedCarbs: 30,
    insulinUnits: 2,
  }));
  const meta = { patientName: "Bella", ageYears: 4, diabetesType: "type1" as const, doctorName: "Dr. Sarah Mitchell", carbRatio: 15, correctionFactor: 60, targetGlucose: 120, generatedAt: end };

  it("covers the chosen window and escapes family-entered text", () => {
    const data = buildVisitSummary({ days: 14, endMs: end, readings, food, insulin: [], sticks: [], accessLog: [] });
    expect(fmtRange(data.startMs, data.endMs)).toBe("Oct 8 to Oct 21, 2026");
    expect(data.perDay).toHaveLength(14);
    const html = buildVisitSummaryHtml(data, meta);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Every meal, newest first (40)");
    expect(html).toContain("Prepared for Dr. Sarah Mitchell");
    expect(html).not.toMatch(/—/);
  });
  it("lists foods by frequency on a 90-day report unless every meal is asked for", () => {
    const data = buildVisitSummary({ days: 90, endMs: end, readings, food, insulin: [], sticks: [], accessLog: [] });
    expect(buildVisitSummaryHtml(data, meta)).toContain("Foods eaten most often");
    expect(buildVisitSummaryHtml(data, meta, { includeEveryMeal: true })).toContain("Every meal, newest first");
  });
  it("leaves out sections that are switched off, and adds the insulin, lows and finger stick logs", () => {
    const insulin = [{ timestamp: at(2026, 10, 20, 8, 0), units: 2.5, type: "bolus" as const, insulinType: "Humalog · 100 u/mL", note: "before school" }];
    const sticks = [{ timestamp: at(2026, 10, 20, 9, 0), glucose: 120, cgmGlucose: 131, reason: "seemed_off" }];
    const data = buildVisitSummary({ days: 14, endMs: end, readings, food, insulin, sticks, accessLog: [] });
    const all = buildVisitSummaryHtml(data, meta);
    expect(all).toContain("Insulin log (1 doses)");
    expect(all).toContain("Humalog");
    expect(all).toContain("before school");
    expect(all).toContain("Dexcom seemed off");
    expect(all).toContain("+11");
    expect(all).toContain("Daily pattern by time of day");
    const lean = buildVisitSummaryHtml(data, meta, { sections: { pattern: false, eachDay: false, meals: false, insulin: false, lows: false, sticks: false } });
    expect(lean).not.toContain("Daily pattern by time of day");
    expect(lean).not.toContain('class="page"');
    expect(lean).toContain("Glucose at a glance");
    const foodOnly = buildVisitSummaryHtml(data, meta, { sections: { insulin: false, lows: false, sticks: false } });
    expect(foodOnly).toContain("<h2>Food Log</h2>");
    expect(foodOnly).toContain('class="strip"');
  });
  it("names the file after the patient and date", () => {
    expect(visitSummaryFileName({ patientName: "Bella Bethea", generatedAt: end })).toBe("Bella_Bethea_Visit_Summary_2026-10-22.pdf");
    expect(esc(`a"b'<`)).toBe("a&quot;b&#39;&lt;");
  });
});
