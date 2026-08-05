import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
describe("via-code log attribution is taken from the VERIFIED caller", () => {
  it("credits the authenticated account, not the id the client asked to credit", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-owner" });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "h-owner",
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    // A signed-in caregiver (Clerk identity) holding the code.
    const asNurse = t.withIdentity({ subject: "clerk_nurse", email: "nurse@example.com" });
    const nurse = (await asNurse.mutation(api.identity.ensureUser, {})).userId;

    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h-owner", patientUserId: owner, label: "Nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });

    // The nurse logs through the code but CLAIMS the log belongs to the OWNER. `userCompat` resolves
    // the Clerk identity and ignores the supplied id, so the old guard passed and wrote `owner`.
    await asNurse.mutation(api.careLogs.addFoodLogViaCode, {
      code,
      entry: { clientId: "f1", timestamp: new Date().toISOString(), foodName: "Toast", estimatedCarbs: 20, insulinUnits: 1, confidence: "high", fromPhoto: false },
      authorUserId: owner as any,
    });

    const rows = await t.run(async (ctx: any) => await ctx.db.query("careFoodLogs").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].authorUserId).toBe(nurse);
    expect(rows[0].authorUserId).not.toBe(owner);
    await t.finishInProgressScheduledFunctions();
  });

  it("an accountless code session still falls back to the code's own label", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.auth.register, { email: "o2@example.com", passwordHash: "h2" });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "h2",
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h2", patientUserId: owner, label: "Babysitter", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });
    await t.mutation(api.careLogs.addFoodLogViaCode, {
      code,
      entry: { clientId: "f2", timestamp: new Date().toISOString(), foodName: "Apple", estimatedCarbs: 15, insulinUnits: 1, confidence: "high", fromPhoto: false },
    });
    const rows = await t.run(async (ctx: any) => await ctx.db.query("careFoodLogs").collect());
    expect(rows[0].authorUserId).toBeUndefined();
    expect(rows[0].authorName).toBeTruthy();
    await t.finishInProgressScheduledFunctions();
  });
});

describe("access-code readings do NOT depend on the guardian being signed in", () => {
  it("returns the patient's readings to a code holder with no authenticated identity at all", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.auth.register, { email: "g@example.com", passwordHash: "hg" });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "hg",
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "hg", patientUserId: owner, label: "Nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });

    // Readings land server-side (the ingest cron writes these regardless of any app being open).
    await t.run(async (ctx: any) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("patientGlucoseReadings", {
          userId: owner,
          glucose: 100 + i,
          timestamp: new Date(Date.UTC(2026, 7, 4, 10, i)).toISOString(),
          anomaly: { warning: false },
        });
      }
    });

    // `t` carries NO identity — this is precisely a caregiver on a phone where the guardian is
    // signed out. Clearing the device cache on sign-out must not affect this.
    const readings = await t.query(api.careCircle.glucoseForAccessCode, { code, limit: 300 });
    expect(readings.length).toBe(3);
    expect(readings.some((r: any) => r.glucose === 101)).toBe(true);
  });
});

describe("patientProfile.replace never destroys server-generated fields", () => {
  it("keeps the caregiver code, doctor code and access log when a partial profile is saved", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.mutation(api.auth.register, { email: "p@example.com", passwordHash: "hp" });

    // Full profile, as a settled account would have it.
    await t.mutation(api.patientProfile.replace, {
      userId, passwordHash: "hp",
      profile: {
        childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01",
        caregiverCode: "ABC123", caregiverCodeIssuedAt: "2026-08-01T00:00:00.000Z",
        doctorCode: "XYZ789", doctorCodeIssuedAt: "2026-08-01T00:00:00.000Z",
        doctorName: "Dr. Who",
        accessLog: [{ id: "log_1", timestamp: "2026-08-01T00:00:00.000Z", action: "Caregiver code generated", actor: "owner" }],
      },
    });

    // Now the destructive case: onboarding-shaped payload with none of those fields.
    await t.mutation(api.patientProfile.replace, {
      userId, passwordHash: "hp",
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });

    const row = await t.run(async (ctx: any) =>
      await ctx.db.query("patientProfiles").withIndex("by_userId", (q: any) => q.eq("userId", userId)).unique(),
    );
    expect(row.caregiverCode).toBe("ABC123");
    expect(row.doctorCode).toBe("XYZ789");
    expect(row.accessLog).toHaveLength(1);
  });

  it("still lets a user CLEAR an editable doctor field", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.mutation(api.auth.register, { email: "p2@example.com", passwordHash: "hp2" });
    const base = { childName: "Bella", parentName: "Mom", diabetesType: "type1" as const, dateOfBirth: "2014-01-01" };
    await t.mutation(api.patientProfile.replace, {
      userId, passwordHash: "hp2", profile: { ...base, doctorName: "Dr. Who", doctorPhone: "555-0100" },
    });
    await t.mutation(api.patientProfile.replace, { userId, passwordHash: "hp2", profile: base });
    const row = await t.run(async (ctx: any) =>
      await ctx.db.query("patientProfiles").withIndex("by_userId", (q: any) => q.eq("userId", userId)).unique(),
    );
    expect(row.doctorName).toBeUndefined();
    expect(row.doctorPhone).toBeUndefined();
  });
});

describe("access-code log attribution records WHICH code wrote the entry", () => {
  it("stamps authorCode so the writing device can recognise its own entry", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.auth.register, { email: "o@ac.com", passwordHash: "ho" });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "ho",
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    // A code labelled "me" is the exact case that looked broken: the label alone can't identify a writer.
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "ho", patientUserId: owner, label: "me", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });

    await t.mutation(api.careLogs.addFoodLogViaCode, {
      code,
      entry: { clientId: "f1", timestamp: new Date().toISOString(), foodName: "Apple", estimatedCarbs: 25, insulinUnits: 1.7, confidence: "high", fromPhoto: false },
    });

    const rows = await t.run(async (ctx: any) => await ctx.db.query("careFoodLogs").collect());
    expect(rows).toHaveLength(1);
    // The label is still the human-facing byline for everyone else...
    expect(rows[0].authorName).toBe("me");
    // ...but the CODE is now recorded, which is what lets the writing device say "by you".
    expect(rows[0].authorCode).toBe(code);
    expect(rows[0].authorUserId).toBeUndefined();
    await t.finishInProgressScheduledFunctions();
  });

  it("does not stamp a code when a signed-in account logs through one", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.auth.register, { email: "o2@ac.com", passwordHash: "h2" });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "h2",
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const asNurse = t.withIdentity({ subject: "clerk_n2", email: "n2@ac.com" });
    const nurse = (await asNurse.mutation(api.identity.ensureUser, {})).userId;
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h2", patientUserId: owner, label: "Nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });
    await asNurse.mutation(api.careLogs.addFoodLogViaCode, {
      code,
      entry: { clientId: "f2", timestamp: new Date().toISOString(), foodName: "Toast", estimatedCarbs: 20, insulinUnits: 1, confidence: "high", fromPhoto: false },
      authorUserId: nurse as any,
    });
    const rows = await t.run(async (ctx: any) => await ctx.db.query("careFoodLogs").collect());
    // An ACCOUNT wrote this, so it is attributed to the account — not to the code.
    expect(rows[0].authorUserId).toBe(nurse);
    expect(rows[0].authorCode).toBeUndefined();
    await t.finishInProgressScheduledFunctions();
  });
});

describe("attribution across every identity type", () => {
  async function owner(t: any, email: string, hash: string) {
    const id = await t.mutation(api.auth.register, { email, passwordHash: hash });
    await t.mutation(api.patientProfile.replace, {
      userId: id, passwordHash: hash,
      profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    return id;
  }
  const PERMS = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };
  const entry = (clientId: string) => ({
    clientId, timestamp: new Date().toISOString(), foodName: "Snack",
    estimatedCarbs: 15, insulinUnits: 1, confidence: "high" as const, fromPhoto: false,
  });
  const rowsOf = (t: any) => t.run(async (ctx: any) => await ctx.db.query("careFoodLogs").collect());

  it("KID code: credited to the child by name, and stamped with the code", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, "kid-o@x.com", "h");
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: o, passwordHash: "h", patientUserId: o, label: "Bella's phone", kind: "child", permissions: PERMS,
    });
    await t.mutation(api.careLogs.addFoodLogViaCode, { code, entry: entry("k1") });
    const rows = await rowsOf(t);
    // A child code is the patient's own device, so the byline is the CHILD's name (not the label).
    expect(rows[0].authorName).toBe("Bella");
    expect(rows[0].authorCode).toBe(code); // ...and the kid's device can still see "by you"
    expect(rows[0].authorUserId).toBeUndefined();
    await t.finishInProgressScheduledFunctions();
  });

  it("CO-GUARDIAN: credited to their own account, so each guardian sees the other by name", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, "cg-o@x.com", "ho");
    const member = await t.mutation(api.auth.register, { email: "cg-m@x.com", passwordHash: "hm" });
    await t.mutation(api.patientProfile.replace, {
      userId: member, passwordHash: "hm",
      profile: { childName: "Bella", parentName: "Dad", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const { code } = await t.mutation(api.careCircle.createInvite, { userId: o, passwordHash: "ho", patientUserId: o });
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: "hm", code });

    await t.mutation(api.careLogs.addFoodLog, {
      userId: member, passwordHash: "hm", patientUserId: o, entry: entry("c1"),
    });
    const rows = await rowsOf(t);
    expect(rows[0].authorUserId).toBe(member); // exact identity → "by you" on their device only
    expect(rows[0].authorName).toBe("Dad"); // the OTHER guardian sees a real name, not "Bella"
    expect(rows[0].authorCode).toBeUndefined();
    await t.finishInProgressScheduledFunctions();
  });

  it("CAREGIVER EMAIL account on a caregiver code: shown under the CODE's label", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, "ce-o@x.com", "h3");
    const asNurse = t.withIdentity({ subject: "clerk_ce", email: "nurse@x.com" });
    const nurse = (await asNurse.mutation(api.identity.ensureUser, {})).userId;
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: o, passwordHash: "h3", patientUserId: o, label: "Marcy Hoffman", kind: "caregiver", permissions: PERMS,
    });
    await asNurse.mutation(api.careLogs.addFoodLogViaCode, {
      code, entry: entry("n1"), authorUserId: nurse as any,
    });
    const rows = await rowsOf(t);
    expect(rows[0].authorName).toBe("Marcy Hoffman"); // the name the guardian set for the code
    expect(rows[0].authorUserId).toBe(nurse); // still exact, so her device reads "by you"
    await t.finishInProgressScheduledFunctions();
  });

  it("CAREGIVER EMAIL account on a CHILD code: never credited to the child", async () => {
    const t = convexTest(schema, modules);
    const o = await owner(t, "ck-o@x.com", "h4");
    const asNurse = t.withIdentity({ subject: "clerk_ck", email: "nurse2@x.com" });
    const nurse = (await asNurse.mutation(api.identity.ensureUser, {})).userId;
    await asNurse.mutation(api.patientProfile.replace, {
      profile: { childName: "Nina", diabetesType: "type1", dateOfBirth: "1990-01-01", accountRole: "caregiver" },
    });
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: o, passwordHash: "h4", patientUserId: o, label: "Bella's phone", kind: "child", permissions: PERMS,
    });
    await asNurse.mutation(api.careLogs.addFoodLogViaCode, {
      code, entry: entry("n2"), authorUserId: nurse as any,
    });
    const rows = await rowsOf(t);
    expect(rows[0].authorName).toBe("Nina"); // her own name — NOT "Bella"
    expect(rows[0].authorName).not.toBe("Bella");
    await t.finishInProgressScheduledFunctions();
  });
});
