import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

async function setupOwner(t: ReturnType<typeof convexTest>) {
  const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-owner" });
  await t.mutation(api.patientProfile.replace, {
    userId: owner, passwordHash: "h-owner",
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  return owner;
}

const stick = (clientId: string, glucose = 182) => ({
  clientId,
  timestamp: new Date().toISOString(),
  glucose,
  cgmGlucose: 214,
  cgmTimestamp: new Date().toISOString(),
  cgmTrend: "rising",
  reason: "seemed_off" as const,
});

describe("finger sticks", () => {
  it("an owner logs one; it comes back in listLogs with the CGM match and byline", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    await t.mutation(api.careLogs.addFingerStick, { userId: owner, passwordHash: "h-owner", patientUserId: owner, entry: stick("fs_1") });
    const logs = await t.query(api.careLogs.listLogs, { userId: owner, passwordHash: "h-owner", patientUserId: owner });
    expect(logs?.fingerStickLog).toHaveLength(1);
    expect(logs?.fingerStickLog[0]).toMatchObject({ id: "fs_1", glucose: 182, cgmGlucose: 214, reason: "seemed_off", authorName: "Mom" });
    // Food and insulin are untouched.
    expect(logs?.foodLog).toHaveLength(0);
    expect(logs?.insulinLog).toHaveLength(0);
  });

  it("is idempotent on clientId (a retry never duplicates)", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const args = { userId: owner, passwordHash: "h-owner", patientUserId: owner, entry: stick("fs_dup") };
    await t.mutation(api.careLogs.addFingerStick, args);
    await t.mutation(api.careLogs.addFingerStick, args);
    const rows = await t.run(async (ctx: any) => await ctx.db.query("careFingerSticks").collect());
    expect(rows).toHaveLength(1);
  });

  it("rejects impossible meter values", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    await expect(
      t.mutation(api.careLogs.addFingerStick, { userId: owner, passwordHash: "h-owner", patientUserId: owner, entry: stick("fs_bad", 1820) }),
    ).rejects.toThrow(/between 20 and 600/);
  });

  it("a caregiver code with the log grant can log and delete; one without it cannot", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h-owner", patientUserId: owner, label: "School nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });
    await t.mutation(api.careLogs.addFingerStickViaCode, { code, entry: stick("fs_nurse", 95) });
    let viaCode = await t.query(api.careLogs.listLogsViaCode, { code });
    expect(viaCode?.fingerStickLog[0]).toMatchObject({ id: "fs_nurse", glucose: 95, authorName: "School nurse" });

    await t.mutation(api.careLogs.deleteFingerStickViaCode, { code, clientId: "fs_nurse" });
    viaCode = await t.query(api.careLogs.listLogsViaCode, { code });
    expect(viaCode?.fingerStickLog).toHaveLength(0);

    const { code: viewOnly } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h-owner", patientUserId: owner, label: "Grandpa", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: false, useCalculator: false, chat: false },
    });
    await expect(t.mutation(api.careLogs.addFingerStickViaCode, { code: viewOnly, entry: stick("fs_no") })).rejects.toThrow(/cannot add logs/);
  });

  it("the owner can delete a finger stick", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    await t.mutation(api.careLogs.addFingerStick, { userId: owner, passwordHash: "h-owner", patientUserId: owner, entry: stick("fs_del") });
    await t.mutation(api.careLogs.deleteFingerStick, { userId: owner, passwordHash: "h-owner", patientUserId: owner, clientId: "fs_del" });
    const logs = await t.query(api.careLogs.listLogs, { userId: owner, passwordHash: "h-owner", patientUserId: owner });
    expect(logs?.fingerStickLog).toHaveLength(0);
  });
});
