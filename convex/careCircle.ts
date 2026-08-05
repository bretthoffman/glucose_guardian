/**
 * Care Circle — account linking, roles, and external access codes.
 * Design: CARE_CIRCLE_ROLES_AUDIT_01.md.
 *
 * Model recap:
 *  - co-guardians (parents / spouses) are real accounts linked via `careLinks`, joined through
 *    short-lived `careInvites` codes. Max 3 active co-guardians per patient.
 *  - External guardians (teacher / babysitter / relative) use named persistent `careAccessCodes`
 *    — the code is the credential; permissions + schedule ride on the code; retire to kill it.
 *  - `careSettings.dependentMode` (parent-kid mode) decides which side holds admin control:
 *    off → the patient account administers its own circle; on → active co-guardians administer
 *    and the patient (kid) device is governed by `careSettings.devicePermissions`.
 *
 * Every function re-verifies caller credentials per call (same userId+passwordHash convention as
 * the rest of the patient API). Schedules are evaluated lazily via `careSchedule.ts` — the server
 * is the enforcement boundary; clients only mirror the evaluation for UI copy.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";
import { doseSettingsByTime } from "./schema";
import {
  FULL_CARE_PERMISSIONS,
  VIEWER_CARE_PERMISSIONS,
  careAccessAllowed,
  evaluateCareAccess,
  type CareAccess,
  type CarePermissions,
} from "./careSchedule";
import { copyBucketLogs } from "./careLogs";

// ─── validators (mirror schema.ts) ───────────────────────────────────────────────────────────

const carePermissionsPayload = v.object({
  viewReadings: v.boolean(),
  viewLogs: v.boolean(),
  log: v.boolean(),
  useCalculator: v.boolean(),
  chat: v.boolean(),
});

const careAccessPayload = v.union(
  v.object({ mode: v.literal("always") }),
  v.object({ mode: v.literal("disabled") }),
  v.object({ mode: v.literal("window"), startMs: v.number(), endMs: v.number() }),
  v.object({
    mode: v.literal("weekly"),
    days: v.array(v.number()),
    startMinute: v.number(),
    endMinute: v.number(),
    tzOffsetMinutes: v.number(),
  }),
);

// ─── shared helpers ──────────────────────────────────────────────────────────────────────────

const MAX_CO_GUARDIANS = 3;
/** Total guardians in a circle = the owner + co-guardians. Drives the "N/4" counter. */
const MAX_GUARDIANS_TOTAL = MAX_CO_GUARDIANS + 1;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
/** No lookalike characters (I/O/0/1). 8 chars ≈ 1.1e12 combinations. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/**
 * Access codes are BEARER CREDENTIALS — a code alone grants a caregiver/kid device the patient's
 * readings and logs, and the doctor code alone gates the two unauthenticated api-server routes
 * (`/api/doctor/sync`, `/api/doctor/order-decision`). So they must be unpredictable, not merely
 * random-looking: `Math.random()` is seeded PRNG output, and observing enough issued codes can reveal
 * the generator state and therefore future codes. 32^8 ≈ 1.1e12 is only meaningful if the draws are
 * genuinely unpredictable.
 *
 * Uses the Web Crypto CSPRNG, with a `Math.random` fallback rather than a throw: failing closed here
 * would mean a guardian cannot issue a caregiver code at all, which is worse than the old behavior.
 * The fallback is strictly no weaker than what this did before.
 *
 * Rejection sampling keeps the mapping unbiased if CODE_ALPHABET is ever edited to a non-divisor
 * length (256 is 8× 32 exactly today, so nothing is currently discarded).
 */
function randomCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let code = "";
  try {
    while (code.length < CODE_LENGTH) {
      const bytes = new Uint8Array(CODE_LENGTH - code.length + 8);
      crypto.getRandomValues(bytes);
      for (const b of bytes) {
        if (code.length >= CODE_LENGTH) break;
        if (b >= limit) continue;
        code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      }
    }
    return code;
  } catch {
    let fallback = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      fallback += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return fallback;
  }
}

export function normalizeCareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

/** Generate a code that collides with neither invites nor access codes. */
async function generateUniqueCode(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const inviteHit = await ctx.db
      .query("careInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    const accessHit = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!inviteHit && !accessHit) return code;
  }
  throw new ConvexError("Could not generate a unique code — try again");
}

async function getSettings(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  const row = await ctx.db
    .query("careSettings")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .unique();
  return row ?? null;
}

function settingsOrDefault(row: { dependentMode: boolean; devicePermissions: CarePermissions } | null) {
  return {
    dependentMode: row?.dependentMode ?? false,
    devicePermissions: row?.devicePermissions ?? { ...FULL_CARE_PERMISSIONS },
  };
}

async function activeCoGuardianLinks(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db
    .query("careLinks")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId).eq("status", "active"))
    .collect();
}

async function activeLinkFor(
  ctx: QueryCtx | MutationCtx,
  patientUserId: Id<"users">,
  memberUserId: Id<"users">,
) {
  // A pair can accumulate several rows over join/leave/rejoin cycles (the index has no status), so
  // scan them and return the ACTIVE one — never just `.first()`, which might be a stale revoked row
  // and would make an existing co-guardian look unlinked (blanking their whole circle view).
  const links = await ctx.db
    .query("careLinks")
    .withIndex("by_patient_member", (q) =>
      q.eq("patientUserId", patientUserId).eq("memberUserId", memberUserId),
    )
    .collect();
  return links.find((l) => l.status === "active") ?? null;
}

/**
 * Admin resolution: the patient account and any active co-guardian administer the circle. (Kids
 * have no account — they use a child access code — so there is no account-flipping to reason about.)
 */
async function isCircleAdmin(
  ctx: QueryCtx | MutationCtx,
  patientUserId: Id<"users">,
  callerUserId: Id<"users">,
): Promise<boolean> {
  if (callerUserId === patientUserId) return true;
  return (await activeLinkFor(ctx, patientUserId, callerUserId)) !== null;
}

async function displayNameFor(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<string> {
  const profile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (profile?.parentName?.trim()) return profile.parentName.trim();
  if (profile?.childName?.trim()) return profile.childName.trim();
  const user = await ctx.db.get(userId);
  return user?.email?.split("@")[0] ?? "Guardian";
}

/** Slim, role-appropriate patient fields — never codes, access logs, or contact details. */
async function slimPatientProfile(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  const row = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", patientUserId))
    .unique();
  if (!row) return null;
  return {
    childName: row.childName,
    diabetesType: row.diabetesType,
    /** Co-guardians / external viewers need this for age-appropriate copy (kid vs adult). */
    dateOfBirth: row.dateOfBirth,
    weightLbs: row.weightLbs,
    insulinTypes: row.insulinTypes,
    profilePhotoUri: row.profilePhotoUri,
    carbRatio: row.carbRatio,
    targetGlucose: row.targetGlucose,
    correctionFactor: row.correctionFactor,
    doseSettingsByTime: row.doseSettingsByTime,
    /** So a kid/caregiver device evaluates readings against the owner's ranges, not its own. */
    alertPreferences: row.alertPreferences,
  };
}

const GLUCOSE_DEFAULT_LIMIT = 300;
const GLUCOSE_MAX_LIMIT = 600;

async function readRecentGlucose(
  ctx: QueryCtx,
  patientUserId: Id<"users">,
  limit: number | undefined,
) {
  const lim = Math.min(Math.max(limit ?? GLUCOSE_DEFAULT_LIMIT, 1), GLUCOSE_MAX_LIMIT);
  const rows = await ctx.db
    .query("patientGlucoseReadings")
    .withIndex("by_user_time", (q) => q.eq("userId", patientUserId))
    .order("desc")
    .take(lim);
  rows.reverse();
  return rows.map((r) => ({
    glucose: r.glucose,
    timestamp: r.timestamp,
    anomaly: r.anomaly,
    dexcomTrend: r.dexcomTrend,
  }));
}

// ─── invites (co-guardians) ──────────────────────────────────────────────────────────────────

export const createInvite = mutation({
  args: {
    ...legacyAuthArgs,
    patientUserId: v.id("users"),
    // When set, the invite is delivered to this account's Care Circle as an incoming request to
    // accept (the "found a matching account, invite them" flow) — no code to copy out-of-band.
    targetUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    if (!(await isCircleAdmin(ctx, args.patientUserId, user._id))) throw new ConvexError("Not allowed");
    const links = await activeCoGuardianLinks(ctx, args.patientUserId);
    if (links.length >= MAX_CO_GUARDIANS) {
      throw new ConvexError(`This care circle already has ${MAX_CO_GUARDIANS} co-guardians`);
    }
    const now = Date.now();

    if (args.targetUserId) {
      if (args.targetUserId === args.patientUserId) throw new ConvexError("You can't invite the patient's own account");
      const target = await ctx.db.get(args.targetUserId);
      if (!target) throw new ConvexError("That account no longer exists");
      if (await activeLinkFor(ctx, args.patientUserId, args.targetUserId)) {
        throw new ConvexError("That account is already a co-guardian");
      }
      // Reuse an existing live invite to the same target so tapping "Invite" twice doesn't pile up
      // duplicate incoming requests — the code stays stable and they still see a single request.
      const existing = await ctx.db
        .query("careInvites")
        .withIndex("by_target", (q) => q.eq("targetUserId", args.targetUserId).eq("status", "pending"))
        .collect();
      const live = existing.find((i) => i.patientUserId === args.patientUserId && i.expiresAt > now);
      if (live) return { code: live.code, expiresAt: live.expiresAt, delivered: true };
    }

    const code = await generateUniqueCode(ctx);
    await ctx.db.insert("careInvites", {
      patientUserId: args.patientUserId,
      code,
      role: "co_guardian",
      presetPermissions: { ...FULL_CARE_PERMISSIONS },
      presetAccess: { mode: "always" },
      createdByUserId: user._id,
      ...(args.targetUserId ? { targetUserId: args.targetUserId } : {}),
      expiresAt: now + INVITE_TTL_MS,
      status: "pending",
      createdAt: now,
    });
    return { code, expiresAt: now + INVITE_TTL_MS, delivered: !!args.targetUserId };
  },
});

export const cancelInvite = mutation({
  args: { ...legacyAuthArgs, inviteId: v.id("careInvites") },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) return;
    if (!(await isCircleAdmin(ctx, invite.patientUserId, user._id))) throw new ConvexError("Not allowed");
    if (invite.status === "pending") await ctx.db.patch(args.inviteId, { status: "cancelled" });
  },
});

export const redeemInvite = mutation({
  args: { ...legacyAuthArgs, code: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const code = normalizeCareCode(args.code);
    const invite = await ctx.db
      .query("careInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!invite || invite.status !== "pending") throw new ConvexError("Invalid or already-used invite code");
    if (Date.now() > invite.expiresAt) throw new ConvexError("This invite code has expired");
    if (invite.patientUserId === user._id) throw new ConvexError("You cannot join your own care circle");
    // A directed invite can only be accepted by the account it was addressed to — sharing its code
    // with someone else must not let them hijack the seat.
    if (invite.targetUserId && invite.targetUserId !== user._id) {
      throw new ConvexError("This invitation was sent to a different account");
    }

    const existing = await activeLinkFor(ctx, invite.patientUserId, user._id);
    if (existing) throw new ConvexError("You are already in this care circle");
    const links = await activeCoGuardianLinks(ctx, invite.patientUserId);
    if (links.length >= MAX_CO_GUARDIANS) {
      throw new ConvexError(`This care circle already has ${MAX_CO_GUARDIANS} co-guardians`);
    }

    const now = Date.now();
    const displayName = await displayNameFor(ctx, user._id);
    await ctx.db.insert("careLinks", {
      patientUserId: invite.patientUserId,
      memberUserId: user._id,
      role: "co_guardian",
      displayName,
      permissions: invite.presetPermissions,
      access: invite.presetAccess,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(invite._id, {
      status: "redeemed",
      redeemedByUserId: user._id,
      redeemedAt: now,
    });
    // Merge care immediately: everything the joiner logged before linking (their old private
    // bucket) backfills into the circle's shared pool so every guardian sees the same history.
    await copyBucketLogs(ctx, user._id, invite.patientUserId, displayName);
    const patient = await slimPatientProfile(ctx, invite.patientUserId);
    return { patientUserId: invite.patientUserId, patientName: patient?.childName ?? "Patient" };
  },
});

// ─── links (co-guardians) ────────────────────────────────────────────────────────────────────

/**
 * Leave/removal snapshot: the departing member keeps the circle's CURRENT settings as their own
 * (they're still caring for the same child — reverting to whatever they had before joining could
 * silently resurrect months-old dosing math). Copies the owner's shared profile fields + the
 * shared quick-meals/contact pool onto the member's own records. Deliberately NOT the doctor code:
 * two accounts must never share one code (the portal resolves codes uniquely) — the ex-member
 * generates a fresh code from their dashboard if they still see that practice.
 */
async function snapshotSharedToMember(
  ctx: MutationCtx,
  patientUserId: Id<"users">,
  memberUserId: Id<"users">,
) {
  const ownerProfile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", patientUserId))
    .unique();
  const now = Date.now();
  if (ownerProfile) {
    const sharedFields = {
      childName: ownerProfile.childName,
      childLastName: ownerProfile.childLastName,
      diabetesType: ownerProfile.diabetesType,
      dateOfBirth: ownerProfile.dateOfBirth,
      weightLbs: ownerProfile.weightLbs,
      doctorName: ownerProfile.doctorName,
      doctorEmail: ownerProfile.doctorEmail,
      doctorPhone: ownerProfile.doctorPhone,
      doctorInstitution: ownerProfile.doctorInstitution,
      insulinTypes: ownerProfile.insulinTypes,
      carbRatio: ownerProfile.carbRatio,
      targetGlucose: ownerProfile.targetGlucose,
      correctionFactor: ownerProfile.correctionFactor,
      doseSettingsByTime: ownerProfile.doseSettingsByTime,
      alertPreferences: ownerProfile.alertPreferences,
    };
    const memberProfile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", memberUserId))
      .unique();
    if (memberProfile) {
      await ctx.db.patch(memberProfile._id, { ...sharedFields, updatedAt: now });
    } else {
      await ctx.db.insert("patientProfiles", { userId: memberUserId, ...sharedFields, updatedAt: now });
    }
  }
  const pool = await ctx.db
    .query("careShared")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .unique();
  if (pool) {
    const memberPool = await ctx.db
      .query("careShared")
      .withIndex("by_patient", (q) => q.eq("patientUserId", memberUserId))
      .unique();
    const doc = {
      patientUserId: memberUserId,
      quickFoods: pool.quickFoods,
      emergencyContacts: pool.emergencyContacts,
      updatedAt: now,
    };
    if (memberPool) await ctx.db.replace(memberPool._id, doc);
    else await ctx.db.insert("careShared", doc);
  }
}

export const revokeLink = mutation({
  args: { ...legacyAuthArgs, linkId: v.id("careLinks") },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const link = await ctx.db.get(args.linkId);
    if (!link || link.status !== "active") return;
    const isMemberLeaving = link.memberUserId === user._id;
    if (!isMemberLeaving && !(await isCircleAdmin(ctx, link.patientUserId, user._id))) {
      throw new ConvexError("Not allowed");
    }
    // In dependent mode the last co-guardian cannot be removed — the circle would have no admin.
    const settings = settingsOrDefault(await getSettings(ctx, link.patientUserId));
    if (settings.dependentMode) {
      const links = await activeCoGuardianLinks(ctx, link.patientUserId);
      if (links.length <= 1) {
        throw new ConvexError("Turn off parent-kid mode before removing the last co-guardian");
      }
    }
    await ctx.db.patch(args.linkId, {
      status: "revoked",
      revokedAt: Date.now(),
      revokedBy: isMemberLeaving ? "member" : "patient_side",
      updatedAt: Date.now(),
    });
    // The ex-member walks away with the circle's current settings — never a blanked account.
    await snapshotSharedToMember(ctx, link.patientUserId, link.memberUserId);
  },
});

export const setLinkPermissions = mutation({
  args: {
    ...legacyAuthArgs,
    linkId: v.id("careLinks"),
    permissions: carePermissionsPayload,
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const link = await ctx.db.get(args.linkId);
    if (!link || link.status !== "active") throw new ConvexError("Link not found");
    if (!(await isCircleAdmin(ctx, link.patientUserId, user._id))) throw new ConvexError("Not allowed");
    await ctx.db.patch(args.linkId, { permissions: args.permissions, updatedAt: Date.now() });
  },
});

export const setLinkAccess = mutation({
  args: {
    ...legacyAuthArgs,
    linkId: v.id("careLinks"),
    access: careAccessPayload,
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const link = await ctx.db.get(args.linkId);
    if (!link || link.status !== "active") throw new ConvexError("Link not found");
    if (!(await isCircleAdmin(ctx, link.patientUserId, user._id))) throw new ConvexError("Not allowed");
    await ctx.db.patch(args.linkId, { access: args.access, updatedAt: Date.now() });
  },
});

// ─── named external access codes ─────────────────────────────────────────────────────────────

export const createAccessCode = mutation({
  args: {
    ...legacyAuthArgs,
    patientUserId: v.id("users"),
    label: v.string(),
    kind: v.optional(v.union(v.literal("caregiver"), v.literal("child"))),
    permissions: v.optional(carePermissionsPayload),
    access: v.optional(careAccessPayload),
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    if (!(await isCircleAdmin(ctx, args.patientUserId, user._id))) throw new ConvexError("Not allowed");
    const label = args.label.trim();
    if (!label) throw new ConvexError("Give this code a name (who it's for)");
    const kind = args.kind ?? "caregiver";
    // A child (the patient's own kid on their phone) gets full-ish defaults the parent then trims;
    // a caregiver defaults to view-only.
    const defaultPermissions = kind === "child" ? FULL_CARE_PERMISSIONS : VIEWER_CARE_PERMISSIONS;
    const now = Date.now();
    const code = await generateUniqueCode(ctx);
    const id = await ctx.db.insert("careAccessCodes", {
      patientUserId: args.patientUserId,
      code,
      label,
      kind,
      permissions: args.permissions ?? { ...defaultPermissions },
      access: args.access ?? { mode: "always" },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { id, code };
  },
});

export const updateAccessCode = mutation({
  args: {
    ...legacyAuthArgs,
    codeId: v.id("careAccessCodes"),
    label: v.optional(v.string()),
    permissions: v.optional(carePermissionsPayload),
    access: v.optional(careAccessPayload),
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const row = await ctx.db.get(args.codeId);
    if (!row || row.status !== "active") throw new ConvexError("Code not found");
    if (!(await isCircleAdmin(ctx, row.patientUserId, user._id))) throw new ConvexError("Not allowed");
    await ctx.db.patch(args.codeId, {
      ...(args.label != null && args.label.trim() ? { label: args.label.trim() } : {}),
      ...(args.permissions ? { permissions: args.permissions } : {}),
      ...(args.access ? { access: args.access } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const retireAccessCode = mutation({
  args: { ...legacyAuthArgs, codeId: v.id("careAccessCodes") },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const row = await ctx.db.get(args.codeId);
    if (!row) return;
    if (!(await isCircleAdmin(ctx, row.patientUserId, user._id))) throw new ConvexError("Not allowed");
    if (row.status === "active") {
      await ctx.db.patch(args.codeId, { status: "retired", retiredAt: Date.now(), updatedAt: Date.now() });
    }
  },
});

/** Best-effort usage stamp, called by an external-guardian device when it starts a session. */
export const touchAccessCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = normalizeCareCode(args.code);
    const row = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (row && row.status === "active") await ctx.db.patch(row._id, { lastUsedAt: Date.now() });
  },
});

// ─── dependent (parent-kid) mode ─────────────────────────────────────────────────────────────

export const setDependentMode = mutation({
  args: {
    ...legacyAuthArgs,
    patientUserId: v.id("users"),
    enabled: v.boolean(),
    devicePermissions: v.optional(carePermissionsPayload),
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const isSelf = user._id === args.patientUserId;
    const isCoGuardian = (await activeLinkFor(ctx, args.patientUserId, user._id)) !== null;
    if (!isSelf && !isCoGuardian) throw new ConvexError("Not allowed");
    const existing = await getSettings(ctx, args.patientUserId);
    const current = settingsOrDefault(existing);
    // The kid account cannot flip control back to itself while dependent mode is on.
    if (current.dependentMode && isSelf && !isCoGuardian && args.enabled === false) {
      throw new ConvexError("A co-guardian must turn off parent-kid mode");
    }
    if (args.enabled) {
      const links = await activeCoGuardianLinks(ctx, args.patientUserId);
      if (links.length === 0) {
        throw new ConvexError("Link at least one co-guardian before enabling parent-kid mode");
      }
    }
    const doc = {
      patientUserId: args.patientUserId,
      dependentMode: args.enabled,
      devicePermissions: args.devicePermissions ?? current.devicePermissions,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("careSettings", doc);
  },
});

// ─── shared circle settings (co-guardian inheritance) ────────────────────────────────────────
// When accounts link as co-guardians they merge care: the circle OWNER's settings are the one
// live copy every member's app reads and every tool uses. Members may edit the "anyone" subset
// (child identity, doctor office info) in place; the safety-critical subset (weight, insulin
// settings, dose math, alert thresholds, doctor-code rotation) stays owner-only. The quick-meals
// list and emergency contacts are a mutual pool on `careShared`.

/** Shared profile fields a co-guardian may edit (writes land on the owner's profile). */
const sharedProfilePatchPayload = v.object({
  childName: v.optional(v.string()),
  childLastName: v.optional(v.string()),
  diabetesType: v.optional(v.union(v.literal("type1"), v.literal("type2"), v.literal("other"))),
  dateOfBirth: v.optional(v.string()),
  doctorName: v.optional(v.string()),
  doctorEmail: v.optional(v.string()),
  doctorPhone: v.optional(v.string()),
  doctorInstitution: v.optional(v.string()),
  // Owner-only below — accepted in the payload so the owner can use the same mutation, but a
  // non-owner sending any of them is rejected.
  weightLbs: v.optional(v.number()),
  insulinTypes: v.optional(v.array(v.string())),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  doseSettingsByTime: v.optional(doseSettingsByTime),
});

const OWNER_ONLY_PROFILE_FIELDS = [
  "dateOfBirth",
  "weightLbs",
  "insulinTypes",
  "carbRatio",
  "targetGlucose",
  "correctionFactor",
  "doseSettingsByTime",
] as const;

const emergencyContactPayload = v.object({
  id: v.string(),
  name: v.string(),
  phone: v.string(),
  relation: v.string(),
  /** The ONE contact the emergency banner's one-tap text targets (at most one per circle). */
  primary: v.optional(v.boolean()),
});

const MAX_EMERGENCY_CONTACTS = 5;
const MAX_QUICK_FOODS = 12;

/** The circle bucket a caller's shared settings resolve to (owner's account, or self when solo). */
async function circleAnchorFor(
  ctx: QueryCtx | MutationCtx,
  callerUserId: Id<"users">,
): Promise<{ anchor: Id<"users">; isOwner: boolean }> {
  const membership = await ctx.db
    .query("careLinks")
    .withIndex("by_member", (q) => q.eq("memberUserId", callerUserId).eq("status", "active"))
    .first();
  return membership
    ? { anchor: membership.patientUserId, isOwner: false }
    : { anchor: callerUserId, isOwner: true };
}

async function getCareSharedRow(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db
    .query("careShared")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .unique();
}

/**
 * Everything a device needs to render its circle-inherited state, in one call polled alongside
 * logs: who the anchor is, the owner's shared profile fields (members only — an owner's own
 * profile is already the source of truth), and the mutual quick-meals + emergency-contact pool.
 */
export const circleContext = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const { anchor, isOwner } = await circleAnchorFor(ctx, user._id);
    const pool = await getCareSharedRow(ctx, anchor);

    let shared: null | Record<string, unknown> = null;
    let ownerName = "";
    if (!isOwner) {
      ownerName = await displayNameFor(ctx, anchor);
      const row = await ctx.db
        .query("patientProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", anchor))
        .unique();
      if (row) {
        shared = {
          childName: row.childName,
          childLastName: row.childLastName,
          diabetesType: row.diabetesType,
          dateOfBirth: row.dateOfBirth,
          weightLbs: row.weightLbs,
          doctorName: row.doctorName,
          doctorEmail: row.doctorEmail,
          doctorPhone: row.doctorPhone,
          doctorInstitution: row.doctorInstitution,
          insulinTypes: row.insulinTypes,
          carbRatio: row.carbRatio,
          targetGlucose: row.targetGlucose,
          correctionFactor: row.correctionFactor,
          doseSettingsByTime: row.doseSettingsByTime,
          alertPreferences: row.alertPreferences,
          // Same doctor office, same code: a member's app syncs to the owner's portal thread.
          doctorCode: row.doctorCode,
          doctorCodeIssuedAt: row.doctorCodeIssuedAt,
        };
      }
    }

    return {
      anchorPatientUserId: anchor,
      isOwner,
      ownerName,
      shared,
      quickFoods: pool?.quickFoods ?? null,
      emergencyContacts: pool?.emergencyContacts ?? null,
    };
  },
});

/**
 * Edit shared profile fields in place on the circle owner's profile. Owner may change anything in
 * the payload; a member is limited to the "anyone" subset — the owner-only fields (weight, insulin
 * types, dose math) are rejected so no co-guardian can quietly change the dosing ground truth.
 */
export const updateSharedProfile = mutation({
  args: { ...legacyAuthArgs, patch: sharedProfilePatchPayload },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const { anchor, isOwner } = await circleAnchorFor(ctx, user._id);
    /**
     * Owner-only fields are FATAL for the whole patch — deliberately fail-closed.
     *
     * A partial write would be worse than a rejection here: the caller would be told the save failed
     * while some fields had in fact changed. So this stays loud, and the CLIENT is responsible for not
     * sending owner-locked fields from a member session (see `splitSharedProfilePatch`). This throw is
     * the backstop for a client bug, not the everyday path.
     */
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.patch)) {
      if (value === undefined) continue;
      if (!isOwner && (OWNER_ONLY_PROFILE_FIELDS as readonly string[]).includes(key)) {
        throw new ConvexError("Only the circle owner can change this setting");
      }
      patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return;
    const row = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", anchor))
      .unique();
    if (!row) throw new ConvexError("The circle owner hasn't finished setting up their profile");
    await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
  },
});

/** Replace the circle's Quick Lookup meals list (mutual: any guardian may update it). */
export const setQuickFoods = mutation({
  args: { ...legacyAuthArgs, foods: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const { anchor } = await circleAnchorFor(ctx, user._id);
    const foods = args.foods.map((f) => f.trim()).filter(Boolean).slice(0, MAX_QUICK_FOODS);
    const existing = await getCareSharedRow(ctx, anchor);
    if (existing) await ctx.db.patch(existing._id, { quickFoods: foods, updatedAt: Date.now() });
    else await ctx.db.insert("careShared", { patientUserId: anchor, quickFoods: foods, updatedAt: Date.now() });
  },
});

/** Add to the circle's mutual emergency-contact pool (idempotent by contact id, capped). */
export const addSharedEmergencyContact = mutation({
  args: { ...legacyAuthArgs, contact: emergencyContactPayload },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const { anchor } = await circleAnchorFor(ctx, user._id);
    const existing = await getCareSharedRow(ctx, anchor);
    const contacts = existing?.emergencyContacts ?? [];
    if (contacts.some((c) => c.id === args.contact.id)) return; // idempotent re-send, not a failure
    // A bare `return` here reported SUCCESS while silently discarding the contact — for
    // safety-critical data whose whole purpose is being reachable in an emergency. Fail loudly so the
    // caller can tell the user; the client also checks the cap first so this is the backstop.
    if (contacts.length >= MAX_EMERGENCY_CONTACTS) {
      throw new ConvexError(
        `You can have at most ${MAX_EMERGENCY_CONTACTS} emergency contacts. Remove one first.`,
      );
    }
    const next = [...contacts, args.contact];
    if (existing) await ctx.db.patch(existing._id, { emergencyContacts: next, updatedAt: Date.now() });
    else await ctx.db.insert("careShared", { patientUserId: anchor, emergencyContacts: next, updatedAt: Date.now() });
  },
});

/**
 * Mark ONE contact as the one-tap emergency text target (radio semantics: setting a contact clears
 * every other; null clears all). Enforced server-side so no client can produce two primaries.
 */
export const setPrimaryEmergencyContact = mutation({
  args: { ...legacyAuthArgs, contactId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const { anchor } = await circleAnchorFor(ctx, user._id);
    const existing = await getCareSharedRow(ctx, anchor);
    if (!existing?.emergencyContacts) return;
    await ctx.db.patch(existing._id, {
      emergencyContacts: existing.emergencyContacts.map((c) => ({
        ...c,
        primary: args.contactId != null && c.id === args.contactId ? true : undefined,
      })),
      updatedAt: Date.now(),
    });
  },
});

export const removeSharedEmergencyContact = mutation({
  args: { ...legacyAuthArgs, contactId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const { anchor } = await circleAnchorFor(ctx, user._id);
    const existing = await getCareSharedRow(ctx, anchor);
    if (!existing?.emergencyContacts) return;
    await ctx.db.patch(existing._id, {
      emergencyContacts: existing.emergencyContacts.filter((c) => c.id !== args.contactId),
      updatedAt: Date.now(),
    });
  },
});

/**
 * One-time seed of the contact pool from a device's pre-cloud local list. Owner-only and only
 * while the pool is empty — a joining member's old local contacts must never overwrite the
 * owner's pool (on join, the owner's list IS the list).
 */
export const importSharedEmergencyContacts = mutation({
  args: { ...legacyAuthArgs, contacts: v.array(emergencyContactPayload) },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const { anchor, isOwner } = await circleAnchorFor(ctx, user._id);
    if (!isOwner) return;
    const existing = await getCareSharedRow(ctx, anchor);
    if (existing?.emergencyContacts && existing.emergencyContacts.length > 0) return;
    const contacts = args.contacts.slice(0, MAX_EMERGENCY_CONTACTS);
    if (contacts.length === 0) return;
    if (existing) await ctx.db.patch(existing._id, { emergencyContacts: contacts, updatedAt: Date.now() });
    else await ctx.db.insert("careShared", { patientUserId: anchor, emergencyContacts: contacts, updatedAt: Date.now() });
  },
});

// ─── circle queries ──────────────────────────────────────────────────────────────────────────

/** Full circle view for the panel — admins and the patient account itself (read-only for a kid). */
export const getCircle = query({
  args: { ...legacyAuthArgs, patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const isSelf = user._id === args.patientUserId;
    const admin = await isCircleAdmin(ctx, args.patientUserId, user._id);
    const isCoGuardian = (await activeLinkFor(ctx, args.patientUserId, user._id)) !== null;
    if (!isSelf && !admin && !isCoGuardian) return null;

    const now = Date.now();
    const settings = settingsOrDefault(await getSettings(ctx, args.patientUserId));
    const links = await activeCoGuardianLinks(ctx, args.patientUserId);
    const patientProfile = await slimPatientProfile(ctx, args.patientUserId);
    const invites = await ctx.db
      .query("careInvites")
      .withIndex("by_patient", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "pending"))
      .collect();
    const codes = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_patient", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "active"))
      .collect();

    // Unified peer list — the circle owner (Dexcom/patient account) and every active co-guardian are
    // equal members of ONE shared circle, so both sides render the same roster. The owner has no
    // linkId (they can't be "removed") and always has open access.
    const okAccess = evaluateCareAccess({ mode: "always" }, now);
    const guardians = [
      {
        userId: args.patientUserId,
        displayName: await displayNameFor(ctx, args.patientUserId),
        isMe: args.patientUserId === user._id,
        isOwner: true,
        linkId: null as Id<"careLinks"> | null,
        accessState: okAccess,
      },
      ...links.map((l) => ({
        userId: l.memberUserId,
        displayName: l.displayName,
        isMe: l.memberUserId === user._id,
        isOwner: false,
        linkId: l._id as Id<"careLinks"> | null,
        accessState: evaluateCareAccess(l.access as CareAccess, now),
      })),
    ];

    return {
      isAdmin: admin,
      settings,
      patientUserId: args.patientUserId,
      patientName: patientProfile?.childName ?? "Patient",
      /** Owner + co-guardians as equal peers (owner first). `MAX_GUARDIANS_TOTAL` is the cap incl. owner. */
      guardians,
      maxGuardians: MAX_GUARDIANS_TOTAL,
      coGuardians: links.map((l) => ({
        linkId: l._id,
        memberUserId: l.memberUserId,
        displayName: l.displayName,
        permissions: l.permissions,
        access: l.access,
        accessState: evaluateCareAccess(l.access as CareAccess, now),
        isMe: l.memberUserId === user._id,
        createdAt: l.createdAt,
      })),
      pendingInvites: invites
        .filter((i) => i.expiresAt > now)
        .map((i) => ({ inviteId: i._id, code: i.code, expiresAt: i.expiresAt })),
      accessCodes: codes.map((c) => ({
        codeId: c._id,
        code: c.code,
        label: c.label,
        kind: c.kind ?? ("caregiver" as const),
        permissions: c.permissions,
        access: c.access,
        accessState: evaluateCareAccess(c.access as CareAccess, now),
        lastUsedAt: c.lastUsedAt,
        createdAt: c.createdAt,
      })),
    };
  },
});

/**
 * Invitations addressed to me (from the "found a matching account, invite them" flow) that I can
 * accept in-app. This is the inbound side of a directed invite — no code sharing required. Stale,
 * already-linked, or full-circle invites are filtered out so the list only shows actionable requests.
 */
export const incomingInvites = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return [];
    const invites = await ctx.db
      .query("careInvites")
      .withIndex("by_target", (q) => q.eq("targetUserId", user._id).eq("status", "pending"))
      .collect();
    const now = Date.now();
    const out = [];
    for (const invite of invites) {
      if (invite.expiresAt <= now) continue;
      if (await activeLinkFor(ctx, invite.patientUserId, user._id)) continue;
      const links = await activeCoGuardianLinks(ctx, invite.patientUserId);
      if (links.length >= MAX_CO_GUARDIANS) continue;
      const patient = await slimPatientProfile(ctx, invite.patientUserId);
      out.push({
        inviteId: invite._id,
        code: invite.code,
        patientUserId: invite.patientUserId,
        patientName: patient?.childName ?? "Patient",
        invitedByName: await displayNameFor(ctx, invite.createdByUserId),
        expiresAt: invite.expiresAt,
      });
    }
    return out;
  },
});

/** The circles I belong to as a co-guardian (drives "viewing Bella" mode on my device). */
export const myMemberships = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return [];
    const links = await ctx.db
      .query("careLinks")
      .withIndex("by_member", (q) => q.eq("memberUserId", user._id).eq("status", "active"))
      .collect();
    const now = Date.now();
    const out = [];
    for (const link of links) {
      const patient = await slimPatientProfile(ctx, link.patientUserId);
      const settings = settingsOrDefault(await getSettings(ctx, link.patientUserId));
      out.push({
        linkId: link._id,
        patientUserId: link.patientUserId,
        patientName: patient?.childName ?? "Patient",
        permissions: link.permissions,
        access: link.access,
        accessState: evaluateCareAccess(link.access as CareAccess, now),
        dependentMode: settings.dependentMode,
      });
    }
    return out;
  },
});

/** What the patient's own device may do (kid restrictions when dependentMode is on). */
export const myDeviceSettings = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const settings = settingsOrDefault(await getSettings(ctx, user._id));
    return settings;
  },
});

// ─── same-sensor discovery ────────────────────────────────────────────────────────────────────

/**
 * Other accounts whose Dexcom credentials use the same username as the caller's — evidence they
 * share one sensor (e.g. a parent and kid). Surfaced manually from Care Circle (never a popup).
 * Returns the full email (these accounts demonstrably share the caller's own Dexcom login, and the
 * user needs to see it to pick the right person). Flags accounts already linked to the caller.
 */
export const findSharedSensorAccounts = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const mine = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    // Match on the actual Dexcom username (server-only) so this works regardless of whether the
    // indexed `usernameKey` has been backfilled — no reconnect required.
    const key = (mine?.usernameKey ?? mine?.dexcomUsername ?? "").trim().toLowerCase();
    if (!key) {
      return { hasCredentials: !!mine, matches: [] as { userId: Id<"users">; email: string; name: string; alreadyLinked: boolean }[] };
    }
    const all = await ctx.db.query("patientDexcomCredentials").collect();

    const matches: { userId: Id<"users">; email: string; name: string; alreadyLinked: boolean }[] = [];
    for (const row of all) {
      if (row.userId === user._id) continue;
      const rowKey = (row.usernameKey ?? row.dexcomUsername ?? "").trim().toLowerCase();
      if (rowKey !== key) continue;
      const matchUser = await ctx.db.get(row.userId);
      if (!matchUser) continue;
      const profile = await ctx.db
        .query("patientProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", row.userId))
        .unique();
      const linked =
        (await activeLinkFor(ctx, user._id, row.userId)) != null ||
        (await activeLinkFor(ctx, row.userId, user._id)) != null;
      matches.push({
        userId: row.userId,
        email: matchUser.email,
        name: profile?.childName?.trim() || "Glucose Guardian user",
        alreadyLinked: linked,
      });
    }
    return { hasCredentials: true, matches };
  },
});

// ─── member data access (link-authorized) ────────────────────────────────────────────────────

async function requireViewableLink(
  ctx: QueryCtx,
  memberUserId: Id<"users">,
  patientUserId: Id<"users">,
) {
  const link = await activeLinkFor(ctx, patientUserId, memberUserId);
  if (!link || !link.permissions.viewReadings) return null;
  if (!careAccessAllowed(link.access as CareAccess, Date.now())) return null;
  return link;
}

export const glucoseForLink = query({
  args: {
    ...legacyAuthArgs,
    patientUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return [];
    const link = await requireViewableLink(ctx, user._id, args.patientUserId);
    if (!link) return [];
    return await readRecentGlucose(ctx, args.patientUserId, args.limit);
  },
});

export const profileForLink = query({
  args: { ...legacyAuthArgs, patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const link = await requireViewableLink(ctx, user._id, args.patientUserId);
    if (!link) return null;
    return await slimPatientProfile(ctx, args.patientUserId);
  },
});

// ─── external-guardian data access (code-authorized) ─────────────────────────────────────────

async function resolveActiveAccessCode(ctx: QueryCtx, rawCode: string) {
  const code = normalizeCareCode(rawCode);
  if (code.length !== CODE_LENGTH) return null;
  const row = await ctx.db
    .query("careAccessCodes")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
  if (!row || row.status !== "active") return null;
  return row;
}

/**
 * Day-scoped glucose for a linked co-guardian's viewing mode — the Log tab's per-day pager. Same
 * auth as `glucoseForLink`; added because day browsing previously fell back to the ~300-reading
 * in-memory overlay, capping history at about a day for anyone viewing another patient.
 */
export const listForDayRangeForLink = query({
  args: {
    ...legacyAuthArgs,
    patientUserId: v.id("users"),
    startTimestamp: v.string(),
    endTimestamp: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return [];
    const link = await requireViewableLink(ctx, user._id, args.patientUserId);
    if (!link) return [];
    const lim = Math.min(Math.max(args.limit ?? GLUCOSE_DEFAULT_LIMIT, 1), GLUCOSE_MAX_LIMIT);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", args.patientUserId)
          .gte("timestamp", args.startTimestamp)
          .lt("timestamp", args.endTimestamp),
      )
      .order("asc")
      .take(lim);
    return rows.map((r) => ({
      glucose: r.glucose,
      timestamp: r.timestamp,
      anomaly: r.anomaly,
      dexcomTrend: r.dexcomTrend,
    }));
  },
});

/** Session bootstrap for an external-guardian device: who am I viewing, what may I do, am I in-window. */
export const resolveAccessCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) return null;
    const patient = await slimPatientProfile(ctx, row.patientUserId);
    return {
      label: row.label,
      kind: row.kind ?? ("caregiver" as const),
      patientName: patient?.childName ?? "Patient",
      permissions: row.permissions,
      access: row.access,
      accessState: evaluateCareAccess(row.access as CareAccess, Date.now()),
    };
  },
});

export const glucoseForAccessCode = query({
  args: { code: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) return [];
    if (!row.permissions.viewReadings) return [];
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return [];
    return await readRecentGlucose(ctx, row.patientUserId, args.limit);
  },
});

/**
 * Day-scoped glucose for a new (8-char) access-code session — the Log tab's per-day graph. Same
 * view-readings + schedule gating as glucoseForAccessCode; lets a kid/caregiver page back through
 * days like an owner (the legacy patientGlucose.listForDayRangeForCaregiver is 6-char codes only).
 */
export const listForDayRangeForAccessCode = query({
  args: {
    code: v.string(),
    startTimestamp: v.string(),
    endTimestamp: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) return [];
    if (!row.permissions.viewReadings) return [];
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return [];
    const lim = Math.min(Math.max(args.limit ?? GLUCOSE_DEFAULT_LIMIT, 1), GLUCOSE_MAX_LIMIT);
    const rows = await ctx.db
      .query("patientGlucoseReadings")
      .withIndex("by_user_time", (q) =>
        q
          .eq("userId", row.patientUserId)
          .gte("timestamp", args.startTimestamp)
          .lt("timestamp", args.endTimestamp),
      )
      .order("asc")
      .take(lim);
    return rows.map((r) => ({
      glucose: r.glucose,
      timestamp: r.timestamp,
      anomaly: r.anomaly,
      dexcomTrend: r.dexcomTrend,
    }));
  },
});

export const profileForAccessCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) return null;
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    const slim = await slimPatientProfile(ctx, row.patientUserId);
    if (!slim) return null;
    // The circle's shared emergency-contact pool — a caregiver inherits it read-only for this child.
    const shared = await ctx.db
      .query("careShared")
      .withIndex("by_patient", (q) => q.eq("patientUserId", row.patientUserId))
      .unique();
    return { ...slim, emergencyContacts: shared?.emergencyContacts ?? [] };
  },
});
