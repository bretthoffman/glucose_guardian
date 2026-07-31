import { describe, expect, it } from "vitest";
import {
  buildExpoMessage,
  careLogCopy,
  categoryForGlucose,
  categoryForTrend,
  chunk,
  classifyGlucose,
  classifyTrendAlert,
  isCriticalCategory,
  messageCopy,
  soundKeyForCategory,
} from "./pushLogic";

describe("classifyGlucose", () => {
  const t = { urgentLowThreshold: 55, lowThreshold: 70, highThreshold: 180, urgentHighThreshold: 250 };

  it("classifies each band, with urgent winning over its non-urgent counterpart", () => {
    expect(classifyGlucose(40, t)).toBe("urgent_low");
    expect(classifyGlucose(55, t)).toBe("urgent_low"); // boundary is inclusive
    expect(classifyGlucose(65, t)).toBe("low");
    expect(classifyGlucose(120, t)).toBeNull(); // in range → no alert
    expect(classifyGlucose(200, t)).toBe("high");
    expect(classifyGlucose(250, t)).toBe("urgent_high");
    expect(classifyGlucose(400, t)).toBe("urgent_high");
  });

  it("falls back to app defaults when the profile has no thresholds", () => {
    expect(classifyGlucose(50, {})).toBe("urgent_low");
    expect(classifyGlucose(120, {})).toBeNull();
    expect(classifyGlucose(300, {})).toBe("urgent_high");
  });

  it("routes each band to exactly ONE category — urgent low owns urgent; urgent high folds into High", () => {
    expect(categoryForGlucose("urgent_low")).toBe("glucoseUrgent"); // takes over from Low entirely
    expect(categoryForGlucose("low")).toBe("glucoseLow");
    expect(categoryForGlucose("high")).toBe("glucoseHigh");
    expect(categoryForGlucose("urgent_high")).toBe("glucoseHigh"); // copy stays "very high"
  });
});

describe("critical-alert scope (what we told Apple)", () => {
  it("allows Critical Alerts ONLY for urgent glucose", () => {
    expect(isCriticalCategory("glucoseUrgent")).toBe(true);
    for (const c of ["glucoseHigh", "glucoseLow", "riseFast", "fallFast", "careLog", "messages", "doctor"] as const) {
      expect(isCriticalCategory(c)).toBe(false);
    }
  });

  it("builds a critical payload for urgent glucose and a standard one otherwise", () => {
    const urgent = buildExpoMessage({
      token: "ExponentPushToken[x]", category: "glucoseUrgent", copy: { title: "t", body: "b" },
    });
    expect(urgent.sound).toEqual({ critical: true, name: "default", volume: 1 });
    expect(urgent.interruptionLevel).toBe("critical");

    const careLog = buildExpoMessage({
      token: "ExponentPushToken[x]", category: "careLog", copy: { title: "t", body: "b" },
    });
    expect(careLog.sound).toBe("default");
    expect(careLog.interruptionLevel).toBe("active");
    expect(careLog.data).toMatchObject({ category: "careLog" });
  });
});

describe("classifyTrendAlert (rising/falling fast)", () => {
  const at = (min: number) => min * 60_000;
  const latest = { glucose: 150, timestampMs: at(10) };

  it("prefers the sensor's Dexcom arrow: Single and Double both count as fast", () => {
    expect(classifyTrendAlert({ latest, prev: null, dexcomTrend: "DoubleUp" })).toBe("rise_fast");
    expect(classifyTrendAlert({ latest, prev: null, dexcomTrend: 2 })).toBe("rise_fast");
    expect(classifyTrendAlert({ latest, prev: null, dexcomTrend: "SingleDown" })).toBe("fall_fast");
    expect(classifyTrendAlert({ latest, prev: null, dexcomTrend: 7 })).toBe("fall_fast");
    expect(classifyTrendAlert({ latest, prev: null, dexcomTrend: "Flat" })).toBeNull();
    expect(classifyTrendAlert({ latest, prev: null, dexcomTrend: 3 })).toBeNull();
  });

  it("computes the mg/dL-per-minute rate from the previous reading when no arrow is present", () => {
    const prev = { glucose: 140, timestampMs: at(0) };
    expect(classifyTrendAlert({ latest: { glucose: 151, timestampMs: at(5) }, prev })).toBe("rise_fast");
    expect(classifyTrendAlert({ latest: { glucose: 129, timestampMs: at(5) }, prev })).toBe("fall_fast");
    expect(classifyTrendAlert({ latest: { glucose: 145, timestampMs: at(5) }, prev })).toBeNull(); // 1 mg/min
    expect(classifyTrendAlert({ latest: { glucose: 190, timestampMs: at(20) }, prev })).toBeNull(); // gap too wide
    expect(classifyTrendAlert({ latest: { glucose: 190, timestampMs: at(5) }, prev: null })).toBeNull();
  });

  it("maps trend kinds to their own categories and sound slots", () => {
    expect(categoryForTrend("rise_fast")).toBe("riseFast");
    expect(categoryForTrend("fall_fast")).toBe("fallFast");
    expect(soundKeyForCategory("riseFast")).toBe("riseFast");
    expect(soundKeyForCategory("fallFast")).toBe("fallFast");
    expect(soundKeyForCategory("glucoseHigh")).toBe("glucoseHigh");
    expect(soundKeyForCategory("glucoseLow")).toBe("glucoseLow");
  });
});

describe("copy", () => {
  it("names the patient and the value for glucose alerts", () => {
    const c = careLogCopy({ authorName: "Nurse Joy", patientName: "Bella", kind: "insulin", units: 2 });
    expect(c.title).toContain("Nurse Joy");
    expect(c.title).toContain("Bella");
    expect(c.body).toContain("2u");
  });

  it("summarizes a meal log", () => {
    const c = careLogCopy({ authorName: "Dad", patientName: "Bella", kind: "food", carbs: 30, foodName: "Pizza" });
    expect(c.body).toContain("Pizza");
    expect(c.body).toContain("30g");
  });

  it("truncates a long message preview", () => {
    const c = messageCopy({ senderName: "Mom", text: "x".repeat(300) });
    expect(c.title).toContain("Mom");
    expect(c.body.length).toBeLessThanOrEqual(140);
    expect(c.body.endsWith("…")).toBe(true);
  });
});

describe("chunk", () => {
  it("splits into Expo-sized batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 100)).toEqual([]);
  });
});
