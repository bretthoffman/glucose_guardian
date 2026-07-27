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

/** API-only: verify server secret + user passwordHash, then upsert Libre credentials. */
export const upsertCredentials = mutation({
  args: {
    serverSecret: v.string(),
    ...legacyAuthArgs,
    libreEmail: v.string(),
    librePassword: v.string(),
    libreApiBase: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requirePatientBackendSecret(args.serverSecret);
    const user = await userCompat(ctx, args);
    const ok = user !== null;
    if (!ok) throw new ConvexError("Unauthorized");
    const existing = await ctx.db
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    const now = Date.now();
    const doc = {
      userId: user!._id,
      libreEmail: args.libreEmail.trim(),
      librePassword: args.librePassword,
      libreApiBase: args.libreApiBase?.trim() || undefined,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("patientLibreCredentials", doc);
    }
    return { ok: true as const };
  },
});

/**
 * API-only: returns credentials to trusted server callers with shared secret.
 * Never add a client-facing function that returns `librePassword` to the mobile app.
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
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    if (!row) return null;
    return {
      libreEmail: row.libreEmail,
      librePassword: row.librePassword,
      libreApiBase: row.libreApiBase,
    };
  },
});

/** API-only: clear stored Libre credentials for this user. */
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
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user!._id))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true as const };
  },
});

/**
 * Client-facing: save my own LibreLink Up credentials via the Clerk identity on the request — same
 * rationale as `patientDexcomSecrets.saveMyCredentials`. WRITE-only.
 */
export const saveMyCredentials = mutation({
  args: {
    ...legacyAuthArgs,
    libreEmail: v.string(),
    librePassword: v.string(),
    libreApiBase: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) throw new ConvexError("Not signed in");
    const existing = await ctx.db
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const now = Date.now();
    const doc = {
      userId: user._id,
      libreEmail: args.libreEmail.trim(),
      librePassword: args.librePassword,
      libreApiBase: args.libreApiBase?.trim() || undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("patientLibreCredentials", doc);
    return { ok: true as const };
  },
});

/** Client-facing: clear my stored Libre credentials (disconnect flow). */
export const clearMyCredentials = mutation({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) throw new ConvexError("Not signed in");
    const existing = await ctx.db
      .query("patientLibreCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true as const };
  },
});
