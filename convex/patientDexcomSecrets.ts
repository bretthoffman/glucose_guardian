import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

function requirePatientBackendSecret(provided: string) {
  const expected = process.env.CONVEX_PATIENT_BACKEND_SECRET;
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized patient backend");
  }
}

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

/** API-only: verify server secret + user passwordHash, then upsert Dexcom credentials. */
export const upsertCredentials = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
    passwordHash: v.string(),
    dexcomUsername: v.string(),
    dexcomPassword: v.string(),
    outsideUS: v.boolean(),
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    const existing = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const now = Date.now();
    const doc = {
      userId: args.userId,
      dexcomUsername: args.dexcomUsername.trim(),
      dexcomPassword: args.dexcomPassword,
      outsideUS: args.outsideUS,
      updatedAt: now,
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
    userId: v.id("users"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) return null;
    const row = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
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
    userId: v.id("users"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    const existing = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true as const };
  },
});
