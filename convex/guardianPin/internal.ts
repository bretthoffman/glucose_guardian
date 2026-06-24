import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { GUARDIAN_PIN_CONFIG as C } from "./config";

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

export const assertAuth = internalQuery({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    return await assertPatientAuth(ctx, args.userId, args.passwordHash);
  },
});

/** Server-only row read — never exposed to client queries. */
export const getRow = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("patientGuardianPins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const persistPin = internalMutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    pinHash: v.string(),
    pinSalt: v.string(),
    migrationMarker: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    const now = Date.now();
    const existing = await ctx.db
      .query("patientGuardianPins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    const doc = {
      userId: args.userId,
      pinHash: args.pinHash,
      pinSalt: args.pinSalt,
      hashVersion: C.HASH_VERSION,
      state: "active" as const,
      failedAttempts: 0,
      lastFailedAt: undefined as number | undefined,
      lockoutUntil: undefined as number | undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      migrationMarker: args.migrationMarker,
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("patientGuardianPins", doc);
    }
  },
});

export const recordFailedAttempt = internalMutation({
  args: { userId: v.id("users"), passwordHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    const row = await ctx.db
      .query("patientGuardianPins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) return { failedAttempts: 0, lockoutUntil: undefined as number | undefined };
    const failedAttempts = (row.failedAttempts ?? 0) + 1;
    let lockoutUntil = row.lockoutUntil;
    if (failedAttempts >= C.MAX_FAILED_ATTEMPTS) {
      lockoutUntil = args.now + C.LOCKOUT_MS;
    }
    await ctx.db.patch(row._id, {
      failedAttempts,
      lastFailedAt: args.now,
      lockoutUntil,
      updatedAt: args.now,
    });
    return { failedAttempts, lockoutUntil };
  },
});

export const resetFailedAttempts = internalMutation({
  args: { userId: v.id("users"), passwordHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const ok = await assertPatientAuth(ctx, args.userId, args.passwordHash);
    if (!ok) throw new Error("Unauthorized");
    const row = await ctx.db
      .query("patientGuardianPins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      failedAttempts: 0,
      lastFailedAt: undefined,
      lockoutUntil: undefined,
      updatedAt: args.now,
    });
  },
});
