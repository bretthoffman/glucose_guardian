import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/!(*.test).*s");

async function seedLibreUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "sync@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("patientCgmConnections", {
      userId,
      type: "libre",
      token: "tok",
      libreApiBase: "https://api.eu.libreview.io",
      updatedAt: 0,
    });
    await ctx.db.insert("patientLibreCredentials", {
      userId,
      libreEmail: "sync@x.com",
      librePassword: "pw",
      updatedAt: 0,
    });
    await ctx.db.insert("cgmSyncState", {
      userId,
      provider: "libre",
      consecutiveFailures: 0,
      status: "no_shared_patient",
      providerDiagnosticCategory: "no_shared_patient",
      providerDiagnosticMessageKey: "cgm.diagnostic.no_shared_patient",
      libreConnectionCount: 0,
      reconnectRequired: false,
      nextEligibleAt: 0,
      generation: 0,
      updatedAt: 0,
    });
    return userId;
  });
}

describe("patientCgmSync.getSyncStatus", () => {
  it("returns sanitized sync state for the authenticated owner", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedLibreUser(t);
    const status = await t.query(api.patientCgmSync.getSyncStatus, { userId, passwordHash: "ph" });
    expect(status?.connected).toBe(true);
    if (status?.connected) {
      expect(status.provider).toBe("libre");
      expect(status.diagnosticCategory).toBe("no_shared_patient");
      expect(status.messageKey).toBe("cgm.diagnostic.no_shared_patient");
      expect(status.hasStoredCredentials).toBe(true);
      expect(JSON.stringify(status)).not.toMatch(/password|token|pw/i);
    }
  });

  it("returns null for unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedLibreUser(t);
    const status = await t.query(api.patientCgmSync.getSyncStatus, { userId, passwordHash: "wrong" });
    expect(status).toBeNull();
  });
});
