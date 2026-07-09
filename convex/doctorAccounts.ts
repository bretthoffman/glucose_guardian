import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function requireDoctorApiSecret(provided: string) {
  const expected = process.env.CONVEX_DOCTOR_API_SECRET;
  if (!expected || provided !== expected) {
    throw new Error("Unauthorized doctor API");
  }
}

export function normalizeAccessCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

async function getActiveLink(
  ctx: QueryCtx | MutationCtx,
  doctorId: Id<"doctorAccounts">,
  accessCode: string,
) {
  const link = await ctx.db
    .query("doctorPatientLinks")
    .withIndex("by_doctorId_accessCode", (q) =>
      q.eq("doctorId", doctorId).eq("accessCode", accessCode),
    )
    .unique();
  if (!link || link.revokedAt != null) return null;
  return link;
}

async function findPatientProfileByDoctorCode(ctx: QueryCtx | MutationCtx, code: string) {
  const row = await ctx.db
    .query("patientProfiles")
    .withIndex("by_doctorCode", (q) => q.eq("doctorCode", code))
    .first();
  if (!row?.doctorCode) return null;
  if (normalizeAccessCode(row.doctorCode) !== code) return null;
  return row;
}

export const register = mutation({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    displayName: v.string(),
    title: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    institution: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const email = args.email.trim().toLowerCase();
    const displayName = args.displayName.trim();
    if (!email) throw new Error("Email required");
    if (!displayName) throw new Error("Display name required");

    const existing = await ctx.db
      .query("doctorAccounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) throw new Error("Email already registered");

    const now = Date.now();
    const doctorId = await ctx.db.insert("doctorAccounts", {
      email,
      passwordHash: args.passwordHash,
      displayName,
      title: args.title?.trim() || undefined,
      firstName: args.firstName?.trim() || undefined,
      lastName: args.lastName?.trim() || undefined,
      institution: args.institution?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { doctorId };
  },
});

export const login = query({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const email = args.email.trim().toLowerCase();
    const account = await ctx.db
      .query("doctorAccounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account || account.passwordHash !== args.passwordHash) {
      return null;
    }
    return {
      doctorId: account._id,
      email: account.email,
      displayName: account.displayName,
      title: account.title,
      firstName: account.firstName,
      lastName: account.lastName,
      institution: account.institution,
      hasPin: !!account.pinHash,
    };
  },
});

export const getById = query({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const account = await ctx.db.get(args.doctorId);
    if (!account) return null;
    return {
      doctorId: account._id,
      email: account.email,
      displayName: account.displayName,
      title: account.title,
      firstName: account.firstName,
      lastName: account.lastName,
      institution: account.institution,
      hasPin: !!account.pinHash,
    };
  },
});

/**
 * Set (or replace) the account-level portal PIN. `pinHash` is a client-computed hash of the
 * doctor's 4-digit PIN — the raw PIN never leaves the browser. Once set, the PIN follows the
 * account to any device the doctor signs in from.
 */
export const setPin = mutation({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
    pinHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const account = await ctx.db.get(args.doctorId);
    if (!account) throw new Error("Doctor not found");
    const now = Date.now();
    await ctx.db.patch(args.doctorId, {
      pinHash: args.pinHash,
      pinUpdatedAt: now,
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

/**
 * Verify a submitted PIN hash against the account's stored hash. Returns `hasPin: false` when the
 * account has never set one (so the portal can route to the set-PIN step instead of failing).
 */
export const verifyPin = query({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
    pinHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const account = await ctx.db.get(args.doctorId);
    if (!account?.pinHash) {
      return { valid: false as const, hasPin: false as const };
    }
    return { valid: account.pinHash === args.pinHash, hasPin: true as const };
  },
});

export const createSession = mutation({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const account = await ctx.db.get(args.doctorId);
    if (!account) throw new Error("Doctor not found");
    await ctx.db.insert("doctorSessions", {
      doctorId: args.doctorId,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const validateSession = query({
  args: {
    serverSecret: v.string(),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const session = await ctx.db
      .query("doctorSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    return { doctorId: session.doctorId };
  },
});

export const revokeSession = mutation({
  args: {
    serverSecret: v.string(),
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const session = await ctx.db
      .query("doctorSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (session) {
      await ctx.db.delete(session._id);
    }
    return { ok: true as const };
  },
});

export const assertCanAccess = query({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
    accessCode: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const code = normalizeAccessCode(args.accessCode);
    const link = await getActiveLink(ctx, args.doctorId, code);
    return { allowed: !!link, accessCode: code };
  },
});

export const createLink = mutation({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
    accessCode: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const code = normalizeAccessCode(args.accessCode);
    if (code.length !== 6) {
      throw new Error("Access code must be 6 characters");
    }

    const profile = await findPatientProfileByDoctorCode(ctx, code);
    if (!profile) {
      throw new Error("Invalid or unknown patient access code");
    }
    if (
      profile.caregiverCode &&
      normalizeAccessCode(profile.caregiverCode) === code
    ) {
      throw new Error("Invalid access code");
    }

    const existing = await ctx.db
      .query("doctorPatientLinks")
      .withIndex("by_doctorId_accessCode", (q) =>
        q.eq("doctorId", args.doctorId).eq("accessCode", code),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      const state = await ctx.db
        .query("doctorPortalState")
        .withIndex("by_accessCode", (q) => q.eq("accessCode", code))
        .unique();
      if (existing.revokedAt == null) {
        return {
          linkId: existing._id,
          accessCode: code,
          displayName: existing.displayName ?? profile.childName,
          patientUserId: existing.patientUserId ?? profile.userId,
          linkedAt: existing.linkedAt,
          alreadyLinked: true,
          hasData: !!state?.profile,
          syncedAt: state?.syncedAt ?? null,
        };
      }
      await ctx.db.patch(existing._id, {
        revokedAt: undefined,
        linkedAt: now,
        displayName: profile.childName,
        patientUserId: profile.userId,
      });
    } else {
      await ctx.db.insert("doctorPatientLinks", {
        doctorId: args.doctorId,
        accessCode: code,
        patientUserId: profile.userId,
        displayName: profile.childName,
        linkedAt: now,
      });
    }

    const state = await ctx.db
      .query("doctorPortalState")
      .withIndex("by_accessCode", (q) => q.eq("accessCode", code))
      .unique();

    return {
      accessCode: code,
      displayName: profile.childName,
      patientUserId: profile.userId,
      linkedAt: existing?.revokedAt != null ? now : existing?.linkedAt ?? now,
      alreadyLinked: existing?.revokedAt == null && !!existing,
      hasData: !!state?.profile,
      syncedAt: state?.syncedAt ?? null,
    };
  },
});

export const listLinks = query({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const links = await ctx.db
      .query("doctorPatientLinks")
      .withIndex("by_doctorId", (q) => q.eq("doctorId", args.doctorId))
      .collect();

    const patients = await Promise.all(
      links
        .filter((link) => link.revokedAt == null)
        .map(async (link) => {
          const state = await ctx.db
            .query("doctorPortalState")
            .withIndex("by_accessCode", (q) => q.eq("accessCode", link.accessCode))
            .unique();
          return {
            accessCode: link.accessCode,
            displayName: link.displayName ?? state?.profile?.childName ?? null,
            patientUserId: link.patientUserId,
            linkedAt: link.linkedAt,
            hasData: !!state?.profile,
            syncedAt: state?.syncedAt ?? null,
          };
        }),
    );

    patients.sort((a, b) => b.linkedAt - a.linkedAt);
    return { patients };
  },
});

export const revokeLink = mutation({
  args: {
    serverSecret: v.string(),
    doctorId: v.id("doctorAccounts"),
    accessCode: v.string(),
  },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const code = normalizeAccessCode(args.accessCode);
    const link = await ctx.db
      .query("doctorPatientLinks")
      .withIndex("by_doctorId_accessCode", (q) =>
        q.eq("doctorId", args.doctorId).eq("accessCode", code),
      )
      .unique();
    if (!link) {
      throw new Error("Link not found");
    }
    if (link.revokedAt != null) {
      return { revoked: true as const };
    }
    await ctx.db.patch(link._id, { revokedAt: Date.now() });
    return { revoked: true as const };
  },
});
