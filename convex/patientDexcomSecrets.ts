import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { legacyAuthArgs, userCompat } from "./identity";

function requirePatientBackendSecret(provided: string) {
  const expected = process.env.CONVEX_PATIENT_BACKEND_SECRET;
  if (!expected || provided !== expected) {
    throw new ConvexError("Unauthorized patient backend");
  }
}

/** API-only: verify server secret + user passwordHash, then upsert Dexcom credentials. */
export const upsertCredentials = mutation({
  args: {
    serverSecret: v.string(),
    ...legacyAuthArgs,
    dexcomUsername: v.string(),
    dexcomPassword: v.string(),
    outsideUS: v.boolean(),
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    const existing = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    const now = Date.now();
    const doc = {
      userId: user!._id,
      dexcomUsername: args.dexcomUsername.trim(),
      dexcomPassword: args.dexcomPassword,
      outsideUS: args.outsideUS,
      updatedAt: now,
      usernameKey: args.dexcomUsername.trim().toLowerCase(),
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("patientDexcomCredentials", doc);
    }
    return { ok: true as const };
  },
});

/**
 * API-only: returns credentials to trusted server callers with shared secret.
 * Implemented as a mutation so credentials are not served via Convex query caching.
 * Never add a client-facing function that returns `dexcomPassword` to the mobile app.
 */
export const getCredentialsForServer = mutation({
  args: {
    serverSecret: v.string(),
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) return null;
    const row = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    if (!row) return null;
    return {
      dexcomUsername: row.dexcomUsername,
      dexcomPassword: row.dexcomPassword,
      outsideUS: row.outsideUS,
    };
  },
});

/** API-only: clear stored Dexcom credentials for this user. */
export const clearCredentials = mutation({
  args: {
    serverSecret: v.string(),
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    const existing = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true as const };
  },
});

/**
 * Client-facing: the signed-in user saves THEIR OWN Dexcom Share credentials, authenticated by the
 * Clerk token riding the request (`userCompat`; legacy args tolerated during the migration).
 * Replaces the api-server /api/cgm/dexcom/credentials hop, which authenticated by passwordHash
 * pass-through and therefore could never work for Clerk accounts (they have no password). WRITE-only:
 * the standing rule that no client-facing function ever RETURNS `dexcomPassword` still holds.
 */
export const saveMyCredentials = mutation({
  args: {
    ...legacyAuthArgs,
    dexcomUsername: v.string(),
    dexcomPassword: v.string(),
    outsideUS: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) throw new ConvexError("Not signed in");
    const existing = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const now = Date.now();
    const doc = {
      userId: user._id,
      dexcomUsername: args.dexcomUsername.trim(),
      dexcomPassword: args.dexcomPassword,
      outsideUS: args.outsideUS,
      updatedAt: now,
      usernameKey: args.dexcomUsername.trim().toLowerCase(),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("patientDexcomCredentials", doc);
    return { ok: true as const };
  },
});

/** Client-facing: clear my stored Dexcom credentials (disconnect flow). */
export const clearMyCredentials = mutation({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) throw new ConvexError("Not signed in");
    const existing = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true as const };
  },
});
