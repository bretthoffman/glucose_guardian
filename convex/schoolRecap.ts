/**
 * Day recaps: a caregiver code (the school nurse) sends the family a recap of its hours, now or when
 * its school hours end, with an optional note. The guardians get a push and the recap sheet; each
 * parent's phone builds the numbers (time in range, lows, meals, doses) from its own readings and logs,
 * so only the window and the note live here.
 */
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { legacyAuthArgs } from "./identity";
import type { CareAccess } from "./careSchedule";
import { RECAP_NOTE_MAX, recapSendAt, recapWindow } from "./carePlanLogic";
import { activeCaregiverCode, childNameFor, planViewer } from "./carePlan";

const RECAP_TTL_MS = 24 * 60 * 60 * 1000;

/** The caregiver's recap screen: today's window and the recap already sent or waiting, if any. */
export const forCaregiver = query({
  args: { code: v.string(), tzOffsetMinutes: v.number() },
  handler: async (ctx, a) => {
    const row = await activeCaregiverCode(ctx, a.code);
    if (!row) return null;
    const now = Date.now();
    const window = recapWindow(row.access as CareAccess, now, a.tzOffsetMinutes);
    const latest = await ctx.db
      .query("schoolRecaps")
      .withIndex("by_code", (q) => q.eq("code", row.code).gte("createdAt", window.startMs - 6 * 3_600_000))
      .order("desc")
      .first();
    return {
      childName: await childNameFor(ctx, row.patientUserId),
      window,
      latest: latest
        ? { id: latest._id, note: latest.note, sendAt: latest.sendAt, sentAt: latest.sentAt ?? null, seen: latest.seen.map((s) => ({ name: s.name, at: s.at })) }
        : null,
    };
  },
});

/** Caregiver: send the recap now, or when the hours end. A waiting one is replaced. */
export const send = mutation({
  args: { code: v.string(), tzOffsetMinutes: v.number(), note: v.string(), sendNow: v.boolean() },
  handler: async (ctx, a) => {
    const row = await activeCaregiverCode(ctx, a.code);
    if (!row) throw new ConvexError("This code can't send a recap right now");
    const now = Date.now();
    const window = recapWindow(row.access as CareAccess, now, a.tzOffsetMinutes);
    const waiting = await ctx.db
      .query("schoolRecaps")
      .withIndex("by_code", (q) => q.eq("code", row.code).gte("createdAt", now - RECAP_TTL_MS))
      .collect();
    for (const r of waiting) {
      if (r.sentAt != null) continue;
      if (r.scheduledId) await ctx.scheduler.cancel(r.scheduledId);
      await ctx.db.delete(r._id);
    }
    const sendAt = recapSendAt(window, now, a.sendNow);
    const id = await ctx.db.insert("schoolRecaps", {
      patientUserId: row.patientUserId,
      code: row.code,
      fromName: row.label,
      note: a.note.trim().slice(0, RECAP_NOTE_MAX),
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
      sendAt,
      createdAt: now,
      seen: [],
    });
    const scheduledId = await ctx.scheduler.runAt(sendAt, internal.schoolRecap.deliver, { id });
    await ctx.db.patch(id, { scheduledId });
    return { id, sendAt };
  },
});

/** Caregiver: take back a recap that hasn't gone out yet. */
export const cancel = mutation({
  args: { code: v.string(), id: v.id("schoolRecaps") },
  handler: async (ctx, a) => {
    const row = await activeCaregiverCode(ctx, a.code);
    const r = await ctx.db.get(a.id);
    if (!row || !r || r.code !== row.code || r.sentAt != null) return false;
    if (r.scheduledId) await ctx.scheduler.cancel(r.scheduledId);
    await ctx.db.delete(r._id);
    return true;
  },
});

/** At send time: mark it sent and push it to the guardians. */
export const deliver = internalMutation({
  args: { id: v.id("schoolRecaps") },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.sentAt != null) return;
    await ctx.db.patch(r._id, { sentAt: Date.now(), scheduledId: undefined });
    await ctx.scheduler.runAfter(0, internal.schoolRecap.notify, {
      patientUserId: r.patientUserId,
      childName: await childNameFor(ctx, r.patientUserId),
      fromName: r.fromName,
      note: r.note,
    });
  },
});

export const notify = internalAction({
  args: { patientUserId: v.id("users"), childName: v.string(), fromName: v.string(), note: v.string() },
  handler: async (ctx, a): Promise<void> => {
    // Guardians only: the owner's devices and the co-guardians', not other caregiver codes.
    const owner: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, { patientUserId: a.patientUserId, category: "messages", scope: "owner" });
    const co: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, { patientUserId: a.patientUserId, category: "messages", scope: "coGuardians" });
    const seen = new Set<string>();
    const tokens = [...owner, ...co].filter((t) => (seen.has(t.token) ? false : (seen.add(t.token), true)));
    if (tokens.length === 0) return;
    const from = a.fromName.trim().split(/[\s(]+/)[0] || a.fromName;
    const note = a.note.trim();
    await ctx.runAction(internal.push.deliver, {
      tokens,
      category: "messages",
      title: `${a.childName}'s day recap from ${from}`,
      body: note ? (note.length > 140 ? `${note.slice(0, 137)}...` : note) : "Tap to see how the day went.",
      data: { kind: "school_recap" },
    });
  },
});

/** Family: the newest recap sent in the last 24 hours, and whether this person has opened it. */
export const forFamily = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, a) => {
    const viewer = await planViewer(ctx, a);
    if (!viewer || viewer.kind !== "family") return null;
    const now = Date.now();
    const rows = await ctx.db
      .query("schoolRecaps")
      .withIndex("by_patient", (q) => q.eq("patientUserId", viewer.patientUserId).gte("createdAt", now - RECAP_TTL_MS))
      .order("desc")
      .collect();
    const r = rows.find((x) => x.sentAt != null);
    if (!r) return null;
    return {
      id: r._id,
      fromName: r.fromName,
      note: r.note,
      windowStartMs: r.windowStartMs,
      windowEndMs: r.windowEndMs,
      sentAt: r.sentAt!,
      seenByMe: r.seen.some((s) => s.userId === viewer.userId),
    };
  },
});

/** Family: opened it ("Mom saw it at 3:05", on the caregiver's screen). */
export const markSeen = mutation({
  args: { ...legacyAuthArgs, id: v.id("schoolRecaps") },
  handler: async (ctx, a) => {
    const viewer = await planViewer(ctx, a);
    const r = await ctx.db.get(a.id);
    if (!viewer || viewer.kind !== "family" || !r || r.patientUserId !== (viewer.patientUserId as Id<"users">)) return;
    if (r.seen.some((s) => s.userId === viewer.userId)) return;
    await ctx.db.patch(r._id, { seen: [...r.seen, { userId: viewer.userId, name: viewer.name, at: Date.now() }] });
  },
});
