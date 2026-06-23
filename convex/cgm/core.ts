/**
 * Provider-agnostic CGM ingestion policy — PURE logic, no Convex or network imports.
 *
 * This module is the shared brain for both Dexcom and Libre: failure classification, retry/backoff,
 * cursor/overlap/gap planning, and the orchestration of a single connection sync (`runProviderSync`)
 * via injected effects. Keeping it pure makes every policy decision unit-testable without a Convex
 * deployment or live provider credentials. Time (`now`) is always passed in — never read here — so
 * tests are deterministic and Convex's determinism rules are never a concern.
 */

export type Provider = "dexcom" | "libre";

/** Sanitized failure taxonomy. `none` means success. Stored as a string in `cgmSyncState`. */
export type FailureCategory =
  | "none"
  | "no_credentials"
  | "invalid_credentials"
  | "provider_outage"
  | "network_timeout"
  | "rate_limited"
  | "malformed_response"
  | "persistence_failure"
  | "missing_config"
  | "internal_error";

/** Health surfaced to operators and (indirectly) to the patient connection-health banner. */
export type SyncStatus = "ok" | "pending" | "retrying" | "needs_reconnect" | "no_credentials";

/** Categories that should NOT keep re-authenticating every cycle (terminal until user reconnects). */
const TERMINAL_CATEGORIES: ReadonlySet<FailureCategory> = new Set([
  "no_credentials",
  "invalid_credentials",
]);

export function isTerminalCategory(category: FailureCategory): boolean {
  return TERMINAL_CATEGORIES.has(category);
}

export interface ProviderLimits {
  /** Nominal sample cadence in minutes (≈5 for Dexcom/Libre). Drives normal scheduling + count math. */
  cadenceMinutes: number;
  /** Max readings to request in a single fetch (provider hard cap). */
  maxCount: number;
  /** Provider server-side retention window in minutes; data older than this is unrecoverable. */
  maxWindowMinutes: number;
  /** Whether the provider accepts an explicit lookback window (Dexcom yes, Libre no — fixed graph). */
  supportsWindow: boolean;
  /** Count to request on the very first sync (bounded initial backfill). */
  initialBackfillCount: number;
  /** How often to run a deep reconcile pass to fill interior gaps even when newer readings exist. */
  reconcileIntervalMs: number;
}

export type FetchReason = "initial" | "incremental" | "reconcile" | "catchup";

export interface FetchPlan {
  /** Readings to request, clamped to provider limits. */
  count: number;
  /** Lookback window in minutes (meaningful only when `supportsWindow`). */
  windowMinutes: number;
  reason: FetchReason;
  /** True when the gap exceeds provider retention, so an interior period cannot be recovered. */
  expectUnrecoverableGap: boolean;
}

/** A normalized reading ready to persist. Shape matches the `patientGlucoseReadings` row. */
export interface ReadingRecord {
  glucose: number;
  timestamp: string; // ISO-8601 UTC
  anomaly: { warning: boolean; message?: string };
  dexcomTrend?: number | string;
}

export type LoginOutcome<Session> =
  | { ok: true; session: Session }
  | { ok: false; category: FailureCategory };

export type ReadOutcome =
  | { ok: true; entries: ReadingRecord[] }
  | { ok: false; sessionExpired: boolean; category: FailureCategory };

/** Anomaly bounds match the existing client + api-server paths so stored rows are identical. */
export const LOW_BOUND = 70;
export const HIGH_BOUND = 240;

export function anomalyFor(glucose: number): { warning: boolean; message?: string } {
  if (glucose < LOW_BOUND) return { warning: true, message: `Low glucose: ${glucose} mg/dL` };
  if (glucose > HIGH_BOUND) return { warning: true, message: `High glucose: ${glucose} mg/dL` };
  return { warning: false };
}

const OVERLAP_SAMPLES = 2; // deliberate overlap so boundary readings are never skipped
const MIN_FETCH_COUNT = 2;

/**
 * Decide how much history to request for this run.
 *
 * - First sync (no cursor): bounded initial backfill.
 * - Gap longer than retention: fetch the full retained window and flag an unrecoverable interior gap.
 * - Periodic reconcile: fetch the full window to fill interior holes even though newer data exists.
 * - Otherwise: incremental — enough samples to cover the elapsed gap plus overlap, clamped to limits.
 */
export function computeFetchPlan(args: {
  now: number;
  lastReadingTimestamp: string | null;
  lastBackfillAt: number | null;
  limits: ProviderLimits;
}): FetchPlan {
  const { now, lastReadingTimestamp, lastBackfillAt, limits } = args;

  if (!lastReadingTimestamp) {
    return {
      count: clamp(limits.initialBackfillCount, MIN_FETCH_COUNT, limits.maxCount),
      windowMinutes: limits.maxWindowMinutes,
      reason: "initial",
      expectUnrecoverableGap: false,
    };
  }

  const lastMs = Date.parse(lastReadingTimestamp);
  if (Number.isNaN(lastMs)) {
    return {
      count: clamp(limits.initialBackfillCount, MIN_FETCH_COUNT, limits.maxCount),
      windowMinutes: limits.maxWindowMinutes,
      reason: "initial",
      expectUnrecoverableGap: false,
    };
  }

  const gapMinutes = Math.max(0, (now - lastMs) / 60000);

  if (gapMinutes > limits.maxWindowMinutes) {
    // Inactivity exceeded retention: grab everything still available; the older interior is lost.
    return {
      count: limits.maxCount,
      windowMinutes: limits.maxWindowMinutes,
      reason: "catchup",
      expectUnrecoverableGap: true,
    };
  }

  const reconcileDue =
    lastBackfillAt === null || now - lastBackfillAt >= limits.reconcileIntervalMs;
  if (reconcileDue) {
    return {
      count: limits.maxCount,
      windowMinutes: limits.maxWindowMinutes,
      reason: "reconcile",
      expectUnrecoverableGap: false,
    };
  }

  const needed = Math.ceil(gapMinutes / limits.cadenceMinutes) + OVERLAP_SAMPLES;
  const count = clamp(needed, MIN_FETCH_COUNT, limits.maxCount);
  const windowMinutes = clamp(
    Math.ceil(gapMinutes) + limits.cadenceMinutes * OVERLAP_SAMPLES,
    limits.cadenceMinutes,
    limits.maxWindowMinutes,
  );
  return { count, windowMinutes, reason: "incremental", expectUnrecoverableGap: false };
}

export interface RetryConfig {
  /** Base backoff for transient failures (ms). */
  baseBackoffMs: number;
  /** Cap on transient backoff (ms). */
  maxBackoffMs: number;
  /** Backoff floor for rate limiting (ms). */
  rateLimitBackoffMs: number;
  /** How long to wait before re-checking a terminal credential failure (ms). */
  terminalRecheckMs: number;
}

export interface ScheduleDecision {
  nextEligibleAt: number;
  status: SyncStatus;
  /** New consecutive-failure counter (0 on success). */
  consecutiveFailures: number;
  terminal: boolean;
}

/**
 * Given the outcome category, decide the next scheduling state. Pure and deterministic; the caller
 * adds jitter. Terminal credential failures back off to `terminalRecheckMs` (NOT the 5-min cadence)
 * so we never hammer the provider with logins that can't succeed until the user reconnects.
 */
export function decideSchedule(args: {
  now: number;
  category: FailureCategory;
  priorConsecutiveFailures: number;
  cadenceMinutes: number;
  retry: RetryConfig;
}): ScheduleDecision {
  const { now, category, priorConsecutiveFailures, cadenceMinutes, retry } = args;

  if (category === "none") {
    return {
      nextEligibleAt: now + cadenceMinutes * 60_000,
      status: "ok",
      consecutiveFailures: 0,
      terminal: false,
    };
  }

  const failures = priorConsecutiveFailures + 1;

  if (category === "no_credentials") {
    return {
      nextEligibleAt: now + retry.terminalRecheckMs,
      status: "no_credentials",
      consecutiveFailures: failures,
      terminal: true,
    };
  }
  if (category === "invalid_credentials") {
    return {
      nextEligibleAt: now + retry.terminalRecheckMs,
      status: "needs_reconnect",
      consecutiveFailures: failures,
      terminal: true,
    };
  }

  // Transient categories: exponential backoff with cap.
  const base = category === "rate_limited" ? retry.rateLimitBackoffMs : retry.baseBackoffMs;
  const backoff = Math.min(retry.maxBackoffMs, base * Math.pow(2, failures - 1));
  return {
    nextEligibleAt: now + backoff,
    status: "retrying",
    consecutiveFailures: failures,
    terminal: false,
  };
}

export interface SyncState {
  lastReadingTimestamp: string | null;
  lastBackfillAt: number | null;
  consecutiveFailures: number;
}

export interface SyncContext<Creds, Session> {
  now: number;
  limits: ProviderLimits;
  state: SyncState;
  creds: Creds | null; // null => no server-stored credentials
  session: Session | null; // current stored session/token, if any
}

export interface SyncEffects<Creds, Session> {
  login(creds: Creds): Promise<LoginOutcome<Session>>;
  read(session: Session, plan: FetchPlan): Promise<ReadOutcome>;
  /** Persist a refreshed session immediately so it survives even if the rest of the run fails. */
  persistSession(session: Session): Promise<void>;
  /** Persist readings (dedup-safe). MUST throw to signal a persistence failure. */
  persist(entries: ReadingRecord[]): Promise<{ inserted: number; maxTimestamp: string | null }>;
}

export interface SyncOutcome {
  category: FailureCategory;
  inserted: number;
  /** Cursor after this run; only differs from prior when a newer reading was persisted. */
  newCursor: string | null;
  advancedCursor: boolean;
  unrecoverableGap: boolean;
  refreshedSession: boolean;
  reason: FetchReason | "skipped";
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b; // ISO-8601 UTC strings sort chronologically
}

/**
 * Orchestrate one connection's sync via injected effects. Provider-agnostic and fully testable.
 *
 * Order guarantees the cursor never advances before persistence:
 *   1. plan the fetch from the cursor,
 *   2. try the existing session; on expiry (or no session) re-login + persist the new session,
 *   3. read,
 *   4. persist (throwing → `persistence_failure`),
 *   5. compute the advanced cursor ONLY from what was persisted.
 */
export async function runProviderSync<Creds, Session>(
  ctx: SyncContext<Creds, Session>,
  fx: SyncEffects<Creds, Session>,
): Promise<SyncOutcome> {
  const base = {
    inserted: 0,
    newCursor: ctx.state.lastReadingTimestamp,
    advancedCursor: false,
    unrecoverableGap: false,
    refreshedSession: false,
  };

  if (ctx.creds === null) {
    return { ...base, category: "no_credentials", reason: "skipped" };
  }

  const plan = computeFetchPlan({
    now: ctx.now,
    lastReadingTimestamp: ctx.state.lastReadingTimestamp,
    lastBackfillAt: ctx.state.lastBackfillAt,
    limits: ctx.limits,
  });

  let session = ctx.session;
  let refreshedSession = false;

  let read: ReadOutcome = session
    ? await fx.read(session, plan)
    : { ok: false, sessionExpired: true, category: "none" };

  if (!read.ok && read.sessionExpired) {
    const login = await fx.login(ctx.creds);
    if (!login.ok) {
      return { ...base, refreshedSession, category: login.category, reason: plan.reason };
    }
    session = login.session;
    refreshedSession = true;
    await fx.persistSession(session);
    read = await fx.read(session, plan);
  }

  if (!read.ok) {
    return {
      ...base,
      refreshedSession,
      category: read.category === "none" ? "internal_error" : read.category,
      reason: plan.reason,
    };
  }

  let persisted: { inserted: number; maxTimestamp: string | null };
  try {
    persisted = await fx.persist(read.entries);
  } catch {
    return { ...base, refreshedSession, category: "persistence_failure", reason: plan.reason };
  }

  const newCursor = maxIso(ctx.state.lastReadingTimestamp, persisted.maxTimestamp);
  const advancedCursor = newCursor !== ctx.state.lastReadingTimestamp;

  return {
    category: "none",
    inserted: persisted.inserted,
    newCursor,
    advancedCursor,
    unrecoverableGap: plan.expectUnrecoverableGap,
    refreshedSession,
    reason: plan.reason,
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
