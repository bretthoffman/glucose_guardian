import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
const HASH_A = "hash-a";
const HASH_B = "hash-b";
const BASE = { childName: "Bella", diabetesType: "type1" as const, dateOfBirth: "2014-01-01" };

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: HASH_A });
  const member = await t.mutation(api.auth.register, { email: "member@example.com", passwordHash: HASH_B });
  // Onboarding's first write carries the dose settings — a row with none takes them from the payload.
  await t.mutation(api.patientProfile.replace, { userId: owner, passwordHash: HASH_A, profile: { ...BASE, carbRatio: 30, targetGlucose: 160, correctionFactor: 160 } });
  // The member's own row holds the old poisoned defaults.
  await t.mutation(api.patientProfile.replace, { userId: member, passwordHash: HASH_B, profile: { ...BASE, childName: "Dad", carbRatio: 15, targetGlucose: 120, correctionFactor: 50 } });
  return { t, owner, member };
}
const audit = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.query("doseSettingsAudit").collect()).sort((a, b) => a.at - b.at));

describe("dose settings are server-owned", () => {
  it("a generic profile save can no longer change them — the stale-device / old-bundle revert", async () => {
    const { t, owner } = await setup();
    // A device with a stale cache saves some unrelated field and echoes its old dose math (or defaults).
    await t.mutation(api.patientProfile.replace, { userId: owner, passwordHash: HASH_A, profile: { ...BASE, weightLbs: 70, carbRatio: 15, targetGlucose: 120, correctionFactor: 50 } });
    const p = await t.query(api.patientProfile.get, { userId: owner, passwordHash: HASH_A });
    expect([p?.carbRatio, p?.targetGlucose, p?.correctionFactor]).toEqual([30, 160, 160]);
    expect(p?.weightLbs).toBe(70); // the rest of the save still lands
    const rows = await audit(t);
    const ignored = rows.filter((r) => r.kind === "ignored" && r.patientUserId === owner);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]!.before.carbRatio).toBe(30);
    expect(ignored[0]!.after.carbRatio).toBe(15);
  });

  it("a save that omits them entirely (onboarding re-run on an empty read) keeps them, per-meal overrides included", async () => {
    const { t, owner } = await setup();
    await t.mutation(api.patientProfile.setDoseSettings, {
      userId: owner, passwordHash: HASH_A, carbRatio: 30, targetGlucose: 160, correctionFactor: 160,
      doseSettingsByTime: { breakfast: { carbRatio: 20 } }, source: "dashboard",
    });
    await t.mutation(api.patientProfile.replace, { userId: owner, passwordHash: HASH_A, profile: { ...BASE } });
    const p = await t.query(api.patientProfile.get, { userId: owner, passwordHash: HASH_A });
    expect(p?.carbRatio).toBe(30);
    expect(p?.doseSettingsByTime).toEqual({ breakfast: { carbRatio: 20 } });
  });

  it("setDoseSettings changes them, stamps the row, and records who/what/from-where", async () => {
    const { t, owner } = await setup();
    const res = await t.mutation(api.patientProfile.setDoseSettings, {
      userId: owner, passwordHash: HASH_A, carbRatio: 25, targetGlucose: 150, correctionFactor: 140, source: "dashboard", appVersion: "1.0.0+abcd1234",
    });
    expect(res).toEqual({ changed: true });
    const p = await t.query(api.patientProfile.get, { userId: owner, passwordHash: HASH_A });
    expect([p?.carbRatio, p?.targetGlucose, p?.correctionFactor]).toEqual([25, 150, 140]);
    expect(p?.accessLog?.at(-1)?.action).toContain("CR 30 · Target 160 · ISF 160 → CR 25 · Target 150 · ISF 140");
    const last = (await audit(t)).filter((r) => r.kind === "changed").at(-1)!;
    expect(last.source).toBe("dashboard");
    expect(last.appVersion).toBe("1.0.0+abcd1234");
    expect(last.before.carbRatio).toBe(30);
    expect(last.after.carbRatio).toBe(25);
    // Same values again → a no-op, no audit noise.
    const again = await t.mutation(api.patientProfile.setDoseSettings, { userId: owner, passwordHash: HASH_A, carbRatio: 25, targetGlucose: 150, correctionFactor: 140, source: "dashboard" });
    expect(again).toEqual({ changed: false });
  });

  it("clears per-meal overrides only when told to (null), leaves them when omitted", async () => {
    const { t, owner } = await setup();
    const base = { userId: owner, passwordHash: HASH_A, carbRatio: 30, targetGlucose: 160, correctionFactor: 160, source: "dashboard" };
    await t.mutation(api.patientProfile.setDoseSettings, { ...base, doseSettingsByTime: { dinner: { correctionFactor: 120 } } });
    await t.mutation(api.patientProfile.setDoseSettings, { ...base, carbRatio: 28 });
    expect((await t.query(api.patientProfile.get, { userId: owner, passwordHash: HASH_A }))?.doseSettingsByTime).toEqual({ dinner: { correctionFactor: 120 } });
    await t.mutation(api.patientProfile.setDoseSettings, { ...base, carbRatio: 28, doseSettingsByTime: null });
    expect((await t.query(api.patientProfile.get, { userId: owner, passwordHash: HASH_A }))?.doseSettingsByTime).toBeUndefined();
  });

  it("rejects out-of-range values", async () => {
    const { t, owner } = await setup();
    await expect(
      t.mutation(api.patientProfile.setDoseSettings, { userId: owner, passwordHash: HASH_A, carbRatio: 0, targetGlucose: 160, correctionFactor: 160, source: "dashboard" }),
    ).rejects.toThrow();
  });
});

describe("a linked co-guardian reads the OWNER's dose settings from the server", () => {
  async function linked() {
    const s = await setup();
    const { code } = await s.t.mutation(api.careCircle.createInvite, { userId: s.owner, passwordHash: HASH_A, patientUserId: s.owner });
    await s.t.mutation(api.careCircle.redeemInvite, { userId: s.member, passwordHash: HASH_B, code });
    return s;
  }

  it("their own profile read returns the owner's ratios — never the stale defaults on their own row", async () => {
    const { t, member } = await linked();
    const p = await t.query(api.patientProfile.get, { userId: member, passwordHash: HASH_B });
    expect([p?.carbRatio, p?.targetGlucose, p?.correctionFactor]).toEqual([30, 160, 160]);
    expect(p?.childName).toBe("Dad"); // personal fields stay their own
  });

  it("follows the owner's changes, cannot set dose settings itself, and its profile saves are not logged as attempts", async () => {
    const { t, owner, member } = await linked();
    await t.mutation(api.patientProfile.setDoseSettings, { userId: owner, passwordHash: HASH_A, carbRatio: 22, targetGlucose: 140, correctionFactor: 120, source: "dashboard" });
    expect((await t.query(api.patientProfile.get, { userId: member, passwordHash: HASH_B }))?.carbRatio).toBe(22);
    await expect(
      t.mutation(api.patientProfile.setDoseSettings, { userId: member, passwordHash: HASH_B, carbRatio: 10, targetGlucose: 100, correctionFactor: 40, source: "dashboard" }),
    ).rejects.toThrow();
    // The member saves a personal field; its payload echoes the owner's ratios it was shown. Harmless, unlogged.
    await t.mutation(api.patientProfile.replace, { userId: member, passwordHash: HASH_B, profile: { ...BASE, childName: "Dad", parentName: "Brian", carbRatio: 22, targetGlucose: 140, correctionFactor: 120 } });
    expect((await audit(t)).filter((r) => r.patientUserId === member && r.kind === "ignored")).toHaveLength(0);
  });
});
