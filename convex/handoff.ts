/**
 * Handoff notes: the optional note that rides on the handoff sheet.
 *
 * - A family account (the owner or a co-guardian) leaves a note for caregivers: everyone, or only
 *   some access codes ("Holly", "Andrea"). The caregiver sees it on their first open of the day.
 * - A caregiver code (the school nurse, grandma) leaves a note back for the family, which shows on
 *   the family's "While you were away" sheet.
 *
 * The newest note per audience replaces the older one and shows for 24 hours. Opening it records
 * who saw it and when. The numbers on the sheet (reading, insulin, meals) are not stored here; each
 * phone builds them from the logs it already has.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { legacyAuthArgs, userCompat } from "./identity";
import { circleBucketFor } from "./careLogs";

export const NOTE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE = 500;

type Viewer =
  | { kind: "family"; patientUserId: Id<"users">; userId: Id<"users">; name: string }
  | { kind: "caregiver"; patientUserId: Id<"users">; code: string; name: string };

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function familyName(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<string> {
  const p = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  const user = await ctx.db.get(userId);
  return p?.parentName?.trim() || user?.email?.split("@")[0] || "Family";
}

async function viewerFor(
  ctx: QueryCtx | MutationCtx,
  args: { code?: string; userId?: Id<"users">; passwordHash?: string },
): Promise<Viewer | null> {
  if (args.code) {
    const code = normalizeCode(args.code);
    if (code.length !== 8) return null;
    const row = await ctx.db
      .query("careAccessCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (!row || row.status !== "active" || row.kind === "child") return null;
    return { kind: "caregiver", patientUserId: row.patientUserId, code, name: row.label };
  }
  const user = await userCompat(ctx, args);
  if (!user) return null;
  return {
    kind: "family",
    patientUserId: await circleBucketFor(ctx, user._id),
    userId: user._id,
    name: await familyName(ctx, user._id),
  };
}

async function newestNote(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">, audience: "caregivers" | "family") {
  return await ctx.db
    .query("handoffNotes")
    .withIndex("by_patient_audience", (q) => q.eq("patientUserId", patientUserId).eq("audience", audience))
    .order("desc")
    .first();
}

/** Whether a caregivers-audience note is addressed to this code. */
export function noteIsFor(recipientCodes: string[] | undefined, code: string): boolean {
  return !recipientCodes || recipientCodes.length === 0 || recipientCodes.map(normalizeCode).includes(normalizeCode(code));
}

const ownerArgs = { ...legacyAuthArgs, code: v.optional(v.string()) };

/**
 * The note for this viewer (24 hours, addressed to them), and for a family account also the status
 * of the note it left for caregivers ("Holly saw it at 8:02 AM").
 */
export const forMe = query({
  args: ownerArgs,
  handler: async (ctx, args) => {
    const viewer = await viewerFor(ctx, args);
    if (!viewer) return null;
    const now = Date.now();
    const fresh = <T extends { createdAt: number }>(n: T | null) => (n && now - n.createdAt < NOTE_TTL_MS ? n : null);
    if (viewer.kind === "caregiver") {
      const n = fresh(await newestNote(ctx, viewer.patientUserId, "caregivers"));
      const note = n && noteIsFor(n.recipientCodes, viewer.code) ? n : null;
      return {
        /** The viewer's own name ("Holly"), for the greeting. */
        you: viewer.name,
        note: note ? { id: note._id, text: note.text, fromName: note.fromName, createdAt: note.createdAt } : null,
        sent: null,
      };
    }
    const n = fresh(await newestNote(ctx, viewer.patientUserId, "family"));
    const sent = fresh(await newestNote(ctx, viewer.patientUserId, "caregivers"));
    return {
      you: viewer.name,
      note: n ? { id: n._id, text: n.text, fromName: n.fromName, createdAt: n.createdAt } : null,
      sent: sent
        ? { id: sent._id, text: sent.text, recipientCodes: sent.recipientCodes ?? [], createdAt: sent.createdAt, seen: sent.seen }
        : null,
    };
  },
});

/** Leave a note: family → caregivers (optionally only some codes); caregiver → family. */
export const leaveNote = mutation({
  args: { ...ownerArgs, text: v.string(), recipientCodes: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const viewer = await viewerFor(ctx, args);
    if (!viewer) throw new ConvexError("Not signed in");
    const text = args.text.trim().slice(0, MAX_NOTE);
    const audience = viewer.kind === "family" ? "caregivers" : "family";
    // The newest note per audience replaces the older one.
    const old = await ctx.db
      .query("handoffNotes")
      .withIndex("by_patient_audience", (q) => q.eq("patientUserId", viewer.patientUserId).eq("audience", audience))
      .collect();
    for (const o of old) await ctx.db.delete(o._id);
    if (!text) return null; // an empty note clears it
    const id = await ctx.db.insert("handoffNotes", {
      patientUserId: viewer.patientUserId,
      audience,
      text,
      fromName: viewer.name,
      ...(viewer.kind === "family" ? { fromUserId: viewer.userId } : { fromCode: viewer.code }),
      ...(viewer.kind === "family" && args.recipientCodes?.length
        ? { recipientCodes: args.recipientCodes.map(normalizeCode).filter((c) => c.length === 8) }
        : {}),
      createdAt: Date.now(),
      seen: [],
    });
    return id;
  },
});

/** Record that this viewer opened the note (once per viewer). */
export const markSeen = mutation({
  args: { ...ownerArgs, noteId: v.id("handoffNotes") },
  handler: async (ctx, args) => {
    const viewer = await viewerFor(ctx, args);
    if (!viewer) return;
    const note = await ctx.db.get(args.noteId);
    if (!note || note.patientUserId !== viewer.patientUserId) return;
    const expected = viewer.kind === "caregiver" ? "caregivers" : "family";
    if (note.audience !== expected) return;
    if (viewer.kind === "caregiver" && !noteIsFor(note.recipientCodes, viewer.code)) return;
    if (note.seen.some((s) => s.name === viewer.name)) return;
    await ctx.db.patch(note._id, { seen: [...note.seen, { name: viewer.name, at: Date.now() }].slice(-20) });
  },
});
