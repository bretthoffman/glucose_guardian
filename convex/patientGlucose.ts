import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const glucoseEntryPayload = v.object({
  glucose: v.number(),
  timestamp: v.string(),
  anomaly: v.object({
    warning: v.boolean(),
    message: v.optional(v.string()),
  }),
  dexcomTrend: v.optional(v.union(v.number(), v.string())),
});

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

function normalizeCaregiverCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/** Read-only glucose for devices that only have a caregiver/family code (no password). */
function mapGlucoseRows(rows: { glucose: number; timestamp: string; anomaly: { warning: boolean; message?: string }; dexcomTrend?: number | string }[]) {
  return rows.map((r) => ({
    glucose: r.glucose,
    timestamp: r.timestamp,
    anomaly: r.anomaly,
    dexcomTrend: r.dexcomTrend,
  }));
}

const DAY_RANGE_DEFAULT_LIMIT = 500;
const DAY_RANGE_MAX_LIMIT = 600;

/** Bounded glucose readings for one local calendar day — start inclusive, end exclusive (ISO timestamps). */
export const listForDayRange = query({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    startTimestamp: v.string(),
    endTimestamp: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) return [];
    const lim = Math.min(Math.max(args.limit ?? DAY_RANGE_DEFAULT_LIMIT, 1), DAY_RANGE_MAX_LIMIT);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", args.userId)
          .gte("timestamp", args.startTimestamp)
          .lt("timestamp", args.endTimestamp),
      )
      .order("asc")
      .take(lim);
    return mapGlucoseRows(rows);
  },
});

/** Caregiver day-range glucose for Dose Log historical graph. */
export const listForDayRangeForCaregiver = query({
  args: {
    code: v.string(),
    startTimestamp: v.string(),
    endTimestamp: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeCaregiverCode(args.code);
    if (normalized.length !== 6) return [];
    const profileRow = await ctx.db
      .query("patientProfiles")
      .withIndex("by_caregiverCode", (q) => q.eq("caregiverCode", normalized))
      .first();
    if (!profileRow?.caregiverCode) return [];
    if (profileRow.caregiverCode.toUpperCase() !== normalized) return [];
    const lim = Math.min(Math.max(args.limit ?? DAY_RANGE_DEFAULT_LIMIT, 1), DAY_RANGE_MAX_LIMIT);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", profileRow.userId)
          .gte("timestamp", args.startTimestamp)
          .lt("timestamp", args.endTimestamp),
      )
      .order("asc")
      .take(lim);
    return mapGlucoseRows(rows);
  },
});

export const listRecentForCaregiver = query({
  args: {
    code: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalized = normalizeCaregiverCode(args.code);
    if (normalized.length !== 6) return [];
    const profileRow = await ctx.db
      .query("patientProfiles")
      .withIndex("by_caregiverCode", (q) => q.eq("caregiverCode", normalized))
      .first();
    if (!profileRow?.caregiverCode) return [];
    if (profileRow.caregiverCode.toUpperCase() !== normalized) return [];
    const lim = Math.min(Math.max(args.limit ?? 300, 1), 500);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) => q.eq("userId", profileRow.userId))
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

export const listRecent = query({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) return [];
    const lim = Math.min(Math.max(args.limit ?? 300, 1), 500);
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

export const upsertBatch = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    entries: v.array(glucoseEntryPayload),
  },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    let inserted = 0;
    for (const e of args.entries.slice(0, 350)) {
      const existing = await ctx.db
        .query("patientGlucoseReadings")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", args.userId).eq("timestamp", e.timestamp),
        )
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
    return { inserted };
  },
});

export const clearAll = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .collect();
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
  },
});
