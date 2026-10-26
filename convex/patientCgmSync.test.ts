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

describe("credential writes un-park a raced sync state", () => {
  it("getSyncStatus never reports no_credentials once credentials exist", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "race@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("patientCgmConnections", { userId, type: "libre", token: "tok", updatedAt: 0 });
      // the raced state: first ingest ran before the credential write landed
      await ctx.db.insert("cgmSyncState", {
        userId,
        provider: "libre",
        consecutiveFailures: 1,
        status: "no_credentials",
        lastFailureCategory: "no_credentials",
        providerDiagnosticCategory: "no_credentials",
        providerDiagnosticMessageKey: "cgm.diagnostic.no_credentials",
        reconnectRequired: true,
        nextEligibleAt: Date.now() + 6 * 3600_000,
        generation: 1,
        updatedAt: 0,
      });
      // credentials committed just after that failed attempt
      await ctx.db.insert("patientLibreCredentials", { userId, libreEmail: "race@x.com", librePassword: "pw", updatedAt: 1 });
      return userId;
    });
    const status = await t.query(api.patientCgmSync.getSyncStatus, { userId, passwordHash: "ph" });
    expect(status?.connected).toBe(true);
    expect(status?.diagnosticCategory).not.toBe("no_credentials");
    expect(status?.reconnectRequired).toBe(false);
  });

  it("a credential upsert resets backoff, failures, and the stale diagnostic", async () => {
    const t = convexTest(schema, modules);
    const { userId, stateId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "reset@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 });
      const stateId = await ctx.db.insert("cgmSyncState", {
        userId,
        provider: "libre",
        consecutiveFailures: 3,
        status: "no_credentials",
        lastFailureCategory: "no_credentials",
        providerDiagnosticCategory: "no_credentials",
        providerDiagnosticMessageKey: "cgm.diagnostic.no_credentials",
        reconnectRequired: true,
        nextEligibleAt: Date.now() + 6 * 3600_000,
        generation: 1,
        updatedAt: 0,
      });
      return { userId, stateId };
    });
    const before = Date.now();
    await t.run(async (ctx) => {
      const { resetSyncStateForNewCredentials } = await import("./cgm/credentialReset");
      await resetSyncStateForNewCredentials(ctx, userId, "libre", before);
    });
    const row = await t.run(async (ctx) => ctx.db.get(stateId));
    expect(row?.status).toBe("pending");
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.reconnectRequired).toBe(false);
    expect(row?.providerDiagnosticCategory).toBeUndefined();
    expect(row?.nextEligibleAt).toBe(before);
  });
});
