/**
 * Care Circle shared log bucket (Phase 2) — the authored food/insulin log every circle member
 * writes to and every viewer reads. See CARE_CIRCLE_ROLES_AUDIT_01.md §2.6.
 *
 * Authorization mirrors careCircle.ts: a caller may write/read a patient's logs when they ARE the
 * patient (subject to kid-device restrictions in dependent mode), an active co-guardian with the
 * relevant grant + open schedule, or an external access code with the grant + open schedule.
 * `clientId` (the device-generated entry id) is the idempotency key so migration and retries never
 * duplicate.
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { careAccessAllowed, type CareAccess } from "./careSchedule";

const FOOD_CAP = 200;
const INSULIN_CAP = 500;

const foodEntryPayload = v.object({
  clientId: v.string(),
  timestamp: v.string(),
  foodName: v.string(),
  estimatedCarbs: v.number(),
  insulinUnits: v.number(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  fromPhoto: v.boolean(),
  photoUri: v.optional(v.string()),
});

const insulinEntryPayload = v.object({
  clientId: v.string(),
  timestamp: v.string(),
  units: v.number(),
  type: v.union(v.literal("bolus"), v.literal("correction"), v.literal("manual"), v.literal("basal")),
  note: v.optional(v.string()),
  foodLogId: v.optional(v.string()),
  insulinType: v.optional(v.string()),
  recommendedUnits: v.optional(v.number()),
  manualOverride: v.optional(v.boolean()),
});

// ─── auth helpers (kept local; small + self-contained) ───────────────────────────────────────

async function assertPatientAuth(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
): Promise<boolean> {
  const user = await ctx.db.get(userId);
  return user !== null && user.passwordHash === passwordHash;
}

function normalizeCareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function patientDisplayName(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">): Promise<string> {
  const profile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", patientUserId))
    .unique();
  return profile?.childName?.trim() || "Patient";
}

/**
 * The name to credit a LOG to for an account holder (`userId`). This is the guardian's own name —
 * never the child they care for, because in a co-guardian circle every guardian shares one child
 * name, so crediting logs to the child makes every byline identical (the "everything says Bella"
 * bug). Resolution: the guardian's own name (`parentName`) → for an adult-managing-own account the
 * person's own name lives in `childName` → else the email handle. A parent account with no name yet
 * deliberately falls back to the email handle, NOT the child's name.
 */
async function guardianDisplayName(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<string> {
  const profile = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  const parent = profile?.parentName?.trim();
  if (parent) return parent;
  // "Adult (myself)" and "caregiver" (nurse) accounts store the person's OWN name in childName —
  // there is no separate kid on those accounts.
  if (profile?.accountRole === "adult" || profile?.accountRole === "caregiver") {
    const own = profile.childName?.trim();
    if (own) return own;
  }
  const user = await ctx.db.get(userId);
  const handle = user?.email?.split("@")[0]?.trim();
  if (handle) return handle;
  // Legacy accounts with no role and no parent name — last resort only.
  return profile?.childName?.trim() || "Guardian";
}

interface WriteAuth {
  authorUserId?: Id<"users">;
  authorName: string;
}

/** Resolve whether `callerUserId` may WRITE logs to `patientUserId`, and under what byline. */
async function resolveAccountWriteAuth(
  ctx: QueryCtx | MutationCtx,
  callerUserId: Id<"users">,
  patientUserId: Id<"users">,
): Promise<WriteAuth | null> {
  if (callerUserId === patientUserId) {
    const settings = await ctx.db
      .query("careSettings")
      .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
      .unique();
    // In dependent mode the kid's own device may log only if granted; otherwise the patient always may.
    if (settings?.dependentMode && !settings.devicePermissions.log) return null;
    // Credit to the guardian who logged, not the child (their own account IS the circle owner).
    return { authorUserId: callerUserId, authorName: await guardianDisplayName(ctx, callerUserId) };
  }
  const link = await ctx.db
    .query("careLinks")
    .withIndex("by_patient_member", (q) =>
      q.eq("patientUserId", patientUserId).eq("memberUserId", callerUserId),
    )
    .first();
  if (!link || link.status !== "active") return null;
  if (!link.permissions.log) return null;
  if (!careAccessAllowed(link.access as CareAccess, Date.now())) return null;
  // Derive the co-guardian's name live from their own profile (not the join-time link snapshot, which
  // goes stale if they set/change their name after joining).
  return { authorUserId: callerUserId, authorName: await guardianDisplayName(ctx, callerUserId) };
}

/** Resolve whether `callerUserId` may READ `patientUserId`'s logs. */
async function resolveAccountReadAuth(
  ctx: QueryCtx,
  callerUserId: Id<"users">,
  patientUserId: Id<"users">,
): Promise<boolean> {
  if (callerUserId === patientUserId) return true;
  const link = await ctx.db
    .query("careLinks")
    .withIndex("by_patient_member", (q) =>
      q.eq("patientUserId", patientUserId).eq("memberUserId", callerUserId),
    )
    .first();
  if (!link || link.status !== "active") return false;
  if (!link.permissions.viewLogs) return false;
  return careAccessAllowed(link.access as CareAccess, Date.now());
}

async function resolveActiveAccessCode(ctx: QueryCtx | MutationCtx, rawCode: string) {
  const code = normalizeCareCode(rawCode);
  if (code.length !== 8) return null;
  const row = await ctx.db
    .query("careAccessCodes")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
  return row && row.status === "active" ? row : null;
}

/**
 * The shared log bucket a caller's "my logs" resolve to: their circle owner's bucket when they are
 * an active co-guardian, else their own. This is what makes linked accounts ONE log pool — every
 * read and write a member's device aims at itself is redirected here, so the calculator, the Logs
 * tab, and chat context all see the same merged stream on every guardian's phone (including app
 * builds that predate the linking feature).
 */
export async function circleBucketFor(
  ctx: QueryCtx | MutationCtx,
  callerUserId: Id<"users">,
): Promise<Id<"users">> {
  const membership = await ctx.db
    .query("careLinks")
    .withIndex("by_member", (q) => q.eq("memberUserId", callerUserId).eq("status", "active"))
    .first();
  return membership?.patientUserId ?? callerUserId;
}

// ─── pruning ─────────────────────────────────────────────────────────────────────────────────

async function pruneFood(ctx: MutationCtx, patientUserId: Id<"users">) {
  const rows = await ctx.db
    .query("careFoodLogs")
    .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
    .order("desc")
    .collect();
  for (const row of rows.slice(FOOD_CAP)) await ctx.db.delete(row._id);
}

async function pruneInsulin(ctx: MutationCtx, patientUserId: Id<"users">) {
  const rows = await ctx.db
    .query("careInsulinLogs")
    .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
    .order("desc")
    .collect();
  for (const row of rows.slice(INSULIN_CAP)) await ctx.db.delete(row._id);
}

// ─── insert helpers (idempotent on clientId) ─────────────────────────────────────────────────

async function upsertFood(
  ctx: MutationCtx,
  patientUserId: Id<"users">,
  auth: WriteAuth,
  entry: typeof foodEntryPayload.type,
) {
  const existing = await ctx.db
    .query("careFoodLogs")
    .withIndex("by_patient_client", (q) =>
      q.eq("patientUserId", patientUserId).eq("clientId", entry.clientId),
    )
    .first();
  if (existing) return; // idempotent — migration / retry safe
  await ctx.db.insert("careFoodLogs", {
    patientUserId,
    ...(auth.authorUserId ? { authorUserId: auth.authorUserId } : {}),
    authorName: auth.authorName,
    createdAt: Date.now(),
    ...entry,
  });
  await pruneFood(ctx, patientUserId);
}

async function upsertInsulin(
  ctx: MutationCtx,
  patientUserId: Id<"users">,
  auth: WriteAuth,
  entry: typeof insulinEntryPayload.type,
) {
  const existing = await ctx.db
    .query("careInsulinLogs")
    .withIndex("by_patient_client", (q) =>
      q.eq("patientUserId", patientUserId).eq("clientId", entry.clientId),
    )
    .first();
  if (existing) return;
  await ctx.db.insert("careInsulinLogs", {
    patientUserId,
    ...(auth.authorUserId ? { authorUserId: auth.authorUserId } : {}),
    authorName: auth.authorName,
    createdAt: Date.now(),
    ...entry,
  });
  await pruneInsulin(ctx, patientUserId);
}

/**
 * Join-time backfill: copy every log in `fromPatientUserId`'s bucket into `toPatientUserId`'s
 * bucket so a joining co-guardian's pre-link history (yesterday's meals, last week's doses) is
 * visible to the whole circle. Idempotent via clientId — safe to run on rejoin. Entries the joiner
 * authored themselves take the circle byline (`selfAuthorName`, the link display name); entries
 * other people wrote into the joiner's old bucket keep their original byline. Prunes once at the
 * end (not per row) to stay well inside mutation read limits.
 */
export async function copyBucketLogs(
  ctx: MutationCtx,
  fromPatientUserId: Id<"users">,
  toPatientUserId: Id<"users">,
  selfAuthorName: string,
): Promise<void> {
  if (fromPatientUserId === toPatientUserId) return;
  const bylineFor = (row: { authorUserId?: Id<"users">; authorName: string }): WriteAuth =>
    row.authorUserId === fromPatientUserId || row.authorUserId === undefined
      ? { authorUserId: fromPatientUserId, authorName: selfAuthorName }
      : { authorUserId: row.authorUserId, authorName: row.authorName };

  const food = await ctx.db
    .query("careFoodLogs")
    .withIndex("by_patient_time", (q) => q.eq("patientUserId", fromPatientUserId))
    .order("desc")
    .take(FOOD_CAP);
  for (const row of food) {
    const existing = await ctx.db
      .query("careFoodLogs")
      .withIndex("by_patient_client", (q) =>
        q.eq("patientUserId", toPatientUserId).eq("clientId", row.clientId),
      )
      .first();
    if (existing) continue;
    const auth = bylineFor(row);
    await ctx.db.insert("careFoodLogs", {
      patientUserId: toPatientUserId,
      ...(auth.authorUserId ? { authorUserId: auth.authorUserId } : {}),
      authorName: auth.authorName,
      createdAt: row.createdAt,
      clientId: row.clientId,
      timestamp: row.timestamp,
      foodName: row.foodName,
      estimatedCarbs: row.estimatedCarbs,
      insulinUnits: row.insulinUnits,
      confidence: row.confidence,
      fromPhoto: row.fromPhoto,
      ...(row.photoUri != null ? { photoUri: row.photoUri } : {}),
    });
  }

  const insulin = await ctx.db
    .query("careInsulinLogs")
    .withIndex("by_patient_time", (q) => q.eq("patientUserId", fromPatientUserId))
    .order("desc")
    .take(INSULIN_CAP);
  for (const row of insulin) {
    const existing = await ctx.db
      .query("careInsulinLogs")
      .withIndex("by_patient_client", (q) =>
        q.eq("patientUserId", toPatientUserId).eq("clientId", row.clientId),
      )
      .first();
    if (existing) continue;
    const auth = bylineFor(row);
    await ctx.db.insert("careInsulinLogs", {
      patientUserId: toPatientUserId,
      ...(auth.authorUserId ? { authorUserId: auth.authorUserId } : {}),
      authorName: auth.authorName,
      createdAt: row.createdAt,
      clientId: row.clientId,
      timestamp: row.timestamp,
      units: row.units,
      type: row.type,
      ...(row.note != null ? { note: row.note } : {}),
      ...(row.foodLogId != null ? { foodLogId: row.foodLogId } : {}),
      ...(row.insulinType != null ? { insulinType: row.insulinType } : {}),
      ...(row.recommendedUnits != null ? { recommendedUnits: row.recommendedUnits } : {}),
      ...(row.manualOverride != null ? { manualOverride: row.manualOverride } : {}),
    });
  }

  await pruneFood(ctx, toPatientUserId);
  await pruneInsulin(ctx, toPatientUserId);
}

// ─── account-authorized mutations (patient + co-guardians) ───────────────────────────────────

export const addFoodLog = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    patientUserId: v.id("users"),
    entry: foodEntryPayload,
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    // "Log to myself" lands in the caller's circle bucket, so a co-guardian's entry reaches everyone.
    const patientUserId =
      args.patientUserId === args.userId ? await circleBucketFor(ctx, args.userId) : args.patientUserId;
    const auth = await resolveAccountWriteAuth(ctx, args.userId, patientUserId);
    if (!auth) throw new Error("Not allowed to log for this patient");
    await upsertFood(ctx, patientUserId, auth, args.entry);
  },
});

export const addInsulinLog = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    patientUserId: v.id("users"),
    entry: insulinEntryPayload,
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const patientUserId =
      args.patientUserId === args.userId ? await circleBucketFor(ctx, args.userId) : args.patientUserId;
    const auth = await resolveAccountWriteAuth(ctx, args.userId, patientUserId);
    if (!auth) throw new Error("Not allowed to log for this patient");
    await upsertInsulin(ctx, patientUserId, auth, args.entry);
  },
});

/** Idempotent bulk import — used once to migrate a device's local AsyncStorage logs to the cloud. */
export const importLogs = mutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
    patientUserId: v.id("users"),
    food: v.array(foodEntryPayload),
    insulin: v.array(insulinEntryPayload),
  },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const patientUserId =
      args.patientUserId === args.userId ? await circleBucketFor(ctx, args.userId) : args.patientUserId;
    const auth = await resolveAccountWriteAuth(ctx, args.userId, patientUserId);
    if (!auth) throw new Error("Not allowed to log for this patient");
    for (const entry of args.food) await upsertFood(ctx, patientUserId, auth, entry);
    for (const entry of args.insulin) await upsertInsulin(ctx, patientUserId, auth, entry);
  },
});

// ─── external-code-authorized mutations ──────────────────────────────────────────────────────

/** A child logs under the patient's own name; a caregiver logs under the code's label. */
async function codeAuthorName(
  ctx: MutationCtx,
  row: { kind?: "caregiver" | "child"; label: string; patientUserId: Id<"users"> },
): Promise<string> {
  return row.kind === "child" ? await patientDisplayName(ctx, row.patientUserId) : row.label;
}

/**
 * The byline for a log written via an access code. A signed-in Caregiver (school-nurse) account
 * logging through a code it holds is credited to THAT account (name + authorUserId, which drives the
 * live re-derivation on read) — so guardians see the nurse's real name. An accountless access-code
 * session (kid device / teacher with just a code) falls back to the child's name / the code label.
 */
async function viaCodeWriteAuth(
  ctx: MutationCtx,
  row: { kind?: "caregiver" | "child"; label: string; patientUserId: Id<"users"> },
  authorUserId: Id<"users"> | undefined,
  passwordHash: string | undefined,
): Promise<WriteAuth> {
  if (authorUserId && passwordHash && (await assertPatientAuth(ctx, authorUserId, passwordHash))) {
    return { authorUserId, authorName: await guardianDisplayName(ctx, authorUserId) };
  }
  return { authorName: await codeAuthorName(ctx, row) };
}

export const addFoodLogViaCode = mutation({
  args: {
    code: v.string(),
    entry: foodEntryPayload,
    // Set when a signed-in caregiver account logs through the code (attributes the log to them).
    authorUserId: v.optional(v.id("users")),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row || !row.permissions.log) throw new Error("This code cannot add logs");
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) throw new Error("Outside this code's schedule");
    const auth = await viaCodeWriteAuth(ctx, row, args.authorUserId, args.passwordHash);
    await upsertFood(ctx, row.patientUserId, auth, args.entry);
  },
});

export const addInsulinLogViaCode = mutation({
  args: {
    code: v.string(),
    entry: insulinEntryPayload,
    authorUserId: v.optional(v.id("users")),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row || !row.permissions.log) throw new Error("This code cannot add logs");
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) throw new Error("Outside this code's schedule");
    const auth = await viaCodeWriteAuth(ctx, row, args.authorUserId, args.passwordHash);
    await upsertInsulin(ctx, row.patientUserId, auth, args.entry);
  },
});

// ─── reads ───────────────────────────────────────────────────────────────────────────────────

/** Prefer the author's CURRENT guardian name (re-derived on read) over the row's stored snapshot. */
function bylineFor(
  row: { authorUserId?: string; authorName: string },
  liveNames: Map<string, string>,
): string {
  if (row.authorUserId) {
    const live = liveNames.get(row.authorUserId);
    if (live) return live;
  }
  return row.authorName;
}

function mapFood(
  row: {
    clientId: string; timestamp: string; foodName: string; estimatedCarbs: number;
    insulinUnits: number; confidence: "high" | "medium" | "low"; fromPhoto: boolean;
    photoUri?: string; authorUserId?: string; authorName: string; edited?: boolean;
  },
  liveNames: Map<string, string>,
) {
  return {
    id: row.clientId,
    timestamp: row.timestamp,
    foodName: row.foodName,
    estimatedCarbs: row.estimatedCarbs,
    insulinUnits: row.insulinUnits,
    confidence: row.confidence,
    fromPhoto: row.fromPhoto,
    photoUri: row.photoUri,
    authorUserId: row.authorUserId,
    authorName: bylineFor(row, liveNames),
    edited: row.edited,
  };
}

function mapInsulin(
  row: {
    clientId: string; timestamp: string; units: number;
    type: "bolus" | "correction" | "manual" | "basal"; note?: string; foodLogId?: string;
    insulinType?: string; recommendedUnits?: number; manualOverride?: boolean;
    authorUserId?: string; authorName: string; edited?: boolean;
  },
  liveNames: Map<string, string>,
) {
  return {
    id: row.clientId,
    timestamp: row.timestamp,
    units: row.units,
    type: row.type,
    note: row.note,
    foodLogId: row.foodLogId,
    insulinType: row.insulinType,
    recommendedUnits: row.recommendedUnits,
    manualOverride: row.manualOverride,
    authorUserId: row.authorUserId,
    authorName: bylineFor(row, liveNames),
    edited: row.edited,
  };
}

async function readLogs(ctx: QueryCtx, patientUserId: Id<"users">) {
  const [food, insulin] = await Promise.all([
    ctx.db
      .query("careFoodLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
      .order("desc")
      .take(FOOD_CAP),
    ctx.db
      .query("careInsulinLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
      .order("desc")
      .take(INSULIN_CAP),
  ]);
  // Re-derive each account-author's CURRENT guardian name once (a circle has ≤4 guardians, so this
  // is a handful of lookups regardless of log count). This makes bylines always show the guardian's
  // live name — repairing rows stored under the child's name and reflecting later name changes.
  // Access-code logs (child/caregiver, no authorUserId) keep their stored label.
  const authorIds = new Set<string>();
  for (const r of food) if (r.authorUserId) authorIds.add(r.authorUserId);
  for (const r of insulin) if (r.authorUserId) authorIds.add(r.authorUserId);
  const liveNames = new Map<string, string>();
  for (const id of authorIds) {
    liveNames.set(id, await guardianDisplayName(ctx, id as Id<"users">));
  }
  return {
    foodLog: food.map((r) => mapFood(r, liveNames)),
    insulinLog: insulin.map((r) => mapInsulin(r, liveNames)),
  };
}

/** Merged authored logs for a patient — patient themselves or an authorized co-guardian. */
export const listLogs = query({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    // A member asking for "my logs" is served the circle's pool. If their grant/schedule currently
    // blocks viewing it, they get EMPTY logs — never their stale pre-link private bucket, which
    // would silently mislead the dose calculator.
    const patientUserId =
      args.patientUserId === args.userId ? await circleBucketFor(ctx, args.userId) : args.patientUserId;
    if (!(await resolveAccountReadAuth(ctx, args.userId, patientUserId))) {
      if (patientUserId !== args.patientUserId) return { foodLog: [], insulinLog: [] };
      return null;
    }
    return await readLogs(ctx, patientUserId);
  },
});

// ─── clear-all (patient or active co-guardian) ───────────────────────────────────────────────

/** Caller may clear a patient's logs when they are the patient or an active co-guardian. */
async function resolveClearAuth(
  ctx: MutationCtx,
  callerUserId: Id<"users">,
  patientUserId: Id<"users">,
): Promise<boolean> {
  if (callerUserId === patientUserId) return true;
  const link = await ctx.db
    .query("careLinks")
    .withIndex("by_patient_member", (q) =>
      q.eq("patientUserId", patientUserId).eq("memberUserId", callerUserId),
    )
    .first();
  return !!link && link.status === "active";
}

export const clearFood = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const patientUserId =
      args.patientUserId === args.userId ? await circleBucketFor(ctx, args.userId) : args.patientUserId;
    if (!(await resolveClearAuth(ctx, args.userId, patientUserId))) throw new Error("Not allowed");
    const rows = await ctx.db
      .query("careFoodLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

export const clearInsulin = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    const patientUserId =
      args.patientUserId === args.userId ? await circleBucketFor(ctx, args.userId) : args.patientUserId;
    if (!(await resolveClearAuth(ctx, args.userId, patientUserId))) throw new Error("Not allowed");
    const rows = await ctx.db
      .query("careInsulinLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", patientUserId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

/** Merged authored logs for an external access-code viewer (view-logs grant + open schedule). */
export const listLogsViaCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row || !row.permissions.viewLogs) return null;
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    return await readLogs(ctx, row.patientUserId);
  },
});

// ─── per-entry delete + edit (patient / co-guardian, or via an access code with the log grant) ──
// Editing/deleting a single shared row propagates to everyone in the circle and to every access-code
// viewer, and (since the calculator reads the same pool) removes/updates it from all future dose math.
// An edit stamps `edited: true` so viewers can see the entry was changed.

const foodEditPatch = v.object({
  foodName: v.optional(v.string()),
  estimatedCarbs: v.optional(v.number()),
  insulinUnits: v.optional(v.number()),
  timestamp: v.optional(v.string()),
});

const insulinEditPatch = v.object({
  units: v.optional(v.number()),
  note: v.optional(v.string()),
  timestamp: v.optional(v.string()),
});

async function findFoodRow(ctx: MutationCtx, patientUserId: Id<"users">, clientId: string) {
  return await ctx.db
    .query("careFoodLogs")
    .withIndex("by_patient_client", (q) => q.eq("patientUserId", patientUserId).eq("clientId", clientId))
    .first();
}

async function findInsulinRow(ctx: MutationCtx, patientUserId: Id<"users">, clientId: string) {
  return await ctx.db
    .query("careInsulinLogs")
    .withIndex("by_patient_client", (q) => q.eq("patientUserId", patientUserId).eq("clientId", clientId))
    .first();
}

async function patchFoodRow(ctx: MutationCtx, row: NonNullable<Awaited<ReturnType<typeof findFoodRow>>>, patch: typeof foodEditPatch.type) {
  await ctx.db.patch(row._id, {
    ...(patch.foodName !== undefined ? { foodName: patch.foodName } : {}),
    ...(patch.estimatedCarbs !== undefined ? { estimatedCarbs: patch.estimatedCarbs } : {}),
    ...(patch.insulinUnits !== undefined ? { insulinUnits: patch.insulinUnits } : {}),
    ...(patch.timestamp !== undefined ? { timestamp: patch.timestamp } : {}),
    edited: true,
  });
}

async function patchInsulinRow(ctx: MutationCtx, row: NonNullable<Awaited<ReturnType<typeof findInsulinRow>>>, patch: typeof insulinEditPatch.type) {
  await ctx.db.patch(row._id, {
    ...(patch.units !== undefined ? { units: patch.units } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.timestamp !== undefined ? { timestamp: patch.timestamp } : {}),
    edited: true,
  });
}

/** Resolve the circle bucket + write auth for an account-authorized per-entry edit/delete. */
async function accountEntryAuth(ctx: MutationCtx, userId: Id<"users">, passwordHash: string, patientUserIdArg: Id<"users">): Promise<Id<"users">> {
  if (!(await assertPatientAuth(ctx, userId, passwordHash))) throw new Error("Unauthorized");
  const patientUserId = patientUserIdArg === userId ? await circleBucketFor(ctx, userId) : patientUserIdArg;
  if (!(await resolveAccountWriteAuth(ctx, userId, patientUserId))) throw new Error("Not allowed to edit this log");
  return patientUserId;
}

/** Resolve the patient bucket for an access-code per-entry edit/delete (requires the log grant). */
async function codeEntryAuth(ctx: MutationCtx, code: string): Promise<Id<"users">> {
  const row = await resolveActiveAccessCode(ctx, code);
  if (!row || !row.permissions.log) throw new Error("This code cannot edit logs");
  if (!careAccessAllowed(row.access as CareAccess, Date.now())) throw new Error("Outside this code's schedule");
  return row.patientUserId;
}

export const deleteFoodLog = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users"), clientId: v.string() },
  handler: async (ctx, args) => {
    const patientUserId = await accountEntryAuth(ctx, args.userId, args.passwordHash, args.patientUserId);
    const row = await findFoodRow(ctx, patientUserId, args.clientId);
    if (row) await ctx.db.delete(row._id);
  },
});

export const deleteInsulinLog = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users"), clientId: v.string() },
  handler: async (ctx, args) => {
    const patientUserId = await accountEntryAuth(ctx, args.userId, args.passwordHash, args.patientUserId);
    const row = await findInsulinRow(ctx, patientUserId, args.clientId);
    if (row) await ctx.db.delete(row._id);
  },
});

export const updateFoodLog = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users"), clientId: v.string(), patch: foodEditPatch },
  handler: async (ctx, args) => {
    const patientUserId = await accountEntryAuth(ctx, args.userId, args.passwordHash, args.patientUserId);
    const row = await findFoodRow(ctx, patientUserId, args.clientId);
    if (row) await patchFoodRow(ctx, row, args.patch);
  },
});

export const updateInsulinLog = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users"), clientId: v.string(), patch: insulinEditPatch },
  handler: async (ctx, args) => {
    const patientUserId = await accountEntryAuth(ctx, args.userId, args.passwordHash, args.patientUserId);
    const row = await findInsulinRow(ctx, patientUserId, args.clientId);
    if (row) await patchInsulinRow(ctx, row, args.patch);
  },
});

export const deleteFoodLogViaCode = mutation({
  args: { code: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const patientUserId = await codeEntryAuth(ctx, args.code);
    const row = await findFoodRow(ctx, patientUserId, args.clientId);
    if (row) await ctx.db.delete(row._id);
  },
});

export const deleteInsulinLogViaCode = mutation({
  args: { code: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const patientUserId = await codeEntryAuth(ctx, args.code);
    const row = await findInsulinRow(ctx, patientUserId, args.clientId);
    if (row) await ctx.db.delete(row._id);
  },
});

export const updateFoodLogViaCode = mutation({
  args: { code: v.string(), clientId: v.string(), patch: foodEditPatch },
  handler: async (ctx, args) => {
    const patientUserId = await codeEntryAuth(ctx, args.code);
    const row = await findFoodRow(ctx, patientUserId, args.clientId);
    if (row) await patchFoodRow(ctx, row, args.patch);
  },
});

export const updateInsulinLogViaCode = mutation({
  args: { code: v.string(), clientId: v.string(), patch: insulinEditPatch },
  handler: async (ctx, args) => {
    const patientUserId = await codeEntryAuth(ctx, args.code);
    const row = await findInsulinRow(ctx, patientUserId, args.clientId);
    if (row) await patchInsulinRow(ctx, row, args.patch);
  },
});
