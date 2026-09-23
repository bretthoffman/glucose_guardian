import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const SECRET = "test-doctor-api-secret";
const CODE = "ABC234";

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_API_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const iso = (day: number, hour = 12) => new Date(Date.UTC(2026, 7, day, hour)).toISOString();

async function seedPatient(t: ReturnType<typeof convexTest>, email = "p@example.com", doctorCode = CODE) {
  return await t.run(async (ctx: any) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email, createdAt: now, updatedAt: now });
    await ctx.db.insert("patientProfiles", {
      userId,
      childName: "Bella",
      parentName: "Mom",
      diabetesType: "type1",
      dateOfBirth: "2014-01-01",
      carbRatio: 12,
      correctionFactor: 45,
      targetGlucose: 110,
      doseSettingsByTime: { breakfast: { carbRatio: 10 } },
      alertPreferences: { lowThreshold: 70, highThreshold: 180, emergencyAlertsEnabled: true },
      doctorCode,
      caregiverCode: "CARE22",
      doctorEmail: "dr@example.com",
      updatedAt: now,
    });
    return userId;
  });
}

async function addFood(t: ReturnType<typeof convexTest>, patientUserId: unknown, clientId: string, timestamp: string) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("careFoodLogs", {
      patientUserId,
      authorName: "Mom",
      authorCode: "NURSE1",
      clientId,
      timestamp,
      foodName: "Pancakes",
      estimatedCarbs: 45,
      insulinUnits: 4,
      confidence: "high",
      fromPhoto: true,
      photoUri: "file:///var/mobile/meal.jpg",
      fatGrams: 12,
      absorption: "medium",
      createdAt: Date.now(),
    });
  });
}

async function addInsulin(t: ReturnType<typeof convexTest>, patientUserId: unknown, clientId: string, timestamp: string) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("careInsulinLogs", {
      patientUserId,
      authorName: "Mom",
      clientId,
      timestamp,
      units: 4,
      type: "bolus",
      foodLogId: "f1",
      insulinType: "Humalog · 100 u/mL",
      recommendedUnits: 4.5,
      manualOverride: true,
      createdAt: Date.now(),
    });
  });
}

describe("doctorAccounts.getCareLogs", () => {
  it("returns the whole logged history in the window, newest first, shaped like snapshot entries", async () => {
    const t = convexTest(schema, modules);
    const patient = await seedPatient(t);
    // More than the 100 entries the phone's doctor sync carries.
    for (let i = 0; i < 120; i++) await addFood(t, patient, `f${i}`, iso(1 + (i % 28), i % 24));
    await addInsulin(t, patient, "i1", iso(3));
    await addInsulin(t, patient, "i2", iso(20));

    const res = await t.query(api.doctorAccounts.getCareLogs, {
      serverSecret: SECRET,
      accessCode: CODE,
      fromTimestamp: iso(1, 0),
      toTimestamp: iso(31),
    });

    expect(res.food).toHaveLength(120);
    const stamps = res.food.map((f) => f.timestamp);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    expect(res.insulin.map((l) => l.id)).toEqual(["i2", "i1"]);

    const food = res.food[0] as Record<string, unknown>;
    expect(food.id).toMatch(/^f\d+$/);
    expect(food).toMatchObject({ foodName: "Pancakes", fatGrams: 12, absorption: "medium", authorName: "Mom" });
    // Device file paths and access credentials never leave the backend.
    expect(food.photoUri).toBeUndefined();
    expect(food.authorCode).toBeUndefined();
    expect(res.insulin[0]).toMatchObject({
      units: 4,
      type: "bolus",
      foodLogId: "f1",
      insulinType: "Humalog · 100 u/mL",
      recommendedUnits: 4.5,
      manualOverride: true,
    });
  });

  it("keeps to the window and to the patient behind the code", async () => {
    const t = convexTest(schema, modules);
    const patient = await seedPatient(t);
    const other = await seedPatient(t, "other@example.com", "ZZZ999");
    await addFood(t, patient, "inside", iso(10));
    await addFood(t, patient, "before", iso(2));
    await addFood(t, other, "not-mine", iso(10));

    const res = await t.query(api.doctorAccounts.getCareLogs, {
      serverSecret: SECRET,
      accessCode: CODE.toLowerCase(),
      fromTimestamp: iso(5),
      toTimestamp: iso(15),
    });
    expect(res.food.map((f) => f.id)).toEqual(["inside"]);
  });

  it("returns nothing for an unknown code and rejects a bad secret", async () => {
    const t = convexTest(schema, modules);
    await seedPatient(t);
    const args = { accessCode: "NOPE99", fromTimestamp: iso(1), toTimestamp: iso(30) };
    expect(await t.query(api.doctorAccounts.getCareLogs, { serverSecret: SECRET, ...args })).toEqual({
      food: [],
      insulin: [],
    });
    await expect(
      t.query(api.doctorAccounts.getCareLogs, { serverSecret: "wrong", ...args, accessCode: CODE }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

describe("doctorAccounts.getPatientProfile", () => {
  it("returns the synced-profile fields and alert thresholds only", async () => {
    const t = convexTest(schema, modules);
    await seedPatient(t);
    const res = await t.query(api.doctorAccounts.getPatientProfile, { serverSecret: SECRET, accessCode: CODE });
    expect(res?.profile).toEqual({
      childName: "Bella",
      parentName: "Mom",
      diabetesType: "type1",
      dateOfBirth: "2014-01-01",
      carbRatio: 12,
      correctionFactor: 45,
      targetGlucose: 110,
      doseSettingsByTime: { breakfast: { carbRatio: 10 } },
    });
    expect(res?.alertPreferences).toEqual({ lowThreshold: 70, highThreshold: 180 });
    expect(JSON.stringify(res)).not.toMatch(/CARE22|dr@example\.com/);
  });

  it("returns null for an unknown code", async () => {
    const t = convexTest(schema, modules);
    await seedPatient(t);
    expect(
      await t.query(api.doctorAccounts.getPatientProfile, { serverSecret: SECRET, accessCode: "NOPE99" }),
    ).toBeNull();
  });
});
