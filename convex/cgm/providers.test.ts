import { describe, it, expect } from "vitest";
import { makeDexcomAdapter, makeLibreAdapter } from "./providers";
import type { FetchPlan } from "./core";

const plan: FetchPlan = { count: 12, windowMinutes: 120, reason: "incremental", expectUnrecoverableGap: false };

type Route = { test: (u: string) => boolean; res: (u: string, init?: RequestInit) => Response | Promise<Response> };
function router(routes: Route[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    for (const r of routes) if (r.test(u)) return r.res(u, init);
    throw new Error("unexpected fetch: " + u);
  }) as unknown as typeof fetch;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (body: string, status = 200) => new Response(body, { status });

describe("dexcom adapter", () => {
  it("logs in via authenticate → login and returns a session", async () => {
    const adapter = makeDexcomAdapter({
      fetch: router([
        { test: (u) => u.includes("AuthenticatePublisherAccount"), res: () => json("account-id-1234567890") },
        { test: (u) => u.includes("LoginPublisherAccountById"), res: () => json("session-id-abcdefghij") },
      ]),
    });
    const out = await adapter.login({ username: "u", password: "p", outsideUS: false });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.session).toEqual({ sessionId: "session-id-abcdefghij", outsideUS: false });
  });

  it("classifies a bad password as invalid_credentials (terminal)", async () => {
    const adapter = makeDexcomAdapter({
      fetch: router([
        { test: (u) => u.includes("AuthenticatePublisherAccount"), res: () => json({ Code: "AccountPasswordInvalid" }, 401) },
      ]),
    });
    const out = await adapter.login({ username: "u", password: "bad", outsideUS: false });
    expect(out).toEqual({ ok: false, category: "invalid_credentials" });
  });

  it("classifies an account lockout as rate_limited (temporary), not terminal", async () => {
    const adapter = makeDexcomAdapter({
      fetch: router([
        { test: (u) => u.includes("AuthenticatePublisherAccount"), res: () => json({ Code: "AccountLockout" }, 500) },
      ]),
    });
    const out = await adapter.login({ username: "u", password: "p", outsideUS: false });
    expect(out).toEqual({ ok: false, category: "rate_limited" });
  });

  it("normalizes readings (ST→ISO, value, trend, anomaly bounds)", async () => {
    const ms = 1_700_000_000_000;
    const adapter = makeDexcomAdapter({
      fetch: router([
        {
          test: (u) => u.includes("ReadPublisherLatestGlucoseValues"),
          res: () =>
            json([
              { ST: `/Date(${ms})/`, Value: 65, Trend: "FortyFiveDown" },
              { WT: `/Date(${ms + 300000})/`, Value: 250, Trend: 4 },
            ]),
        },
      ]),
    });
    const out = await adapter.read({ sessionId: "s", outsideUS: false }, plan);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.entries[0]).toEqual({
        glucose: 65,
        timestamp: new Date(ms).toISOString(),
        anomaly: { warning: true, message: "Low glucose: 65 mg/dL" },
        dexcomTrend: "FortyFiveDown",
      });
      expect(out.entries[1].glucose).toBe(250);
      expect(out.entries[1].anomaly.warning).toBe(true);
      expect(out.entries[1].dexcomTrend).toBe(4);
    }
  });

  it("reports an expired session on 401 so the caller re-logs in", async () => {
    const adapter = makeDexcomAdapter({
      fetch: router([{ test: (u) => u.includes("ReadPublisher"), res: () => text("SessionNotValid", 401) }]),
    });
    const out = await adapter.read({ sessionId: "s", outsideUS: false }, plan);
    expect(out).toEqual({ ok: false, sessionExpired: true, category: "none" });
  });

  it("maps 429 → rate_limited and 5xx → provider_outage (not session expiry)", async () => {
    const a429 = makeDexcomAdapter({ fetch: router([{ test: (u) => u.includes("ReadPublisher"), res: () => text("slow down", 429) }]) });
    expect(await a429.read({ sessionId: "s", outsideUS: false }, plan)).toEqual({
      ok: false,
      sessionExpired: false,
      category: "rate_limited",
    });
    const a500 = makeDexcomAdapter({ fetch: router([{ test: (u) => u.includes("ReadPublisher"), res: () => text("oops", 503) }]) });
    expect(await a500.read({ sessionId: "s", outsideUS: false }, plan)).toEqual({
      ok: false,
      sessionExpired: false,
      category: "provider_outage",
    });
  });

  it("maps a network exception to network_timeout", async () => {
    const adapter = makeDexcomAdapter({
      fetch: (() => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    const out = await adapter.read({ sessionId: "s", outsideUS: false }, plan);
    expect(out).toEqual({ ok: false, sessionExpired: false, category: "network_timeout" });
  });
});

describe("libre adapter", () => {
  it("follows the region redirect and returns a token + resolved host", async () => {
    let attempts = 0;
    const adapter = makeLibreAdapter({
      fetch: router([
        {
          test: (u) => u.includes("/llu/auth/login"),
          res: () => {
            attempts++;
            if (attempts === 1) return json({ status: 2, data: { redirect: true, region: "eu" } });
            return json({ data: { authTicket: { token: "tok-123" } } });
          },
        },
      ]),
    });
    const out = await adapter.login({ email: "a@b.com", password: "p" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.session.token).toBe("tok-123");
      expect(out.session.apiBase).toBe("https://api.eu.libreview.io");
    }
    expect(attempts).toBe(2);
  });

  it("treats a missing share token as invalid_credentials (sharing not enabled)", async () => {
    const adapter = makeLibreAdapter({
      fetch: router([{ test: (u) => u.includes("/llu/auth/login"), res: () => json({ data: {} }) }]),
    });
    const out = await adapter.login({ email: "a@b.com", password: "p" });
    expect(out).toEqual({ ok: false, category: "invalid_credentials" });
  });

  it("reads connections → graph, normalizes, and skips malformed rows", async () => {
    const tsSec = 1_700_000_000;
    const adapter = makeLibreAdapter({
      fetch: router([
        { test: (u) => u.endsWith("/llu/connections"), res: () => json({ data: [{ patientId: "pid-1" }] }) },
        {
          test: (u) => u.includes("/llu/connections/pid-1/graph"),
          res: () =>
            json({
              data: {
                graphData: [
                  { Timestamp: tsSec, ValueInMgPerDl: 140, TrendArrow: 3 },
                  { Timestamp: "not-a-number", Value: null }, // skipped
                ],
              },
            }),
        },
      ]),
    });
    const out = await adapter.read({ token: "t", apiBase: "https://api.eu.libreview.io" }, plan);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.entries).toHaveLength(1);
      expect(out.entries[0]).toEqual({
        glucose: 140,
        timestamp: new Date(tsSec * 1000).toISOString(),
        anomaly: { warning: false },
        dexcomTrend: 3,
      });
    }
  });

  it("reports an expired session on a 401 from connections", async () => {
    const adapter = makeLibreAdapter({
      fetch: router([{ test: (u) => u.endsWith("/llu/connections"), res: () => text("unauth", 401) }]),
    });
    const out = await adapter.read({ token: "t", apiBase: "https://api.eu.libreview.io" }, plan);
    expect(out).toEqual({ ok: false, sessionExpired: true, category: "none" });
  });
});
