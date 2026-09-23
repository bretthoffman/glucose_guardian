import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { copyBucketLogs } from "./careLogs";

const modules = import.meta.glob("./**/!(*.test).*s");

const SECRET = "test-doctor-api-secret";
const CODE = "ABC234";
const PW = "h-owner";

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_API_SECRET", SECRET);
  // Logging schedules circle pushes; fake timers let each test run them to completion.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest>;

/** A patient account (legacy password auth) whose doctor code is CODE. */
async function seedOwner(t: T, email = "owner@example.com", doctorCode = CODE) {
  const owner = await t.mutation(api.auth.register, { email, passwordHash: PW });
  await t.mutation(api.patientProfile.replace, {
    userId: owner,
    passwordHash: PW,
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  await t.run(async (ctx: any) => {
    const p = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q: any) => q.eq("userId", owner))
      .first();
    await ctx.db.patch(p._id, { doctorCode });
  });
  return owner;
}

const meal = (clientId: string, timestamp = new Date().toISOString()) => ({
  clientId,
  timestamp,
  foodName: "Pancakes",
  estimatedCarbs: 45,
  insulinUnits: 4,
  confidence: "high" as const,
  fromPhoto: true,
});

async function logMeal(t: T, owner: any, clientId: string) {
  await t.mutation(api.careLogs.addFoodLog, { userId: owner, passwordHash: PW, patientUserId: owner, entry: meal(clientId) });
}

/**
 * What an upload to the URL from generateFoodPhotoUploadUrl produces. (convex-test's storage mock
 * doesn't record the upload's Content-Type, so it's set here the way the real backend would.)
 */
async function upload(t: T, contentType: string | null = "image/jpeg", size?: number) {
  return (await t.run(async (ctx: any) => {
    const id = await ctx.storage.store(new Blob([new Uint8Array(2048)]));
    await ctx.db.patch(id, { ...(contentType ? { contentType } : {}), ...(size ? { size } : {}) });
    return id;
  })) as any;
}

const fileExists = (t: T, id: any) => t.run(async (ctx: any) => (await ctx.db.system.get(id)) !== null);
const photoOf = (t: T, clientId: string) =>
  t.run(async (ctx: any) => {
    const rows = await ctx.db.query("careFoodLogs").collect();
    return rows.find((r: any) => r.clientId === clientId)?.photoStorageId ?? null;
  });

async function attach(t: T, owner: any, clientId: string, storageId: any) {
  await t.mutation(api.careLogs.attachFoodPhoto, { userId: owner, passwordHash: PW, patientUserId: owner, clientId, storageId });
}

describe("meal photos: upload + attach", () => {
  it("a guardian uploads and attaches a meal photo; the doctor sees it's there and can fetch it", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    await logMeal(t, owner, "f1");
    await logMeal(t, owner, "f2");

    const url = await t.mutation(api.careLogs.generateFoodPhotoUploadUrl, { userId: owner, passwordHash: PW, patientUserId: owner });
    expect(typeof url).toBe("string");
    const photo = await upload(t);
    await attach(t, owner, "f1", photo);
    expect(await photoOf(t, "f1")).toBe(photo);

    const logs = await t.query(api.doctorAccounts.getCareLogs, {
      serverSecret: SECRET,
      accessCode: CODE,
      fromTimestamp: "2000-01-01T00:00:00.000Z",
      toTimestamp: "2100-01-01T00:00:00.000Z",
    });
    const byId = Object.fromEntries(logs.food.map((f: any) => [f.id, f]));
    expect(byId.f1.hasPhoto).toBe(true);
    expect(byId.f2.hasPhoto).toBe(false);
    // The storage id itself never leaves the backend.
    expect(JSON.stringify(logs)).not.toContain(String(photo));

    const got = await t.query(api.doctorAccounts.getFoodPhoto, { serverSecret: SECRET, accessCode: CODE.toLowerCase(), clientId: "f1" });
    expect(got).toMatchObject({ contentType: "image/jpeg" });
    expect(got!.url).toMatch(/^https:\/\//);
    expect(await t.query(api.doctorAccounts.getFoodPhoto, { serverSecret: SECRET, accessCode: CODE, clientId: "f2" })).toBeNull();
    expect(await t.query(api.doctorAccounts.getFoodPhoto, { serverSecret: SECRET, accessCode: "NOPE99", clientId: "f1" })).toBeNull();
    await expect(
      t.query(api.doctorAccounts.getFoodPhoto, { serverSecret: "wrong", accessCode: CODE, clientId: "f1" }),
    ).rejects.toThrow(/Unauthorized/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("only JPEG, PNG or WebP under 4 MB — and a refused file is left alone, not deleted", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    await logMeal(t, owner, "f1");
    for (const bad of [
      await upload(t, "image/svg+xml"),
      await upload(t, "image/heic"),
      await upload(t, "text/html"),
      await upload(t, null), // uploaded without a Content-Type
      await upload(t, "image/jpeg", 4 * 1024 * 1024 + 1),
    ]) {
      await expect(attach(t, owner, "f1", bad)).rejects.toThrow(/JPEG, PNG or WebP images under 4 MB/);
      expect(await fileExists(t, bad)).toBe(true);
    }
    expect(await photoOf(t, "f1")).toBeNull();

    const png = await upload(t, "image/png; charset=binary");
    await attach(t, owner, "f1", png);
    expect(await photoOf(t, "f1")).toBe(png);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("needs the entry to exist, and one upload belongs to one meal", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    const photo = await upload(t);
    await expect(attach(t, owner, "not-logged", photo)).rejects.toThrow(/Log the meal before/);

    await logMeal(t, owner, "f1");
    await logMeal(t, owner, "f2");
    await attach(t, owner, "f1", photo);
    await attach(t, owner, "f1", photo); // a retry is a no-op
    await expect(attach(t, owner, "f2", photo)).rejects.toThrow(/already attached to another meal/);
    expect(await photoOf(t, "f1")).toBe(photo);
    expect(await photoOf(t, "f2")).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("someone outside the circle can't upload or attach", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    await logMeal(t, owner, "f1");
    const stranger = await t.mutation(api.auth.register, { email: "x@example.com", passwordHash: "h-x" });
    await expect(
      t.mutation(api.careLogs.generateFoodPhotoUploadUrl, { userId: stranger, passwordHash: "h-x", patientUserId: owner }),
    ).rejects.toThrow(/Not allowed/);
    await expect(
      t.mutation(api.careLogs.attachFoodPhoto, {
        userId: stranger, passwordHash: "h-x", patientUserId: owner, clientId: "f1", storageId: await upload(t),
      }),
    ).rejects.toThrow(/Not allowed/);
    expect(await photoOf(t, "f1")).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("an access code with the log grant can attach; a view-only code can't", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    const perms = { viewReadings: true, viewLogs: true, useCalculator: false, chat: false };
    const { code: nurse } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: PW, patientUserId: owner, label: "Nurse", kind: "caregiver",
      permissions: { ...perms, log: true },
    });
    const { code: viewer } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: PW, patientUserId: owner, label: "Grandma", kind: "caregiver",
      permissions: { ...perms, log: false },
    });
    await t.mutation(api.careLogs.addFoodLogViaCode, { code: nurse, entry: meal("n1") });

    expect(typeof (await t.mutation(api.careLogs.generateFoodPhotoUploadUrlViaCode, { code: nurse }))).toBe("string");
    const photo = await upload(t);
    await t.mutation(api.careLogs.attachFoodPhotoViaCode, { code: nurse, clientId: "n1", storageId: photo });
    expect(await photoOf(t, "n1")).toBe(photo);

    await expect(t.mutation(api.careLogs.generateFoodPhotoUploadUrlViaCode, { code: viewer })).rejects.toThrow(/cannot/);
    await expect(
      t.mutation(api.careLogs.attachFoodPhotoViaCode, { code: viewer, clientId: "n1", storageId: await upload(t) }),
    ).rejects.toThrow(/cannot/);
    expect(await photoOf(t, "n1")).toBe(photo);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

describe("meal photos: no orphaned files", () => {
  it("replacing a photo deletes the old file", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    await logMeal(t, owner, "f1");
    const first = await upload(t);
    const second = await upload(t);
    await attach(t, owner, "f1", first);
    await attach(t, owner, "f1", second);
    expect(await photoOf(t, "f1")).toBe(second);
    expect(await fileExists(t, first)).toBe(false);
    expect(await fileExists(t, second)).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("deleting an entry (account or code) or clearing the log deletes its photo", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: PW, patientUserId: owner, label: "Nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });
    const photos: Record<string, any> = {};
    for (const id of ["a", "b", "c", "d"]) {
      await logMeal(t, owner, id);
      photos[id] = await upload(t);
      await attach(t, owner, id, photos[id]);
    }

    await t.mutation(api.careLogs.deleteFoodLog, { userId: owner, passwordHash: PW, patientUserId: owner, clientId: "a" });
    expect(await fileExists(t, photos.a)).toBe(false);
    await t.mutation(api.careLogs.deleteFoodLogViaCode, { code, clientId: "b" });
    expect(await fileExists(t, photos.b)).toBe(false);
    expect(await fileExists(t, photos.c)).toBe(true);

    await t.mutation(api.careLogs.clearFood, { userId: owner, passwordHash: PW, patientUserId: owner });
    expect(await fileExists(t, photos.c)).toBe(false);
    expect(await fileExists(t, photos.d)).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("the FOOD_CAP prune deletes the dropped entry's photo", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    const oldPhoto = await upload(t);
    await t.run(async (ctx: any) => {
      for (let i = 0; i < 200; i++) {
        await ctx.db.insert("careFoodLogs", {
          patientUserId: owner,
          authorUserId: owner,
          authorName: "Mom",
          createdAt: Date.now(),
          ...meal(`old${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
          ...(i === 0 ? { photoStorageId: oldPhoto } : {}),
        });
      }
    });
    await logMeal(t, owner, "new"); // entry 201 — the oldest is pruned
    expect(await photoOf(t, "old0")).toBeNull();
    expect(await fileExists(t, oldPhoto)).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  it("a photo shared by a joiner's copied entries is kept until the last copy goes", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedOwner(t);
    const joiner = await seedOwner(t, "joiner@example.com", "JNR234");
    await t.mutation(api.careLogs.addFoodLog, { userId: joiner, passwordHash: PW, patientUserId: joiner, entry: meal("j1") });
    const photo = await upload(t);
    await attach(t, joiner, "j1", photo);

    // Joining a circle copies the joiner's entries into it and leaves the originals in place.
    await t.run(async (ctx: any) => copyBucketLogs(ctx, joiner, owner, "Dad"));
    const rows = await t.run(async (ctx: any) =>
      (await ctx.db.query("careFoodLogs").collect()).filter((r: any) => r.clientId === "j1"),
    );
    expect(rows.map((r: any) => r.photoStorageId)).toEqual([photo, photo]);

    await t.mutation(api.careLogs.deleteFoodLog, { userId: owner, passwordHash: PW, patientUserId: owner, clientId: "j1" });
    expect(await fileExists(t, photo)).toBe(true);
    await t.mutation(api.careLogs.deleteFoodLog, { userId: joiner, passwordHash: PW, patientUserId: joiner, clientId: "j1" });
    expect(await fileExists(t, photo)).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
