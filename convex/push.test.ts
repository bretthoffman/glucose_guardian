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
      glucoseUrgent: true, glucoseHigh: true, glucoseLow: true, riseFast: true, fallFast: true,
      careLog: true, messages: true, doctor: true,
    });
  });

  it("keeps a SEPARATE settings row per identity on one device, with only the signed-in one live", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "School nurse", kind: "caregiver",
    });
    const TOKEN = "ExponentPushToken[dev]";

    // The caregiver code signs in on this phone and picks its own sound.
    await t.mutation(api.push.registerToken, { code, token: TOKEN, platform: "ios" });
    await t.mutation(api.push.setSounds, { token: TOKEN, sounds: { urgent: "siren.wav" } });

    // Same physical device later signs in as the guardian: a NEW row, default settings — the
    // caregiver's choices must not become the guardian's.
    await t.mutation(api.push.registerToken, {
      userId: patient, passwordHash: HASH_A, token: TOKEN, platform: "ios",
    });
    expect((await t.query(api.push.getPrefs, { token: TOKEN }))?.sounds).toEqual({});
    await t.mutation(api.push.setSounds, { token: TOKEN, sounds: { urgent: "chime.wav" } });

    const rows = await t.run(async (ctx: any) => await ctx.db.query("pushTokens").collect());
    expect(rows).toHaveLength(2);
    // Exactly one row is live — so the device is never double-delivered.
    expect(rows.filter((r: any) => r.disabledAt == null)).toHaveLength(1);
    const codeRow = rows.find((r: any) => r.code === code);
    const userRow = rows.find((r: any) => r.userId === patient);
    expect(codeRow.sounds).toEqual({ urgent: "siren.wav" }); // preserved, untouched
    expect(userRow.sounds).toEqual({ urgent: "chime.wav" });
    expect(codeRow.disabledAt).toBeGreaterThan(0);

    // Signing the caregiver code back in restores ITS settings and parks the guardian's.
    await t.mutation(api.push.registerToken, { code, token: TOKEN, platform: "ios" });
    expect((await t.query(api.push.getPrefs, { token: TOKEN }))?.sounds).toEqual({ urgent: "siren.wav" });
  });

  it("a toggle change on one identity never leaks to the other identity on the same phone", async () => {
    const { t, patient } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient, passwordHash: HASH_A, patientUserId: patient, label: "Sitter", kind: "caregiver",
    });
    const TOKEN = "ExponentPushToken[shared]";
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: TOKEN, platform: "ios" });
    await t.mutation(api.push.setPrefs, {
      token: TOKEN,
      prefs: { glucoseUrgent: true, glucoseHigh: true, glucoseLow: true, riseFast: true, fallFast: true, careLog: true, messages: true, doctor: true },
    });

    await t.mutation(api.push.registerToken, { code, token: TOKEN, platform: "ios" });
    await t.mutation(api.push.setPrefs, {
      token: TOKEN,
      prefs: { glucoseUrgent: false, glucoseHigh: false, glucoseLow: false, riseFast: false, fallFast: false, careLog: false, messages: false, doctor: false },
    });

    // Back to the guardian: everything it had is still on.
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: TOKEN, platform: "ios" });
    const prefs = (await t.query(api.push.getPrefs, { token: TOKEN }))?.prefs;
    expect(prefs?.glucoseUrgent).toBe(true);
    expect(prefs?.careLog).toBe(true);
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
  it("fires on EVERY new reading — one zone category per reading, no repeat timers", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.push.registerToken, { userId: patient, passwordHash: HASH_A, token: "tok-mom", platform: "ios" });

    // Urgent low fires each time it's evaluated — back-to-back readings both alert.
    let res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 48 });
    expect(res).toEqual({ zone: "urgent_low", trend: null });
    res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 47 });
    expect(res.zone).toBe("urgent_low");
    // In range → nothing fires. (No state machine left to re-arm — it's per reading.)
    res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 120 });
    expect(res.zone).toBeNull();
    await t.finishInProgressScheduledFunctions();
  });

  it("urgent-high readings fire as the HIGH category (urgent is reserved for lows)", async () => {
    const { t, patient } = await setup();
    let res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 260 });
    expect(res.zone).toBe("urgent_high"); // zone name (and its "very high" copy) is preserved…
    res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 200 });
    expect(res.zone).toBe("high");
    await t.finishInProgressScheduledFunctions();
  });

  it("uses the patient's own configured thresholds", async () => {
    const { t, patient } = await setup();
    await t.mutation(api.patientProfile.setAlertPreferences, {
      userId: patient, passwordHash: HASH_A,
      alertPreferences: { urgentLowThreshold: 60, lowThreshold: 90, highThreshold: 140, urgentHighThreshold: 200 },
    });
    // 150 is in range on defaults, but HIGH against this patient's tighter thresholds.
    const res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 150 });
    expect(res.zone).toBe("high");
    await t.finishInProgressScheduledFunctions();
  });

  it("classifies the trend: sensor arrow first, else the rate from stored readings", async () => {
    const { t, patient } = await setup();
    // Sensor arrow wins outright.
    let res = await t.mutation(internal.push.evaluateGlucoseForPush, {
      patientUserId: patient as any, value: 150, dexcomTrend: "SingleDown",
    });
    expect(res.trend).toBe("fall_fast");
    // No arrow: the two newest stored readings give ~3 mg/dL/min rising.
    const base = Date.now();
    await t.run(async (ctx: any) => {
      await ctx.db.insert("patientGlucoseReadings", {
        userId: patient, glucose: 140, timestamp: new Date(base - 5 * 60_000).toISOString(), anomaly: { warning: false },
      });
      await ctx.db.insert("patientGlucoseReadings", {
        userId: patient, glucose: 155, timestamp: new Date(base).toISOString(), anomaly: { warning: false },
      });
    });
    res = await t.mutation(internal.push.evaluateGlucoseForPush, { patientUserId: patient as any, value: 155 });
    expect(res.trend).toBe("rise_fast");
    expect(res.zone).toBeNull(); // 155 is in range — a trend alert can fire alone
    await t.finishInProgressScheduledFunctions();
  });
});
