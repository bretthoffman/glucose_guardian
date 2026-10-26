/**
 * Lab results (A1C, thyroid, celiac screen, one-time lab glucose, ...) in the care-circle bucket.
 *
 * Same access rules as the shared logs (careLogs): the patient account and active co-guardians with
 * the log grant may add or remove results; anyone in the circle who may view logs may read them.
 * `clientId` is the device id and the edit/delete key; MyChart imports also carry `externalId` (the
 * FHIR Observation id) so pulling the same result twice never duplicates it.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";
import { circleBucketFor, resolveAccountReadAuth, resolveAccountWriteAuth } from "./careLogs";

const LAB_CAP = 300;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const LAB_TESTS = ["a1c", "tsh", "celiac", "glucose", "other"] as const;

export const labPayload = v.object({
  clientId: v.string(),
  test: v.string(),
  name: v.string(),
  value: v.optional(v.number()),
  valueText: v.optional(v.string()),
  unit: v.optional(v.string()),
  refRange: v.optional(v.string()),
  takenOn: v.string(),
  source: v.union(v.literal("manual"), v.literal("photo"), v.literal("mychart")),
  externalId: v.optional(v.string()),
});
type LabPayload = typeof labPayload.type;

/** Shape checks so a typo can't store a result that breaks every device. */
export function cleanLab(p: LabPayload): LabPayload {
  if (!LOCAL_DATE.test(p.takenOn)) throw new ConvexError("Date must be YYYY-MM-DD");
  const test = (LAB_TESTS as readonly string[]).includes(p.test) ? p.test : "other";
  const name = p.name.trim().slice(0, 80);
  if (!name) throw new ConvexError("Name the test");
  const valueText = p.valueText?.trim().slice(0, 60) || undefined;
  if (p.value == null && !valueText) throw new ConvexError("Enter a result");
  if (p.value != null && !Number.isFinite(p.value)) throw new ConvexError("Result must be a number");
  // An A1C outside 3 to 20% is a typo (or the wrong test), not a result.
  if (test === "a1c" && p.value != null && (p.value < 3 || p.value > 20)) {
    throw new ConvexError("An A1C is usually between 4% and 14%. Check the number.");
  }
  return {
    clientId: p.clientId.slice(0, 80),
    test,
    name,
    ...(p.value != null ? { value: Math.round(p.value * 100) / 100 } : {}),
    ...(valueText ? { valueText } : {}),
    ...(p.unit?.trim() ? { unit: p.unit.trim().slice(0, 20) } : {}),
    ...(p.refRange?.trim() ? { refRange: p.refRange.trim().slice(0, 40) } : {}),
    takenOn: p.takenOn,
    source: p.source,
    ...(p.externalId ? { externalId: p.externalId.slice(0, 120) } : {}),
  };
}

async function prune(ctx: MutationCtx, patientUserId: Id<"users">) {
  const rows = await ctx.db
    .query("labResults")
    .withIndex("by_patient_taken", (q) => q.eq("patientUserId", patientUserId))
    .order("desc")
    .collect();
  for (const row of rows.slice(LAB_CAP)) await ctx.db.delete(row._id);
}

/** Results for the caller's circle, newest first. Members without view access get an empty list. */
export const list = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const patientUserId = await circleBucketFor(ctx, user._id);
    if (!(await resolveAccountReadAuth(ctx, user._id, patientUserId))) return [];
    const rows = await ctx.db
      .query("labResults")
      .withIndex("by_patient_taken", (q) => q.eq("patientUserId", patientUserId))
      .order("desc")
      .take(LAB_CAP);
    return rows.map((r) => ({
      id: r.clientId,
      test: r.test,
      name: r.name,
      value: r.value,
      valueText: r.valueText,
      unit: r.unit,
      refRange: r.refRange,
      takenOn: r.takenOn,
      source: r.source,
      externalId: r.externalId,
      authorName: r.authorName,
      createdAt: r.createdAt,
    }));
  },
});

/** Add or edit one result (by clientId; MyChart imports also match by externalId). */
export const save = mutation({
  args: { ...legacyAuthArgs, lab: labPayload },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const patientUserId = await circleBucketFor(ctx, user._id);
    const auth = await resolveAccountWriteAuth(ctx, user._id, patientUserId);
    if (!auth) throw new ConvexError("Not allowed to add results for this patient");
    const clean = cleanLab(args.lab);
    const now = Date.now();
    const existing =
      (clean.externalId
        ? await ctx.db
            .query("labResults")
            .withIndex("by_patient_external", (q) => q.eq("patientUserId", patientUserId).eq("externalId", clean.externalId))
            .first()
        : null) ??
      (await ctx.db
        .query("labResults")
        .withIndex("by_patient_client", (q) => q.eq("patientUserId", patientUserId).eq("clientId", clean.clientId))
        .first());
    if (existing) {
      await ctx.db.replace(existing._id, {
        patientUserId,
        ...clean,
        clientId: existing.clientId,
        ...(existing.authorUserId ? { authorUserId: existing.authorUserId } : {}),
        authorName: existing.authorName,
        createdAt: existing.createdAt,
        updatedAt: now,
      });
      return { id: existing.clientId, created: false };
    }
    await ctx.db.insert("labResults", {
      patientUserId,
      ...clean,
      ...(auth.authorUserId ? { authorUserId: auth.authorUserId } : {}),
      authorName: auth.authorName,
      createdAt: now,
      updatedAt: now,
    });
    await prune(ctx, patientUserId);
    return { id: clean.clientId, created: true };
  },
});

export const remove = mutation({
  args: { ...legacyAuthArgs, id: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const patientUserId = await circleBucketFor(ctx, user._id);
    if (!(await resolveAccountWriteAuth(ctx, user._id, patientUserId))) {
      throw new ConvexError("Not allowed to remove results for this patient");
    }
    const row = await ctx.db
      .query("labResults")
      .withIndex("by_patient_client", (q) => q.eq("patientUserId", patientUserId).eq("clientId", args.id))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});
