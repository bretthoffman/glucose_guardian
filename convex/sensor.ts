/**
 * The CGM sensor countdown, shared by the whole circle (rules in sensorLogic.ts).
 *
 * - Everyone who can see the readings sees the countdown: the family, caregiver codes and kid codes,
 *   during their hours.
 * - The family, and codes allowed to add logs, can mark a new sensor, fix its type or date, mark it
 *   ended early, and keep count of sensors left in the box.
 * - Libre sensors start by themselves from the readings (recordLibreStart, called by the CGM sync).
 * - The evening before a sensor's days end, the circle gets a "sensor ends tomorrow" push (category
 *   "sensor"; each phone can turn it off under Notifications).
 */
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { legacyAuthArgs, userCompat } from "./identity";
import { circleBucketFor } from "./careLogs";
import { careAccessAllowed, type CareAccess } from "./careSchedule";
import { childNameFor, normalizeCode } from "./carePlan";
import { clockAt, LOW_SUPPLY, reminderAt, SENSOR_SPECS, type SensorKind } from "./sensorLogic";

const labelArgs = {
  gtin: v.optional(v.string()),
  serial: v.optional(v.string()),
  pairingCode: v.optional(v.string()),
  expiresOn: v.optional(v.string()),
};
function cleanLabel(a: { gtin?: string; serial?: string; pairingCode?: string; expiresOn?: string }) {
  const t = (x: string | undefined, n: number) => (x?.trim() ? x.trim().slice(0, n) : undefined);
  const exp = a.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(a.expiresOn) ? a.expiresOn : undefined;
  return { gtin: t(a.gtin, 14), serial: t(a.serial, 20), pairingCode: t(a.pairingCode, 12), expiresOn: exp };
}

const kindArg = v.union(v.literal("g7"), v.literal("g7_15"), v.literal("g6"), v.literal("libre14"), v.literal("libre15"));
const DAY = 24 * 3_600_000;

type Viewer = { patientUserId: Id<"users">; name: string; canEdit: boolean };

async function sensorViewer(
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
    if (!row || row.status !== "active" || !careAccessAllowed(row.access as CareAccess, Date.now())) return null;
    if (!row.permissions.viewReadings) return null;
    return { patientUserId: row.patientUserId, name: row.label, canEdit: !!row.permissions.log };
  }
  const user = await userCompat(ctx, args);
  if (!user) return null;
  const own = await ctx.db
    .query("patientProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .unique();
  // A co-guardian goes by the name the circle knows them by ("Mom").
  const link = await ctx.db
    .query("careLinks")
    .withIndex("by_member", (q) => q.eq("memberUserId", user._id).eq("status", "active"))
    .first();
  return {
    patientUserId: link?.patientUserId ?? user._id,
    name: link?.displayName?.trim() || own?.parentName?.trim() || own?.childName?.trim() || user.email?.split("@")[0] || "Family",
    canEdit: true,
  };
}

async function currentSession(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db
    .query("sensorSessions")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .order("desc")
    .first();
}

async function supplyRow(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db
    .query("sensorSupplies")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId))
    .unique();
}

/** (Re)schedule the night-before reminder for this sensor. */
async function scheduleReminder(ctx: MutationCtx, row: Doc<"sensorSessions">) {
  if (row.reminderId) await ctx.scheduler.cancel(row.reminderId).catch(() => {});
  const endsAt = row.startedAt + SENSOR_SPECS[row.kind].days * DAY;
  const at = row.endedAt ? null : reminderAt(endsAt, row.tzOffsetMinutes, Date.now());
  const reminderId = at ? await ctx.scheduler.runAt(at, internal.sensor.remind, { sessionId: row._id }) : undefined;
  await ctx.db.patch(row._id, { reminderId });
}

/** Start a new sensor: ends the current one, counts one out of the box, schedules the reminder. */
async function startSensor(
  ctx: MutationCtx,
  patientUserId: Id<"users">,
  fields: {
    kind: SensorKind;
    startedAt: number;
    site?: string;
    source: "manual" | "detected" | "libre";
    setByName: string;
    tzOffsetMinutes: number;
    gtin?: string;
    serial?: string;
    pairingCode?: string;
    expiresOn?: string;
  },
) {
  const cur = await currentSession(ctx, patientUserId);
  if (cur && !cur.endedAt) {
    if (cur.reminderId) await ctx.scheduler.cancel(cur.reminderId).catch(() => {});
    await ctx.db.patch(cur._id, { endedAt: Math.max(cur.startedAt, fields.startedAt), reminderId: undefined });
  }
  const id = await ctx.db.insert("sensorSessions", { patientUserId, ...fields, createdAt: Date.now() });
  const supply = await supplyRow(ctx, patientUserId);
  if (supply && supply.sensorsLeft > 0) await ctx.db.patch(supply._id, { sensorsLeft: supply.sensorsLeft - 1, updatedAt: Date.now() });
  await scheduleReminder(ctx, (await ctx.db.get(id))!);
  return id;
}

function cleanSite(site: string | undefined): string | undefined {
  const s = site?.trim().slice(0, 30);
  return s ? s : undefined;
}

function checkStart(startedAt: number) {
  const now = Date.now();
  if (!Number.isFinite(startedAt) || startedAt > now + 5 * 60_000 || startedAt < now - 16 * DAY) {
    throw new ConvexError("Pick when the sensor went on, within the last 16 days");
  }
}

const viewerArgs = { ...legacyAuthArgs, code: v.optional(v.string()) };

/** The current sensor, the last few sites (newest first), sensors left, and whether this person can change it. */
export const current = query({
  args: viewerArgs,
  handler: async (ctx, a) => {
    const viewer = await sensorViewer(ctx, a);
    if (!viewer) return null;
    const recent = await ctx.db
      .query("sensorSessions")
      .withIndex("by_patient", (q) => q.eq("patientUserId", viewer.patientUserId))
      .order("desc")
      .take(6);
    const cur = recent[0];
    const supply = await supplyRow(ctx, viewer.patientUserId);
    return {
      childName: await childNameFor(ctx, viewer.patientUserId),
      canEdit: viewer.canEdit,
      sensor: cur
        ? {
            id: cur._id,
            kind: cur.kind,
            startedAt: cur.startedAt,
            endedAt: cur.endedAt ?? null,
            endedEarly: !!cur.endedEarly,
            site: cur.site ?? null,
            serial: cur.serial ?? null,
            // The pairing code only for people who can change the sensor.
            pairingCode: viewer.canEdit ? cur.pairingCode ?? null : null,
            expiresOn: cur.expiresOn ?? null,
            source: cur.source,
            setByName: cur.setByName,
          }
        : null,
      recentSites: recent.map((r) => r.site).filter((s): s is string => !!s).slice(0, 3),
      sensorsLeft: supply ? supply.sensorsLeft : null,
    };
  },
});

/** A new sensor went on (from the New sensor sheet, the question after connecting, or a confirmed gap). */
export const start = mutation({
  args: { ...viewerArgs, kind: kindArg, startedAt: v.number(), site: v.optional(v.string()), detected: v.optional(v.boolean()), tzOffsetMinutes: v.number(), ...labelArgs },
  handler: async (ctx, a) => {
    const viewer = await sensorViewer(ctx, a);
    if (!viewer?.canEdit) throw new ConvexError("You can't change the sensor from here");
    checkStart(a.startedAt);
    return await startSensor(ctx, viewer.patientUserId, {
      kind: a.kind,
      startedAt: a.startedAt,
      site: cleanSite(a.site),
      source: a.detected ? "detected" : "manual",
      setByName: viewer.name,
      tzOffsetMinutes: Math.round(a.tzOffsetMinutes),
      ...cleanLabel(a),
    });
  },
});

/** Fix the current sensor's type, start time or site. */
export const update = mutation({
  args: { ...viewerArgs, kind: v.optional(kindArg), startedAt: v.optional(v.number()), site: v.optional(v.string()), tzOffsetMinutes: v.number(), ...labelArgs },
  handler: async (ctx, a) => {
    const viewer = await sensorViewer(ctx, a);
    if (!viewer?.canEdit) throw new ConvexError("You can't change the sensor from here");
    const cur = await currentSession(ctx, viewer.patientUserId);
    if (!cur || cur.endedAt) throw new ConvexError("No sensor to change");
    if (a.startedAt != null) checkStart(a.startedAt);
    await ctx.db.patch(cur._id, {
      ...(a.kind ? { kind: a.kind } : {}),
      ...(a.startedAt != null ? { startedAt: a.startedAt } : {}),
      ...(a.site !== undefined ? { site: cleanSite(a.site) } : {}),
      ...(a.serial || a.gtin ? cleanLabel(a) : {}),
      tzOffsetMinutes: Math.round(a.tzOffsetMinutes),
      setByName: viewer.name,
    });
    await scheduleReminder(ctx, (await ctx.db.get(cur._id))!);
  },
});

/** The sensor stopped early (failed or fell off). */
export const endEarly = mutation({
  args: viewerArgs,
  handler: async (ctx, a) => {
    const viewer = await sensorViewer(ctx, a);
    if (!viewer?.canEdit) throw new ConvexError("You can't change the sensor from here");
    const cur = await currentSession(ctx, viewer.patientUserId);
    if (!cur || cur.endedAt) return;
    if (cur.reminderId) await ctx.scheduler.cancel(cur.reminderId).catch(() => {});
    await ctx.db.patch(cur._id, { endedAt: Date.now(), endedEarly: true, reminderId: undefined });
  },
});

/** Sensors left in the box (null stops counting). */
export const setSupply = mutation({
  args: { ...viewerArgs, sensorsLeft: v.union(v.number(), v.null()) },
  handler: async (ctx, a) => {
    const viewer = await sensorViewer(ctx, a);
    if (!viewer?.canEdit) throw new ConvexError("You can't change this from here");
    const row = await supplyRow(ctx, viewer.patientUserId);
    if (a.sensorsLeft == null) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    const n = Math.max(0, Math.min(99, Math.round(a.sensorsLeft)));
    if (row) await ctx.db.patch(row._id, { sensorsLeft: n, updatedAt: Date.now() });
    else await ctx.db.insert("sensorSupplies", { patientUserId: viewer.patientUserId, sensorsLeft: n, updatedAt: Date.now() });
  },
});

/**
 * From the Libre sync: the sensor's start time as LibreLinkUp reports it. A new start means a new
 * sensor; the same start (within 10 minutes) is the one already counted. Keeps a Libre Plus choice.
 */
export const recordLibreStart = internalMutation({
  args: { userId: v.id("users"), startedAt: v.number() },
  handler: async (ctx, a) => {
    const patientUserId = await circleBucketFor(ctx, a.userId);
    const now = Date.now();
    if (a.startedAt > now + 60 * 60_000 || a.startedAt < now - 16 * DAY) return;
    const cur = await currentSession(ctx, patientUserId);
    if (cur && Math.abs(cur.startedAt - a.startedAt) < 10 * 60_000) return;
    if (cur && a.startedAt < cur.startedAt) return; // an older sensor than the one we have
    const kind: SensorKind = cur?.kind === "libre15" ? "libre15" : "libre14";
    await startSensor(ctx, patientUserId, {
      kind,
      startedAt: a.startedAt,
      source: "libre",
      setByName: "Libre",
      tzOffsetMinutes: cur?.tzOffsetMinutes ?? -300,
    });
  },
});

/** The evening before: "Bella's sensor ends tomorrow at 7:12 AM." */
export const remind = internalMutation({
  args: { sessionId: v.id("sensorSessions") },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.sessionId);
    if (!row || row.endedAt) return;
    const latest = await currentSession(ctx, row.patientUserId);
    if (latest?._id !== row._id) return;
    await ctx.db.patch(row._id, { reminderId: undefined });
    const spec = SENSOR_SPECS[row.kind];
    const endsAt = row.startedAt + spec.days * DAY;
    const supply = await supplyRow(ctx, row.patientUserId);
    const child = await childNameFor(ctx, row.patientUserId);
    const when = clockAt(endsAt, row.tzOffsetMinutes);
    const grace = spec.graceHours > 0 ? `, with a ${spec.graceHours}-hour grace period after` : "";
    const stock =
      supply && supply.sensorsLeft <= LOW_SUPPLY
        ? ` ${supply.sensorsLeft === 0 ? "No sensors left in the box" : `Only ${supply.sensorsLeft} left in the box`}, time to reorder.`
        : " Have a spare ready.";
    await ctx.scheduler.runAfter(0, internal.sensor.notifyReminder, {
      patientUserId: row.patientUserId,
      title: `${child === "your child" ? "Your" : `${child}'s`} sensor ends tomorrow`,
      body: `It ends at ${when}${grace}.${stock}`,
    });
  },
});

export const notifyReminder = internalAction({
  args: { patientUserId: v.id("users"), title: v.string(), body: v.string() },
  handler: async (ctx, a): Promise<void> => {
    const tokens: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, { patientUserId: a.patientUserId, category: "sensor" });
    if (tokens.length === 0) return;
    await ctx.runAction(internal.push.deliver, { tokens, category: "sensor", title: a.title, body: a.body, data: { kind: "sensor_reminder" } });
  },
});
