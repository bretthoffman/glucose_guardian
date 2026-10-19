import type { CGMReading, PatientSnapshot } from "@doctor-portal/api-client-react";
import { calculateA1C } from "./utils";

const ts = (x: { timestamp: string }) => new Date(x.timestamp).getTime();
const byTimeAsc = (a: { timestamp: string }, b: { timestamp: string }) => ts(a) - ts(b);

/**
 * A CGM normally reports every ~5 min. If the newest reading is older than this, the data is
 * stale — the portal must not present it as the patient's current glucose.
 */
export const STALE_AFTER_MIN = 20;

/** Human-friendly age, e.g. "just now", "12 min ago", "15 h ago", "2 d ago". */
export function formatAge(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.round(minutes / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** True when a timestamp falls on the local calendar day. */
export function isToday(timestamp: string): boolean {
  const d = new Date(timestamp);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

export interface GlucoseZones {
  urgentLow: number;
  low: number;
  high: number;
  urgentHigh: number;
}

export type GlucoseStatus = "urgentLow" | "low" | "target" | "high" | "urgentHigh";

export const STATUS_META: Record<
  GlucoseStatus,
  { label: string; text: string; chip: string; dot: string; hex: string }
> = {
  urgentHigh: {
    label: "Urgent High",
    text: "text-destructive",
    chip: "bg-destructive/15 text-destructive border-destructive/30",
    dot: "bg-destructive",
    hex: "#EF4444",
  },
  high: {
    label: "High",
    text: "text-warning",
    chip: "bg-warning/15 text-warning border-warning/30",
    dot: "bg-warning",
    hex: "#F59E0B",
  },
  target: {
    label: "In Range",
    text: "text-success",
    chip: "bg-success/15 text-success border-success/30",
    dot: "bg-success",
    hex: "#10B981",
  },
  low: {
    label: "Low",
    text: "text-orange-600 dark:text-orange-500",
    chip: "bg-orange-500/15 text-orange-600 border-orange-500/30",
    dot: "bg-orange-500",
    hex: "#F97316",
  },
  urgentLow: {
    label: "Urgent Low",
    text: "text-destructive",
    chip: "bg-destructive/15 text-destructive border-destructive/30",
    dot: "bg-destructive",
    hex: "#EF4444",
  },
};

export function zonesFromSnapshot(s: PatientSnapshot): GlucoseZones {
  const a = s.alertPreferences;
  return {
    urgentLow: a?.urgentLowThreshold ?? 55,
    low: a?.lowThreshold ?? 70,
    high: a?.highThreshold ?? 180,
    urgentHigh: a?.urgentHighThreshold ?? 250,
  };
}

export function glucoseStatus(value: number, z: GlucoseZones): GlucoseStatus {
  if (value >= z.urgentHigh) return "urgentHigh";
  if (value > z.high) return "high";
  if (value <= z.urgentLow) return "urgentLow";
  if (value < z.low) return "low";
  return "target";
}

export const TREND_LABEL: Record<string, string> = {
  DoubleUp: "Rising fast",
  SingleUp: "Rising",
  FortyFiveUp: "Rising slowly",
  Flat: "Flat",
  FortyFiveDown: "Falling slowly",
  SingleDown: "Falling",
  DoubleDown: "Falling fast",
};

export interface GlucoseMetrics {
  count: number;
  /** Readings sorted oldest → newest (chronological). */
  readingsAsc: CGMReading[];
  latest?: CGMReading;
  /** Minutes since the newest reading, or null when there are no readings. */
  minutesSinceLatest: number | null;
  /** True when the newest reading is too old to represent current glucose. */
  stale: boolean;
  status: GlucoseStatus | null;
  zones: GlucoseZones;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  a1c: string | null;
  tir: number;
  tar: number;
  tbr: number;
  cv: number;
  variability: "Low" | "Moderate" | "High";
  sensorUsage: number | null;
  insulinToday: number;
  lastInsulin?: { units: number; timestamp: string };
  lastMeal?: { timestamp: string };
}

export function computeMetrics(s: PatientSnapshot): GlucoseMetrics {
  // Snapshots arrive oldest → newest; sort defensively so "latest" is always the newest sample.
  const readings = [...(s.glucoseReadings ?? [])].sort(byTimeAsc);
  const values = readings.map((r) => r.value);
  const n = values.length;
  const zones = zonesFromSnapshot(s);
  const latest = readings[n - 1];
  const minutesSinceLatest = latest
    ? Math.max(0, Math.round((Date.now() - ts(latest)) / 60000))
    : null;
  const stale = minutesSinceLatest != null && minutesSinceLatest > STALE_AFTER_MIN;

  const average = n ? Math.round(values.reduce((a, b) => a + b, 0) / n) : null;
  const highest = n ? Math.max(...values) : null;
  const lowest = n ? Math.min(...values) : null;

  const inTarget = values.filter((v) => v >= zones.low && v <= zones.high).length;
  const above = values.filter((v) => v > zones.high).length;
  const below = values.filter((v) => v < zones.low).length;
  const tir = n ? Math.round((inTarget / n) * 100) : 0;
  const tar = n ? Math.round((above / n) * 100) : 0;
  const tbr = n ? Math.round((below / n) * 100) : 0;

  const mean = average ?? 0;
  const variance = n ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / n : 0;
  const cv = mean ? Math.round((Math.sqrt(variance) / mean) * 100) : 0;
  const variability = cv >= 36 ? "High" : cv >= 25 ? "Moderate" : "Low";

  let sensorUsage: number | null = null;
  if (n >= 2) {
    const span = ts(readings[n - 1]) - ts(readings[0]);
    const expected = Math.max(1, Math.round(span / (5 * 60 * 1000)) + 1);
    sensorUsage = Math.min(100, Math.round((n / expected) * 100));
  }

  const insulin = [...(s.insulinLog ?? [])].sort(byTimeAsc);
  const food = [...(s.foodLog ?? [])].sort(byTimeAsc);
  const insulinToday = insulin
    .filter((l) => isToday(l.timestamp))
    .reduce((a, l) => a + l.units, 0);

  return {
    count: n,
    readingsAsc: readings,
    latest,
    minutesSinceLatest,
    stale,
    status: latest ? glucoseStatus(latest.value, zones) : null,
    zones,
    average,
    highest,
    lowest,
    a1c: calculateA1C(readings),
    tir,
    tar,
    tbr,
    cv,
    variability,
    sensorUsage,
    insulinToday,
    lastInsulin: insulin[insulin.length - 1],
    lastMeal: food[food.length - 1],
  };
}

/** Lightweight time-of-day heuristics for the "Detected patterns" panel. */
export function detectPatterns(s: PatientSnapshot): string[] {
  const readings = s.glucoseReadings ?? [];
  const z = zonesFromSnapshot(s);
  const out: string[] = [];
  if (!readings.length) return out;

  const inWindow = (from: number, to: number) =>
    readings.filter((r) => {
      const h = new Date(r.timestamp).getHours();
      return h >= from && h < to;
    });

  const evening = inWindow(19, 22);
  if (evening.length >= 3 && evening.filter((r) => r.value > z.high).length / evening.length > 0.5) {
    out.push("Repeated highs between 7–10 PM");
  }
  const night = inWindow(0, 6);
  if (night.length >= 3 && night.filter((r) => r.value < z.low).length / night.length > 0.3) {
    out.push("Overnight lows (12–6 AM)");
  }
  const above = readings.filter((r) => r.value > z.high).length / readings.length;
  if (above > 0.5) out.push("Over half of readings above target — review dinner carb ratio");
  const below = readings.filter((r) => r.value < z.low).length / readings.length;
  if (below > 0.1) out.push("Frequent lows — consider easing correction factor");

  if (!out.length) out.push("No concerning patterns detected");
  return out;
}
