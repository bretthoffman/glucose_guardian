import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/!(*.test).*s");

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(routes: Array<{ test: (u: string) => boolean; res: () => Response }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL) => {
      const u = String(url);
      const match = routes.find((r) => r.test(u));
      if (!match) return Promise.reject(new Error("unexpected fetch: " + u));
      return Promise.resolve(match.res());
    }),
  );
}

describe("cgmDiagnostics.runLibreDiagnostic", () => {
  it("returns sanitized summary without credentials or tokens", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { email: "d@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("patientCgmConnections", { userId: uid, type: "libre", updatedAt: 0 });
      await ctx.db.insert("patientLibreCredentials", { userId: uid, libreEmail: "d@x.com", librePassword: "secret-pw", updatedAt: 0 });
      await ctx.db.insert("cgmSyncState", { userId: uid, provider: "libre", consecutiveFailures: 0, status: "pending", nextEligibleAt: 0, generation: 0, updatedAt: 0 });
      return uid;
    });

    stubFetch([
      { test: (u) => u.includes("/llu/auth/login"), res: () => json({ data: { authTicket: { token: "bearer-secret" } } }) },
      { test: (u) => u.endsWith("/llu/connections"), res: () => json({ data: [] }) },
    ]);

    const summary = await t.action(api.cgmDiagnostics.runLibreDiagnostic, { userId, passwordHash: "ph" });
    expect("error" in summary).toBe(false);
    if (!("error" in summary)) {
      expect(summary.status).toBe("no_shared_patient");
      expect(summary.authenticationSucceeded).toBe(true);
      const serialized = JSON.stringify(summary);
      expect(serialized).not.toMatch(/secret-pw|bearer-secret|d@x.com/i);
    }
  });

  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "d2@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 }),
    );
    const result = await t.action(api.cgmDiagnostics.runLibreDiagnostic, { userId, passwordHash: "bad" });
    expect(result).toEqual({ error: "unauthorized" });
  });
});
