/**
 * Meal high heads-up (rules in mealHighLogic.ts): meals that kept the person high even after extra
 * insulin, for the app's calculator and the Doctor Portal. Read-only guidance: nothing here feeds the
 * dose math.
 *
 * - Everyone who can see the readings gets the patterns (the family, and codes during their hours).
 * - Only the family turns it off or changes what counts as high (setPrefs).
 * - The Doctor Portal reads it with the api-server's secret (forDoctor).
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, userCompat } from "./identity";
import { careAccessAllowed, type CareAccess } from "./careSchedule";
import { normalizeCode } from "./carePlan";
import { findPatientProfileByDoctorCode, normalizeAccessCode } from "./doctorAccounts";
import { requireDoctorApiSecret } from "./doctorAuth/secret";
import {
  candidateFoods,
  DEFAULT_HIGH,
  HIGH_CHOICES,
  LOOKBACK_DAYS,
  mealPatterns,
  type HighReading,
} from "./mealHighLogic";

const MIN = 60_000;
const viewerArgs = { code: v.optional(v.string()), ...legacyAuthArgs };

type Viewer = { patientUserId: Id<"users">; family: boolean };

async function viewer(ctx: QueryCtx | MutationCtx, args: { code?: string; userId?: Id<"users">; passwordHash?: string }): Promise<Viewer | null> {
  if (args.code) {
    const code = normalizeCode(args.code);
    if (code.length !== 8) return null;
    const row = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!row || row.status !== "active" || !careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    if (!row.permissions.viewReadings) return null;
    return { patientUserId: row.patientUserId, family: false };
  }
  const user = await userCompat(ctx, args);
  if (!user) return null;
  const link = await ctx.db
    .query("careLinks")
    .withIndex("by_member", (q) => q.eq("memberUserId", user._id).eq("status", "active"))
    .first();
  return { patientUserId: link?.patientUserId ?? user._id, family: true };
}

async function prefsFor(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  const row = await ctx.db
    .query("mealHighPrefs")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .unique();
  return { row, enabled: row?.enabled ?? true, high: row?.high ?? DEFAULT_HIGH };
}

/** The flagged meals for this person, from the last LOOKBACK_DAYS of logs and readings. */
export async function patternsFor(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">, high: number) {
  const nowMs = Date.now();
  const from = new Date(nowMs - (LOOKBACK_DAYS * 24 * 60 + 300) * MIN).toISOString();
  const [foodRows, doseRows] = await Promise.all([
    ctx.db
      .query("careFoodLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId).gte("timestamp", from))
      .order("desc")
      .take(600),
    ctx.db
      .query("careInsulinLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId).gte("timestamp", from))
      .order("desc")
      .take(900),
  ]);
  const foods = foodRows.map((f) => ({ clientId: f.clientId, foodName: f.foodName, timestamp: f.timestamp, estimatedCarbs: f.estimatedCarbs }));
  const doses = doseRows.map((d) => ({ timestamp: d.timestamp, units: d.units, type: d.type, foodLogId: d.foodLogId }));
  const candidates = candidateFoods(foods, nowMs);
  if (candidates.length === 0) return [];

  // Sensor data only around the meals worth judging (20 minutes before to 5 hours after each).
  const readings: HighReading[] = [];
  const seen = new Set<string>();
  for (const f of candidates) {
    const t0 = Date.parse(f.timestamp);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", patientUserId)
          .gte("timestamp", new Date(t0 - 20 * MIN).toISOString())
          .lte("timestamp", new Date(t0 + 300 * MIN).toISOString()),
      )
      .take(150);
    for (const r of rows) {
      if (seen.has(r.timestamp)) continue;
      seen.add(r.timestamp);
      const ms = Date.parse(r.timestamp);
      if (Number.isFinite(ms) && Number.isFinite(r.glucose)) readings.push({ glucose: r.glucose, ms });
    }
  }
  // All foods go in (a snack on top of a meal rules that time out); only candidates have sensor data.
  return mealPatterns({ foods, doses, readings, high, nowMs });
}

/** The app: whether it's on, what counts as high, who may change that, and the flagged meals. */
export const forViewer = query({
  args: viewerArgs,
  handler: async (ctx, args) => {
    const who = await viewer(ctx, args);
    if (!who) return null;
    const prefs = await prefsFor(ctx, who.patientUserId);
    return {
      enabled: prefs.enabled,
      high: prefs.high,
      canChange: who.family,
      patterns: prefs.enabled ? await patternsFor(ctx, who.patientUserId, prefs.high) : [],
    };
  },
});

/** The family turns it on or off, or changes what counts as high (200, 250 or 300). */
export const setPrefs = mutation({
  args: { ...viewerArgs, enabled: v.optional(v.boolean()), high: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const who = await viewer(ctx, args);
    if (!who || !who.family) throw new ConvexError("Only the family can change this.");
    if (args.high != null && !(HIGH_CHOICES as readonly number[]).includes(args.high)) throw new ConvexError("Pick 200, 250 or 300.");
    const prefs = await prefsFor(ctx, who.patientUserId);
    const next = { enabled: args.enabled ?? prefs.enabled, high: args.high ?? prefs.high, updatedAt: Date.now() };
    if (prefs.row) await ctx.db.patch(prefs.row._id, next);
    else await ctx.db.insert("mealHighPrefs", { patientUserId: who.patientUserId, ...next });
    return next;
  },
});

/** The Doctor Portal (via the api-server): the same list, plus whether the family has it on. */
export const forDoctor = query({
  args: { serverSecret: v.string(), accessCode: v.string() },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const profile = await findPatientProfileByDoctorCode(ctx, normalizeAccessCode(args.accessCode));
    if (!profile) return null;
    const prefs = await prefsFor(ctx, profile.userId);
    return {
      enabled: prefs.enabled,
      high: prefs.high,
      lookbackDays: LOOKBACK_DAYS,
      patterns: await patternsFor(ctx, profile.userId, prefs.high),
    };
  },
});
