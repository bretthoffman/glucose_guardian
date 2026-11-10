import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mealHigh = (api as any).mealHigh;
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };
const H = 3_600_000;
const NOW = Date.parse("2026-11-10T19:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

afterEach(() => vi.useRealTimers());

describe("meal high heads-up", () => {
  it("finds pancakes that stayed high after extra insulin; the family can turn it off; codes can't", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const t = convexTest(schema, modules);
    const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "h-b" });
    await t.mutation(api.patientProfile.replace, {
      userId: brian, passwordHash: "h-b",
      profile: { childName: "Bella", parentName: "Brian", diabetesType: "type1", dateOfBirth: "2018-01-01" },
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("careAccessCodes", {
        patientUserId: brian, code: "NURSE001", label: "School Nurse", kind: "caregiver", permissions: perms,
        access: { mode: "always" }, status: "active", createdAt: NOW, updatedAt: NOW,
      });
      for (const [i, daysAgo] of [2, 9].entries()) {
        const t0 = NOW - daysAgo * 24 * H - 6.5 * H;
        const clientId = `p${i}`;
        await ctx.db.insert("careFoodLogs", {
          patientUserId: brian, authorName: "Mom", clientId, timestamp: iso(t0), foodName: "Pancakes with syrup",
          estimatedCarbs: 48, insulinUnits: 3, confidence: "high", fromPhoto: false, createdAt: t0,
        });
        await ctx.db.insert("careInsulinLogs", {
          patientUserId: brian, authorName: "Mom", clientId: `d${i}`, timestamp: iso(t0), units: 3, type: "bolus",
          foodLogId: clientId, recommendedUnits: 3, createdAt: t0,
        });
        await ctx.db.insert("careInsulinLogs", {
          patientUserId: brian, authorName: "Mom", clientId: `c${i}`, timestamp: iso(t0 + 130 * 60_000), units: 1.5,
          type: "correction", createdAt: t0,
        });
        for (let m = 0; m <= 300; m += 5) {
          const glucose = Math.round(m <= 120 ? 197 + (155 * m) / 120 : 352 - ((m - 120) * 62) / 120);
          await ctx.db.insert("patientGlucoseReadings", { userId: brian, glucose, timestamp: iso(t0 + m * 60_000), anomaly: { warning: false } });
        }
      }
    });

    const mine = await t.query(mealHigh.forViewer, { userId: brian, passwordHash: "h-b" });
    expect(mine).toMatchObject({ enabled: true, high: 250, canChange: true });
    expect(mine.patterns).toHaveLength(1);
    expect(mine.patterns[0]).toMatchObject({ foodName: "Pancakes with syrup", stayedHigh: 2 });

    const nurse = await t.query(mealHigh.forViewer, { code: "NURSE001" });
    expect(nurse.canChange).toBe(false);
    expect(nurse.patterns).toHaveLength(1);
    await expect(t.mutation(mealHigh.setPrefs, { code: "NURSE001", enabled: false })).rejects.toThrow();

    await t.mutation(mealHigh.setPrefs, { userId: brian, passwordHash: "h-b", high: 300 });
    expect((await t.query(mealHigh.forViewer, { code: "NURSE001" })).high).toBe(300);
    await expect(t.mutation(mealHigh.setPrefs, { userId: brian, passwordHash: "h-b", high: 275 })).rejects.toThrow();
    await t.mutation(mealHigh.setPrefs, { userId: brian, passwordHash: "h-b", enabled: false });
    const off = await t.query(mealHigh.forViewer, { code: "NURSE001" });
    expect(off).toMatchObject({ enabled: false, patterns: [] });
  });
});
