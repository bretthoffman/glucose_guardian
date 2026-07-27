import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { legacyAuthArgs, userCompat } from "./identity";

/** Matches mobile `CGMConnection` when a vendor is connected (row deleted when disconnected). */
export const cgmConnectionPayload = v.object({
  type: v.union(v.literal("dexcom"), v.literal("libre")),
  sessionId: v.optional(v.string()),
  token: v.optional(v.string()),
  outsideUS: v.optional(v.boolean()),
  libreApiBase: v.optional(v.string()),
  connectedAt: v.optional(v.string()),
});

export const get = query({
  args: {
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) return null;
    const row = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    if (!row) return null;
    return {
      type: row.type,
      sessionId: row.sessionId,
      token: row.token,
      outsideUS: row.outsideUS,
      libreApiBase: row.libreApiBase,
      connectedAt: row.connectedAt,
    };
  },
});

/**
 * Presence-only check: does this user have server-stored CGM credentials backing the ingestion
 * cron + silent session refresh? Returns booleans only — NEVER the stored password. Client-callable
 * with the same `userId` + `passwordHash` auth as the rest of this module. The secret tables
 * (`patientDexcomSecrets`/`patientLibreSecrets`) intentionally expose no password-returning client
 * function; this does not change that invariant.
 */
export const hasCredentials = query({
  args: {
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) return null;
    const dexcom = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    const libre = await ctx.db
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    return { hasDexcom: dexcom !== null, hasLibre: libre !== null };
  },
});

export const replace = mutation({
  args: {
    ...legacyAuthArgs,
    connection: cgmConnectionPayload,
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    const existing = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    const now = Date.now();
    const doc = {
      userId: user!._id,
      ...args.connection,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("patientCgmConnections", doc);
    }

    // Reconcile the ingestion work-queue (`cgmSyncState`) for this connect/reconnect. Drop any
    // state row for a different provider (user switched device) and make this provider's row due
    // immediately with a fresh session. The cursor (`lastReadingTimestamp`) is PRESERVED on a
    // same-provider reconnect so we don't pointlessly re-backfill 24h; a provider switch starts
    // with no cursor (bounded initial backfill). Generation is bumped so any in-flight stale
    // worker's completion is rejected.
    const provider = args.connection.type;
    const states = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", user!._id))
      .collect();
    let current: (typeof states)[number] | null = null;
    for (const s of states) {
      if (s.provider === provider) current = s;
      else await ctx.db.delete(s._id);
    }
    if (current) {
      await ctx.db.patch(current._id, {
        status: "pending",
        nextEligibleAt: now,
        consecutiveFailures: 0,
        lastFailureCategory: undefined,
        lastFailureAt: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        generation: current.generation + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("cgmSyncState", {
        userId: user!._id,
        provider,
        consecutiveFailures: 0,
        status: "pending",
        nextEligibleAt: now,
        generation: 0,
        updatedAt: now,
      });
    }
  },
});

export const clear = mutation({
  args: {
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    const existing = await ctx.db
      .query("patientCgmConnections")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    // Remove the ingestion work-queue rows so the cron stops syncing a disconnected patient.
    const states = await ctx.db
      .query("cgmSyncState")
      .withIndex("by_user_provider", (q) => q.eq("userId", user!._id))
      .collect();
    for (const s of states) {
      await ctx.db.delete(s._id);
    }
  },
});
