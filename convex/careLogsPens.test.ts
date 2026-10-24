import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

async function setupOwner(t: ReturnType<typeof convexTest>) {
  const owner = await t.mutation(api.auth.register, { email: "owner@example.com", passwordHash: "h-owner" });
  await t.mutation(api.patientProfile.replace, {
    userId: owner, passwordHash: "h-owner",
    profile: { childName: "Bella", parentName: "Mom", diabetesType: "type1", dateOfBirth: "2014-01-01" },
  });
  return owner;
}

const pen = (clientId: string, extra: object = {}) => ({
  clientId,
  insulinLabel: "Lispro Junior · 100 u/mL",
  name: "Home",
  openedOn: "2026-10-05",
  goodForDays: 28,
  ...extra,
});

describe("insulin pens", () => {
  it("an owner starts a pen; it comes back in listLogs with the byline, logs untouched", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    await t.mutation(api.careLogs.savePen, { userId: owner, passwordHash: "h-owner", patientUserId: owner, pen: pen("pen_1") });
    const logs = await t.query(api.careLogs.listLogs, { userId: owner, passwordHash: "h-owner", patientUserId: owner });
    expect(logs?.penLog).toHaveLength(1);
    expect(logs?.penLog[0]).toMatchObject({ id: "pen_1", insulinLabel: "Lispro Junior · 100 u/mL", name: "Home", openedOn: "2026-10-05", goodForDays: 28, authorName: "Mom" });
    expect(logs?.insulinLog).toHaveLength(0);
  });

  it("saving the same clientId edits in place, and ending keeps it with its reason", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const base = { userId: owner, passwordHash: "h-owner", patientUserId: owner };
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("pen_e") });
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("pen_e", { name: "School", openedOn: "2026-10-06" }) });
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("pen_e", { name: "School", openedOn: "2026-10-06", endedOn: "2026-10-20", endReason: "used_up" }) });
    const rows = await t.run(async (ctx: any) => await ctx.db.query("carePens").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "School", openedOn: "2026-10-06", endedOn: "2026-10-20", endReason: "used_up" });
    // Clearing the name on a later save removes it.
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("pen_e", { name: undefined, openedOn: "2026-10-06" }) });
    const after = await t.run(async (ctx: any) => await ctx.db.query("carePens").first());
    expect(after.name).toBeUndefined();
    expect(after.endedOn).toBeUndefined();
  });

  it("keeps pen or vial; a save without it (an older app) never turns a vial into a pen", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const base = { userId: owner, passwordHash: "h-owner", patientUserId: owner };
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("v1", { insulinLabel: "Humalog · 100 u/mL", form: "vial" }) });
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("v1", { insulinLabel: "Humalog · 100 u/mL", name: "School" }) });
    const logs = await t.query(api.careLogs.listLogs, base);
    expect(logs?.penLog[0]).toMatchObject({ id: "v1", form: "vial", name: "School" });
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("p1") });
    const all = await t.query(api.careLogs.listLogs, base);
    expect(all?.penLog.find((p: any) => p.id === "p1")?.form).toBeUndefined();
  });

  it("pen and vial lists survive a profile save from an app that doesn't know them", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const profile = { childName: "Bella", parentName: "Mom", diabetesType: "type1" as const, dateOfBirth: "2014-01-01", insulinTypes: ["Humalog · 100 u/mL"] };
    await t.mutation(api.patientProfile.replace, {
      userId: owner, passwordHash: "h-owner",
      profile: { ...profile, insulinPens: [], insulinVials: ["Humalog · 100 u/mL"] },
    });
    await t.mutation(api.patientProfile.replace, { userId: owner, passwordHash: "h-owner", profile });
    const got = await t.query(api.patientProfile.get, { userId: owner, passwordHash: "h-owner" });
    expect(got).toMatchObject({ insulinPens: [], insulinVials: ["Humalog · 100 u/mL"] });
    // A current app clearing them really clears them.
    await t.mutation(api.patientProfile.replace, { userId: owner, passwordHash: "h-owner", profile: { ...profile, insulinTypes: [], insulinPens: [], insulinVials: [] } });
    const cleared = await t.query(api.patientProfile.get, { userId: owner, passwordHash: "h-owner" });
    expect(cleared).toMatchObject({ insulinTypes: [], insulinPens: [], insulinVials: [] });
  });

  it("rejects bad dates, impossible day counts and a blank insulin", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const base = { userId: owner, passwordHash: "h-owner", patientUserId: owner };
    await expect(t.mutation(api.careLogs.savePen, { ...base, pen: pen("p", { openedOn: "Oct 5" }) })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(t.mutation(api.careLogs.savePen, { ...base, pen: pen("p", { goodForDays: 0 }) })).rejects.toThrow(/1 to 120/);
    await expect(t.mutation(api.careLogs.savePen, { ...base, pen: pen("p", { goodForDays: 12.5 }) })).rejects.toThrow(/1 to 120/);
    await expect(t.mutation(api.careLogs.savePen, { ...base, pen: pen("p", { insulinLabel: "  " }) })).rejects.toThrow(/Pick an insulin/);
  });

  it("a caregiver code with the log grant can start and delete a pen; one without it cannot", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const { code } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h-owner", patientUserId: owner, label: "School nurse", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: true, useCalculator: false, chat: false },
    });
    await t.mutation(api.careLogs.savePenViaCode, { code, pen: pen("pen_nurse", { name: "School" }) });
    let viaCode = await t.query(api.careLogs.listLogsViaCode, { code });
    expect(viaCode?.penLog[0]).toMatchObject({ id: "pen_nurse", name: "School", authorName: "School nurse" });
    // The owner sees the same pen.
    const ownerLogs = await t.query(api.careLogs.listLogs, { userId: owner, passwordHash: "h-owner", patientUserId: owner });
    expect(ownerLogs?.penLog.map((p: { id: string }) => p.id)).toEqual(["pen_nurse"]);

    await t.mutation(api.careLogs.deletePenViaCode, { code, clientId: "pen_nurse" });
    viaCode = await t.query(api.careLogs.listLogsViaCode, { code });
    expect(viaCode?.penLog).toHaveLength(0);

    const { code: viewOnly } = await t.mutation(api.careCircle.createAccessCode, {
      userId: owner, passwordHash: "h-owner", patientUserId: owner, label: "Grandpa", kind: "caregiver",
      permissions: { viewReadings: true, viewLogs: true, log: false, useCalculator: false, chat: false },
    });
    await expect(t.mutation(api.careLogs.savePenViaCode, { code: viewOnly, pen: pen("pen_no") })).rejects.toThrow(/cannot add logs/);
  });

  it("the owner can delete a pen added by mistake", async () => {
    const t = convexTest(schema, modules);
    const owner = await setupOwner(t);
    const base = { userId: owner, passwordHash: "h-owner", patientUserId: owner };
    await t.mutation(api.careLogs.savePen, { ...base, pen: pen("pen_x") });
    await t.mutation(api.careLogs.deletePen, { ...base, clientId: "pen_x" });
    const logs = await t.query(api.careLogs.listLogs, base);
    expect(logs?.penLog).toHaveLength(0);
  });
});
