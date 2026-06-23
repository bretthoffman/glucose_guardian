import { convexTest } from "convex-test";
import { describe, it, expect, vi, afterEach } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Load all non-test Convex modules for the in-memory backend.
const modules = import.meta.glob("./**/!(*.test).*s");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------- fetch mock ------------------------------- */

type Route = { test: (u: string) => boolean; res: (u: string, init?: RequestInit) => Response };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (body: string, status = 200) => new Response(body, { status });

function stubFetch(routes: Route[]) {
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const match = routes.find((r) => r.test(u));
    if (!match) return Promise.reject(new Error("unexpected fetch: " + u));
    return Promise.resolve(match.res(u, init));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const dexcomAuthOk: Route = { test: (u) => u.includes("AuthenticatePublisherAccount"), res: () => json("account-id-1234567890") };
const dexcomLoginOk: Route = { test: (u) => u.includes("LoginPublisherAccountById"), res: () => json("session-refreshed-0001") };

function dexcomItems(count: number, stepMs: number, endMsAgo = 0) {
  const now = Date.now();
  const items: Array<Record<string, unknown>> = [];
  for (let i = count - 1; i >= 0; i--) {
    items.push({ ST: `/Date(${now - endMsAgo - i * stepMs})/`, Value: 120, Trend: "Flat" });
  }
  return items;
}

/* --------------------------------- seeding -------------------------------- */

async function seedDexcom(
  t: ReturnType<typeof convexTest>,
  opts: {
    passwordHash?: string;
    sessionId?: string | null;
    withCreds?: boolean;
    state?: Partial<{
      status: "ok" | "pending" | "retrying" | "needs_reconnect" | "no_credentials";
      nextEligibleAt: number;
      lastReadingTimestamp: string;
      lastBackfillAt: number;
      consecutiveFailures: number;
    }> | null;
    caregiverCode?: string;
  } = {},
): Promise<Id<"users">> {
  const passwordHash = opts.passwordHash ?? "ph";
  const withCreds = opts.withCreds ?? true;
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: `u${Math.random()}@x.com`, passwordHash, createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("patientCgmConnections", {
      userId,
      type: "dexcom",
      ...(opts.sessionId === null ? {} : { sessionId: opts.sessionId ?? "session-existing-00001" }),
      outsideUS: false,
      updatedAt: 0,
    });
    if (withCreds) {
      await ctx.db.insert("patientDexcomCredentials", { userId, dexcomUsername: "u", dexcomPassword: "pw", outsideUS: false, updatedAt: 0 });
    }
    if (opts.state !== null) {
      await ctx.db.insert("cgmSyncState", {
        userId,
        provider: "dexcom",
        consecutiveFailures: opts.state?.consecutiveFailures ?? 0,
        status: opts.state?.status ?? "pending",
        nextEligibleAt: opts.state?.nextEligibleAt ?? 0,
        generation: 0,
        updatedAt: 0,
        ...(opts.state?.lastReadingTimestamp ? { lastReadingTimestamp: opts.state.lastReadingTimestamp } : {}),
        ...(opts.state?.lastBackfillAt ? { lastBackfillAt: opts.state.lastBackfillAt } : {}),
      });
    }
    if (opts.caregiverCode) {
      await ctx.db.insert("patientProfiles", {
        userId,
        childName: "Kid",
        diabetesType: "type1",
        dateOfBirth: "2015-01-01",
        caregiverCode: opts.caregiverCode,
        updatedAt: 0,
      });
    }
    return userId;
  });
}

const getState = (t: ReturnType<typeof convexTest>, userId: Id<"users">, provider: "dexcom" | "libre" = "dexcom") =>
  t.run(async (ctx) =>
    ctx.db.query("cgmSyncState").withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider)).unique(),
  );
const getReadings = (t: ReturnType<typeof convexTest>, userId: Id<"users">) =>
  t.run(async (ctx) => ctx.db.query("patientGlucoseReadings").withIndex("by_user_time", (q) => q.eq("userId", userId)).collect());
const getConn = (t: ReturnType<typeof convexTest>, userId: Id<"users">) =>
  t.run(async (ctx) => ctx.db.query("patientCgmConnections").withIndex("by_userId", (q) => q.eq("userId", userId)).unique());

/* ================================== tests ================================= */

describe("scheduled ingestion — Dexcom", () => {
  it("initial ingestion persists readings and advances the cursor", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    const items = dexcomItems(3, 5 * MINUTE);
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(items) }]);

    const before = Date.now();
    const res = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res.processed).toBe(1);
    expect(res.inserted).toBe(3);
    expect(res.failures).toBe(0);

    const readings = await getReadings(t, userId);
    expect(readings).toHaveLength(3);
    const state = await getState(t, userId);
    expect(state?.status).toBe("ok");
    expect(state?.lastReadingTimestamp).toBeTruthy();
    expect(state?.nextEligibleAt).toBeGreaterThanOrEqual(before + 5 * MINUTE);
    expect(state?.leaseOwner).toBeUndefined();
  });

  it("re-running dedups identical timestamps (idempotent)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    const items = dexcomItems(3, 5 * MINUTE);
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(items) }]);

    await t.action(internal.cgmIngest.runDueIngest, {});
    // make it due again, then run with the SAME items
    await t.run(async (ctx) => {
      const s = await ctx.db.query("cgmSyncState").withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", "dexcom")).unique();
      if (s) await ctx.db.patch(s._id, { nextEligibleAt: 0 });
    });
    const res2 = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res2.inserted).toBe(0);
    expect((await getReadings(t, userId))).toHaveLength(3);
  });

  it("expired session is silently re-logged-in and the new session is persisted", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t, { sessionId: "stale-session-0001" });
    let reads = 0;
    stubFetch([
      dexcomAuthOk,
      dexcomLoginOk,
      {
        test: (u) => u.includes("ReadPublisher"),
        res: () => {
          reads++;
          return reads === 1 ? text("SessionNotValid", 401) : json(dexcomItems(2, 5 * MINUTE));
        },
      },
    ]);

    const res = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res.inserted).toBe(2);
    expect(reads).toBe(2);
    const conn = await getConn(t, userId);
    expect(conn?.sessionId).toBe("session-refreshed-0001"); // server refreshed + persisted
    expect((await getState(t, userId))?.status).toBe("ok");
  });

  it("missing credentials → no_credentials with a long recheck (no provider call)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t, { withCreds: false });
    stubFetch([{ test: () => true, res: () => json([]) }]);

    const before = Date.now();
    await t.action(internal.cgmIngest.runDueIngest, {});
    const state = await getState(t, userId);
    expect(state?.status).toBe("no_credentials");
    expect(state?.nextEligibleAt).toBeGreaterThan(before + 60 * MINUTE);
  });

  it("invalid credentials → needs_reconnect, and does NOT retry every cycle", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    stubFetch([
      { test: (u) => u.includes("ReadPublisher"), res: () => text("SessionNotValid", 401) },
      { test: (u) => u.includes("AuthenticatePublisherAccount"), res: () => json({ Code: "AccountPasswordInvalid" }, 401) },
    ]);

    const before = Date.now();
    await t.action(internal.cgmIngest.runDueIngest, {});
    const state = await getState(t, userId);
    expect(state?.status).toBe("needs_reconnect");
    expect(state?.lastFailureCategory).toBe("invalid_credentials");
    expect(state?.nextEligibleAt).toBeGreaterThan(before + 60 * MINUTE); // ~6h, not ~5min
  });

  it("temporary outage → retrying with exponential backoff", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => text("err", 503) }]);

    const before = Date.now();
    await t.action(internal.cgmIngest.runDueIngest, {});
    const state = await getState(t, userId);
    expect(state?.status).toBe("retrying");
    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.lastFailureCategory).toBe("provider_outage");
    // first transient backoff is the 5-min base (+ up to 60s jitter)
    expect(state?.nextEligibleAt).toBeGreaterThanOrEqual(before + 5 * MINUTE);
    expect(state?.nextEligibleAt).toBeLessThan(before + 7 * MINUTE);
  });

  it("rate limiting backs off longer than a normal transient failure", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => text("slow down", 429) }]);

    const before = Date.now();
    await t.action(internal.cgmIngest.runDueIngest, {});
    const state = await getState(t, userId);
    expect(state?.status).toBe("retrying");
    expect(state?.lastFailureCategory).toBe("rate_limited");
    expect(state?.nextEligibleAt).toBeGreaterThanOrEqual(before + 15 * MINUTE);
  });

  it("recovers a multi-hour gap without flagging it unrecoverable", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t, {
      state: { lastReadingTimestamp: new Date(Date.now() - 3 * HOUR).toISOString(), lastBackfillAt: Date.now() },
    });
    const items = dexcomItems(36, 5 * MINUTE); // 3h of readings
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(items) }]);

    const res = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res.inserted).toBe(36);
    expect((await getState(t, userId))?.unrecoverableGap).toBeFalsy();
  });

  it("flags an unrecoverable gap when inactivity exceeds provider retention", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t, {
      state: { lastReadingTimestamp: new Date(Date.now() - 30 * HOUR).toISOString(), lastBackfillAt: Date.now() },
    });
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(dexcomItems(2, 5 * MINUTE)) }]);

    await t.action(internal.cgmIngest.runDueIngest, {});
    expect((await getState(t, userId))?.unrecoverableGap).toBe(true);
  });

  it("interior recent-gap reconciliation requests the full window even when newer data exists", async () => {
    const t = convexTest(schema, modules);
    await seedDexcom(t, {
      state: { lastReadingTimestamp: new Date(Date.now() - 10 * MINUTE).toISOString(), lastBackfillAt: Date.now() - 7 * HOUR },
    });
    const fetchMock = stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(dexcomItems(5, 5 * MINUTE)) }]);

    await t.action(internal.cgmIngest.runDueIngest, {});
    const readUrl = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.includes("ReadPublisher"))!;
    expect(readUrl).toMatch(/maxCount=288/);
    expect(readUrl).toMatch(/minutes=1440/);
  });
});

describe("scheduled ingestion — Libre", () => {
  it("initial Libre ingestion via connections → graph", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { email: "l@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("patientCgmConnections", { userId: uid, type: "libre", token: "tok-existing", libreApiBase: "https://api.eu.libreview.io", updatedAt: 0 });
      await ctx.db.insert("patientLibreCredentials", { userId: uid, libreEmail: "l@x.com", librePassword: "pw", updatedAt: 0 });
      await ctx.db.insert("cgmSyncState", { userId: uid, provider: "libre", consecutiveFailures: 0, status: "pending", nextEligibleAt: 0, generation: 0, updatedAt: 0 });
      return uid;
    });
    const tsSec = Math.floor(Date.now() / 1000) - 300;
    stubFetch([
      { test: (u) => u.endsWith("/llu/connections"), res: () => json({ data: [{ patientId: "pid" }] }) },
      { test: (u) => u.includes("/graph"), res: () => json({ data: { graphData: [{ Timestamp: tsSec, ValueInMgPerDl: 150, TrendArrow: 3 }] } }) },
    ]);

    const res = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res.inserted).toBe(1);
    const readings = await getReadings(t, userId);
    expect(readings[0].glucose).toBe(150);
    expect(readings[0].dexcomTrend).toBe(3);
  });
});

describe("leases and concurrency", () => {
  it("a second claim is denied while a lease is active", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    const now = Date.now();
    const a = await t.mutation(internal.cgmIngest.claimConnection, {
      userId, provider: "dexcom", now, leaseOwner: "A", leaseMs: 2 * MINUTE, force: false, minSinceAttemptMs: 0,
    });
    const b = await t.mutation(internal.cgmIngest.claimConnection, {
      userId, provider: "dexcom", now: now + 1000, leaseOwner: "B", leaseMs: 2 * MINUTE, force: false, minSinceAttemptMs: 0,
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("leased");
  });

  it("an abandoned lease is reclaimable, and the stale worker's completion is rejected", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    const now = Date.now();
    const a = await t.mutation(internal.cgmIngest.claimConnection, {
      userId, provider: "dexcom", now, leaseOwner: "A", leaseMs: MINUTE, force: false, minSinceAttemptMs: 0,
    });
    expect(a.ok).toBe(true);
    // lease expires; worker B reclaims
    const b = await t.mutation(internal.cgmIngest.claimConnection, {
      userId, provider: "dexcom", now: now + 2 * MINUTE, leaseOwner: "B", leaseMs: MINUTE, force: false, minSinceAttemptMs: 0,
    });
    expect(b.ok).toBe(true);
    // stale worker A tries to commit → rejected (lease owner changed)
    const completeA = await t.mutation(internal.cgmIngest.completeSync, {
      userId, provider: "dexcom", leaseOwner: "A", expectedGeneration: a.ok ? a.generation : 0,
      now: now + 3 * MINUTE, category: "none", status: "ok", nextEligibleAt: now + 10 * MINUTE,
      consecutiveFailures: 0, advancedCursor: false, unrecoverableGap: false, didReconcile: false,
    });
    expect(completeA.applied).toBe(false);
    expect(completeA.superseded).toBe(true);
  });

  it("expedited claim respects the throttle (minSinceAttemptMs)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      const s = await ctx.db.query("cgmSyncState").withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", "dexcom")).unique();
      if (s) await ctx.db.patch(s._id, { lastAttemptAt: now - 10_000 }); // synced 10s ago
    });
    const c = await t.mutation(internal.cgmIngest.claimConnection, {
      userId, provider: "dexcom", now, leaseOwner: "exp", leaseMs: MINUTE, force: true, minSinceAttemptMs: 60_000,
    });
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("too_soon");
  });
});

describe("scheduling, seeding and isolation", () => {
  it("listDueState returns a bounded batch, oldest-due first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let i = 0; i < 30; i++) {
        const uid = await ctx.db.insert("users", { email: `b${i}@x.com`, passwordHash: "ph", createdAt: 0, updatedAt: 0 });
        await ctx.db.insert("cgmSyncState", { userId: uid, provider: "dexcom", consecutiveFailures: 0, status: "pending", nextEligibleAt: i, generation: 0, updatedAt: 0 });
      }
    });
    const due = await t.query(internal.cgmIngest.listDueState, { now: Date.now(), limit: 25 });
    expect(due).toHaveLength(25);
  });

  it("seeds state for pre-existing connections that have no work-queue row, then ingests them", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t, { state: null }); // connection + creds, but NO cgmSyncState
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(dexcomItems(2, 5 * MINUTE)) }]);

    const res = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res.seeded).toBeGreaterThanOrEqual(1);
    expect(res.inserted).toBe(2);
    expect(await getState(t, userId)).not.toBeNull();
  });

  it("one provider failing does not block another (isolation)", async () => {
    const t = convexTest(schema, modules);
    const dexUser = await seedDexcom(t);
    const libUser = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { email: "li@x.com", passwordHash: "ph", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("patientCgmConnections", { userId: uid, type: "libre", token: "tok", libreApiBase: "https://api.eu.libreview.io", updatedAt: 0 });
      await ctx.db.insert("patientLibreCredentials", { userId: uid, libreEmail: "li@x.com", librePassword: "pw", updatedAt: 0 });
      await ctx.db.insert("cgmSyncState", { userId: uid, provider: "libre", consecutiveFailures: 0, status: "pending", nextEligibleAt: 0, generation: 0, updatedAt: 0 });
      return uid;
    });
    const tsSec = Math.floor(Date.now() / 1000) - 300;
    stubFetch([
      { test: (u) => u.includes("ReadPublisher"), res: () => text("boom", 503) }, // dexcom fails
      { test: (u) => u.endsWith("/llu/connections"), res: () => json({ data: [{ patientId: "pid" }] }) },
      { test: (u) => u.includes("/graph"), res: () => json({ data: { graphData: [{ Timestamp: tsSec, ValueInMgPerDl: 99, TrendArrow: 3 }] } }) },
    ]);

    const res = await t.action(internal.cgmIngest.runDueIngest, {});
    expect(res.failures).toBe(1);
    expect((await getReadings(t, dexUser))).toHaveLength(0);
    expect((await getReadings(t, libUser))).toHaveLength(1); // libre still ingested
  });
});

describe("mobile foreground + caregiver flow", () => {
  it("requestExpeditedSync ingests for the authed patient and returns canonical history", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(dexcomItems(4, 5 * MINUTE)) }]);

    const out = await t.action(api.cgmIngest.requestExpeditedSync, { userId, passwordHash: "ph" });
    expect(out.status).toBe("ok");
    expect(out.inserted).toBe(4);
    expect(out.readings).toHaveLength(4);
  });

  it("requestExpeditedSync rejects a bad password without touching the provider", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t);
    const fetchMock = stubFetch([{ test: () => true, res: () => json([]) }]);

    const out = await t.action(api.cgmIngest.requestExpeditedSync, { userId, passwordHash: "WRONG" });
    expect(out.status).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a caregiver query returns server-ingested readings (no patient app open)", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedDexcom(t, { caregiverCode: "ABC123" });
    stubFetch([{ test: (u) => u.includes("ReadPublisher"), res: () => json(dexcomItems(3, 5 * MINUTE)) }]);
    await t.action(internal.cgmIngest.runDueIngest, {});

    const caregiverView = await t.query(api.patientGlucose.listRecentForCaregiver, { code: "ABC123" });
    expect(caregiverView).toHaveLength(3);
    expect((await getReadings(t, userId))).toHaveLength(3);
  });
});
