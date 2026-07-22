/**
 * Caregiver (school-nurse) accounts — a real email account (accountRole "caregiver") that HOUSES
 * multiple guardian-issued access codes so one nurse can watch several kids at once.
 *
 * Unlike co-guardian links (careLinks between two accounts for ONE child), these are `caregiverLinks`
 * rows pointing a nurse account at independent `careAccessCodes` from different families. The code
 * stays the credential: retiring it drops the child from the nurse's menu, and the code's schedule
 * still gates live access exactly like an accountless access-code session. The nurse never edits the
 * child's settings — they only view, within whatever the code grants.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { careAccessAllowed, evaluateCareAccess, type CareAccess, type CarePermissions } from "./careSchedule";

const CODE_LENGTH = 8;
/** How far back to fetch logs for the active-carbs/insulin math (longest insulin DIA is 6 h). */
const ACTIVE_LOG_WINDOW_MS = 6 * 60 * 60 * 1000;

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

function normalizeCareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

async function resolveActiveAccessCode(ctx: QueryCtx | MutationCtx, rawCode: string) {
  const code = normalizeCareCode(rawCode);
  if (code.length !== CODE_LENGTH) return null;
  const row = await ctx.db
    .query("careAccessCodes")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
  return row && row.status === "active" ? row : null;
}

/** Add a guardian's access code to this nurse account so the child appears on their menu. */
export const addCaregiverCode = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) throw new Error("That access code isn't valid or is no longer active");
    // A nurse must actually be able to see readings — a log-only / no-view code is useless here.
    if (!row.permissions.viewReadings) throw new Error("This code doesn't allow viewing glucose");
    const code = normalizeCareCode(args.code);
    // Dedupe: adding the same code twice is a no-op (return the existing link's child).
    const existing = await ctx.db
      .query("caregiverLinks")
      .withIndex("by_caregiver_code", (q) => q.eq("caregiverUserId", args.userId).eq("code", code))
      .first();
    if (existing) {
      const profile = await ctx.db
        .query("patientProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", existing.patientUserId))
        .unique();
      return { patientUserId: existing.patientUserId, patientName: profile?.childName?.trim() || "Patient", alreadyLinked: true };
    }
    await ctx.db.insert("caregiverLinks", {
      caregiverUserId: args.userId,
      code,
      patientUserId: row.patientUserId,
      createdAt: Date.now(),
    });
    const profile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", row.patientUserId))
      .unique();
    return { patientUserId: row.patientUserId, patientName: profile?.childName?.trim() || "Patient", alreadyLinked: false };
  },
});

/** Remove a code the nurse added (their menu card disappears; the code itself is untouched). */
export const removeCaregiverCode = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const code = normalizeCareCode(args.code);
    const link = await ctx.db
      .query("caregiverLinks")
      .withIndex("by_caregiver_code", (q) => q.eq("caregiverUserId", args.userId).eq("code", code))
      .first();
    if (link) await ctx.db.delete(link._id);
  },
});

/** Delete caregiver links whose underlying access code has been retired/removed. Best-effort. */
export const pruneStaleCaregiverLinks = mutation({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const links = await ctx.db
      .query("caregiverLinks")
      .withIndex("by_caregiver", (q) => q.eq("caregiverUserId", args.userId))
      .collect();
    for (const link of links) {
      const row = await ctx.db
        .query("careAccessCodes")
        .withIndex("by_code", (q) => q.eq("code", link.code))
        .first();
      if (!row || row.status !== "active") await ctx.db.delete(link._id);
    }
  },
});

function ageFromDob(dateOfBirth: string | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * The nurse's menu: one entry per still-active linked code. Retired/deleted codes are pruned so
 * their card disappears. For each child: identity + the code's live access state + the latest
 * glucose — but the reading is withheld (null) whenever the code is out of its schedule window or
 * lacks view-readings, so a locked child shows "--" and can't leak data.
 */
export const listCaregiverKids = query({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return [];
    const links = await ctx.db
      .query("caregiverLinks")
      .withIndex("by_caregiver", (q) => q.eq("caregiverUserId", args.userId))
      .collect();
    const now = Date.now();
    const out: {
      code: string;
      patientUserId: Id<"users">;
      name: string;
      lastName: string;
      ageYears: number | null;
      diabetesType: string;
      permissions: CarePermissions;
      accessState: ReturnType<typeof evaluateCareAccess>;
      latestGlucose: number | null;
      latestTimestamp: string | null;
      thresholds: { urgentLow: number; low: number; high: number; urgentHigh: number };
      // Recent shared-bucket logs (only when the code can view logs + is in-window) so the nurse's
      // menu can compute the same active-carbs / active-insulin the calculator does, decaying live.
      recentFood: { timestamp: string; estimatedCarbs: number }[];
      recentInsulin: { timestamp: string; units: number; type: string; insulinType?: string }[];
      createdAt: number;
    }[] = [];

    for (const link of links) {
      const row = await ctx.db
        .query("careAccessCodes")
        .withIndex("by_code", (q) => q.eq("code", link.code))
        .first();
      // Retired / deleted code → drop the child from the menu. (A query can't delete the now-stale
      // link row; it's simply never surfaced. `pruneStaleCaregiverLinks` cleans them up on demand.)
      if (!row || row.status !== "active") continue;
      const profile = await ctx.db
        .query("patientProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", row.patientUserId))
        .unique();
      const accessState = evaluateCareAccess(row.access as CareAccess, now);
      const inWindow = careAccessAllowed(row.access as CareAccess, now);
      const open = row.permissions.viewReadings && inWindow;

      let latestGlucose: number | null = null;
      let latestTimestamp: string | null = null;
      if (open) {
        const latest = await ctx.db
          .query("patientGlucoseReadings")
          .withIndex("by_user_time", (q) => q.eq("userId", row.patientUserId))
          .order("desc")
          .first();
        if (latest) {
          latestGlucose = latest.glucose;
          latestTimestamp = latest.timestamp;
        }
      }

      // Recent logs for the active-carbs / active-insulin math — only when this code may view logs
      // and is in its schedule window. 6 h covers the longest insulin duration of action.
      let recentFood: { timestamp: string; estimatedCarbs: number }[] = [];
      let recentInsulin: { timestamp: string; units: number; type: string; insulinType?: string }[] = [];
      if (row.permissions.viewLogs && inWindow) {
        const cutoff = new Date(now - ACTIVE_LOG_WINDOW_MS).toISOString();
        const [food, insulin] = await Promise.all([
          ctx.db
            .query("careFoodLogs")
            .withIndex("by_patient_time", (q) => q.eq("patientUserId", row.patientUserId).gte("timestamp", cutoff))
            .order("desc")
            .take(100),
          ctx.db
            .query("careInsulinLogs")
            .withIndex("by_patient_time", (q) => q.eq("patientUserId", row.patientUserId).gte("timestamp", cutoff))
            .order("desc")
            .take(100),
        ]);
        recentFood = food.map((f) => ({ timestamp: f.timestamp, estimatedCarbs: f.estimatedCarbs }));
        recentInsulin = insulin.map((i) => ({
          timestamp: i.timestamp,
          units: i.units,
          type: i.type,
          ...(i.insulinType != null ? { insulinType: i.insulinType } : {}),
        }));
      }

      const prefs = profile?.alertPreferences;
      out.push({
        code: link.code,
        patientUserId: row.patientUserId,
        name: profile?.childName?.trim() || "Patient",
        lastName: profile?.childLastName?.trim() || "",
        ageYears: ageFromDob(profile?.dateOfBirth),
        diabetesType: profile?.diabetesType ?? "type1",
        permissions: row.permissions,
        accessState,
        latestGlucose,
        latestTimestamp,
        thresholds: {
          urgentLow: typeof prefs?.urgentLowThreshold === "number" ? prefs.urgentLowThreshold : 55,
          low: typeof prefs?.lowThreshold === "number" ? prefs.lowThreshold : 70,
          high: typeof prefs?.highThreshold === "number" ? prefs.highThreshold : 180,
          urgentHigh: typeof prefs?.urgentHighThreshold === "number" ? prefs.urgentHighThreshold : 250,
        },
        recentFood,
        recentInsulin,
        createdAt: link.createdAt,
      });
    }

    out.sort((a, b) => a.createdAt - b.createdAt);
    return out;
  },
});
