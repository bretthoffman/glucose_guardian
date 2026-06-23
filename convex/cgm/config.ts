/**
 * Configuration for CGM ingestion — provider limits, retry policy, and operational knobs.
 *
 * Provider-specific limits live here (not hard-coded in the orchestrator) so retention/cadence can
 * be tuned per provider. Operational knobs read from Convex environment variables with safe defaults,
 * so batch size / lease duration / concurrency can be changed without a code edit.
 */
import type { Provider, ProviderLimits, RetryConfig } from "./core";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const PROVIDER_LIMITS: Record<Provider, ProviderLimits> = {
  // Dexcom Share: accepts minutes (≤1440) + maxCount; retains ~24h.
  dexcom: {
    cadenceMinutes: 5,
    maxCount: 288, // 24h at 5-min cadence
    maxWindowMinutes: 1440,
    supportsWindow: true,
    initialBackfillCount: 288,
    reconcileIntervalMs: 6 * HOUR,
  },
  // LibreLink Up: `/graph` returns a fixed recent window (no minutes/count); ~12h of history.
  libre: {
    cadenceMinutes: 5,
    maxCount: 300,
    maxWindowMinutes: 720,
    supportsWindow: false,
    initialBackfillCount: 300,
    reconcileIntervalMs: 6 * HOUR,
  },
};

export const RETRY_CONFIG: RetryConfig = {
  baseBackoffMs: 5 * MINUTE,
  maxBackoffMs: 60 * MINUTE,
  rateLimitBackoffMs: 15 * MINUTE,
  terminalRecheckMs: 6 * HOUR,
};

function envInt(name: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Operational knobs (Convex env vars, with defaults). */
export const ingestConfig = {
  /** Max connections processed per dispatcher run (bounded workload). */
  get batchLimit(): number {
    return envInt("CGM_INGEST_BATCH_LIMIT", 25);
  },
  /** Max pre-existing connections seeded into the work queue per run. */
  get seedLimit(): number {
    return envInt("CGM_INGEST_SEED_LIMIT", 50);
  },
  /** Lease duration. Shorter than the cron interval so a crashed worker's lease recovers next run. */
  get leaseMs(): number {
    return envInt("CGM_INGEST_LEASE_MS", 2 * MINUTE);
  },
  /** In-run concurrency across claimed connections. */
  get concurrency(): number {
    return envInt("CGM_INGEST_CONCURRENCY", 5);
  },
  /**
   * Minimum spacing between client-triggered expedited syncs for a connection. Repeated AppState
   * events / tab mounts within this window reuse canonical data instead of hitting the provider.
   */
  get expeditedMinIntervalMs(): number {
    return envInt("CGM_EXPEDITED_MIN_INTERVAL_MS", 60_000);
  },
};
