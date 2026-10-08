import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { DOCTOR_AUTH_CONFIG as C } from "./config";

/**
 * Organization license keys and the email codes that go with them. The actions that hash keys,
 * passwords and codes live in doctorAuthActions.ts ("use node"); these are their database halves.
 */

// ─── rules ───────────────────────────────────────────────────────────────────────────────────

/** "Riverside.org " / "@riverside.org" → "riverside.org". */
export function normalizeDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

/** Whether the email's domain is one of the allowed ones, or a subdomain of one. Empty = any. */
export function emailDomainAllowed(email: string, allowedDomains: string[]) {
  if (allowedDomains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

async function liveKey(ctx: QueryCtx | MutationCtx, keyHash: string) {
  const key = await ctx.db
    .query("doctorLicenseKeys")
    .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
    .unique();
  if (!key || key.revokedAt != null) return null;
  const org = await ctx.db.get(key.organizationId);
  return org ? { key, org } : null;
}

async function seatsUsed(ctx: QueryCtx | MutationCtx, organizationId: Id<"doctorOrganizations">) {
  const members = await ctx.db
    .query("doctorAccounts")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .collect();
  return members.length;
}

async function emailTaken(ctx: QueryCtx | MutationCtx, email: string) {
  const existing = await ctx.db
    .query("doctorAccounts")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  return existing != null;
}

export type LicenseRefusal =
  | { result: "invalid_license" }
  | { result: "no_seats" }
  | { result: "domain_not_allowed"; allowedDomains: string[] }
  | { result: "email_taken" };

/** Everything that must hold for `email` to join with this key (checked again at sign-up). */
async function licenseRefusal(
  ctx: QueryCtx | MutationCtx,
  keyHash: string,
  email: string,
): Promise<{ refusal: LicenseRefusal } | { org: Doc<"doctorOrganizations"> }> {
  const live = await liveKey(ctx, keyHash);
  if (!live) return { refusal: { result: "invalid_license" } };
  const { org } = live;
  if (!emailDomainAllowed(email, org.allowedDomains)) {
    return { refusal: { result: "domain_not_allowed", allowedDomains: org.allowedDomains } };
  }
  if (await emailTaken(ctx, email)) return { refusal: { result: "email_taken" } };
  if ((await seatsUsed(ctx, org._id)) >= org.seats) return { refusal: { result: "no_seats" } };
  return { org };
}

// ─── the code a doctor types on the home screen ─────────────────────────────────────────────

/**
 * What a typed code is: a live license key (with the organization it fills in), a live invite
 * (nothing else — invites are tied to an email that's checked at sign-up), or neither.
 */
export const describeCode = internalQuery({
  args: { codeHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const live = await liveKey(ctx, args.codeHash);
    if (live) {
      const { org } = live;
      return {
        kind: "license" as const,
        organization: { name: org.name, location: org.location },
        allowedDomains: org.allowedDomains,
        seatsAvailable: (await seatsUsed(ctx, org._id)) < org.seats,
      };
    }
    const invite = await ctx.db
      .query("doctorInvites")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .unique();
    if (invite && invite.usedAt == null && invite.revokedAt == null && invite.expiresAt > args.now) {
      return { kind: "invite" as const };
    }
    return { kind: "invalid" as const };
  },
});

// ─── email verification ──────────────────────────────────────────────────────────────────────

export const checkLicenseForEmail = internalQuery({
  args: { keyHash: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const check = await licenseRefusal(ctx, args.keyHash, args.email);
    return "refusal" in check ? check.refusal : { result: "ok" as const, organizationName: check.org.name };
  },
});

/** Store a fresh code for the email; any earlier unused one stops working. */
export const storeEmailCode = internalMutation({
  args: { email: v.string(), codeHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const earlier = await ctx.db
      .query("doctorEmailCodes")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
    for (const row of earlier) await ctx.db.delete(row._id);
    await ctx.db.insert("doctorEmailCodes", {
      email: args.email,
      codeHash: args.codeHash,
      createdAt: args.now,
      expiresAt: args.now + C.EMAIL_CODE_VALID_MS,
      attempts: 0,
    });
  },
});

async function currentEmailCode(ctx: QueryCtx | MutationCtx, email: string, now: number) {
  const rows = await ctx.db
    .query("doctorEmailCodes")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  const row = rows[rows.length - 1];
  if (!row || row.usedAt != null || row.expiresAt <= now || row.attempts >= C.EMAIL_CODE_MAX_ATTEMPTS) {
    return null;
  }
  return row;
}

/**
 * Check a typed code before the (expensive) password hashing. A wrong guess uses up one of the
 * code's attempts; after the last one the doctor needs a new code.
 */
export const tryEmailCode = internalMutation({
  args: { email: v.string(), codeHash: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const row = await currentEmailCode(ctx, args.email, args.now);
    if (!row) return { ok: false };
    if (row.codeHash === args.codeHash) return { ok: true };
    await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
    return { ok: false };
  },
});

/** Use the email code and create the account in one transaction (re-checking everything). */
export const createAccountFromLicense = internalMutation({
  args: {
    keyHash: v.string(),
    email: v.string(),
    emailCodeHash: v.string(),
    passwordDigest: v.string(),
    displayName: v.string(),
    title: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    specialty: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    { result: "ok"; doctorId: Id<"doctorAccounts"> } | { result: "invalid_email_code" } | LicenseRefusal
  > => {
    const now = Date.now();
    const code = await currentEmailCode(ctx, args.email, now);
    if (!code || code.codeHash !== args.emailCodeHash) return { result: "invalid_email_code" };
    const check = await licenseRefusal(ctx, args.keyHash, args.email);
    if ("refusal" in check) return check.refusal;

    const doctorId = await ctx.db.insert("doctorAccounts", {
      email: args.email,
      passwordDigest: args.passwordDigest,
      passwordUpdatedAt: now,
      displayName: args.displayName,
      title: args.title?.trim() || undefined,
      firstName: args.firstName?.trim() || undefined,
      lastName: args.lastName?.trim() || undefined,
      specialty: args.specialty?.trim() || undefined,
      institution: check.org.name,
      organizationId: check.org._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(code._id, { usedAt: now });
    return { result: "ok", doctorId };
  },
});

// ─── admin ───────────────────────────────────────────────────────────────────────────────────

/** Resolve an organization by id or exact name (admin commands accept either). */
async function findOrganization(ctx: QueryCtx | MutationCtx, organization: string) {
  const id = ctx.db.normalizeId("doctorOrganizations", organization);
  if (id) {
    const org = await ctx.db.get(id);
    if (org) return org;
  }
  const byName = await ctx.db
    .query("doctorOrganizations")
    .withIndex("by_name", (q) => q.eq("name", organization.trim()))
    .collect();
  if (byName.length === 1) return byName[0]!;
  throw new Error(
    byName.length ? `More than one organization is named "${organization}"; use its id` : `No organization "${organization}"`,
  );
}

export const insertOrganization = internalMutation({
  args: {
    name: v.string(),
    location: v.optional(v.string()),
    seats: v.number(),
    allowedDomains: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("doctorOrganizations", { ...args, createdAt: now, updatedAt: now });
  },
});

/** Make `keyHash` the organization's only live key (revoking any earlier one). */
export const replaceLicenseKey = internalMutation({
  args: { organization: v.string(), keyHash: v.string() },
  handler: async (ctx, args) => {
    const org = await findOrganization(ctx, args.organization);
    const now = Date.now();
    const keys = await ctx.db
      .query("doctorLicenseKeys")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", org._id))
      .collect();
    for (const key of keys) if (key.revokedAt == null) await ctx.db.patch(key._id, { revokedAt: now });
    await ctx.db.insert("doctorLicenseKeys", { organizationId: org._id, keyHash: args.keyHash, createdAt: now });
    return { organizationId: org._id, name: org.name };
  },
});

/**
 * Admin: stop an organization's license key working (accounts already created keep working).
 *
 *   npx convex run doctorAuth/licenses:revokeLicenseKey '{"organization":"Riverside Pediatrics"}' --prod
 */
export const revokeLicenseKey = internalMutation({
  args: { organization: v.string() },
  handler: async (ctx, args) => {
    const org = await findOrganization(ctx, args.organization);
    const now = Date.now();
    const keys = await ctx.db
      .query("doctorLicenseKeys")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", org._id))
      .collect();
    let revoked = 0;
    for (const key of keys) {
      if (key.revokedAt != null) continue;
      await ctx.db.patch(key._id, { revokedAt: now });
      revoked++;
    }
    return { organization: org.name, revoked };
  },
});

/**
 * Admin: change an organization's seats, allowed email domains, name or location.
 *
 *   npx convex run doctorAuth/licenses:updateOrganization '{"organization":"Riverside Pediatrics","seats":40}' --prod
 */
export const updateOrganization = internalMutation({
  args: {
    organization: v.string(),
    name: v.optional(v.string()),
    location: v.optional(v.string()),
    seats: v.optional(v.number()),
    allowedDomains: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const org = await findOrganization(ctx, args.organization);
    const patch: Partial<Doc<"doctorOrganizations">> = { updatedAt: Date.now() };
    if (args.name?.trim()) patch.name = args.name.trim();
    if (args.location !== undefined) patch.location = args.location.trim() || undefined;
    if (args.seats !== undefined) {
      if (!Number.isInteger(args.seats) || args.seats < 1) throw new Error("seats must be a whole number ≥ 1");
      patch.seats = args.seats;
    }
    if (args.allowedDomains !== undefined) patch.allowedDomains = args.allowedDomains.map(normalizeDomain).filter(Boolean);
    if (args.note !== undefined) patch.note = args.note.trim() || undefined;
    await ctx.db.patch(org._id, patch);
    return { ...org, ...patch };
  },
});

/**
 * Admin: every organization, its seats in use, whether its key is live, and who has joined.
 *
 *   npx convex run doctorAuth/licenses:listOrganizations --prod
 */
export const listOrganizations = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("doctorOrganizations").collect();
    return await Promise.all(
      orgs.map(async (org) => {
        const members = await ctx.db
          .query("doctorAccounts")
          .withIndex("by_organizationId", (q) => q.eq("organizationId", org._id))
          .collect();
        const keys = await ctx.db
          .query("doctorLicenseKeys")
          .withIndex("by_organizationId", (q) => q.eq("organizationId", org._id))
          .collect();
        return {
          id: org._id,
          name: org.name,
          location: org.location,
          seats: `${members.length} of ${org.seats} used`,
          allowedDomains: org.allowedDomains,
          licenseKey: keys.some((k) => k.revokedAt == null) ? "live" : "none (revoked or never issued)",
          members: members.map((m) => ({ email: m.email, name: m.displayName, joined: new Date(m.createdAt).toISOString() })),
        };
      }),
    );
  },
});
