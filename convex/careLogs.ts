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
    return { authorUserId: callerUserId, authorName: await patientDisplayName(ctx, patientUserId) };
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
  return { authorUserId: callerUserId, authorName: link.displayName };
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
    const auth = await resolveAccountWriteAuth(ctx, args.userId, args.patientUserId);
    if (!auth) throw new Error("Not allowed to log for this patient");
    await upsertFood(ctx, args.patientUserId, auth, args.entry);
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
    const auth = await resolveAccountWriteAuth(ctx, args.userId, args.patientUserId);
    if (!auth) throw new Error("Not allowed to log for this patient");
    await upsertInsulin(ctx, args.patientUserId, auth, args.entry);
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
    const auth = await resolveAccountWriteAuth(ctx, args.userId, args.patientUserId);
    if (!auth) throw new Error("Not allowed to log for this patient");
    for (const entry of args.food) await upsertFood(ctx, args.patientUserId, auth, entry);
    for (const entry of args.insulin) await upsertInsulin(ctx, args.patientUserId, auth, entry);
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

export const addFoodLogViaCode = mutation({
  args: { code: v.string(), entry: foodEntryPayload },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row || !row.permissions.log) throw new Error("This code cannot add logs");
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) throw new Error("Outside this code's schedule");
    await upsertFood(ctx, row.patientUserId, { authorName: await codeAuthorName(ctx, row) }, args.entry);
  },
});

export const addInsulinLogViaCode = mutation({
  args: { code: v.string(), entry: insulinEntryPayload },
  handler: async (ctx, args) => {
    const row = await resolveActiveAccessCode(ctx, args.code);
    if (!row || !row.permissions.log) throw new Error("This code cannot add logs");
    if (!careAccessAllowed(row.access as CareAccess, Date.now())) throw new Error("Outside this code's schedule");
    await upsertInsulin(ctx, row.patientUserId, { authorName: await codeAuthorName(ctx, row) }, args.entry);
  },
});

// ─── reads ───────────────────────────────────────────────────────────────────────────────────

function mapFood(row: {
  clientId: string; timestamp: string; foodName: string; estimatedCarbs: number;
  insulinUnits: number; confidence: "high" | "medium" | "low"; fromPhoto: boolean;
  photoUri?: string; authorUserId?: string; authorName: string;
}) {
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
    authorName: row.authorName,
  };
}

function mapInsulin(row: {
  clientId: string; timestamp: string; units: number;
  type: "bolus" | "correction" | "manual" | "basal"; note?: string; foodLogId?: string;
  insulinType?: string; recommendedUnits?: number; manualOverride?: boolean;
  authorUserId?: string; authorName: string;
}) {
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
    authorName: row.authorName,
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
  return { foodLog: food.map(mapFood), insulinLog: insulin.map(mapInsulin) };
}

/** Merged authored logs for a patient — patient themselves or an authorized co-guardian. */
export const listLogs = query({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) return null;
    if (!(await resolveAccountReadAuth(ctx, args.userId, args.patientUserId))) return null;
    return await readLogs(ctx, args.patientUserId);
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
    if (!(await resolveClearAuth(ctx, args.userId, args.patientUserId))) throw new Error("Not allowed");
    const rows = await ctx.db
      .query("careFoodLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", args.patientUserId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

export const clearInsulin = mutation({
  args: { userId: v.id("users"), passwordHash: v.string(), patientUserId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await assertPatientAuth(ctx, args.userId, args.passwordHash))) throw new Error("Unauthorized");
    if (!(await resolveClearAuth(ctx, args.userId, args.patientUserId))) throw new Error("Not allowed");
    const rows = await ctx.db
      .query("careInsulinLogs")
      .withIndex("by_patient_time", (q) => q.eq("patientUserId", args.patientUserId))
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
