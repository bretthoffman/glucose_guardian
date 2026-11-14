import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");
const perms = { viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true };

describe("viewers can ask for a fresh CGM pull of the patient they watch", () => {
  it("finds the patient's connection for an active code or co-guardian, never otherwise", async () => {
    const t = convexTest(schema, modules);
    const brian = await t.mutation(api.auth.register, { email: "brian@example.com", passwordHash: "h-b" });
    const wife = await t.mutation(api.auth.register, { email: "wife@example.com", passwordHash: "h-w" });
    const stranger = await t.mutation(api.auth.register, { email: "x@example.com", passwordHash: "h-x" });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("patientCgmConnections", { userId: brian, type: "dexcom", updatedAt: now });
      await ctx.db.insert("careLinks", {
        patientUserId: brian, memberUserId: wife, role: "co_guardian", displayName: "Mom",
        permissions: perms, access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("careAccessCodes", {
        patientUserId: brian, code: "ADELIA01", label: "Adelia", kind: "caregiver", permissions: perms,
        access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("careAccessCodes", {
        patientUserId: brian, code: "OLDCODE1", label: "Old", kind: "caregiver", permissions: perms,
        access: { mode: "always" }, status: "retired", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("careAccessCodes", {
        patientUserId: brian, code: "NOREAD01", label: "No readings", kind: "caregiver", permissions: { ...perms, viewReadings: false },
        access: { mode: "always" }, status: "active", createdAt: now, updatedAt: now,
      });
    });
    const q = (args: Record<string, unknown>) => t.query(internal.cgmIngest.viewerConnection, args);
    expect(await q({ code: "adelia01" })).toEqual({ userId: brian, provider: "dexcom" });
    expect(await q({ userId: wife, passwordHash: "h-w" })).toEqual({ userId: brian, provider: "dexcom" });
    expect(await q({ code: "OLDCODE1" })).toBeNull();
    expect(await q({ code: "NOREAD01" })).toBeNull();
    expect(await q({ code: "NOPE" })).toBeNull();
    expect(await q({ userId: wife, passwordHash: "wrong" })).toBeNull();
    expect(await q({ userId: stranger, passwordHash: "h-x" })).toBeNull();
  });
});
