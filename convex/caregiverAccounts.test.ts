import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const NURSE = "hash-nurse";
const G1 = "hash-g1";
const G2 = "hash-g2";

async function setup() {
  const t = convexTest(schema, modules);
  const nurse = await t.mutation(api.auth.register, { email: "nurse@school.edu", passwordHash: NURSE });
  await t.mutation(api.patientProfile.replace, {
    userId: nurse, passwordHash: NURSE,
    profile: { childName: "Nurse Joy", accountRole: "caregiver", organization: "Lincoln Elementary", diabetesType: "type1", dateOfBirth: "" },
  });
  // Two unrelated families, each with their own kid + an access code for the nurse.
  const g1 = await t.mutation(api.auth.register, { email: "g1@example.com", passwordHash: G1 });
  await t.mutation(api.patientProfile.replace, {
    userId: g1, passwordHash: G1,
    profile: { childName: "Claire", childLastName: "Smith", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2009-01-01" },
  });
  const g2 = await t.mutation(api.auth.register, { email: "g2@example.com", passwordHash: G2 });
  await t.mutation(api.patientProfile.replace, {
    userId: g2, passwordHash: G2,
    profile: { childName: "Noah", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2010-06-01" },
  });
  return { t, nurse, g1, g2 };
}

async function makeCode(t: any, guardian: string, hash: string, access?: any, permissions?: any) {
  const { code } = await t.mutation(api.careCircle.createAccessCode, {
    userId: guardian, passwordHash: hash, patientUserId: guardian,
    label: "School nurse", kind: "caregiver",
    permissions: permissions ?? { viewReadings: true, viewLogs: true, log: false, useCalculator: false, chat: false },
    ...(access ? { access } : {}),
  });
  return code;
}

describe("caregiver (school-nurse) accounts", () => {
  it("adds codes from two different families and lists both kids", async () => {
    const { t, nurse, g1, g2 } = await setup();
    const c1 = await makeCode(t, g1, G1);
    const c2 = await makeCode(t, g2, G2);

    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c1 });
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c2 });

    const kids = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids.map((k) => k.name).sort()).toEqual(["Claire", "Noah"]);
    expect(kids.every((k) => k.accessState.state === "ok")).toBe(true);
    // Last name flows through for disambiguating same-first-name kids on the nurse's roster.
    expect(kids.find((k) => k.name === "Claire")?.lastName).toBe("Smith");
    expect(kids.find((k) => k.name === "Noah")?.lastName).toBe("");
  });

  it("is idempotent on re-adding the same code", async () => {
    const { t, nurse, g1 } = await setup();
    const c1 = await makeCode(t, g1, G1);
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c1 });
    const second = await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c1 });
    expect(second.alreadyLinked).toBe(true);
    const kids = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids).toHaveLength(1);
  });

  it("drops a kid's card when the code is retired", async () => {
    const { t, nurse, g1 } = await setup();
    const c1 = await makeCode(t, g1, G1);
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c1 });
    // Retire the code from the guardian side.
    const circle = await t.query(api.careCircle.getCircle, { userId: g1, passwordHash: G1, patientUserId: g1 });
    const codeId = circle!.accessCodes[0].codeId;
    await t.mutation(api.careCircle.retireAccessCode, { userId: g1, passwordHash: G1, codeId });

    const kids = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids).toHaveLength(0);
  });

  it("keeps the card but withholds the reading when the code is outside its schedule window", async () => {
    const { t, nurse, g1 } = await setup();
    // A weekly schedule that is closed right now (no days selected → always outside window).
    const c1 = await makeCode(t, g1, G1, { mode: "weekly", days: [], startMinute: 0, endMinute: 1, tzOffsetMinutes: 0 });
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c1 });
    // Guardian has a reading on file.
    await t.mutation(api.patientGlucose.upsertBatch, {
      userId: g1, passwordHash: G1,
      entries: [{ glucose: 120, timestamp: new Date().toISOString(), anomaly: { warning: false } }],
    });

    const kids = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids).toHaveLength(1); // card stays
    expect(kids[0].accessState.state).not.toBe("ok"); // locked
    expect(kids[0].latestGlucose).toBeNull(); // reading withheld → "--" on the client
  });

  it("shows the latest reading when the window is open", async () => {
    const { t, nurse, g1 } = await setup();
    const c1 = await makeCode(t, g1, G1);
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: c1 });
    await t.mutation(api.patientGlucose.upsertBatch, {
      userId: g1, passwordHash: G1,
      entries: [{ glucose: 128, timestamp: new Date().toISOString(), anomaly: { warning: false } }],
    });
    const kids = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids[0].latestGlucose).toBe(128);
  });

  it("pools logs both ways between a nurse and the child's guardians, crediting the nurse by name", async () => {
    const { t, nurse, g1 } = await setup();
    const code = await makeCode(t, g1, G1, undefined, {
      viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: false,
    });
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code });

    // A guardian logs a meal into the circle's shared bucket (their own account IS the bucket).
    await t.mutation(api.careLogs.addFoodLog, {
      userId: g1, passwordHash: G1, patientUserId: g1,
      entry: { clientId: "gf1", timestamp: new Date().toISOString(), foodName: "Sandwich", estimatedCarbs: 30, insulinUnits: 2, confidence: "high", fromPhoto: false },
    });
    // Reading side: the nurse sees the guardian's meal through the code (feeds their calculator/logs).
    const nurseView = await t.query(api.careLogs.listLogsViaCode, { code });
    expect(nurseView?.foodLog.map((f) => f.id)).toContain("gf1");

    // Writing side: the nurse logs a dose via the code, attributed to their own account.
    await t.mutation(api.careLogs.addInsulinLogViaCode, {
      code, authorUserId: nurse, passwordHash: NURSE,
      entry: { clientId: "ni1", timestamp: new Date().toISOString(), units: 1.5, type: "manual" },
    });
    // The guardian now sees the nurse's dose in the SAME shared pool, credited to the nurse's name
    // (their profile name — not the code label "School nurse").
    const ownerLogs = await t.query(api.careLogs.listLogs, { userId: g1, passwordHash: G1, patientUserId: g1 });
    const dose = ownerLogs?.insulinLog.find((i) => i.id === "ni1");
    expect(dose).toBeTruthy();
    expect(dose?.authorName).toBe("Nurse Joy");
  });

  it("falls back to the code label when an accountless code-holder logs (no author account)", async () => {
    const { t, g1 } = await setup();
    const code = await makeCode(t, g1, G1, undefined, {
      viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false,
    });
    await t.mutation(api.careLogs.addFoodLogViaCode, {
      code, // no authorUserId/passwordHash → accountless
      entry: { clientId: "af1", timestamp: new Date().toISOString(), foodName: "Crackers", estimatedCarbs: 15, insulinUnits: 1, confidence: "medium", fromPhoto: false },
    });
    const ownerLogs = await t.query(api.careLogs.listLogs, { userId: g1, passwordHash: G1, patientUserId: g1 });
    expect(ownerLogs?.foodLog.find((f) => f.id === "af1")?.authorName).toBe("School nurse");
  });

  it("returns recent logs for the active-carbs/insulin math only when the code may view logs in-window", async () => {
    const { t, nurse, g1 } = await setup();
    const code = await makeCode(t, g1, G1, undefined, {
      viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: false,
    });
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code });
    await t.mutation(api.careLogs.addFoodLog, {
      userId: g1, passwordHash: G1, patientUserId: g1,
      entry: { clientId: "rf", timestamp: new Date().toISOString(), foodName: "Rice", estimatedCarbs: 40, insulinUnits: 3, confidence: "high", fromPhoto: false },
    });
    await t.mutation(api.careLogs.addInsulinLog, {
      userId: g1, passwordHash: G1, patientUserId: g1,
      entry: { clientId: "ri", timestamp: new Date().toISOString(), units: 3, type: "bolus" },
    });
    const kids = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids[0].recentFood.map((f) => f.estimatedCarbs)).toContain(40);
    expect(kids[0].recentInsulin.map((i) => i.units)).toContain(3);

    // A code without viewLogs gets no logs (the nurse can't see them → no active values).
    const noView = await makeCode(t, g1, G1, undefined, {
      viewReadings: true, viewLogs: false, log: false, useCalculator: false, chat: false,
    });
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code: noView });
    const kids2 = await t.query(api.caregiverAccounts.listCaregiverKids, { userId: nurse, passwordHash: NURSE });
    expect(kids2.find((k) => k.code === noView)?.recentFood).toEqual([]);
    expect(kids2.find((k) => k.code === noView)?.recentInsulin).toEqual([]);
  });

  it("rejects a code that can't view readings", async () => {
    const { t, nurse, g1 } = await setup();
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: g1, passwordHash: G1, patientUserId: g1, label: "log only", kind: "caregiver",
      permissions: { viewReadings: false, viewLogs: false, log: true, useCalculator: false, chat: false },
    });
    await expect(
      t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NURSE, code }),
    ).rejects.toThrow(/viewing glucose/);
  });
});
