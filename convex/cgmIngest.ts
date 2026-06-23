/**
 * Convex-owned CGM ingestion — the authoritative, unattended path that keeps glucose flowing into
 * `patientGlucoseReadings` whether or not the patient app is open.
 *
 * This module is the THIN binding layer between Convex and the pure policy in `convex/cgm/*`:
 *   - work queue + health live in the `cgmSyncState` table,
 *   - scheduling/leasing/cursor/retry decisions come from `cgm/core` (pure, unit-tested),
 *   - provider protocol lives in `cgm/providers` (Dexcom + Libre adapters),
 *   - a single due-driven dispatcher (`runDueIngest`, the cron target) processes a bounded batch,
 *   - a client-callable `requestExpeditedSync` action runs the SAME path for one connection on
 *     foreground, so Convex is the single cursor/refresh authority (the mobile app no longer talks
 *     to the provider directly for ingestion).
 *
 * Credentials (incl. passwords) are read only by `internal*` functions and never returned to clients.
 */
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { ingestConfig, PROVIDER_LIMITS, RETRY_CONFIG } from "./cgm/config";
import {
  decideSchedule,
  runProviderSync,
  type FailureCategory,
  type Provider,
  type ReadingRecord,
  type SyncOutcome,
} from "./cgm/core";
import {
  makeDexcomAdapter,
  makeLibreAdapter,
  LIBRE_DEFAULT_BASE,
  type DexcomCreds,
  type DexcomSession,
  type LibreCreds,
  type LibreSession,
} from "./cgm/providers";

const providerValidator = v.union(v.literal("dexcom"), v.literal("libre"));

const glucoseEntryPayload = v.object({
  glucose: v.number(),
  timestamp: v.string(),
  anomaly: v.object({ warning: v.boolean(), message: v.optional(v.string()) }),
  dexcomTrend: v.optional(v.union(v.number(), v.string())),
});

/* ============================ work-queue queries ============================ */

/** INTERNAL: due connections (oldest-due first → fair), bounded by `limit`. */
export const listDueState = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args): Promise<Array<{ userId: Id<"users">; provider: Provider }>> => {
    const rows = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_due", (q) => q.lte("nextEligibleAt", args.now))
      .order("asc")
      .take(args.limit);
    return rows.map((r) => ({ userId: r.userId, provider: r.provider }));
  },
});

type CredsAndSession =
  | { provider: "dexcom"; creds: DexcomCreds | null; session: DexcomSession | null }
  | { provider: "libre"; creds: LibreCreds | null; session: LibreSession | null };

/** INTERNAL: credentials (incl. password) + current session for one connection. Server-only. */
export const getCredsAndSession = internalQuery({
  args: { userId: v.id("users"), provider: providerValidator },
  handler: async (ctx, args): Promise<CredsAndSession> => {
    const conn = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (args.provider === "dexcom") {
      const c = await ctx.db
        .query("patientDexcomCredentials")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .unique();
      const creds: DexcomCreds | null = c
        ? { username: c.dexcomUsername, password: c.dexcomPassword, outsideUS: c.outsideUS }
        : null;
      const session: DexcomSession | null =
        conn?.type === "dexcom" && conn.sessionId
          ? { sessionId: conn.sessionId, outsideUS: c?.outsideUS ?? conn.outsideUS ?? false }
          : null;
      return { provider: "dexcom", creds, session };
    }

    const c = await ctx.db
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const creds: LibreCreds | null = c
      ? { email: c.libreEmail, password: c.librePassword, apiBase: c.libreApiBase }
      : null;
    const session: LibreSession | null =
      conn?.type === "libre" && conn.token
        ? { token: conn.token, apiBase: conn.libreApiBase ?? c?.libreApiBase ?? LIBRE_DEFAULT_BASE }
        : null;
    return { provider: "libre", creds, session };
  },
});

/** INTERNAL: latest readings (ascending) for returning canonical history to the mobile client. */
export const recentReadings = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, args) => {
    const lim = Math.min(Math.max(args.limit, 1), 500);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(lim);
    const mapped = rows.map((r) => ({
      glucose: r.glucose,
      timestamp: r.timestamp,
      anomaly: r.anomaly,
      dexcomTrend: r.dexcomTrend,
    }));
    mapped.reverse();
    return mapped;
  },
});

/** INTERNAL: verify patient auth and return the connected provider (or null connection / null auth). */
export const authConnection = internalQuery({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args): Promise<{ provider: Provider | null } | null> => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.passwordHash !== args.passwordHash) return null;
    const conn = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    return { provider: conn?.type ?? null };
  },
});

/* ============================ work-queue mutations =========================== */

/**
 * INTERNAL: seed `cgmSyncState` for pre-existing connections that predate this system. Bounded by
 * `limit` seeds per run. New/reconnecting connections are seeded on `patientCgm.replace`; this is the
 * transitional migration path for users who never re-open the app. Scans the (active-user-sized)
 * connections table — see the spec for the scale boundary.
 */
export const seedMissingState = internalMutation({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const connections = await ctx.db.query("patientCgmConnections").take(500);
    let seeded = 0;
    for (const conn of connections) {
      if (seeded >= args.limit) break;
      const existing = await ctx.db
        .query("cgmSyncState")
        .withIndex("by_user_provider", (q) => q.eq("userId", conn.userId).eq("provider", conn.type))
        .unique();
      if (existing) continue;
      await ctx.db.insert("cgmSyncState", {
        userId: conn.userId,
        provider: conn.type,
        consecutiveFailures: 0,
        status: "pending",
        nextEligibleAt: args.now,
        generation: 0,
        updatedAt: args.now,
      });
      seeded++;
    }
    return seeded;
  },
});

/** INTERNAL: ensure a state row exists for (user, provider); used by the expedited path. */
export const ensureState = internalMutation({
  args: { userId: v.id("users"), provider: providerValidator, now: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId).eq("provider", args.provider))
      .unique();
    if (existing) return;
    await ctx.db.insert("cgmSyncState", {
      userId: args.userId,
      provider: args.provider,
      consecutiveFailures: 0,
      status: "pending",
      nextEligibleAt: args.now,
      generation: 0,
      updatedAt: args.now,
    });
  },
});

type ClaimResult =
  | {
      ok: true;
      generation: number;
      lastReadingTimestamp: string | null;
      lastBackfillAt: number | null;
      consecutiveFailures: number;
    }
  | { ok: false; reason: "no_state" | "leased" | "not_due" | "too_soon" };

/**
 * INTERNAL: atomically claim a connection for syncing. Convex mutations are serializable, so two
 * concurrent claims cannot both succeed — the second observes the unexpired lease and is denied.
 * `force` bypasses the due check (expedited foreground sync) but still respects an active lease and
 * the `minSinceAttemptMs` throttle, so repeated foreground events cannot hammer the provider.
 */
export const claimConnection = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    now: v.number(),
    leaseOwner: v.string(),
    leaseMs: v.number(),
    force: v.boolean(),
    minSinceAttemptMs: v.number(),
  },
  handler: async (ctx, args): Promise<ClaimResult> => {
    const row = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId).eq("provider", args.provider))
      .unique();
    if (!row) return { ok: false, reason: "no_state" };
    if (row.leaseExpiresAt && row.leaseExpiresAt > args.now) return { ok: false, reason: "leased" };
    if (!args.force && row.nextEligibleAt > args.now) return { ok: false, reason: "not_due" };
    if (
      args.minSinceAttemptMs > 0 &&
      row.lastAttemptAt &&
      args.now - row.lastAttemptAt < args.minSinceAttemptMs
    ) {
      return { ok: false, reason: "too_soon" };
    }
    await ctx.db.patch(row._id, {
      leaseOwner: args.leaseOwner,
      leaseExpiresAt: args.now + args.leaseMs,
      updatedAt: args.now,
    });
    return {
      ok: true,
      generation: row.generation,
      lastReadingTimestamp: row.lastReadingTimestamp ?? null,
      lastBackfillAt: row.lastBackfillAt ?? null,
      consecutiveFailures: row.consecutiveFailures,
    };
  },
});

/**
 * INTERNAL: persist a refreshed provider session back onto the connection row. The connection row is
 * the server-owned source of truth for the session; the mobile app no longer writes sessions except
 * on explicit user reconnect, so this cannot be clobbered by stale client state.
 */
export const updateDexcomSession = internalMutation({
  args: { userId: v.id("users"), sessionId: v.string(), outsideUS: v.boolean() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!existing || existing.type !== "dexcom") return;
    await ctx.db.patch(existing._id, {
      sessionId: args.sessionId,
      outsideUS: args.outsideUS,
      updatedAt: Date.now(),
    });
  },
});

export const updateLibreSession = internalMutation({
  args: { userId: v.id("users"), token: v.string(), libreApiBase: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!existing || existing.type !== "libre") return;
    await ctx.db.patch(existing._id, {
      token: args.token,
      libreApiBase: args.libreApiBase,
      updatedAt: Date.now(),
    });
  },
});

/**
 * INTERNAL: insert readings, skipping timestamps that already exist (same dedupe as
 * `patientGlucose.upsertBatch`). `maxTimestamp` spans ALL provided entries (not just newly inserted),
 * because dedupe-skipped rows are already persisted — so the cursor can advance past them.
 */
export const insertReadings = internalMutation({
  args: { userId: v.id("users"), entries: v.array(glucoseEntryPayload) },
  handler: async (ctx, args): Promise<{ inserted: number; maxTimestamp: string | null }> => {
    let inserted = 0;
    let maxTimestamp: string | null = null;
    for (const e of args.entries.slice(0, 400)) {
      if (maxTimestamp === null || e.timestamp > maxTimestamp) maxTimestamp = e.timestamp;
      const existing = await ctx.db
        .query("patientGlucoseReadings")
        .withIndex("by_user_time", (q) => q.eq("userId", args.userId).eq("timestamp", e.timestamp))
        .unique();
      if (existing) continue;
      await ctx.db.insert("patientGlucoseReadings", {
        userId: args.userId,
        glucose: e.glucose,
        timestamp: e.timestamp,
        anomaly: e.anomaly,
        dexcomTrend: e.dexcomTrend,
      });
      inserted++;
    }
    return { inserted, maxTimestamp };
  },
});

/**
 * INTERNAL: commit the result of a sync and release the lease. Guarded by `leaseOwner` AND
 * `expectedGeneration`: a stale worker whose lease expired (and was reclaimed by another worker)
 * cannot overwrite the newer state. The generation is bumped on every committed write.
 */
export const completeSync = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    leaseOwner: v.string(),
    expectedGeneration: v.number(),
    now: v.number(),
    category: v.string(),
    status: v.union(
      v.literal("ok"),
      v.literal("pending"),
      v.literal("retrying"),
      v.literal("needs_reconnect"),
      v.literal("no_credentials"),
    ),
    nextEligibleAt: v.number(),
    consecutiveFailures: v.number(),
    newCursor: v.optional(v.string()),
    advancedCursor: v.boolean(),
    unrecoverableGap: v.boolean(),
    didReconcile: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ applied: boolean; superseded?: boolean }> => {
    const row = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", args.userId).eq("provider", args.provider))
      .unique();
    if (!row) return { applied: false };
    if (row.leaseOwner !== args.leaseOwner || row.generation !== args.expectedGeneration) {
      return { applied: false, superseded: true };
    }

    const success = args.category === "none";
    const patch: Record<string, unknown> = {
      status: args.status,
      consecutiveFailures: args.consecutiveFailures,
      nextEligibleAt: args.nextEligibleAt,
      lastAttemptAt: args.now,
      generation: row.generation + 1,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      updatedAt: args.now,
    };
    if (success) {
      patch.lastSuccessAt = args.now;
      patch.lastFailureCategory = undefined;
      if (args.advancedCursor && args.newCursor) patch.lastReadingTimestamp = args.newCursor;
      if (args.didReconcile) patch.lastBackfillAt = args.now;
      patch.unrecoverableGap = args.unrecoverableGap;
    } else {
      patch.lastFailureCategory = args.category;
      patch.lastFailureAt = args.now;
    }
    await ctx.db.patch(row._id, patch);
    return { applied: true };
  },
});

/* =============================== orchestration =============================== */

function jitterMs(success: boolean): number {
  // Spread retries/cadence so many users don't stampede the provider at the same instant.
  return Math.floor(Math.random() * (success ? 30_000 : 60_000));
}

/**
 * Claim → sync (via the pure orchestrator + provider adapter) → complete, for ONE connection.
 * Returns what happened so the dispatcher / expedited action can aggregate. Never throws for normal
 * failure modes (they become a `FailureCategory`); only genuinely unexpected errors propagate.
 */
async function processConnection(
  ctx: ActionCtx,
  params: { userId: Id<"users">; provider: Provider; leaseOwner: string; now: number; force: boolean; minSinceAttemptMs: number },
): Promise<{ outcome: "skipped" | "ok" | "failed"; inserted: number; category: FailureCategory | "skipped" }> {
  const claim = await ctx.runMutation(internal.cgmIngest.claimConnection, {
    userId: params.userId,
    provider: params.provider,
    now: params.now,
    leaseOwner: params.leaseOwner,
    leaseMs: ingestConfig.leaseMs,
    force: params.force,
    minSinceAttemptMs: params.minSinceAttemptMs,
  });
  if (!claim.ok) return { outcome: "skipped", inserted: 0, category: "skipped" };

  const limits = PROVIDER_LIMITS[params.provider];
  const state = {
    lastReadingTimestamp: claim.lastReadingTimestamp,
    lastBackfillAt: claim.lastBackfillAt,
    consecutiveFailures: claim.consecutiveFailures,
  };

  let outcome: SyncOutcome;
  const target = await ctx.runQuery(internal.cgmIngest.getCredsAndSession, {
    userId: params.userId,
    provider: params.provider,
  });

  const persist = (entries: ReadingRecord[]) =>
    ctx.runMutation(internal.cgmIngest.insertReadings, { userId: params.userId, entries });

  if (target.provider === "dexcom") {
    const adapter = makeDexcomAdapter();
    outcome = await runProviderSync<DexcomCreds, DexcomSession>(
      { now: params.now, limits, state, creds: target.creds, session: target.session },
      {
        login: (c) => adapter.login(c),
        read: (s, plan) => adapter.read(s, plan),
        persistSession: async (s) => {
          await ctx.runMutation(internal.cgmIngest.updateDexcomSession, {
            userId: params.userId,
            sessionId: s.sessionId,
            outsideUS: s.outsideUS,
          });
        },
        persist,
      },
    );
  } else {
    const adapter = makeLibreAdapter();
    outcome = await runProviderSync<LibreCreds, LibreSession>(
      { now: params.now, limits, state, creds: target.creds, session: target.session },
      {
        login: (c) => adapter.login(c),
        read: (s, plan) => adapter.read(s, plan),
        persistSession: async (s) => {
          await ctx.runMutation(internal.cgmIngest.updateLibreSession, {
            userId: params.userId,
            token: s.token,
            libreApiBase: s.apiBase,
          });
        },
        persist,
      },
    );
  }

  const sched = decideSchedule({
    now: params.now,
    category: outcome.category,
    priorConsecutiveFailures: claim.consecutiveFailures,
    cadenceMinutes: limits.cadenceMinutes,
    retry: RETRY_CONFIG,
  });

  await ctx.runMutation(internal.cgmIngest.completeSync, {
    userId: params.userId,
    provider: params.provider,
    leaseOwner: params.leaseOwner,
    expectedGeneration: claim.generation,
    now: params.now,
    category: outcome.category,
    status: sched.status,
    nextEligibleAt: sched.nextEligibleAt + jitterMs(outcome.category === "none"),
    consecutiveFailures: sched.consecutiveFailures,
    newCursor: outcome.newCursor ?? undefined,
    advancedCursor: outcome.advancedCursor,
    unrecoverableGap: outcome.unrecoverableGap,
    didReconcile:
      outcome.reason === "reconcile" || outcome.reason === "initial" || outcome.reason === "catchup",
  });

  return {
    outcome: outcome.category === "none" ? "ok" : "failed",
    inserted: outcome.inserted,
    category: outcome.category,
  };
}

/* ============================== cron + expedited ============================= */

/**
 * INTERNAL (cron target): process a bounded batch of due connections. Overlapping runs are safe
 * because each connection is claimed under an expiring lease; a slow provider only ties up its own
 * lease, and one failing connection never aborts the batch (`Promise.allSettled`). Both providers
 * flow through this one dispatcher.
 */
export const runDueIngest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ processed: number; inserted: number; failures: number; seeded: number }> => {
    const now = Date.now();
    const seeded = await ctx.runMutation(internal.cgmIngest.seedMissingState, {
      now,
      limit: ingestConfig.seedLimit,
    });
    const due = await ctx.runQuery(internal.cgmIngest.listDueState, { now, limit: ingestConfig.batchLimit });
    if (due.length === 0) {
      return { processed: 0, inserted: 0, failures: 0, seeded };
    }

    const runId = `cron-${now}-${Math.floor(Math.random() * 1e9)}`;
    const concurrency = ingestConfig.concurrency;
    let processed = 0;
    let inserted = 0;
    let failures = 0;

    for (let i = 0; i < due.length; i += concurrency) {
      const batch = due.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((item, idx) =>
          processConnection(ctx, {
            userId: item.userId,
            provider: item.provider,
            leaseOwner: `${runId}:${i + idx}`,
            now: Date.now(),
            force: false,
            minSinceAttemptMs: 0,
          }),
        ),
      );
      for (const r of results) {
        processed++;
        if (r.status === "fulfilled") {
          inserted += r.value.inserted;
          if (r.value.outcome === "failed") failures++;
        } else {
          failures++;
          console.warn(`[cgmIngest] worker error: ${String(r.reason)}`);
        }
      }
    }

    console.log(
      `[cgmIngest] due run: processed=${processed} inserted=${inserted} failures=${failures} seeded=${seeded}`,
    );
    return { processed, inserted, failures, seeded };
  },
});

/**
 * PUBLIC (client-callable): request an expedited canonical sync for the signed-in patient, then
 * return canonical recent history. This is the mobile foreground trigger — it runs the SAME claim +
 * adapter + persist path as the cron, so there is ONE cursor authority. The lease prevents collision
 * with the cron, and `minSinceAttemptMs` throttles repeated foreground events server-side so the app
 * cannot generate uncontrolled provider requests. Auth is by `userId` + `passwordHash`.
 */
export const requestExpeditedSync = action({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "ok" | "pending" | "retrying" | "needs_reconnect" | "no_credentials" | "unauthorized" | "not_connected";
    inserted: number;
    readings: Array<{
      glucose: number;
      timestamp: string;
      anomaly: { warning: boolean; message?: string };
      dexcomTrend?: number | string;
    }>;
  }> => {
    const now = Date.now();
    const auth = await ctx.runQuery(internal.cgmIngest.authConnection, {
      userId: args.userId,
      passwordHash: args.passwordHash,
    });
    if (!auth) return { status: "unauthorized", inserted: 0, readings: [] };
    if (!auth.provider) return { status: "not_connected", inserted: 0, readings: [] };

    await ctx.runMutation(internal.cgmIngest.ensureState, { userId: args.userId, provider: auth.provider, now });

    const result = await processConnection(ctx, {
      userId: args.userId,
      provider: auth.provider,
      leaseOwner: `expedited-${now}-${Math.floor(Math.random() * 1e9)}`,
      now,
      force: true,
      minSinceAttemptMs: ingestConfig.expeditedMinIntervalMs,
    });

    const readings = await ctx.runQuery(internal.cgmIngest.recentReadings, { userId: args.userId, limit: 300 });
    const status =
      result.category === "skipped" || result.category === "none"
        ? "ok"
        : result.category === "no_credentials"
          ? "no_credentials"
          : result.category === "invalid_credentials"
            ? "needs_reconnect"
            : "retrying";
    return { status, inserted: result.inserted, readings };
  },
});
