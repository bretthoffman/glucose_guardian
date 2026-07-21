import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const HASH_A = "hash-a";
const HASH_B = "hash-b";

async function setup() {
  const t = convexTest(schema, modules);
  const patient = await t.mutation(api.auth.register, { email: "parent-a@example.com", passwordHash: HASH_A });
  const member = await t.mutation(api.auth.register, { email: "parent-b@example.com", passwordHash: HASH_B });
  // Patient needs a profile so displayName/childName resolve.
  await t.mutation(api.patientProfile.replace, {
    userId: patient,
    passwordHash: HASH_A,
    profile: { childName: "Bella", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  await t.mutation(api.patientProfile.replace, {
    userId: member,
    passwordHash: HASH_B,
    profile: { childName: "Dad", parentName: "Dad", diabetesType: "type1", dateOfBirth: "1985-01-01" },
  });
  return { t, patient, member };
}

describe("co-guardian invite → redeem → link", () => {
  it("creates an active link the patient and member both see", async () => {
    const { t, patient, member } = await setup();

    const { code } = await t.mutation(api.careCircle.createInvite, {
      userId: patient,
      passwordHash: HASH_A,
      patientUserId: patient,
    });
    expect(code).toHaveLength(8);

    const redeem = await t.mutation(api.careCircle.redeemInvite, {
      userId: member,
      passwordHash: HASH_B,
      code,
    });
    expect(redeem.patientName).toBe("Bella");

    // Both accounts resolve to the SAME shared circle (anchored on the patient) and see an identical
    // roster: owner + co-guardian, with "you" being whoever is asking.
    const ownerView = await t.query(api.careCircle.getCircle, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    const memberView = await t.query(api.careCircle.getCircle, { userId: member, passwordHash: HASH_B, patientUserId: patient });

    for (const view of [ownerView, memberView]) {
      expect(view?.guardians).toHaveLength(2); // owner + one co-guardian
      expect(view?.maxGuardians).toBe(4);
      expect(view?.patientName).toBe("Bella");
      expect(view?.guardians[0].isOwner).toBe(true);
      expect(view?.guardians.map((g) => g.userId).sort()).toEqual([patient, member].sort());
    }
    // "isMe" flips per viewer; the owner entry is always the patient account.
    expect(ownerView?.guardians.find((g) => g.isMe)?.userId).toBe(patient);
    expect(memberView?.guardians.find((g) => g.isMe)?.userId).toBe(member);
    expect(ownerView?.guardians.find((g) => g.isOwner)?.userId).toBe(patient);
    expect(memberView?.guardians.find((g) => g.isOwner)?.userId).toBe(patient);
    // Only co-guardian members carry a linkId (the owner can't be removed).
    expect(memberView?.guardians.find((g) => g.isOwner)?.linkId).toBeNull();
    expect(memberView?.guardians.find((g) => !g.isOwner)?.linkId).not.toBeNull();

    // Member also still sees the membership (drives anchor resolution on their device).
    const memberships = await t.query(api.careCircle.myMemberships, { userId: member, passwordHash: HASH_B });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].patientUserId).toBe(patient);
    expect(memberships[0].accessState.state).toBe("ok");
  });

  it("lets a linked co-guardian read the patient's glucose + logs and write a log", async () => {
    const { t, patient, member } = await setup();
    const { code } = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code });

    // Patient logs a meal; co-guardian logs insulin — both land in the patient's shared bucket.
    await t.mutation(api.careLogs.addFoodLog, {
      userId: patient,
      passwordHash: HASH_A,
      patientUserId: patient,
      entry: { clientId: "f1", timestamp: new Date().toISOString(), foodName: "Apple", estimatedCarbs: 15, insulinUnits: 1, confidence: "high", fromPhoto: false },
    });
    await t.mutation(api.careLogs.addInsulinLog, {
      userId: member,
      passwordHash: HASH_B,
      patientUserId: patient,
      entry: { clientId: "i1", timestamp: new Date().toISOString(), units: 2, type: "bolus" },
    });

    const logs = await t.query(api.careLogs.listLogs, { userId: member, passwordHash: HASH_B, patientUserId: patient });
    expect(logs?.foodLog).toHaveLength(1);
    expect(logs?.insulinLog).toHaveLength(1);
    expect(logs?.insulinLog[0].authorName).toBe("Dad"); // co-guardian byline
    expect(logs?.foodLog[0].authorName).toBe("Bella"); // patient byline
  });

  it("delivers a directed invite to the target's inbox and lets only them accept", async () => {
    const { t, patient, member } = await setup();
    const other = await t.mutation(api.auth.register, { email: "stranger@example.com", passwordHash: "hash-c" });

    const inv = await t.mutation(api.careCircle.createInvite, {
      userId: patient,
      passwordHash: HASH_A,
      patientUserId: patient,
      targetUserId: member,
    });
    expect(inv.delivered).toBe(true);

    // Tapping "invite" again reuses the same live invite — no duplicate incoming request.
    const inv2 = await t.mutation(api.careCircle.createInvite, {
      userId: patient,
      passwordHash: HASH_A,
      patientUserId: patient,
      targetUserId: member,
    });
    expect(inv2.code).toBe(inv.code);

    // It shows up in the target's inbox with who/what.
    const inbox = await t.query(api.careCircle.incomingInvites, { userId: member, passwordHash: HASH_B });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].patientName).toBe("Bella");
    expect(inbox[0].code).toBe(inv.code);

    // A stranger who somehow got the code cannot hijack the addressed seat.
    await expect(
      t.mutation(api.careCircle.redeemInvite, { userId: other, passwordHash: "hash-c", code: inv.code }),
    ).rejects.toThrow(/different account/);

    // The addressed member accepts → link created, inbox clears.
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code: inv.code });
    const circle = await t.query(api.careCircle.getCircle, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    expect(circle?.coGuardians).toHaveLength(1);
    const inboxAfter = await t.query(api.careCircle.incomingInvites, { userId: member, passwordHash: HASH_B });
    expect(inboxAfter).toHaveLength(0);
  });

  it("keeps the shared circle loadable after leave + rejoin (stale revoked link must not blank it)", async () => {
    const { t, patient, member } = await setup();

    const inv1 = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code: inv1.code });
    const mem1 = await t.query(api.careCircle.myMemberships, { userId: member, passwordHash: HASH_B });
    // Member leaves — link is revoked (row stays in the table).
    await t.mutation(api.careCircle.revokeLink, { userId: member, passwordHash: HASH_B, linkId: mem1[0].linkId });
    expect(await t.query(api.careCircle.myMemberships, { userId: member, passwordHash: HASH_B })).toHaveLength(0);

    // Rejoin — now the (patient, member) pair has BOTH a revoked and an active careLink row.
    const inv2 = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code: inv2.code });

    // The shared circle must still load for the member (activeLinkFor must find the ACTIVE row, not
    // the first/revoked one) — otherwise the whole panel goes blank.
    const view = await t.query(api.careCircle.getCircle, { userId: member, passwordHash: HASH_B, patientUserId: patient });
    expect(view).not.toBeNull();
    expect(view?.guardians).toHaveLength(2);
    expect(view?.guardians.some((g) => g.isMe && !g.isOwner)).toBe(true);
  });

  it("carries the code owner's alert thresholds to an access-code (child) session", async () => {
    const { t, patient } = await setup();

    // Owner sets custom thresholds; they persist and survive a later profile save.
    await t.mutation(api.patientProfile.setAlertPreferences, {
      userId: patient,
      passwordHash: HASH_A,
      alertPreferences: { lowThreshold: 80, highThreshold: 200, urgentLowThreshold: 60, urgentHighThreshold: 260 },
    });
    const got = await t.query(api.patientProfile.get, { userId: patient, passwordHash: HASH_A });
    expect(got?.alertPreferences?.highThreshold).toBe(200);

    await t.mutation(api.patientProfile.replace, {
      userId: patient,
      passwordHash: HASH_A,
      profile: { childName: "Bella", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const afterSave = await t.query(api.patientProfile.get, { userId: patient, passwordHash: HASH_A });
    expect(afterSave?.alertPreferences?.highThreshold).toBe(200); // profile save didn't wipe them

    // A child access code exposes the owner's thresholds to the borrowing device.
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: patient,
      passwordHash: HASH_A,
      patientUserId: patient,
      label: "Bella's phone",
      kind: "child",
    });
    const slim = await t.query(api.careCircle.profileForAccessCode, { code });
    expect(slim?.alertPreferences?.highThreshold).toBe(200);
    expect(slim?.alertPreferences?.lowThreshold).toBe(80);
  });

  it("rejects a stale/self/duplicate redemption", async () => {
    const { t, patient, member } = await setup();
    const { code } = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });

    await expect(
      t.mutation(api.careCircle.redeemInvite, { userId: patient, passwordHash: HASH_A, code }),
    ).rejects.toThrow(/your own care circle/);

    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code });
    // Second use of the same (now redeemed) code fails.
    await expect(
      t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code }),
    ).rejects.toThrow(/Invalid or already-used/);
  });
});
