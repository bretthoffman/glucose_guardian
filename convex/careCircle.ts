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
import { v } from "convex/values";
import {
  FULL_CARE_PERMISSIONS,
  VIEWER_CARE_PERMISSIONS,
  careAccessAllowed,
  evaluateCareAccess,
  type CareAccess,
  type CarePermissions,
} from "./careSchedule";

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
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
/** No lookalike characters (I/O/0/1). 8 chars ≈ 1.1e12 combinations. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
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
  throw new Error("Could not generate a unique code — try again");
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
  const link = await ctx.db
    .query("careLinks")
    .withIndex("by_patient_member", (q) =>
      q.eq("patientUserId", patientUserId).eq("memberUserId", memberUserId),
    )
    .first();
  return link && link.status === "active" ? link : null;
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
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    if (!(await isCircleAdmin(ctx, args.patientUserId, args.userId))) throw new Error("Not allowed");
    const links = await activeCoGuardianLinks(ctx, args.patientUserId);
    if (links.length >= MAX_CO_GUARDIANS) {
      throw new Error(`This care circle already has ${MAX_CO_GUARDIANS} co-guardians`);
    }
    const now = Date.now();
    const code = await generateUniqueCode(ctx);
    await ctx.db.insert("careInvites", {
      patientUserId: args.patientUserId,
      code,
      role: "co_guardian",
      presetPermissions: { ...FULL_CARE_PERMISSIONS },
      presetAccess: { mode: "always" },
      createdByUserId: args.userId,
      expiresAt: now + INVITE_TTL_MS,
      status: "pending",
      createdAt: now,
    });
    return { code, expiresAt: now + INVITE_TTL_MS };
  },
});

export const cancelInvite = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), inviteId: v.id("careInvites") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const invite = await ctx.db.get(args.inviteId);
    if (!invite) return;
    if (!(await isCircleAdmin(ctx, invite.patientUserId, args.userId))) throw new Error("Not allowed");
    if (invite.status === "pending") await ctx.db.patch(args.inviteId, { status: "cancelled" });
  },
});

export const redeemInvite = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const code = normalizeCareCode(args.code);
    const invite = await ctx.db
      .query("careInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!invite || invite.status !== "pending") throw new Error("Invalid or already-used invite code");
    if (Date.now() > invite.expiresAt) throw new Error("This invite code has expired");
    if (invite.patientUserId === args.userId) throw new Error("You cannot join your own care circle");

    const existing = await activeLinkFor(ctx, invite.patientUserId, args.userId);
    if (existing) throw new Error("You are already in this care circle");
    const links = await activeCoGuardianLinks(ctx, invite.patientUserId);
    if (links.length >= MAX_CO_GUARDIANS) {
      throw new Error(`This care circle already has ${MAX_CO_GUARDIANS} co-guardians`);
    }

    const now = Date.now();
    const displayName = await displayNameFor(ctx, args.userId);
    await ctx.db.insert("careLinks", {
      patientUserId: invite.patientUserId,
      memberUserId: args.userId,
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
      redeemedByUserId: args.userId,
      redeemedAt: now,
    });
    const patient = await slimPatientProfile(ctx, invite.patientUserId);
    return { patientUserId: invite.patientUserId, patientName: patient?.childName ?? "Patient" };
  },
});

// ─── links (co-guardians) ────────────────────────────────────────────────────────────────────

export const revokeLink = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), linkId: v.id("careLinks") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const link = await ctx.db.get(args.linkId);
    if (!link || link.status !== "active") return;
    const isMemberLeaving = link.memberUserId === args.userId;
    if (!isMemberLeaving && !(await isCircleAdmin(ctx, link.patientUserId, args.userId))) {
      throw new Error("Not allowed");
    }
    // In dependent mode the last co-guardian cannot be removed — the circle would have no admin.
    const settings = settingsOrDefault(await getSettings(ctx, link.patientUserId));
    if (settings.dependentMode) {
      const links = await activeCoGuardianLinks(ctx, link.patientUserId);
      if (links.length <= 1) {
        throw new Error("Turn off parent-kid mode before removing the last co-guardian");
      }
    }
    await ctx.db.patch(args.linkId, {
      status: "revoked",
      revokedAt: Date.now(),
      revokedBy: isMemberLeaving ? "member" : "patient_side",
      updatedAt: Date.now(),
    });
  },
});

export const setLinkPermissions = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    linkId: v.id("careLinks"),
    permissions: carePermissionsPayload,
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const link = await ctx.db.get(args.linkId);
    if (!link || link.status !== "active") throw new Error("Link not found");
    if (!(await isCircleAdmin(ctx, link.patientUserId, args.userId))) throw new Error("Not allowed");
    await ctx.db.patch(args.linkId, { permissions: args.permissions, updatedAt: Date.now() });
  },
});

export const setLinkAccess = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    linkId: v.id("careLinks"),
    access: careAccessPayload,
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const link = await ctx.db.get(args.linkId);
    if (!link || link.status !== "active") throw new Error("Link not found");
    if (!(await isCircleAdmin(ctx, link.patientUserId, args.userId))) throw new Error("Not allowed");
    await ctx.db.patch(args.linkId, { access: args.access, updatedAt: Date.now() });
  },
});

// ─── named external access codes ─────────────────────────────────────────────────────────────

export const createAccessCode = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    patientUserId: v.id("users"),
    label: v.string(),
    kind: v.optional(v.union(v.literal("caregiver"), v.literal("child"))),
    permissions: v.optional(carePermissionsPayload),
    access: v.optional(careAccessPayload),
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    if (!(await isCircleAdmin(ctx, args.patientUserId, args.userId))) throw new Error("Not allowed");
    const label = args.label.trim();
    if (!label) throw new Error("Give this code a name (who it's for)");
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
    userId: v.id("users"),
    passwordHash: v.string(),
    codeId: v.id("careAccessCodes"),
    label: v.optional(v.string()),
    permissions: v.optional(carePermissionsPayload),
    access: v.optional(careAccessPayload),
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const row = await ctx.db.get(args.codeId);
    if (!row || row.status !== "active") throw new Error("Code not found");
    if (!(await isCircleAdmin(ctx, row.patientUserId, args.userId))) throw new Error("Not allowed");
    await ctx.db.patch(args.codeId, {
      ...(args.label != null && args.label.trim() ? { label: args.label.trim() } : {}),
      ...(args.permissions ? { permissions: args.permissions } : {}),
      ...(args.access ? { access: args.access } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const retireAccessCode = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), codeId: v.id("careAccessCodes") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const row = await ctx.db.get(args.codeId);
    if (!row) return;
    if (!(await isCircleAdmin(ctx, row.patientUserId, args.userId))) throw new Error("Not allowed");
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
    userId: v.id("users"),
    passwordHash: v.string(),
    patientUserId: v.id("users"),
    enabled: v.boolean(),
    devicePermissions: v.optional(carePermissionsPayload),
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const isSelf = args.userId === args.patientUserId;
    const isCoGuardian = (await activeLinkFor(ctx, args.patientUserId, args.userId)) !== null;
    if (!isSelf && !isCoGuardian) throw new Error("Not allowed");
    const existing = await getSettings(ctx, args.patientUserId);
    const current = settingsOrDefault(existing);
    // The kid account cannot flip control back to itself while dependent mode is on.
    if (current.dependentMode && isSelf && !isCoGuardian && args.enabled === false) {
      throw new Error("A co-guardian must turn off parent-kid mode");
    }
    if (args.enabled) {
      const links = await activeCoGuardianLinks(ctx, args.patientUserId);
      if (links.length === 0) {
        throw new Error("Link at least one co-guardian before enabling parent-kid mode");
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

// ─── circle queries ──────────────────────────────────────────────────────────────────────────

/** Full circle view for the panel — admins and the patient account itself (read-only for a kid). */
export const getCircle = query({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    const isSelf = args.userId === args.patientUserId;
    const admin = await isCircleAdmin(ctx, args.patientUserId, args.userId);
    const isCoGuardian = (await activeLinkFor(ctx, args.patientUserId, args.userId)) !== null;
    if (!isSelf && !admin && !isCoGuardian) return null;

    const now = Date.now();
    const settings = settingsOrDefault(await getSettings(ctx, args.patientUserId));
    const links = await activeCoGuardianLinks(ctx, args.patientUserId);
    const invites = await ctx.db
      .query("careInvites")
      .withIndex("by_patient", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "pending"))
      .collect();
    const codes = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_patient", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "active"))
      .collect();

    return {
      isAdmin: admin,
      settings,
      coGuardians: links.map((l) => ({
        linkId: l._id,
        memberUserId: l.memberUserId,
        displayName: l.displayName,
        permissions: l.permissions,
        access: l.access,
        accessState: evaluateCareAccess(l.access as CareAccess, now),
        isMe: l.memberUserId === args.userId,
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

/** The circles I belong to as a co-guardian (drives "viewing Bella" mode on my device). */
export const myMemberships = query({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return [];
    const links = await ctx.db
      .query("careLinks")
      .withIndex("by_member", (q) => q.eq("memberUserId", args.userId).eq("status", "active"))
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
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    const settings = settingsOrDefault(await getSettings(ctx, args.userId));
    return settings;
  },
});

// ─── same-sensor discovery ────────────────────────────────────────────────────────────────────

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  return `${head}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

/**
 * Other accounts whose Dexcom credentials use the same username as the caller's — evidence they
 * share one sensor (e.g. a parent and kid). Surfaced manually from Care Circle (never a popup).
 * Returns masked identifiers only; flags accounts already linked to the caller.
 */
export const findSharedSensorAccounts = query({
  args: { userId: v.id("users"), passwordHash: v.string() },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    const mine = await ctx.db
      .query("patientDexcomCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    // Match on the actual Dexcom username (server-only) so this works regardless of whether the
    // indexed `usernameKey` has been backfilled — no reconnect required.
    const key = (mine?.usernameKey ?? mine?.dexcomUsername ?? "").trim().toLowerCase();
    if (!key) {
      return { hasCredentials: !!mine, matches: [] as { userId: Id<"users">; maskedEmail: string; name: string; alreadyLinked: boolean }[] };
    }
    const all = await ctx.db.query("patientDexcomCredentials").collect();

    const matches: { userId: Id<"users">; maskedEmail: string; name: string; alreadyLinked: boolean }[] = [];
    for (const row of all) {
      if (row.userId === args.userId) continue;
      const rowKey = (row.usernameKey ?? row.dexcomUsername ?? "").trim().toLowerCase();
      if (rowKey !== key) continue;
      const user = await ctx.db.get(row.userId);
      if (!user) continue;
      const profile = await ctx.db
        .query("patientProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", row.userId))
        .unique();
      const linked =
        (await activeLinkFor(ctx, args.userId, row.userId)) != null ||
        (await activeLinkFor(ctx, row.userId, args.userId)) != null;
      matches.push({
        userId: row.userId,
        maskedEmail: maskEmail(user.email),
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
  passwordHash: string,
  patientUserId: Id<"users">,
) {
  if (!(await assertPatientAuth(ctx, memberUserId, passwordHash))) return null;
  const link = await activeLinkFor(ctx, patientUserId, memberUserId);
  if (!link || !link.permissions.viewReadings) return null;
  if (!careAccessAllowed(link.access as CareAccess, Date.now())) return null;
  return link;
}

export const glucoseForLink = query({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    patientUserId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const link = await requireViewableLink(ctx, args.userId, args.passwordHash, args.patientUserId);
    if (!link) return [];
    return await readRecentGlucose(ctx, args.patientUserId, args.limit);
  },
});

export const profileForLink = query({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    const link = await requireViewableLink(ctx, args.userId, args.passwordHash, args.patientUserId);
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

export const profileForAccessCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row) return null;
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    return await slimPatientProfile(ctx, row.patientUserId);
  },
});
