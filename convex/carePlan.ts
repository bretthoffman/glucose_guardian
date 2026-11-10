/**
 * The Care Plan: what the family wants caregivers to do for a low or a high, where the glucagon and
 * supplies are, and any notes, plus who to call (from Emergency Contacts, so nobody types it twice).
 *
 * - The family (the owner or a co-guardian, signed in) reads and edits it.
 * - A caregiver code (the school nurse, grandma, or a nurse account viewing through a code) reads it,
 *   during the code's hours like everything else it can see. Kid codes don't get it.
 *
 * The text is what the family wrote from their doctor's plan. The app shows it, it doesn't write it.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, userCompat } from "./identity";
import { circleBucketFor } from "./careLogs";
import { careAccessAllowed, type CareAccess } from "./careSchedule";
import { cleanPlan, DEFAULT_RECHECK_MINUTES } from "./carePlanLogic";

export type PlanViewer =
  | { kind: "family"; patientUserId: Id<"users">; userId: Id<"users">; name: string }
  | { kind: "caregiver"; patientUserId: Id<"users">; code: string; name: string };

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/** An active caregiver code (not a kid code) inside its hours, or null. */
export async function activeCaregiverCode(ctx: QueryCtx | MutationCtx, rawCode: string) {
  const code = normalizeCode(rawCode);
  if (code.length !== 8) return null;
  const row = await ctx.db
    .query("careAccessCodes")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
  if (!row || row.status !== "active" || row.kind === "child") return null;
  if (!careAccessAllowed(row.access as CareAccess, Date.now())) return null;
  return row;
}

export async function planViewer(
  ctx: QueryCtx | MutationCtx,
  args: { code?: string; userId?: Id<"users">; passwordHash?: string },
): Promise<PlanViewer | null> {
  if (args.code) {
    const row = await activeCaregiverCode(ctx, args.code);
    return row ? { kind: "caregiver", patientUserId: row.patientUserId, code: row.code, name: row.label } : null;
  }
  const user = await userCompat(ctx, args);
  if (!user) return null;
  const own = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .unique();
  return {
    kind: "family",
    patientUserId: await circleBucketFor(ctx, user._id),
    userId: user._id,
    name: own?.parentName?.trim() || user.email?.split("@")[0] || "Family",
  };
}

export async function childNameFor(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">): Promise<string> {
  const p = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", patientUserId))
    .unique();
  return p?.childName?.trim() || "your child";
}

const args = { ...legacyAuthArgs, code: v.optional(v.string()) };

/** The plan (null until the family writes one), whether this viewer may edit it, and who to call. */
export const get = query({
  args,
  handler: async (ctx, a) => {
    const viewer = await planViewer(ctx, a);
    if (!viewer) return null;
    const plan = await ctx.db
      .query("carePlans")
      .withIndex("by_patient", (q) => q.eq("patientUserId", viewer.patientUserId))
      .unique();
    // The circle's shared Emergency Contacts pool.
    const shared = await ctx.db
      .query("careShared")
      .withIndex("by_patient", (q) => q.eq("patientUserId", viewer.patientUserId))
      .unique();
    const contacts = [...(shared?.emergencyContacts ?? [])]
      .sort((x, y) => Number(!!y.primary) - Number(!!x.primary))
      .map((c) => ({ name: c.name, relation: c.relation, phone: c.phone }));
    return {
      childName: await childNameFor(ctx, viewer.patientUserId),
      canEdit: viewer.kind === "family",
      contacts,
      recheckMinutes: plan?.recheckMinutes ?? DEFAULT_RECHECK_MINUTES,
      plan: plan
        ? { low: plan.low, high: plan.high, supplies: plan.supplies, notes: plan.notes, updatedAt: plan.updatedAt, updatedByName: plan.updatedByName }
        : null,
    };
  },
});

/** Family only: save the plan. Everyone who can see it gets the change right away. */
export const save = mutation({
  args: {
    ...args,
    low: v.string(),
    high: v.string(),
    supplies: v.string(),
    notes: v.string(),
    recheckMinutes: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const viewer = await planViewer(ctx, a);
    if (!viewer || viewer.kind !== "family") throw new ConvexError("Only the family can change the Care Plan");
    const fields = cleanPlan(a);
    const now = Date.now();
    const existing = await ctx.db
      .query("carePlans")
      .withIndex("by_patient", (q) => q.eq("patientUserId", viewer.patientUserId))
      .unique();
    const row = { ...fields, recheckMinutes: fields.recheckMinutes, updatedAt: now, updatedByName: viewer.name };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("carePlans", { patientUserId: viewer.patientUserId, ...row });
    return { updatedAt: now };
  },
});
