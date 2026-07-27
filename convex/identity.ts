/**
 * Clerk-backed identity for guardian accounts (see PREBUILD_PLAN_01 §3).
 *
 * Replaces the legacy `{ userId, passwordHash }` argument pair that ~63 functions currently carry.
 * Instead of trusting a client-supplied credential, functions read the verified Clerk identity from
 * the request (`ctx.auth.getUserIdentity()`, validated by Convex against the issuer configured in
 * `auth.config.ts`) and resolve it to the app's own `users` row.
 *
 * NOT in scope for this migration:
 *  - `doctorAccounts` — the doctor portal's own separate auth system.
 *  - Access-code sessions (kid / caregiver codes) — those authenticate by CODE, not by user, so
 *    every `*ViaCode` function stays exactly as it is.
 */
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./_generated/server";

/** The Clerk `subject` for this request, or null when the request is unauthenticated. */
export async function clerkSubject(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

/** The `users` row for the signed-in Clerk identity, or null (unauthenticated / not yet provisioned). */
export async function currentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const subject = await clerkSubject(ctx);
  if (!subject) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", subject))
    .unique();
}

/**
 * The signed-in user's row, or throw. This is the drop-in replacement for
 * `assertPatientAuth(userId, passwordHash)` — callers get the row rather than trusting an id from
 * the client, which also removes the whole class of "pass someone else's userId" bugs.
 */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Not signed in");
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) throw new ConvexError("No account for this sign-in yet — call identity.ensureUser first");
  return user;
}

/** Convenience for the very common "…and I only need the id" case. */
export async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  return (await requireUser(ctx))._id;
}

/**
 * TRANSITIONAL — delete once every function has moved to `requireUser`.
 *
 * Accepts EITHER a verified Clerk identity (preferred) or the legacy client-supplied
 * `{ userId, passwordHash }`. This exists purely so the ~63-signature migration can proceed file by
 * file with the app compiling and the test suite green at every step, instead of one all-or-nothing
 * change. It does NOT change the account plan: users still re-register against Clerk (clean cutover).
 *
 * Removal checklist (all must be true before deleting):
 *   1. no `passwordHash` left in any `args:` validator outside `doctorAccounts`
 *   2. mobile passes no `userId`/`passwordHash` to guardian functions
 *   3. tests authenticate via `withIdentity`
 *   4. `users.passwordHash` + `hashPassword` deleted
 */
export async function userCompat(
  ctx: QueryCtx | MutationCtx,
  args: { userId?: Id<"users">; passwordHash?: string },
): Promise<Doc<"users"> | null> {
  const viaClerk = await currentUser(ctx);
  if (viaClerk) return viaClerk;

  if (args.userId && args.passwordHash) {
    const user = await ctx.db.get(args.userId);
    if (user && user.passwordHash === args.passwordHash) return user;
  }
  return null;
}

/** Throwing form of {@link userCompat}, for the many handlers that reject rather than return null. */
export async function requireUserCompat(
  ctx: QueryCtx | MutationCtx,
  args: { userId?: Id<"users">; passwordHash?: string },
): Promise<Doc<"users">> {
  const user = await userCompat(ctx, args);
  if (!user) throw new ConvexError("Not signed in");
  return user;
}

/** Shared arg shape for functions still accepting the legacy credential during the migration. */
export const legacyAuthArgs = {
  userId: v.optional(v.id("users")),
  passwordHash: v.optional(v.string()),
};

/**
 * Create (or attach to) the `users` row for the signed-in Clerk identity. The app calls this once
 * after sign-in, before anything else — queries can't insert, so provisioning has to be a mutation.
 *
 * Idempotent. Resolution order:
 *  1. A row already linked to this `clerkId` → return it.
 *  2. A row with the same email but no `clerkId` → attach (claims a pre-Clerk account, so its logs,
 *     circle and codes survive). Harmless under the clean-cutover plan where no such rows exist, and
 *     it's the whole migration path if we ever decide to preserve existing accounts instead.
 *  3. Otherwise → create a fresh row.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not signed in");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique();
    // The email is returned alongside the id so the client doesn't have to race Clerk's user object
    // becoming available — important right after a Google/SSO sign-in.
    if (existing) return { userId: existing._id, email: existing.email };

    const email = (identity.email ?? "").trim().toLowerCase();
    const now = Date.now();

    if (email) {
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (byEmail && !byEmail.clerkId) {
        await ctx.db.patch(byEmail._id, { clerkId: identity.subject, updatedAt: now });
        return { userId: byEmail._id, email: byEmail.email };
      }
    }

    const userId = await ctx.db.insert("users", {
      email,
      clerkId: identity.subject,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, email };
  },
});
