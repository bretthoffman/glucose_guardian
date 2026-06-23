import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Convex-owned CGM ingestion — single, unified, due-driven dispatcher for BOTH Dexcom and Libre.
 *
 * Runs frequently and processes a bounded batch of connections whose `nextEligibleAt` has passed
 * (see `cgmIngest.runDueIngest`). This replaces the earlier per-provider crons: provider protocol is
 * isolated in `cgm/providers`, but scheduling, leasing, retry/backoff, cursor, and persistence are
 * shared — one ingestion system, not two that happen to share a cron.
 *
 * Each connection is claimed under an expiring lease, so overlapping runs are safe and a crashed
 * worker's connection becomes eligible again on the next pass. Normal per-connection cadence is
 * ~5 min (set by `decideSchedule`); this 1-min tick just picks up whatever is due, fairly.
 */
crons.interval("cgm-ingest-due", { minutes: 1 }, internal.cgmIngest.runDueIngest, {});

export default crons;
