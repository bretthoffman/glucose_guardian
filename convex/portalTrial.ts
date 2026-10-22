/**
 * One-time Doctor Portal pass (see the portalTrialPasses table). The app asks for the family's
 * pass when it builds a Visit Summary PDF; the api-server redeems it for a doctor and reads the
 * patient's data through the trial* queries, view only, for 24 hours from first use.
 *
 * Trust model: the family functions use the normal account auth; the doctor-side functions take
 * the server secret (only the api-server calls them) plus the pass code itself.
 */
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";
import { circleBucketFor } from "./careLogs";
import { careLogsForUser, glucoseHistoryForUser, patientProfileRecord, requireDoctorApiSecret } from "./doctorAccounts";

export const PASS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** An unused pass is replaced after this long, so an old PDF's code doesn't open data forever. */
export const UNUSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** No 0/O, 1/I/L: easy to read off paper and type. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 7;

/** "gg-7kq4 m2x" → "7KQ4M2X". */
export function normalizePassCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^GG/, "").slice(0, CODE_LEN);
}

/** "7KQ4M2X" → "GG-7KQ4-M2X" (how it's printed). */
export function formatPassCode(code: string): string {
  return `GG-${code.slice(0, 4)}-${code.slice(4)}`;
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

async function passesFor(ctx: QueryCtx | MutationCtx, patientUserId: Id<"users">) {
  return await ctx.db.query("portalTrialPasses").withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId)).collect();
}

type PassState =
  | { state: "none" }
  | { state: "ready"; code: string; createdAt: number }
  | { state: "active"; code: string; expiresAt: number }
  | { state: "used"; usedAt: number }
  | { state: "off" };

/** Where the family's pass stands. "used" and "off" are final: no new pass is made after them. */
function stateOf(passes: Doc<"portalTrialPasses">[], now: number): PassState {
  const used = passes.find((p) => p.firstUsedAt != null);
  if (used) {
    const expiresAt = used.firstUsedAt! + PASS_WINDOW_MS;
    if (used.revokedAt == null && now < expiresAt) return { state: "active", code: formatPassCode(used.code), expiresAt };
    return { state: "used", usedAt: used.firstUsedAt! };
  }
  if (passes.some((p) => p.revokedAt != null)) return { state: "off" };
  const live = passes.filter((p) => now - p.createdAt < UNUSED_TTL_MS).sort((a, b) => b.createdAt - a.createdAt)[0];
  return live ? { state: "ready", code: formatPassCode(live.code), createdAt: live.createdAt } : { state: "none" };
}

async function addAccessLog(ctx: MutationCtx, patientUserId: Id<"users">, action: string, actor: "owner" | "doctor") {
  const profile = await ctx.db.query("patientProfiles").withIndex("by_userId", (q) => q.eq("userId", patientUserId)).unique();
  if (!profile) return;
  const now = Date.now();
  await ctx.db.patch(profile._id, {
    accessLog: [...(profile.accessLog ?? []), { id: `portal-pass-${now}`, timestamp: new Date(now).toISOString(), action, actor }].slice(-50),
  });
}

// ─── Family side (the app) ─────────────────────────────────────────────────────────────────────

/** The pass's status for the Doctor Office screen. */
export const passStatus = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const patientUserId = await circleBucketFor(ctx, user._id);
    return stateOf(await passesFor(ctx, patientUserId), Date.now());
  },
});

/**
 * The code to print on a Visit Summary: the family's unused pass (made now if there isn't one),
 * or null once a doctor has used it or the family turned it off.
 */
export const passForReport = mutation({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const patientUserId = await circleBucketFor(ctx, user._id);
    const now = Date.now();
    const state = stateOf(await passesFor(ctx, patientUserId), now);
    if (state.state === "ready") return { code: state.code };
    if (state.state !== "none") return { code: null };
    let code = randomCode();
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db.query("portalTrialPasses").withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!clash) break;
      code = randomCode();
    }
    await ctx.db.insert("portalTrialPasses", { patientUserId, code, createdAt: now });
    return { code: formatPassCode(code) };
  },
});

/** The family turns the pass off. It can't be turned back on, and no new one is made. */
export const turnOffPass = mutation({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const patientUserId = await circleBucketFor(ctx, user._id);
    const now = Date.now();
    const passes = await passesFor(ctx, patientUserId);
    let changed = false;
    for (const p of passes) {
      if (p.revokedAt == null) {
        await ctx.db.patch(p._id, { revokedAt: now });
        changed = true;
      }
    }
    if (passes.length === 0) {
      // Turning it off before any PDF was made: record an "off" pass so none is ever printed.
      await ctx.db.insert("portalTrialPasses", { patientUserId, code: randomCode(), createdAt: now, revokedAt: now });
      changed = true;
    }
    if (changed) await addAccessLog(ctx, patientUserId, "Doctor Portal pass turned off", "owner");
    return { ok: true as const };
  },
});

// ─── Doctor side (api-server only) ─────────────────────────────────────────────────────────────

/**
 * A doctor enters the code. The first use starts the 24 hours and is recorded in the family's
 * access history. Returns why it can't be used, if it can't.
 */
export const redeem = mutation({
  args: { serverSecret: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const code = normalizePassCode(args.code);
    if (code.length !== CODE_LEN) return { ok: false as const, reason: "invalid" as const };
    const row = await ctx.db.query("portalTrialPasses").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (!row || row.revokedAt != null) return { ok: false as const, reason: "invalid" as const };
    const now = Date.now();
    let firstUsedAt = row.firstUsedAt;
    if (firstUsedAt == null) {
      if (now - row.createdAt >= UNUSED_TTL_MS) return { ok: false as const, reason: "expired" as const };
      // Only the family's first pass can ever be used.
      const others = await passesFor(ctx, row.patientUserId);
      if (others.some((p) => p._id !== row._id && p.firstUsedAt != null)) return { ok: false as const, reason: "expired" as const };
      firstUsedAt = now;
      await ctx.db.patch(row._id, { firstUsedAt });
      await addAccessLog(ctx, row.patientUserId, "A doctor opened the Doctor Portal pass (view only, 24 hours)", "doctor");
    }
    const expiresAt = firstUsedAt + PASS_WINDOW_MS;
    if (now >= expiresAt) return { ok: false as const, reason: "expired" as const };
    const profile = await ctx.db.query("patientProfiles").withIndex("by_userId", (q) => q.eq("userId", row.patientUserId)).unique();
    return { ok: true as const, expiresAt, patientName: profile?.childName ?? "Patient" };
  },
});

/** The patient behind a pass that is in its 24 hours right now, else null. */
async function activePatient(ctx: QueryCtx, rawCode: string) {
  const code = normalizePassCode(rawCode);
  if (code.length !== CODE_LEN) return null;
  const row = await ctx.db.query("portalTrialPasses").withIndex("by_code", (q) => q.eq("code", code)).first();
  if (!row || row.revokedAt != null || row.firstUsedAt == null) return null;
  const expiresAt = row.firstUsedAt + PASS_WINDOW_MS;
  if (Date.now() >= expiresAt) return null;
  return { patientUserId: row.patientUserId, expiresAt };
}

export const trialProfile = query({
  args: { serverSecret: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const active = await activePatient(ctx, args.code);
    if (!active) return null;
    const row = await ctx.db.query("patientProfiles").withIndex("by_userId", (q) => q.eq("userId", active.patientUserId)).unique();
    if (!row) return null;
    return { ...patientProfileRecord(row), expiresAt: active.expiresAt };
  },
});

export const trialGlucose = query({
  args: { serverSecret: v.string(), code: v.string(), fromTimestamp: v.string(), toTimestamp: v.string() },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const active = await activePatient(ctx, args.code);
    if (!active) return null;
    return await glucoseHistoryForUser(ctx, active.patientUserId, args.fromTimestamp, args.toTimestamp);
  },
});

export const trialLogs = query({
  args: { serverSecret: v.string(), code: v.string(), fromTimestamp: v.string(), toTimestamp: v.string() },
  handler: async (ctx, args) => {
    requireDoctorApiSecret(args.serverSecret);
    const active = await activePatient(ctx, args.code);
    if (!active) return null;
    return await careLogsForUser(ctx, active.patientUserId, args.fromTimestamp, args.toTimestamp);
  },
});
