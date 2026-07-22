import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const GH = "h-guardian";
const NH = "h-nurse";
const FULL = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };

async function guardianWithChild() {
  const t = convexTest(schema, modules);
  const g = await t.mutation(api.auth.register, { email: "mom@example.com", passwordHash: GH });
  await t.mutation(api.patientProfile.replace, {
    userId: g, passwordHash: GH,
    profile: { childName: "Bella", childLastName: "Ray", parentName: "Mom", accountRole: "parent", diabetesType: "type1", dateOfBirth: "2015-01-01" },
  });
  return { t, g };
}

async function code(t: any, g: string, label: string, kind: "child" | "caregiver") {
  const { code } = await t.mutation(api.careCircle.createAccessCode, {
    userId: g, passwordHash: GH, patientUserId: g, label, kind, permissions: FULL,
  });
  return code;
}

const food = (id: string, name = "Cereal") => ({ clientId: id, timestamp: new Date().toISOString(), foodName: name, estimatedCarbs: 30, insulinUnits: 2, confidence: "high" as const, fromPhoto: false });
const dose = (id: string) => ({ clientId: id, timestamp: new Date().toISOString(), units: 2, type: "bolus" as const });

describe("access-code logging pools into the one shared circle bucket", () => {
  it("kid code ↔ guardian: logs pool both ways; kid entries show the child's name", async () => {
    const { t, g } = await guardianWithChild();
    const kid = await code(t, g, "Bella's phone", "child");

    await t.mutation(api.careLogs.addFoodLog, { userId: g, passwordHash: GH, patientUserId: g, entry: food("gm") });
    const kidView = await t.query(api.careLogs.listLogsViaCode, { code: kid });
    expect(kidView?.foodLog.map((f) => f.id)).toContain("gm"); // kid sees guardian's meal

    await t.mutation(api.careLogs.addInsulinLogViaCode, { code: kid, entry: dose("ki") });
    const gLogs = await t.query(api.careLogs.listLogs, { userId: g, passwordHash: GH, patientUserId: g });
    expect(gLogs?.insulinLog.find((i) => i.id === "ki")?.authorName).toBe("Bella"); // guardian sees kid's dose as "Bella"
  });

  it("caregiver code (accountless) ↔ guardian: pools both ways; caregiver entries show the code label", async () => {
    const { t, g } = await guardianWithChild();
    const cg = await code(t, g, "School nurse", "caregiver");

    await t.mutation(api.careLogs.addFoodLog, { userId: g, passwordHash: GH, patientUserId: g, entry: food("gm2") });
    const cgView = await t.query(api.careLogs.listLogsViaCode, { code: cg });
    expect(cgView?.foodLog.map((f) => f.id)).toContain("gm2");

    await t.mutation(api.careLogs.addInsulinLogViaCode, { code: cg, entry: dose("cgi") });
    const gLogs = await t.query(api.careLogs.listLogs, { userId: g, passwordHash: GH, patientUserId: g });
    expect(gLogs?.insulinLog.find((i) => i.id === "cgi")?.authorName).toBe("School nurse");
  });

  it("kid code ↔ caregiver code (both accountless): each sees the other's logs", async () => {
    const { t, g } = await guardianWithChild();
    const kid = await code(t, g, "Bella's phone", "child");
    const cg = await code(t, g, "Nurse", "caregiver");

    await t.mutation(api.careLogs.addFoodLogViaCode, { code: kid, entry: food("kf", "Apple") });
    await t.mutation(api.careLogs.addInsulinLogViaCode, { code: cg, entry: dose("cgi2") });

    const cgView = await t.query(api.careLogs.listLogsViaCode, { code: cg });
    const kidView = await t.query(api.careLogs.listLogsViaCode, { code: kid });
    expect(cgView?.foodLog.find((f) => f.id === "kf")?.authorName).toBe("Bella"); // caregiver sees kid's meal
    expect(kidView?.insulinLog.find((i) => i.id === "cgi2")?.authorName).toBe("Nurse"); // kid sees caregiver's dose
  });

  it("kid code ↔ email nurse account: each sees the other's logs; nurse credited by name", async () => {
    const { t, g } = await guardianWithChild();
    const nurse = await t.mutation(api.auth.register, { email: "nurse@school.edu", passwordHash: NH });
    await t.mutation(api.patientProfile.replace, {
      userId: nurse, passwordHash: NH,
      profile: { childName: "Nurse Joy", accountRole: "caregiver", diabetesType: "type1", dateOfBirth: "" },
    });
    const kid = await code(t, g, "Bella's phone", "child");
    const cg = await code(t, g, "Nurse code", "caregiver");
    await t.mutation(api.caregiverAccounts.addCaregiverCode, { userId: nurse, passwordHash: NH, code: cg });

    // Kid logs a meal; nurse logs a dose through their code, attributed to their account.
    await t.mutation(api.careLogs.addFoodLogViaCode, { code: kid, entry: food("kf2", "Toast") });
    await t.mutation(api.careLogs.addInsulinLogViaCode, { code: cg, authorUserId: nurse, passwordHash: NH, entry: dose("nd") });

    const nurseView = await t.query(api.careLogs.listLogsViaCode, { code: cg });
    const kidView = await t.query(api.careLogs.listLogsViaCode, { code: kid });
    expect(nurseView?.foodLog.find((f) => f.id === "kf2")?.authorName).toBe("Bella"); // nurse sees kid's meal
    expect(kidView?.insulinLog.find((i) => i.id === "nd")?.authorName).toBe("Nurse Joy"); // kid sees nurse's dose by name
    // And the guardian sees both, in the one pool.
    const gLogs = await t.query(api.careLogs.listLogs, { userId: g, passwordHash: GH, patientUserId: g });
    expect(gLogs?.foodLog.map((f) => f.id)).toContain("kf2");
    expect(gLogs?.insulinLog.map((i) => i.id)).toContain("nd");
  });
});
