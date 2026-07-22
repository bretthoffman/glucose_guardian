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
    expect(logs?.insulinLog[0].authorName).toBe("Dad"); // co-guardian byline (their parentName)
    // The patient/owner's own log is credited to the GUARDIAN, never the shared child name. This
    // setup's patient has no parentName, so it falls back to the email handle — but never "Bella".
    expect(logs?.foodLog[0].authorName).toBe("parent-a");
    expect(logs?.foodLog[0].authorName).not.toBe("Bella");
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

describe("co-guardian log bylines credit the guardian, not the shared child", () => {
  it("shows each guardian's own name — even when both used the child's name as childName", async () => {
    // The reported bug: Brian (owner) and Brittany (member) each typed "Bella" (the child) as their
    // account's child name. Both their logs showed "Bella" instead of their own names.
    const t = convexTest(schema, modules);
    const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "hash-brian" });
    const brittany = await t.mutation(api.auth.register, { email: "brittany@example.com", passwordHash: "hash-britt" });
    await t.mutation(api.patientProfile.replace, {
      userId: brian,
      passwordHash: "hash-brian",
      profile: { childName: "Bella", parentName: "Brian", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    await t.mutation(api.patientProfile.replace, {
      userId: brittany,
      passwordHash: "hash-britt",
      profile: { childName: "Bella", parentName: "Brittany", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    const { code } = await t.mutation(api.careCircle.createInvite, { userId: brian, passwordHash: "hash-brian", patientUserId: brian });
    await t.mutation(api.careCircle.redeemInvite, { userId: brittany, passwordHash: "hash-britt", code });

    // Both log "to themselves" (what each device does) — the circle bucket pools them.
    await t.mutation(api.careLogs.addFoodLog, {
      userId: brian, passwordHash: "hash-brian", patientUserId: brian,
      entry: { clientId: "bf1", timestamp: new Date().toISOString(), foodName: "Waffles", estimatedCarbs: 45, insulinUnits: 1.3, confidence: "high", fromPhoto: false },
    });
    await t.mutation(api.careLogs.addFoodLog, {
      userId: brittany, passwordHash: "hash-britt", patientUserId: brittany,
      entry: { clientId: "bf2", timestamp: new Date().toISOString(), foodName: "Pasta", estimatedCarbs: 45, insulinUnits: 1.3, confidence: "high", fromPhoto: false },
    });

    const logs = await t.query(api.careLogs.listLogs, { userId: brittany, passwordHash: "hash-britt", patientUserId: brittany });
    const byId = Object.fromEntries((logs?.foodLog ?? []).map((f) => [f.id, f.authorName]));
    expect(byId["bf1"]).toBe("Brian"); // the OWNER's own log — was showing "Bella"
    expect(byId["bf2"]).toBe("Brittany"); // the member's log
    expect(Object.values(byId)).not.toContain("Bella");
  });

  it("re-derives bylines live, repairing rows stored under the child name and reflecting renames", async () => {
    const t = convexTest(schema, modules);
    const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-own" });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "h-own",
      profile: { childName: "Bella", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    // Simulate a legacy row already stored under the child's name (pre-fix data).
    await t.run(async (ctx) => {
      await ctx.db.insert("careFoodLogs", {
        patientUserId: owner, authorUserId: owner, authorName: "Bella", clientId: "old",
        timestamp: new Date().toISOString(), foodName: "Juice", estimatedCarbs: 25, insulinUnits: 0.7,
        confidence: "high", fromPhoto: false, createdAt: Date.now(),
      });
    });
    // No parent name yet → falls back to the email handle, never the child's name.
    let logs = await t.query(api.careLogs.listLogs, { userId: owner, passwordHash: "h-own", patientUserId: owner });
    expect(logs?.foodLog[0].authorName).toBe("owner");
    expect(logs?.foodLog[0].authorName).not.toBe("Bella");
    // Owner sets their name in settings → the SAME historical row now shows it (live re-derivation).
    await t.mutation(api.careCircle.updateSharedProfile, { userId: owner, passwordHash: "h-own", patch: { doctorName: "keep" } });
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "h-own",
      profile: { childName: "Bella", parentName: "Brian", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2014-01-01" },
    });
    logs = await t.query(api.careLogs.listLogs, { userId: owner, passwordHash: "h-own", patientUserId: owner });
    expect(logs?.foodLog[0].authorName).toBe("Brian");
  });
});

describe("merged co-guardian care (one pool, owner-inherited settings)", () => {
  async function linked() {
    const { t, patient, member } = await setup();
    const { code } = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code });
    return { t, patient, member };
  }

  it("redirects a member's self-targeted log writes AND reads to the circle pool", async () => {
    const { t, patient, member } = await linked();

    // The member's device logs "to itself" (what an un-updated app does) — it must land in the pool.
    await t.mutation(api.careLogs.addFoodLog, {
      userId: member,
      passwordHash: HASH_B,
      patientUserId: member,
      entry: { clientId: "mf1", timestamp: new Date().toISOString(), foodName: "Toast", estimatedCarbs: 20, insulinUnits: 1, confidence: "medium", fromPhoto: false },
    });

    // The owner sees it, and the member reading "their own" logs sees the same pool — permanently,
    // not just until the next poll.
    const ownerLogs = await t.query(api.careLogs.listLogs, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    expect(ownerLogs?.foodLog.map((f) => f.id)).toEqual(["mf1"]);
    expect(ownerLogs?.foodLog[0].authorName).toBe("Dad");
    const memberLogs = await t.query(api.careLogs.listLogs, { userId: member, passwordHash: HASH_B, patientUserId: member });
    expect(memberLogs?.foodLog.map((f) => f.id)).toEqual(["mf1"]);
  });

  it("backfills the joiner's pre-link history into the pool at redeem time", async () => {
    const { t, patient, member } = await setup();

    // Yesterday, before linking, the member logged a meal + a dose in their own private bucket.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await t.mutation(api.careLogs.addFoodLog, {
      userId: member,
      passwordHash: HASH_B,
      patientUserId: member,
      entry: { clientId: "old-f", timestamp: yesterday, foodName: "Pasta", estimatedCarbs: 45, insulinUnits: 3, confidence: "high", fromPhoto: false },
    });
    await t.mutation(api.careLogs.addInsulinLog, {
      userId: member,
      passwordHash: HASH_B,
      patientUserId: member,
      entry: { clientId: "old-i", timestamp: yesterday, units: 3, type: "bolus" },
    });

    const { code } = await t.mutation(api.careCircle.createInvite, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    await t.mutation(api.careCircle.redeemInvite, { userId: member, passwordHash: HASH_B, code });

    // The owner now sees yesterday's entries, credited to the joiner.
    const ownerLogs = await t.query(api.careLogs.listLogs, { userId: patient, passwordHash: HASH_A, patientUserId: patient });
    expect(ownerLogs?.foodLog.map((f) => f.id)).toContain("old-f");
    expect(ownerLogs?.insulinLog.map((i) => i.id)).toContain("old-i");
    expect(ownerLogs?.foodLog.find((f) => f.id === "old-f")?.authorName).toBe("Dad");
  });

  it("inherits the owner's settings via circleContext and enforces owner-only edits", async () => {
    const { t, patient, member } = await linked();

    // Owner curates the account: dose math, insulin types, weight, thresholds, doctor office+code.
    await t.mutation(api.patientProfile.replace, {
      userId: patient,
      passwordHash: HASH_A,
      profile: {
        childName: "Bella", diabetesType: "type1", dateOfBirth: "2014-01-01", weightLbs: 62,
        doctorName: "Dr. Rivera", doctorEmail: "rivera@clinic.com", doctorInstitution: "MUSC",
        insulinTypes: ["Humalog · 100 u/mL"], carbRatio: 12, targetGlucose: 110, correctionFactor: 45,
        doctorCode: "DOC123", doctorCodeIssuedAt: new Date().toISOString(),
      },
    });
    await t.mutation(api.patientProfile.setAlertPreferences, {
      userId: patient,
      passwordHash: HASH_A,
      alertPreferences: { urgentLowThreshold: 50, lowThreshold: 65, highThreshold: 190, urgentHighThreshold: 260 },
    });

    // The member's app receives the owner's copy of everything — including the same doctor code.
    const ctx = await t.query(api.careCircle.circleContext, { userId: member, passwordHash: HASH_B });
    expect(ctx?.isOwner).toBe(false);
    expect(ctx?.anchorPatientUserId).toBe(patient);
    expect(ctx?.shared?.carbRatio).toBe(12);
    expect(ctx?.shared?.weightLbs).toBe(62);
    expect(ctx?.shared?.insulinTypes).toEqual(["Humalog · 100 u/mL"]);
    expect(ctx?.shared?.doctorCode).toBe("DOC123");
    expect(ctx?.shared?.alertPreferences?.highThreshold).toBe(190);
    // The owner's own context carries no overlay (their profile IS the source).
    const ownerCtx = await t.query(api.careCircle.circleContext, { userId: patient, passwordHash: HASH_A });
    expect(ownerCtx?.isOwner).toBe(true);
    expect(ownerCtx?.shared).toBeNull();

    // A member may edit the doctor office info — the write lands on the owner's profile.
    await t.mutation(api.careCircle.updateSharedProfile, {
      userId: member,
      passwordHash: HASH_B,
      patch: { doctorPhone: "(843) 555-0100" },
    });
    const ownerProfile = await t.query(api.patientProfile.get, { userId: patient, passwordHash: HASH_A });
    expect(ownerProfile?.doctorPhone).toBe("(843) 555-0100");

    // But dosing ground truth — and the child's birthday/weight — is owner-only.
    await expect(
      t.mutation(api.careCircle.updateSharedProfile, { userId: member, passwordHash: HASH_B, patch: { carbRatio: 8 } }),
    ).rejects.toThrow(/circle owner/);
    await expect(
      t.mutation(api.careCircle.updateSharedProfile, { userId: member, passwordHash: HASH_B, patch: { weightLbs: 70 } }),
    ).rejects.toThrow(/circle owner/);
    await expect(
      t.mutation(api.careCircle.updateSharedProfile, { userId: member, passwordHash: HASH_B, patch: { dateOfBirth: "2010-05-05" } }),
    ).rejects.toThrow(/circle owner/);
    // The owner may still change it, and the member's inherited copy follows.
    await t.mutation(api.careCircle.updateSharedProfile, {
      userId: patient,
      passwordHash: HASH_A,
      patch: { dateOfBirth: "2013-06-02" },
    });
    const afterDob = await t.query(api.careCircle.circleContext, { userId: member, passwordHash: HASH_B });
    expect(afterDob?.shared?.dateOfBirth).toBe("2013-06-02");
  });

  it("pools quick foods and emergency contacts mutually across the circle", async () => {
    const { t, patient, member } = await linked();

    // Owner's device seeds its local contacts once; a member's import is a no-op by design.
    await t.mutation(api.careCircle.importSharedEmergencyContacts, {
      userId: patient,
      passwordHash: HASH_A,
      contacts: [{ id: "c1", name: "Grandma", phone: "555-1111", relation: "Family" }],
    });
    await t.mutation(api.careCircle.importSharedEmergencyContacts, {
      userId: member,
      passwordHash: HASH_B,
      contacts: [{ id: "cx", name: "ShouldNotAppear", phone: "555-9999", relation: "Family" }],
    });

    // The member adds one — every guardian sees both.
    await t.mutation(api.careCircle.addSharedEmergencyContact, {
      userId: member,
      passwordHash: HASH_B,
      contact: { id: "c2", name: "Uncle Joe", phone: "555-2222", relation: "Family" },
    });
    const ownerCtx = await t.query(api.careCircle.circleContext, { userId: patient, passwordHash: HASH_A });
    expect(ownerCtx?.emergencyContacts?.map((c) => c.id).sort()).toEqual(["c1", "c2"]);

    // The member updates the quick-meals list — the owner's next poll shows it.
    await t.mutation(api.careCircle.setQuickFoods, {
      userId: member,
      passwordHash: HASH_B,
      foods: ["Mac and cheese", "Apple", "Pizza"],
    });
    const ownerCtx2 = await t.query(api.careCircle.circleContext, { userId: patient, passwordHash: HASH_A });
    expect(ownerCtx2?.quickFoods).toEqual(["Mac and cheese", "Apple", "Pizza"]);
    const memberCtx = await t.query(api.careCircle.circleContext, { userId: member, passwordHash: HASH_B });
    expect(memberCtx?.quickFoods).toEqual(["Mac and cheese", "Apple", "Pizza"]);
  });

  it("leaves the departing member with the circle's current settings — minus the doctor code", async () => {
    const { t, patient, member } = await linked();
    await t.mutation(api.patientProfile.replace, {
      userId: patient,
      passwordHash: HASH_A,
      profile: {
        childName: "Bella", diabetesType: "type1", dateOfBirth: "2014-01-01", weightLbs: 62,
        doctorName: "Dr. Rivera", insulinTypes: ["Humalog · 100 u/mL"],
        carbRatio: 12, targetGlucose: 110, correctionFactor: 45, doctorCode: "DOC123",
      },
    });
    await t.mutation(api.patientProfile.setAlertPreferences, {
      userId: patient,
      passwordHash: HASH_A,
      alertPreferences: { urgentLowThreshold: 50, lowThreshold: 65, highThreshold: 190, urgentHighThreshold: 260 },
    });
    await t.mutation(api.careCircle.setQuickFoods, { userId: patient, passwordHash: HASH_A, foods: ["Pizza", "Rice"] });

    const circle = await t.query(api.careCircle.getCircle, { userId: member, passwordHash: HASH_B, patientUserId: patient });
    const myLink = circle?.coGuardians.find((c) => c.isMe);
    await t.mutation(api.careCircle.revokeLink, { userId: member, passwordHash: HASH_B, linkId: myLink!.linkId });

    // The ex-member's own account now holds the owner's settings (continuity, never a blank app)…
    const mine = await t.query(api.patientProfile.get, { userId: member, passwordHash: HASH_B });
    expect(mine?.childName).toBe("Bella");
    expect(mine?.carbRatio).toBe(12);
    expect(mine?.weightLbs).toBe(62);
    expect(mine?.insulinTypes).toEqual(["Humalog · 100 u/mL"]);
    expect(mine?.alertPreferences?.urgentHighThreshold).toBe(260);
    // …except the doctor code, which must stay unique to the owner's account.
    expect(mine?.doctorCode).toBeUndefined();

    // Solo again: their circle context is their own, seeded with the pool copy.
    const soloCtx = await t.query(api.careCircle.circleContext, { userId: member, passwordHash: HASH_B });
    expect(soloCtx?.isOwner).toBe(true);
    expect(soloCtx?.anchorPatientUserId).toBe(member);
    expect(soloCtx?.quickFoods).toEqual(["Pizza", "Rice"]);
  });
});

describe("access-code inheritance contract (what a caregiver's view reads from the guardian)", () => {
  it("profileForAccessCode returns the guardian's dose settings, thresholds, and shared contacts", async () => {
    const t = convexTest(schema, modules);
    const guardian = await t.mutation(api.auth.register, { email: "g@example.com", passwordHash: "h-g" });
    await t.mutation(api.patientProfile.replace, {
      userId: guardian, passwordHash: "h-g",
      profile: {
        childName: "Bella", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2014-01-01",
        carbRatio: 40, targetGlucose: 110, correctionFactor: 45,
      },
    });
    await t.mutation(api.patientProfile.setAlertPreferences, {
      userId: guardian, passwordHash: "h-g",
      alertPreferences: { urgentLowThreshold: 50, lowThreshold: 65, highThreshold: 190, urgentHighThreshold: 260 },
    });
    await t.mutation(api.careCircle.addSharedEmergencyContact, {
      userId: guardian, passwordHash: "h-g",
      contact: { id: "c1", name: "Grandma", phone: "555-1111", relation: "Family" },
    });
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: guardian, passwordHash: "h-g", patientUserId: guardian, label: "Nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: false, useCalculator: true, chat: false },
    });

    const slim = await t.query(api.careCircle.profileForAccessCode, { code });
    // The exact fields a nurse's kid-view inherits (carb ratio was the reported bug: 1:40 not 1:15).
    expect(slim?.carbRatio).toBe(40);
    expect(slim?.targetGlucose).toBe(110);
    expect(slim?.correctionFactor).toBe(45);
    expect(slim?.alertPreferences?.highThreshold).toBe(190);
    expect(slim?.emergencyContacts?.map((c) => c.name)).toEqual(["Grandma"]);
  });
});
