/**
 * History matcher for the AI prediction graph (see PREDICTION_AI_PLAN_01.md). Given the current dose
 * situation, find the top-3 past events in this circle's own logged history that most closely match,
 * and return the glucose windows around them as analogies for the model. More logging ⇒ more/closer
 * candidates ⇒ stronger references — the data flywheel.
 *
 * Two-pass to keep reading reads bounded regardless of history size: Pass 1 scores every candidate
 * on log-only signals (dose/carb/prior-logs) + the contamination filter; Pass 2 fetches a small
 * reading window for only the shortlist to get BG + trend and finish the score; Pass 3 fetches the
 * full pre/post windows for only the final 3. Auth + bucket mirror careLogs (guardian or access code,
 * reading the circle's shared bucket).
 */
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { v } from "convex/values";
import { careAccessAllowed, type CareAccess } from "./careSchedule";
import { circleBucketFor } from "./careLogs";
import {
  classifyTrend,
  combineStrength,
  partialScore,
  scoreEvent,
  type PriorLog,
  type Reading,
  type Situation,
  type TrendBucket,
} from "./predictionMatch";

const MIN = 60_000;
const HOUR = 60 * MIN;
const CANDIDATE_CAP = 600; // most-recent insulin logs to consider (recency also aids accuracy)
const SHORTLIST = 24; // generous so a strong BG/trend match survives Pass 1
const PRE_MS = 3 * HOUR;
const POST_MS = 90 * MIN;
const CARB_ASSOC_MS = 15 * MIN; // a food log within ±15m is this dose's meal
const MIN_POST_READINGS = 12; // of ~18 expected — else a CGM gap makes the outcome unusable
const TOP_N = 3;

// ── local auth helpers (same pattern as careLogs/careMessages) ───────────────────────────────

async function assertPatientAuth(ctx: QueryCtx, userId: Id<"users">, passwordHash: string): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

function normalizeCareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function resolveActiveAccessCode(ctx: QueryCtx, rawCode: string) {
  const code = normalizeCareCode(rawCode);
  if (code.length !== 8) return null;
  const row = await ctx.db.query("careAccessCodes").withIndex("by_code", (q) => q.eq("code", code)).first();
  return row && row.status === "active" ? row : null;
}

/** The circle bucket (patient/owner id) whose logs + readings we match against, or null if unauthorized. */
async function resolveBucket(
  ctx: QueryCtx,
  args: { userId?: Id<"users">; passwordHash?: string; code?: string },
): Promise<Id<"users"> | null> {
  if (args.code != null) {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row || !row.permissions.viewReadings) return null;
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    return row.patientUserId;
  }
  if (args.userId && args.passwordHash) {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    return await circleBucketFor(ctx, args.userId);
  }
  return null;
}

async function readingsInRange(
  ctx: QueryCtx,
  userId: Id<"users">,
  startMs: number,
  endMs: number,
): Promise<Reading[]> {
  const rows = await ctx.db
    .query("patientGlucoseReadings")
    .withIndex("by_user_time", (q) =>
      q
        .eq("userId", userId)
        .gte("timestamp", new Date(startMs).toISOString())
        .lt("timestamp", new Date(endMs).toISOString()),
    )
    .take(400);
  return rows.map((r) => ({ glucose: r.glucose, ms: new Date(r.timestamp).getTime() }));
}

/** Thin a reading series to roughly one point per `stepMin` (keeps the shape, cuts prompt tokens). */
function downsample(readings: Reading[], stepMin: number): Reading[] {
  const stepMs = stepMin * MIN;
  const out: Reading[] = [];
  let lastMs = -Infinity;
  for (const r of [...readings].sort((a, b) => a.ms - b.ms)) {
    if (r.ms - lastMs >= stepMs) {
      out.push(r);
      lastMs = r.ms;
    }
  }
  return out;
}

export const getReferences = query({
  args: {
    // guardian creds OR an access code
    userId: v.optional(v.id("users")),
    passwordHash: v.optional(v.string()),
    code: v.optional(v.string()),
    // the current dose situation
    currentBG: v.number(),
    doseUnits: v.number(),
    carbsGrams: v.number(),
    nowMs: v.number(),
    /** The client's recent readings (last ~3h), used to classify the current trend. */
    recentReadings: v.array(v.object({ glucose: v.number(), ms: v.number() })),
  },
  handler: async (ctx, args) => {
    const patientUserId = await resolveBucket(ctx, args);
    if (!patientUserId) return null;
    const now = args.nowMs;
    const curTrend = classifyTrend(args.recentReadings, now);

    const insulinLogs = await ctx.db
      .query("careInsulinLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
      .order("desc")
      .take(CANDIDATE_CAP);
    const foodLogs = await ctx.db
      .query("careFoodLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
      .order("desc")
      .take(CANDIDATE_CAP);

    type Ev = { kind: "insulin" | "carb"; ms: number; amount: number };
    const carbEvents: Ev[] = foodLogs
      .filter((f) => f.estimatedCarbs > 0)
      .map((f) => ({ kind: "carb" as const, ms: new Date(f.timestamp).getTime(), amount: f.estimatedCarbs }));
    const allEvents: Ev[] = [
      ...insulinLogs
        .filter((l) => l.units > 0 && l.type !== "basal")
        .map((l) => ({ kind: "insulin" as const, ms: new Date(l.timestamp).getTime(), amount: l.units })),
      ...carbEvents,
    ];

    const priorLogsAt = (anchorMs: number, excludeMs: number | null): PriorLog[] =>
      allEvents
        .filter((e) => e.ms >= anchorMs - PRE_MS && e.ms < anchorMs && e.ms !== excludeMs)
        .map((e) => ({ kind: e.kind, minutesBefore: Math.round((anchorMs - e.ms) / MIN), amount: e.amount }));

    const curPriorLogs = priorLogsAt(now, null);
    const curDoseCarb = { dose: args.doseUnits, carbs: args.carbsGrams, priorLogs: curPriorLogs };

    type Cand = {
      eventMs: number;
      units: number;
      carbs: number;
      priorLogs: PriorLog[];
      partial: number;
      bg?: number;
      trend?: TrendBucket;
      confidence?: number;
    };
    const cutoff = now - POST_MS; // an event needs a complete 90-min post-window
    const candidates: Cand[] = [];
    for (const l of insulinLogs) {
      if (!(l.units > 0) || l.type === "basal") continue;
      const eventMs = new Date(l.timestamp).getTime();
      if (!Number.isFinite(eventMs) || eventMs > cutoff) continue;

      // Associated meal: the closest food within ±15m is this dose's carbs.
      let assocCarbs = 0;
      let assocMs: number | null = null;
      let bestDt = Infinity;
      for (const c of carbEvents) {
        const dt = Math.abs(c.ms - eventMs);
        if (dt <= CARB_ASSOC_MS && dt < bestDt) {
          bestDt = dt;
          assocCarbs = c.amount;
          assocMs = c.ms;
        }
      }

      // Contamination hard-filter: any later dose or (non-meal) carb inside the post-window makes the
      // outcome an unreliable analogy — drop the candidate entirely.
      const contaminated = allEvents.some(
        (e) => e.ms > eventMs && e.ms <= eventMs + POST_MS && e.ms !== assocMs,
      );
      if (contaminated) continue;

      const priorLogs = priorLogsAt(eventMs, assocMs);
      const partial = partialScore(curDoseCarb, { dose: l.units, carbs: assocCarbs, priorLogs });
      candidates.push({ eventMs, units: l.units, carbs: assocCarbs, priorLogs, partial });
    }

    candidates.sort((a, b) => b.partial - a.partial);
    const shortlist = candidates.slice(0, SHORTLIST);

    const cur: Situation = {
      bg: args.currentBG,
      dose: args.doseUnits,
      carbs: args.carbsGrams,
      trend: curTrend,
      priorLogs: curPriorLogs,
    };
    for (const c of shortlist) {
      const win = await readingsInRange(ctx, patientUserId, c.eventMs - 25 * MIN, c.eventMs + 5 * MIN);
      if (win.length === 0) continue;
      let bg = win[0].glucose;
      let best = Infinity;
      for (const r of win) {
        const dt = Math.abs(r.ms - c.eventMs);
        if (dt < best) {
          best = dt;
          bg = r.glucose;
        }
      }
      const trend = classifyTrend(win, c.eventMs);
      c.bg = bg;
      c.trend = trend;
      c.confidence = scoreEvent(cur, { bg, dose: c.units, carbs: c.carbs, trend, priorLogs: c.priorLogs });
    }

    const scored = shortlist
      .filter((c) => c.confidence != null)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

    const references = [];
    for (const c of scored) {
      if (references.length >= TOP_N) break;
      const pre = await readingsInRange(ctx, patientUserId, c.eventMs - PRE_MS, c.eventMs + 1);
      const post = await readingsInRange(ctx, patientUserId, c.eventMs, c.eventMs + POST_MS + 1);
      if (post.length < MIN_POST_READINGS) continue;
      references.push({
        confidence: Math.round((c.confidence ?? 0) * 100) / 100,
        startBG: c.bg ?? null,
        units: c.units,
        carbs: c.carbs,
        trendBucket: c.trend ?? "steady",
        pre: downsample(pre, 20).map((r) => ({ minutesBefore: Math.round((c.eventMs - r.ms) / MIN), glucose: r.glucose })),
        post: downsample(post, 10).map((r) => ({ minutesAfter: Math.round((r.ms - c.eventMs) / MIN), glucose: r.glucose })),
      });
    }

    const { strength, label } = combineStrength(references.map((r) => r.confidence));
    return {
      currentTrend: curTrend,
      references,
      strength: Math.round(strength * 100) / 100,
      strengthLabel: label,
    };
  },
});
