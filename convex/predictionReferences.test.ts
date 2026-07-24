import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  classifyTrend,
  combineStrength,
  priorLogsMatch,
  proximity,
  scoreEvent,
  trendMatch,
} from "./predictionMatch";

const modules = import.meta.glob("./**/!(*.test).*s");
const HASH_A = "hash-a";

// ── pure scoring ─────────────────────────────────────────────────────────────────────────────

describe("predictionMatch (pure)", () => {
  it("classifies trend buckets by slope over the last 20 min", () => {
    const rising = [
      { glucose: 160, ms: 0 },
      { glucose: 200, ms: 20 * 60_000 }, // +40 over 20 min = +2/min (boundary → rising_slow)
    ];
    expect(classifyTrend(rising, 20 * 60_000)).toBe("rising_slow");
    const fast = [
      { glucose: 150, ms: 0 },
      { glucose: 210, ms: 20 * 60_000 }, // +3/min
    ];
    expect(classifyTrend(fast, 20 * 60_000)).toBe("rising_fast");
    const flat = [
      { glucose: 150, ms: 0 },
      { glucose: 152, ms: 20 * 60_000 },
    ];
    expect(classifyTrend(flat, 20 * 60_000)).toBe("steady");
    const drop = [
      { glucose: 220, ms: 0 },
      { glucose: 150, ms: 20 * 60_000 }, // −3.5/min
    ];
    expect(classifyTrend(drop, 20 * 60_000)).toBe("falling_fast");
  });

  it("proximity + trendMatch behave", () => {
    expect(proximity(100, 100, 100)).toBe(1);
    expect(proximity(100, 200, 100)).toBe(0);
    expect(proximity(100, 150, 100)).toBeCloseTo(0.5);
    expect(trendMatch("rising_slow", "rising_slow")).toBe(1);
    expect(trendMatch("rising_slow", "steady")).toBe(0.5);
    expect(trendMatch("rising_fast", "falling_fast")).toBe(0);
  });

  it("prior-logs: both-empty matches, one-sided is penalized", () => {
    expect(priorLogsMatch([], [])).toBe(1);
    expect(priorLogsMatch([{ kind: "carb", minutesBefore: 60, amount: 30 }], [])).toBeLessThan(0.3);
    const same = [{ kind: "insulin" as const, minutesBefore: 60, amount: 2 }];
    expect(priorLogsMatch(same, same)).toBeCloseTo(1, 1);
  });

  it("scoreEvent rewards a near-identical situation and strength labels scale", () => {
    const cur = { bg: 200, dose: 2, carbs: 30, trend: "rising_slow" as const, priorLogs: [] };
    const identical = scoreEvent(cur, { bg: 200, dose: 2, carbs: 30, trend: "rising_slow", priorLogs: [] });
    const far = scoreEvent(cur, { bg: 90, dose: 8, carbs: 0, trend: "falling_fast", priorLogs: [] });
    expect(identical).toBeGreaterThan(0.95);
    expect(far).toBeLessThan(identical);
    expect(combineStrength([0.95, 0.9, 0.85]).label).toBe("strong");
    expect(combineStrength([0.4]).label).toBe("rough");
    expect(combineStrength([]).label).toBe("building");
  });
});

// ── the query ────────────────────────────────────────────────────────────────────────────────

async function setupPatient(t: any) {
  const patient = await t.mutation(api.auth.register, { email: "mom@example.com", passwordHash: HASH_A });
  await t.mutation(api.patientProfile.replace, {
    userId: patient,
    passwordHash: HASH_A,
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  return patient;
}

/** Seed 5-min readings across [startMs, endMs] using a glucose curve. */
async function seedReadings(t: any, userId: string, startMs: number, endMs: number, g: (ms: number) => number) {
  await t.run(async (ctx: any) => {
    for (let ms = startMs; ms <= endMs; ms += 5 * 60_000) {
      await ctx.db.insert("patientGlucoseReadings", {
        userId,
        glucose: Math.round(g(ms)),
        timestamp: new Date(ms).toISOString(),
        anomaly: { warning: false },
      });
    }
  });
}

async function seedInsulin(t: any, patient: string, ms: number, units: number, clientId: string) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("careInsulinLogs", {
      patientUserId: patient, authorName: "Mom", clientId, timestamp: new Date(ms).toISOString(),
      units, type: "bolus", createdAt: ms,
    });
  });
}

async function seedFood(t: any, patient: string, ms: number, carbs: number, clientId: string) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("careFoodLogs", {
      patientUserId: patient, authorName: "Mom", clientId, timestamp: new Date(ms).toISOString(),
      foodName: "Meal", estimatedCarbs: carbs, insulinUnits: 2, confidence: "high", fromPhoto: false, createdAt: ms,
    });
  });
}

const NOW = Date.parse("2026-07-20T18:00:00.000Z");
// Rising-into-the-event curve, then a post-meal bump — reused for the current window and events.
const curve = (eventMs: number) => (ms: number) => {
  const dt = (ms - eventMs) / 60_000;
  if (dt <= 0) return 200 + dt * 0.8; // rising_slow into the event, 200 at the event
  if (dt <= 30) return 200 + dt * 0.5;
  return 215 - (dt - 30) * 0.6;
};
const risingRecent = [
  { glucose: 184, ms: NOW - 20 * 60_000 },
  { glucose: 188, ms: NOW - 15 * 60_000 },
  { glucose: 192, ms: NOW - 10 * 60_000 },
  { glucose: 196, ms: NOW - 5 * 60_000 },
  { glucose: 200, ms: NOW },
];

describe("predictionReferences.getReferences", () => {
  it("returns a close historical match with the event's dose/carbs + a strength label", async () => {
    const t = convexTest(schema, modules);
    const patient = await setupPatient(t);
    const eventMs = NOW - 2 * 24 * 60 * 60_000; // two days ago
    await seedReadings(t, patient, eventMs - 3 * 60 * 60_000, eventMs + 95 * 60_000, curve(eventMs));
    await seedInsulin(t, patient, eventMs, 2, "e1");
    await seedFood(t, patient, eventMs, 30, "f1");

    const res = await t.query(api.predictionReferences.getReferences, {
      userId: patient, passwordHash: HASH_A,
      currentBG: 200, doseUnits: 2, carbsGrams: 30, nowMs: NOW, recentReadings: risingRecent,
    });
    expect(res).not.toBeNull();
    expect(res!.references.length).toBe(1);
    expect(res!.references[0].units).toBe(2);
    expect(res!.references[0].carbs).toBe(30);
    expect(res!.references[0].startBG).toBe(200);
    expect(res!.references[0].confidence).toBeGreaterThan(0.9);
    expect(res!.references[0].post.length).toBeGreaterThanOrEqual(6);
    expect(res!.currentTrend).toBe("rising_slow");
    expect(res!.strengthLabel).toBe("strong");
  });

  it("drops a candidate whose post-window is contaminated by a later dose", async () => {
    const t = convexTest(schema, modules);
    const patient = await setupPatient(t);
    const eventMs = NOW - 2 * 24 * 60 * 60_000;
    await seedReadings(t, patient, eventMs - 3 * 60 * 60_000, eventMs + 95 * 60_000, curve(eventMs));
    await seedInsulin(t, patient, eventMs, 2, "e1");
    await seedFood(t, patient, eventMs, 30, "f1");
    // A second dose 30 min later poisons the outcome.
    await seedInsulin(t, patient, eventMs + 30 * 60_000, 1, "e2");

    const res = await t.query(api.predictionReferences.getReferences, {
      userId: patient, passwordHash: HASH_A,
      currentBG: 200, doseUnits: 2, carbsGrams: 30, nowMs: NOW, recentReadings: risingRecent,
    });
    // The clean event is gone; the later 1u dose is too recent-relative? it's 2d ago too but has no
    // clean window either (nothing after it) → it may survive. Assert the contaminated 2u event isn't used.
    expect(res!.references.every((r) => !(r.units === 2 && r.carbs === 30))).toBe(true);
  });

  it("authorizes via an access code and reads the same circle bucket", async () => {
    const t = convexTest(schema, modules);
    const patient = await setupPatient(t);
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Nurse", kind: "caregiver",
    });
    const eventMs = NOW - 2 * 24 * 60 * 60_000;
    await seedReadings(t, patient, eventMs - 3 * 60 * 60_000, eventMs + 95 * 60_000, curve(eventMs));
    await seedInsulin(t, patient, eventMs, 2, "e1");
    await seedFood(t, patient, eventMs, 30, "f1");

    const res = await t.query(api.predictionReferences.getReferences, {
      code, currentBG: 200, doseUnits: 2, carbsGrams: 30, nowMs: NOW, recentReadings: risingRecent,
    });
    expect(res).not.toBeNull();
    expect(res!.references.length).toBe(1);
  });

  it("returns empty references (building) for a patient with no matching history", async () => {
    const t = convexTest(schema, modules);
    const patient = await setupPatient(t);
    const res = await t.query(api.predictionReferences.getReferences, {
      userId: patient, passwordHash: HASH_A,
      currentBG: 200, doseUnits: 2, carbsGrams: 30, nowMs: NOW, recentReadings: risingRecent,
    });
    expect(res!.references).toHaveLength(0);
    expect(res!.strengthLabel).toBe("building");
  });
});
