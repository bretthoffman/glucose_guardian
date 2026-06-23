import { describe, it, expect } from "vitest";
import {
  computeFetchPlan,
  decideSchedule,
  runProviderSync,
  anomalyFor,
  type ProviderLimits,
  type ReadingRecord,
  type RetryConfig,
  type SyncEffects,
} from "./core";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const dexcomLimits: ProviderLimits = {
  cadenceMinutes: 5,
  maxCount: 288,
  maxWindowMinutes: 1440,
  supportsWindow: true,
  initialBackfillCount: 288,
  reconcileIntervalMs: 6 * HOUR,
};

const retry: RetryConfig = {
  baseBackoffMs: 5 * MINUTE,
  maxBackoffMs: 60 * MINUTE,
  rateLimitBackoffMs: 15 * MINUTE,
  terminalRecheckMs: 6 * HOUR,
};

const NOW = 1_700_000_000_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("anomalyFor", () => {
  it("flags lows and highs at the same bounds as the client/api-server paths", () => {
    expect(anomalyFor(65)).toEqual({ warning: true, message: "Low glucose: 65 mg/dL" });
    expect(anomalyFor(250)).toEqual({ warning: true, message: "High glucose: 250 mg/dL" });
    expect(anomalyFor(120)).toEqual({ warning: false });
  });
});

describe("computeFetchPlan", () => {
  it("first sync (no cursor) uses a bounded initial backfill over the full window", () => {
    const plan = computeFetchPlan({ now: NOW, lastReadingTimestamp: null, lastBackfillAt: NOW, limits: dexcomLimits });
    expect(plan.reason).toBe("initial");
    expect(plan.count).toBe(288);
    expect(plan.windowMinutes).toBe(1440);
    expect(plan.expectUnrecoverableGap).toBe(false);
  });

  it("incremental fetch covers the elapsed gap plus overlap, clamped", () => {
    // 10 min gap, reconcile NOT due (lastBackfillAt just now) → incremental.
    const plan = computeFetchPlan({
      now: NOW,
      lastReadingTimestamp: iso(10 * MINUTE),
      lastBackfillAt: NOW,
      limits: dexcomLimits,
    });
    expect(plan.reason).toBe("incremental");
    expect(plan.count).toBe(Math.ceil(10 / 5) + 2); // 4
    expect(plan.expectUnrecoverableGap).toBe(false);
  });

  it("gap longer than retention triggers catchup and flags an unrecoverable gap", () => {
    const plan = computeFetchPlan({
      now: NOW,
      lastReadingTimestamp: iso(30 * HOUR), // > 24h retention
      lastBackfillAt: NOW,
      limits: dexcomLimits,
    });
    expect(plan.reason).toBe("catchup");
    expect(plan.count).toBe(288);
    expect(plan.windowMinutes).toBe(1440);
    expect(plan.expectUnrecoverableGap).toBe(true);
  });

  it("periodic reconcile fetches the full window even when newer readings exist", () => {
    const plan = computeFetchPlan({
      now: NOW,
      lastReadingTimestamp: iso(10 * MINUTE), // recent data exists
      lastBackfillAt: NOW - 7 * HOUR, // reconcile interval (6h) elapsed
      limits: dexcomLimits,
    });
    expect(plan.reason).toBe("reconcile");
    expect(plan.count).toBe(288);
    expect(plan.windowMinutes).toBe(1440);
  });
});

describe("decideSchedule", () => {
  it("success schedules the next run at cadence and clears failures", () => {
    const d = decideSchedule({ now: NOW, category: "none", priorConsecutiveFailures: 3, cadenceMinutes: 5, retry });
    expect(d.status).toBe("ok");
    expect(d.consecutiveFailures).toBe(0);
    expect(d.nextEligibleAt).toBe(NOW + 5 * MINUTE);
    expect(d.terminal).toBe(false);
  });

  it("transient failures back off exponentially, capped", () => {
    const first = decideSchedule({ now: NOW, category: "provider_outage", priorConsecutiveFailures: 0, cadenceMinutes: 5, retry });
    const third = decideSchedule({ now: NOW, category: "provider_outage", priorConsecutiveFailures: 2, cadenceMinutes: 5, retry });
    expect(first.status).toBe("retrying");
    expect(first.nextEligibleAt).toBe(NOW + retry.baseBackoffMs); // base * 2^0
    expect(third.nextEligibleAt).toBe(NOW + retry.baseBackoffMs * 4); // base * 2^2
    // capped
    const huge = decideSchedule({ now: NOW, category: "network_timeout", priorConsecutiveFailures: 20, cadenceMinutes: 5, retry });
    expect(huge.nextEligibleAt).toBe(NOW + retry.maxBackoffMs);
  });

  it("rate limiting uses the longer rate-limit backoff floor", () => {
    const d = decideSchedule({ now: NOW, category: "rate_limited", priorConsecutiveFailures: 0, cadenceMinutes: 5, retry });
    expect(d.nextEligibleAt).toBe(NOW + retry.rateLimitBackoffMs);
  });

  it("terminal credential failures back off to the long recheck (not the 5-min cadence)", () => {
    const noCreds = decideSchedule({ now: NOW, category: "no_credentials", priorConsecutiveFailures: 0, cadenceMinutes: 5, retry });
    expect(noCreds.status).toBe("no_credentials");
    expect(noCreds.terminal).toBe(true);
    expect(noCreds.nextEligibleAt).toBe(NOW + retry.terminalRecheckMs);

    const invalid = decideSchedule({ now: NOW, category: "invalid_credentials", priorConsecutiveFailures: 0, cadenceMinutes: 5, retry });
    expect(invalid.status).toBe("needs_reconnect");
    expect(invalid.terminal).toBe(true);
    expect(invalid.nextEligibleAt).toBe(NOW + retry.terminalRecheckMs);
  });
});

/* ----------------------------- runProviderSync ----------------------------- */

type Creds = { id: string };
type Session = { sid: string };

function reading(msAgo: number, glucose = 120): ReadingRecord {
  return { glucose, timestamp: iso(msAgo), anomaly: anomalyFor(glucose) };
}

function makeEffects(overrides: Partial<SyncEffects<Creds, Session>>): {
  fx: SyncEffects<Creds, Session>;
  calls: { login: number; read: number; persistSession: number; persist: number };
} {
  const calls = { login: 0, read: 0, persistSession: 0, persist: 0 };
  const fx: SyncEffects<Creds, Session> = {
    login: async () => {
      calls.login++;
      return { ok: true, session: { sid: "fresh" } };
    },
    read: async () => {
      calls.read++;
      return { ok: true, entries: [] };
    },
    persistSession: async () => {
      calls.persistSession++;
    },
    persist: async (entries) => {
      calls.persist++;
      const ts = entries.map((e) => e.timestamp).sort();
      return { inserted: entries.length, maxTimestamp: ts.length ? ts[ts.length - 1] : null };
    },
    ...overrides,
  };
  return { fx, calls };
}

describe("runProviderSync", () => {
  const baseCtx = {
    now: NOW,
    limits: dexcomLimits,
    state: { lastReadingTimestamp: iso(10 * MINUTE), lastBackfillAt: NOW, consecutiveFailures: 0 },
    creds: { id: "c" } as Creds,
    session: { sid: "existing" } as Session,
  };

  it("returns no_credentials and does nothing when credentials are missing", async () => {
    const { fx, calls } = makeEffects({});
    const out = await runProviderSync({ ...baseCtx, creds: null }, fx);
    expect(out.category).toBe("no_credentials");
    expect(out.advancedCursor).toBe(false);
    expect(calls.read).toBe(0);
    expect(calls.login).toBe(0);
  });

  it("happy path persists and advances the cursor to the newest persisted reading", async () => {
    const { fx, calls } = makeEffects({
      read: async () => ({ ok: true, entries: [reading(8 * MINUTE), reading(3 * MINUTE)] }),
    });
    const out = await runProviderSync(baseCtx, fx);
    expect(out.category).toBe("none");
    expect(out.inserted).toBe(2);
    expect(out.advancedCursor).toBe(true);
    expect(out.newCursor).toBe(iso(3 * MINUTE));
    expect(out.refreshedSession).toBe(false);
    expect(calls.login).toBe(0);
  });

  it("expired session triggers one silent re-login, persists the session, then re-reads", async () => {
    let readCount = 0;
    const { fx, calls } = makeEffects({
      read: async () => {
        readCount++;
        if (readCount === 1) return { ok: false, sessionExpired: true, category: "none" };
        return { ok: true, entries: [reading(2 * MINUTE)] };
      },
    });
    const out = await runProviderSync(baseCtx, fx);
    expect(out.category).toBe("none");
    expect(out.refreshedSession).toBe(true);
    expect(calls.login).toBe(1);
    expect(calls.persistSession).toBe(1);
    expect(readCount).toBe(2); // read attempted, failed expired, retried after re-login
  });

  it("missing session goes straight to login", async () => {
    const { fx, calls } = makeEffects({
      read: async () => ({ ok: true, entries: [reading(1 * MINUTE)] }),
    });
    const out = await runProviderSync({ ...baseCtx, session: null }, fx);
    expect(out.category).toBe("none");
    expect(calls.login).toBe(1);
    expect(calls.persistSession).toBe(1);
  });

  it("a failed re-login surfaces the credential category and does NOT advance the cursor", async () => {
    const { fx } = makeEffects({
      read: async () => ({ ok: false, sessionExpired: true, category: "none" }),
      login: async () => ({ ok: false, category: "invalid_credentials" }),
    });
    const out = await runProviderSync(baseCtx, fx);
    expect(out.category).toBe("invalid_credentials");
    expect(out.advancedCursor).toBe(false);
    expect(out.newCursor).toBe(baseCtx.state.lastReadingTimestamp);
  });

  it("a non-expiry read failure is reported as its transient category", async () => {
    const { fx } = makeEffects({
      read: async () => ({ ok: false, sessionExpired: false, category: "provider_outage" }),
    });
    const out = await runProviderSync(baseCtx, fx);
    expect(out.category).toBe("provider_outage");
    expect(out.advancedCursor).toBe(false);
  });

  it("a persistence failure does NOT advance the cursor", async () => {
    const { fx } = makeEffects({
      read: async () => ({ ok: true, entries: [reading(1 * MINUTE)] }),
      persist: async () => {
        throw new Error("db down");
      },
    });
    const out = await runProviderSync(baseCtx, fx);
    expect(out.category).toBe("persistence_failure");
    expect(out.advancedCursor).toBe(false);
    expect(out.newCursor).toBe(baseCtx.state.lastReadingTimestamp);
  });

  it("does not advance the cursor when persisted readings are all older than the cursor", async () => {
    const { fx } = makeEffects({
      // returns only readings older than the current cursor (10m ago)
      read: async () => ({ ok: true, entries: [reading(20 * MINUTE), reading(15 * MINUTE)] }),
    });
    const out = await runProviderSync(baseCtx, fx);
    expect(out.category).toBe("none");
    expect(out.advancedCursor).toBe(false);
    expect(out.newCursor).toBe(iso(10 * MINUTE));
  });
});
