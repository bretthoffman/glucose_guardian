import { describe, expect, it } from "vitest";
import {
  buildExpoMessage,
  careLogCopy,
  categoryForGlucose,
  chunk,
  classifyGlucose,
  COOLDOWN_MS,
  isCriticalCategory,
  messageCopy,
  shouldSendGlucoseAlert,
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

  it("routes only urgent bands to the critical-alert category", () => {
    expect(categoryForGlucose("urgent_low")).toBe("glucoseUrgent");
    expect(categoryForGlucose("urgent_high")).toBe("glucoseUrgent");
    expect(categoryForGlucose("low")).toBe("glucoseHighLow");
    expect(categoryForGlucose("high")).toBe("glucoseHighLow");
  });
});

describe("critical-alert scope (what we told Apple)", () => {
  it("allows Critical Alerts ONLY for urgent glucose", () => {
    expect(isCriticalCategory("glucoseUrgent")).toBe(true);
    for (const c of ["glucoseHighLow", "careLog", "messages", "doctor"] as const) {
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

describe("shouldSendGlucoseAlert (rate limiting)", () => {
  const now = 1_000_000_000;

  it("sends the first time", () => {
    expect(shouldSendGlucoseAlert({ kind: "low", lastKind: null, lastSentAt: null, nowMs: now })).toBe(true);
  });

  it("suppresses a repeat of the SAME kind inside its cooldown", () => {
    expect(
      shouldSendGlucoseAlert({ kind: "low", lastKind: "low", lastSentAt: now - 60_000, nowMs: now }),
    ).toBe(false);
  });

  it("re-sends the same kind once the cooldown elapses", () => {
    expect(
      shouldSendGlucoseAlert({ kind: "low", lastKind: "low", lastSentAt: now - COOLDOWN_MS.low, nowMs: now }),
    ).toBe(true);
  });

  it("ALWAYS sends an escalation to a different kind, even inside a cooldown", () => {
    // low → urgent_low must never be swallowed by the previous send's cooldown.
    expect(
      shouldSendGlucoseAlert({ kind: "urgent_low", lastKind: "low", lastSentAt: now - 1000, nowMs: now }),
    ).toBe(true);
  });

  it("uses a shorter cooldown for urgent lows than for highs", () => {
    expect(COOLDOWN_MS.urgent_low).toBeLessThan(COOLDOWN_MS.high);
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
