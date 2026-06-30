import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/!(*.test).*s");

async function seedUser(t: ReturnType<typeof convexTest>, passwordHash = "ph"): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      email: `u${Math.random()}@x.com`,
      passwordHash,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe("patientGlucose.listForDayRange", () => {
  it("returns only readings within the inclusive/exclusive day window", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const dayStart = new Date(2026, 5, 25, 0, 0, 0, 0);
    const dayEnd = new Date(2026, 5, 26, 0, 0, 0, 0);
    const before = new Date(2026, 5, 24, 23, 59, 0, 0).toISOString();
    const inside = new Date(2026, 5, 25, 12, 0, 0, 0).toISOString();
    const atEnd = dayEnd.toISOString();

    await t.run(async (ctx) => {
      for (const [timestamp, glucose] of [
        [before, 90],
        [inside, 120],
        [atEnd, 130],
      ] as const) {
        await ctx.db.insert("patientGlucoseReadings", {
          userId,
          glucose,
          timestamp,
          anomaly: { warning: false },
        });
      }
    });

    const rows = await t.query(api.patientGlucose.listForDayRange, {
      userId,
      passwordHash: "ph",
      startTimestamp: dayStart.toISOString(),
      endTimestamp: dayEnd.toISOString(),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].glucose).toBe(120);
    expect(rows[0].timestamp).toBe(inside);
  });

  it("rejects unauthorized callers", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, "secret");
    const rows = await t.query(api.patientGlucose.listForDayRange, {
      userId,
      passwordHash: "wrong",
      startTimestamp: new Date(2026, 5, 25).toISOString(),
      endTimestamp: new Date(2026, 5, 26).toISOString(),
    });
    expect(rows).toEqual([]);
  });
});
