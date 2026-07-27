import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
const HASH_A = "hash-a";
const HASH_B = "hash-b";

async function setup() {
  const t = convexTest(schema, modules);
  const patient = await t.mutation(api.auth.register, { email: "mom@example.com", passwordHash: HASH_A });
  const member = await t.mutation(api.auth.register, { email: "dad@example.com", passwordHash: HASH_B });
  await t.mutation(api.patientProfile.replace, {
    userId: patient, passwordHash: HASH_A,
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  await t.mutation(api.patientProfile.replace, {
    userId: member, passwordHash: HASH_B,
    profile: { childName: "Dad", parentName: "Dad", diabetesType: "type1", dateOfBirth: "1985-01-01" },
  });
  return { t, patient, member };
}

async function link(t: any, patient: string, member: string) {
  const { code } = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
  await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code });
}

describe("push token registration", () => {
  it("registers a guardian device and defaults every category to on", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.push.registerToken, {
      userId: patient, passwordHash: HASH_A, token: "ExponentPushToken[mom]", platform: "ios",
    });
    const prefs = await t.query(api.push.getPrefs, { token: "ExponentPushToken[mom]" });
    expect(prefs?.prefs).toEqual({
      glucoseUrgent: true, glucoseHighLow: true, careLog: true, messages: true, doctor: true,
    });
  });

  it("registers an access-code device, and re-registering re-points the same token", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "School nurse", kind: "caregiver",
    });
    await t.mutation(api.push.registerToken, { code, token: "ExponentPushToken[dev]", platform: "ios" });
    // Same physical device later signs in as the guardian — one row, re-pointed.
    await t.mutation(api.push.registerToken, {
      userId: patient, passwordHash: HASH_A, token: "ExponentPushToken[dev]", platform: "ios",
    });
    const rows = await t.run(async (ctx: any) => await ctx.db.query("pushTokens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(patient);
    expect(rows[0].code).toBeUndefined();
  });

  it("rejects a bad credential", async () => {
    const { t, patient } = await setup();
    await expect(
      t.mutation(api.push.registerToken, { userId: patient, passwordHash: "wrong", token: "x", platform: "ios" }),
    ).rejects.toThrow();
  });

  it("unregister stops delivery but preserves prefs for a later re-register", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: "tok", platform: "ios" });
    await t.mutation(api.push.setPrefs, {
      token: "tok",
      prefs: { glucoseUrgent: true, glucoseHighLow: false, careLog: false, messages: true, doctor: true },
    });
    await t.mutation(api.push.unregisterToken, { token: "tok" });
    expect(await t.query(api.push.getPrefs, { token: "tok" })).toBeNull();
    const row = await t.run(async (ctx: any) => (await ctx.db.query("pushTokens").collect())[0]);
    expect(row.prefs.careLog).toBe(false); // survived
  });
});

describe("recipient resolution", () => {
  it("notifies the other guardians + codes, never the actor, and honors per-device prefs", async () => {
    const { t, patient, member } = await setup();
    await link(t, patient, member);
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "School nurse", kind: "caregiver",
    });
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: "tok-mom", platform: "ios" });
    await t.mutation(api.push.registerToken, { userId: member, passwordHash: HASH_B, token: "tok-dad", platform: "ios" });
    await t.mutation(api.push.registerToken, { code, token: "tok-nurse", platform: "ios" });

    // Mom logged it → everyone but Mom.
    const tokens = await t.query(internal.push.collectTokens, {
      patientUserId: patient, category: "careLog", excludeUserId: patient as any,
    });
    expect(tokens.map((x) => x.token).sort()).toEqual(["tok-dad", "tok-nurse"]);

    // Dad mutes care-log alerts → he drops out.
    await t.mutation(api.push.setPrefs, {
      token: "tok-dad",
      prefs: { glucoseUrgent: true, glucoseHighLow: true, careLog: false, messages: true, doctor: true },
    });
    const after = await t.query(internal.push.collectTokens, {
      patientUserId: patient, category: "careLog", excludeUserId: patient as any,
    });
    expect(after.map((x) => x.token)).toEqual(["tok-nurse"]);
    // ...but he still gets urgent glucose, which he left on.
    const urgent = await t.query(internal.push.collectTokens, { patientUserId: patient, category: "glucoseUrgent" });
    expect(urgent.map((x) => x.token).sort()).toEqual(["tok-dad", "tok-mom", "tok-nurse"]);
  });

  it("skips an access-code device that is outside its schedule window", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Babysitter", kind: "caregiver",
      access: { mode: "window", startMs: 0, endMs: 1 }, // window ended long ago
    });
    await t.mutation(api.push.registerToken, { code, token: "tok-sitter", platform: "ios" });
    const tokens = await t.query(internal.push.collectTokens, { patientUserId: patient, category: "careLog" });
    expect(tokens).toEqual([]);
  });

  it("targets ONLY the recipient endpoint for a direct message", async () => {
    const { t, patient, member } = await setup();
    await link(t, patient, member);
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: "tok-mom", platform: "ios" });
    await t.mutation(api.push.registerToken, { userId: member, passwordHash: HASH_B, token: "tok-dad", platform: "ios" });
    const tokens = await t.query(internal.push.collectTokens, {
      patientUserId: patient, category: "messages", onlyUserId: member as any,
    });
    expect(tokens.map((x) => x.token)).toEqual(["tok-dad"]);
  });
});

describe("glucose alert evaluation (server-side, app closed)", () => {
  it("records the zone and suppresses in-zone repeats inside the 11-minute window", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: "tok-mom", platform: "ios" });

    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 48 });
    let state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    expect(state).toHaveLength(1);
    expect(state[0].kind).toBe("urgent_low");
    const firstSentAt = state[0].lastSentAt;
    expect(firstSentAt).toBeGreaterThan(0);

    // Still in the emergency zone moments later → the 11-minute repeat timer holds it.
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 47 });
    state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    expect(state).toHaveLength(1);
    expect(state[0].lastSentAt).toBe(firstSentAt);
    await t.finishInProgressScheduledFunctions();
  });

  it("high fires only on the crossing, and recovery from urgent does not re-alert", async () => {
    const { t, patient } = await setup();
    // in-range seeds the state row without alerting…
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 120 });
    let state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    expect(state).toHaveLength(1);
    expect(state[0].kind).toBe("in_range");
    expect(state[0].lastSentAt).toBe(0);
    // …crossing into high records the zone; lingering keeps it; dropping back from urgent_high
    // to high never resets lastSentAt (no non-urgent send ever touches the urgent timer).
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 200 });
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 210 });
    state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    expect(state).toHaveLength(1);
    expect(state[0].kind).toBe("high");
    expect(state[0].lastSentAt).toBe(0);
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 260 });
    state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    const urgentSentAt = state[0].lastSentAt;
    expect(state[0].kind).toBe("urgent_high");
    expect(urgentSentAt).toBeGreaterThan(0);
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 220 });
    state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    expect(state[0].kind).toBe("high");
    expect(state[0].lastSentAt).toBe(urgentSentAt);
    // Drain the notify jobs the sends scheduled, so nothing runs after the test transaction closes.
    await t.finishInProgressScheduledFunctions();
  });

  it("uses the patient's own configured thresholds", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.patientProfile.setAlertPreferences, {
      userId: patient, passwordHash: HASH_A,
      alertPreferences: { urgentLowThreshold: 60, lowThreshold: 90, highThreshold: 140, urgentHighThreshold: 200 },
    });
    // 150 is in range on defaults, but HIGH against this patient's tighter thresholds.
    await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 150 });
    const state = await t.run(async (ctx: any) => await ctx.db.query("pushAlertState").collect());
    expect(state).toHaveLength(1);
    expect(state[0].kind).toBe("high");
    await t.finishInProgressScheduledFunctions();
  });
});
