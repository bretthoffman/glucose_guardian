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
