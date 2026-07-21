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

    // Patient sees the co-guardian.
    const circle = await t.query(api.careCircle.getCircle, {
      userId: patient,
      passwordHash: HASH_A,
      patientUserId: patient,
    });
    expect(circle?.coGuardians).toHaveLength(1);
    expect(circle?.coGuardians[0].memberUserId).toBe(member);

    // Member sees the membership.
    const memberships = await t.query(api.careCircle.myMemberships, {
      userId: member,
      passwordHash: HASH_B,
    });
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
