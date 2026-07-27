import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { legacyAuthArgs, userCompat } from "./identity";

const glucoseEntryPayload = v.object({
  glucose: v.number(),
  timestamp: v.string(),
  anomaly: v.object({
    warning: v.boolean(),
    message: v.optional(v.string()),
  }),
  dexcomTrend: v.optional(v.union(v.number(), v.string())),
});

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
    ...legacyAuthArgs,
    startTimestamp: v.string(),
    endTimestamp: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) return [];
    const lim = Math.min(Math.max(args.limit ?? DAY_RANGE_DEFAULT_LIMIT, 1), DAY_RANGE_MAX_LIMIT);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", user!._id)
          .gte("timestamp", args.startTimestamp)
          .lt("timestamp", args.endTimestamp),
      )
      .order("asc")
      .take(lim);
    return mapGlucoseRows(rows);
  },
});

/**
 * Aggregated glucose stats for an arbitrary window — powers the Estimated-A1C card's on-demand
 * ranges without shipping raw readings to the phone. Callers chunk requests to ≤15-day windows
 * (~4.3k rows at 5-min cadence) so each query stays well under Convex document-scan limits, then
 * merge the parts client-side.
 */
export const windowStats = query({
  args: {
    ...legacyAuthArgs,
    startTimestamp: v.string(),
    endTimestamp: v.string(),
    lowThreshold: v.number(),
    highThreshold: v.number(),
  },
  handler: async (ctx, args) => {
    const empty = { count: 0, sum: 0, lowCount: 0, highCount: 0, oldestTimestamp: null as string | null };
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) return empty;
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", user!._id)
          .gte("timestamp", args.startTimestamp)
          .lt("timestamp", args.endTimestamp),
      )
      .order("asc")
      .collect();
    let sum = 0;
    let lowCount = 0;
    let highCount = 0;
    for (const r of rows) {
      sum += r.glucose;
      if (r.glucose < args.lowThreshold) lowCount++;
      else if (r.glucose > args.highThreshold) highCount++;
    }
    return {
      count: rows.length,
      sum,
      lowCount,
      highCount,
      oldestTimestamp: rows.length > 0 ? rows[0].timestamp : null,
    };
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
    ...legacyAuthArgs,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) return [];
    const lim = Math.min(Math.max(args.limit ?? 300, 1), 500);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) => q.eq("userId", user!._id))
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
    ...legacyAuthArgs,
    entries: v.array(glucoseEntryPayload),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    let inserted = 0;
    for (const e of args.entries.slice(0, 350)) {
      const existing = await ctx.db
        .query("patientGlucoseReadings")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", user!._id).eq("timestamp", e.timestamp),
        )
        .unique();
      if (existing) continue;
      await ctx.db.insert("patientGlucoseReadings", {
        userId: user!._id,
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
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) => q.eq("userId", user!._id))
      .collect();
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
  },
});
