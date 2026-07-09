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

/**
 * Doctor alerts: scan linked patients for urgent lows/highs and stale data (per-kind cooldowns
 * prevent spam), then email new alerts when RESEND_API_KEY is configured. Caregiver-decision
 * alerts are event-driven (inserted by doctor.decideOrder), not scanned.
 */
crons.interval("doctor-alerts-scan", { minutes: 5 }, internal.doctorAlerts.scanAndNotify, {});

/** Monday-morning per-doctor patient digest (email only; skipped without RESEND_API_KEY). */
crons.weekly(
  "doctor-weekly-digest",
  { dayOfWeek: "monday", hourUTC: 12, minuteUTC: 0 },
  internal.doctorAlerts.weeklyDigest,
  {},
);

export default crons;
