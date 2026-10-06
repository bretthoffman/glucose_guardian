import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { THROTTLE_POLICIES, type ThrottlePolicy } from "./config";

// ─── failed-attempt limits ───────────────────────────────────────────────────────────────────

const throttlePolicy = v.union(
  v.literal("loginEmail"),
  v.literal("loginIp"),
  v.literal("linkDoctor"),
  v.literal("linkIp"),
  v.literal("inviteIp"),
);

export type ThrottleEntry = { key: string; policy: ThrottlePolicy };

async function throttleRow(ctx: QueryCtx | MutationCtx, key: string) {
  return await ctx.db
    .query("doctorAuthThrottle")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** How long until every one of these keys is unlocked (0 = none is locked). */
export async function lockRemainingMs(
  ctx: QueryCtx | MutationCtx,
  keys: string[],
  now: number,
): Promise<number> {
  let remaining = 0;
  for (const key of keys) {
    const row = await throttleRow(ctx, key);
    if (row?.lockedUntil && row.lockedUntil > now) remaining = Math.max(remaining, row.lockedUntil - now);
  }
  return remaining;
}

/** Count one failure; the key locks once its policy's limit is reached inside the window. */
export async function noteFailure(ctx: MutationCtx, entry: ThrottleEntry, now: number) {
  const policy = THROTTLE_POLICIES[entry.policy];
  const row = await throttleRow(ctx, entry.key);
  const fresh =
    !row || now - row.windowStart > policy.windowMs || (row.lockedUntil != null && row.lockedUntil <= now);
  const failures = fresh ? 1 : row.failures + 1;
  const next =
    failures >= policy.max
      ? { failures: 0, windowStart: now, lockedUntil: now + policy.lockMs }
      : { failures, windowStart: fresh ? now : row.windowStart, lockedUntil: undefined };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("doctorAuthThrottle", { key: entry.key, ...next });
}

export async function clearThrottle(ctx: MutationCtx, key: string) {
  const row = await throttleRow(ctx, key);
  if (row) await ctx.db.delete(row._id);
}

export const lockStatus = internalQuery({
  args: { keys: v.array(v.string()), now: v.number() },
  handler: async (ctx, args) => ({ retryAfterMs: await lockRemainingMs(ctx, args.keys, args.now) }),
});

export const recordFailures = internalMutation({
  args: { entries: v.array(v.object({ key: v.string(), policy: throttlePolicy })), now: v.number() },
  handler: async (ctx, args) => {
    for (const entry of args.entries) await noteFailure(ctx, entry, args.now);
  },
});

export const clearThrottles = internalMutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const key of args.keys) await clearThrottle(ctx, key);
  },
});

// ─── accounts ────────────────────────────────────────────────────────────────────────────────

/** What the portal gets back about the signed-in doctor (never any password material). */
export function doctorProfile(account: Doc<"doctorAccounts">) {
  return {
    doctorId: account._id,
    email: account.email,
    displayName: account.displayName,
    title: account.title,
    firstName: account.firstName,
    lastName: account.lastName,
    specialty: account.specialty,
    photoDataUri: account.photoDataUri,
    institution: account.institution,
    hasPin: !!account.pinHash,
  };
}

export type DoctorProfile = ReturnType<typeof doctorProfile>;

export const getLoginRecord = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("doctorAccounts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (!account) return null;
    return {
      doctorId: account._id,
      passwordDigest: account.passwordDigest,
      legacyPasswordHash: account.passwordHash,
      profile: doctorProfile(account),
    };
  },
});

/** Store a scrypt digest and drop the reversible pre-scrypt value. */
export const setPasswordDigest = internalMutation({
  args: { doctorId: v.id("doctorAccounts"), passwordDigest: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.doctorId, {
      passwordDigest: args.passwordDigest,
      passwordHash: undefined,
      passwordUpdatedAt: now,
      updatedAt: now,
    });
  },
});

export const listLegacyPasswordAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("doctorAccounts").collect();
    return accounts
      .filter((a) => a.passwordHash && !a.passwordDigest)
      .map((a) => ({ doctorId: a._id, legacyPasswordHash: a.passwordHash! }));
  },
});

/**
 * Admin: remove a doctor account (e.g. an unused or test one) along with its sessions — signing it
 * out everywhere — its patient links, alerts and attempt counters. Access logs and messages stay,
 * as the audit trail. Refuses an account that still has patients unless `force` is set.
 *
 *   npx convex run doctorAuth/internal:removeDoctorAccount '{"email":"old@clinic.org"}' --prod
 */
export const removeDoctorAccount = internalMutation({
  args: { email: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const account = await ctx.db
      .query("doctorAccounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account) return { email, removed: false as const, reason: "no such account" };

    const doctorId = account._id;
    const links = await ctx.db
      .query("doctorPatientLinks")
      .withIndex("by_doctorId", (q) => q.eq("doctorId", doctorId))
      .collect();
    const activePatients = links.filter((l) => l.revokedAt == null).length;
    if (activePatients > 0 && !args.force) {
      return {
        email,
        removed: false as const,
        reason: `has ${activePatients} patient${activePatients === 1 ? "" : "s"}; pass "force": true to remove anyway`,
      };
    }
    const sessions = await ctx.db
      .query("doctorSessions")
      .withIndex("by_doctorId", (q) => q.eq("doctorId", doctorId))
      .collect();
    const alerts = await ctx.db
      .query("doctorAlerts")
      .withIndex("by_doctorId", (q) => q.eq("doctorId", doctorId))
      .collect();
    for (const row of [...sessions, ...links, ...alerts]) await ctx.db.delete(row._id);
    await clearThrottle(ctx, `link:doctor:${doctorId}`);
    await clearThrottle(ctx, `login:email:${email}`);
    await ctx.db.delete(doctorId);
    return {
      email,
      removed: true as const,
      sessionsEnded: sessions.length,
      patientLinks: links.length,
      alerts: alerts.length,
    };
  },
});

// ─── invites ─────────────────────────────────────────────────────────────────────────────────

function inviteIsOpen(invite: Doc<"doctorInvites">, now: number) {
  return invite.usedAt == null && invite.revokedAt == null && invite.expiresAt > now;
}

/** Whether this code is a live invite for this email (no other detail, so it can't be probed). */
export const checkInvite = internalQuery({
  args: { codeHash: v.string(), email: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("doctorInvites")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .unique();
    return !!invite && invite.email === args.email && inviteIsOpen(invite, args.now);
  },
});

/** A new invite replaces any still-open ones for the same email. */
export const storeInvite = internalMutation({
  args: { codeHash: v.string(), email: v.string(), note: v.optional(v.string()), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const earlier = await ctx.db
      .query("doctorInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    for (const invite of earlier) {
      if (inviteIsOpen(invite, now)) await ctx.db.patch(invite._id, { revokedAt: now });
    }
    await ctx.db.insert("doctorInvites", {
      codeHash: args.codeHash,
      email: args.email,
      ...(args.note?.trim() ? { note: args.note.trim() } : {}),
      createdAt: now,
      expiresAt: args.expiresAt,
    });
  },
});

/** Redeem an invite and create the account in one transaction (re-checking everything). */
export const createAccountFromInvite = internalMutation({
  args: {
    codeHash: v.string(),
    email: v.string(),
    passwordDigest: v.string(),
    displayName: v.string(),
    title: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    institution: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { result: "ok"; doctorId: Id<"doctorAccounts"> } | { result: "invalid_invite" } | { result: "email_taken" }
  > => {
    const now = Date.now();
    const invite = await ctx.db
      .query("doctorInvites")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .unique();
    if (!invite || invite.email !== args.email || !inviteIsOpen(invite, now)) {
      return { result: "invalid_invite" };
    }
    const existing = await ctx.db
      .query("doctorAccounts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (existing) return { result: "email_taken" };

    const doctorId = await ctx.db.insert("doctorAccounts", {
      email: args.email,
      passwordDigest: args.passwordDigest,
      passwordUpdatedAt: now,
      displayName: args.displayName,
      title: args.title?.trim() || undefined,
      firstName: args.firstName?.trim() || undefined,
      lastName: args.lastName?.trim() || undefined,
      institution: args.institution?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(invite._id, { usedAt: now, usedByDoctorId: doctorId });
    return { result: "ok", doctorId };
  },
});

/** Admin: cancel any still-open invites for an email. */
export const revokeInvites = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = args.email.trim().toLowerCase();
    const invites = await ctx.db
      .query("doctorInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    let revoked = 0;
    for (const invite of invites) {
      if (!inviteIsOpen(invite, now)) continue;
      await ctx.db.patch(invite._id, { revokedAt: now });
      revoked++;
    }
    return { email, revoked };
  },
});

/** Admin: recent invites and where each stands. */
export const listInvites = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const invites = await ctx.db.query("doctorInvites").order("desc").take(100);
    return invites.map((invite) => ({
      email: invite.email,
      note: invite.note,
      created: new Date(invite.createdAt).toISOString(),
      expires: new Date(invite.expiresAt).toISOString(),
      status:
        invite.usedAt != null
          ? "used"
          : invite.revokedAt != null
            ? "revoked"
            : invite.expiresAt <= now
              ? "expired"
              : "open",
    }));
  },
});
