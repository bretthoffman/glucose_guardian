/**
 * Backend-sent push notifications — the piece that makes alerts arrive with the app CLOSED
 * (see PREBUILD_PLAN_01 §2). Local notifications in `services/notifications.ts` only fire while the
 * app is running; everything here is decided and sent by the server.
 *
 * Shape: devices register a token (`registerToken`) against their identity — a signed-in guardian or
 * an access-code session. Events (a logged dose/meal, a message, a glucose threshold crossing)
 * schedule `deliver`, which resolves recipient tokens from the circle roster, filters by each
 * device's server-side prefs, and POSTs to the Expo Push API.
 *
 * NOTE: guardian auth still uses the legacy `{userId, passwordHash}` pattern for consistency with the
 * other ~69 signatures. It gets migrated with everything else in the Clerk cutover (§3).
 */
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";
import { careAccessAllowed, type CareAccess } from "./careSchedule";
import {
  soundKeyForCategory,
  DEFAULT_PUSH_PREFS,
  EXPO_BATCH_SIZE,
  EXPO_PUSH_URL,
  buildExpoMessage,
  careLogCopy,
  categoryForGlucose,
  chunk,
  classifyGlucose,
  glucoseCopy,
  messageCopy,
  shouldSendGlucoseAlert,
  type ExpoPushMessage,
  type GlucoseAlertKind,
  type PushCategory,
} from "./pushLogic";

const pushPrefsPayload = v.object({
  glucoseUrgent: v.boolean(),
  glucoseHighLow: v.boolean(),
  careLog: v.boolean(),
  messages: v.boolean(),
  doctor: v.boolean(),
});

// ── auth helpers (same pattern as careLogs / careMessages) ───────────────────────────────────

function normalizeCareCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

async function resolveActiveAccessCode(ctx: QueryCtx | MutationCtx, rawCode: string) {
  const code = normalizeCareCode(rawCode);
  if (code.length !== 8) return null;
  const row = await ctx.db.query("careAccessCodes").withIndex("by_code", (q) => q.eq("code", code)).first();
  return row && row.status === "active" ? row : null;
}

/** Identity a device registers under: a guardian account, or an access code. */
type Owner = { userId: Id<"users">; code?: undefined } | { userId?: undefined; code: string };

async function resolveOwner(
  ctx: MutationCtx,
  args: { userId?: Id<"users">; passwordHash?: string; code?: string },
): Promise<Owner | null> {
  if (args.code != null) {
    const row = await resolveActiveAccessCode(ctx, args.code);
    return row ? { code: row.code } : null;
  }
  const user = await userCompat(ctx, args);
  if (user) return { userId: user._id };
  return null;
}

// ── device registration + preferences ────────────────────────────────────────────────────────

/** Upsert this device's Expo push token. Idempotent: re-registering re-points an existing token. */
export const registerToken = mutation({
  args: {
    userId: v.optional(v.id("users")),
    passwordHash: v.optional(v.string()),
    code: v.optional(v.string()),
    token: v.string(),
    platform: v.string(),
  },
  handler: async (ctx, args) => {
    const owner = await resolveOwner(ctx, args);
    if (!owner) throw new ConvexError("Unauthorized");
    const now = Date.now();
    const existing = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (existing) {
      // The same physical device may switch identities (guardian signs out, kid code signs in).
      await ctx.db.patch(existing._id, {
        userId: owner.userId,
        code: owner.code,
        platform: args.platform,
        updatedAt: now,
        disabledAt: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("pushTokens", {
      token: args.token,
      userId: owner.userId,
      code: owner.code,
      platform: args.platform,
      prefs: { ...DEFAULT_PUSH_PREFS },
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Stop sending to this device (sign-out). Keeps the row so prefs survive a re-register. */
export const unregisterToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (row) await ctx.db.patch(row._id, { disabledAt: Date.now(), updatedAt: Date.now() });
  },
});

export const setPrefs = mutation({
  args: { token: v.string(), prefs: pushPrefsPayload },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (!row) throw new ConvexError("This device isn't registered for alerts");
    await ctx.db.patch(row._id, { prefs: args.prefs, updatedAt: Date.now() });
  },
});

/** Per-device custom alert sounds — bundled filenames validated client-side against the app's list. */
export const setSounds = mutation({
  args: {
    token: v.string(),
    sounds: v.object({
      glucose: v.optional(v.string()),
      urgent: v.optional(v.string()),
      messages: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (!row) throw new ConvexError("This device isn't registered for alerts");
    await ctx.db.patch(row._id, { sounds: args.sounds, updatedAt: Date.now() });
  },
});

export const getPrefs = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", args.token)).first();
    if (!row || row.disabledAt != null) return null;
    return { prefs: row.prefs, platform: row.platform, sounds: row.sounds ?? {} };
  },
});

/** Expo told us a token is dead (app uninstalled) — stop sending to it. */
export const disableTokens = internalMutation({
  args: { tokens: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const token of args.tokens) {
      const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).first();
      if (row) await ctx.db.patch(row._id, { disabledAt: Date.now(), updatedAt: Date.now() });
    }
  },
});

// ── recipient resolution ─────────────────────────────────────────────────────────────────────

async function circleGuardianIds(ctx: QueryCtx, patientUserId: Id<"users">): Promise<Id<"users">[]> {
  const links = await ctx.db
    .query("careLinks")
    .withIndex("by_patient", (q) => q.eq("patientUserId", patientUserId).eq("status", "active"))
    .collect();
  return [patientUserId, ...links.map((l) => l.memberUserId)];
}

/**
 * Every live device in the circle that wants this category, minus the actor who caused the event.
 * Access-code devices are skipped while outside their schedule window — the same lock the rest of the
 * app applies, so a babysitter isn't pinged at midnight about a family they no longer have access to.
 */
export const collectTokens = internalQuery({
  args: {
    patientUserId: v.id("users"),
    category: v.string(),
    excludeUserId: v.optional(v.id("users")),
    excludeCode: v.optional(v.string()),
    /** When set, only these endpoints are notified (used for direct messages). */
    onlyUserId: v.optional(v.id("users")),
    onlyCode: v.optional(v.string()),
    /**
     * Device-group scope for the wait-window flow: "owner" = the patient account's own devices,
     * "coGuardians" = other guardian ACCOUNTS, "codes" = access-code devices only. Absent = all.
     */
    scope: v.optional(v.union(v.literal("owner"), v.literal("coGuardians"), v.literal("codes"))),
  },
  handler: async (ctx, args) => {
    const category = args.category as PushCategory;
    const soundKey = soundKeyForCategory(category);
    const out: { token: string; sound?: string }[] = [];
    const wants = (prefs: Record<string, boolean>) => prefs[category] !== false;
    const soundOf = (row: { sounds?: { glucose?: string; urgent?: string; messages?: string } }) => {
      const file = soundKey ? row.sounds?.[soundKey] : undefined;
      return file ? { sound: file } : {};
    };

    let guardianIds = args.onlyUserId
      ? [args.onlyUserId]
      : args.onlyCode
        ? []
        : await circleGuardianIds(ctx, args.patientUserId);
    if (args.scope === "owner") guardianIds = guardianIds.filter((id) => id === args.patientUserId);
    else if (args.scope === "coGuardians") guardianIds = guardianIds.filter((id) => id !== args.patientUserId);
    else if (args.scope === "codes") guardianIds = [];
    for (const userId of guardianIds) {
      if (args.excludeUserId && userId === args.excludeUserId) continue;
      const rows = await ctx.db.query("pushTokens").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
      for (const r of rows) if (r.disabledAt == null && wants(r.prefs)) out.push({ token: r.token, ...soundOf(r) });
    }

    const codes = args.onlyCode
      ? await (async () => {
          const row = await resolveActiveAccessCode(ctx, args.onlyCode!);
          return row ? [row] : [];
        })()
      : args.onlyUserId || args.scope === "owner" || args.scope === "coGuardians"
        ? []
        : await ctx.db
            .query("careAccessCodes")
            .withIndex("by_patient", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "active"))
            .collect();
    const now = Date.now();
    for (const c of codes) {
      if (args.excludeCode && c.code === args.excludeCode) continue;
      if (!careAccessAllowed(c.access as CareAccess, now)) continue;
      const rows = await ctx.db.query("pushTokens").withIndex("by_code", (q) => q.eq("code", c.code)).collect();
      for (const r of rows) if (r.disabledAt == null && wants(r.prefs)) out.push({ token: r.token, ...soundOf(r) });
    }

    // Dedupe by token (a device could appear via account AND code rows) — first hit wins.
    const seen = new Set<string>();
    return out.filter((t) => (seen.has(t.token) ? false : (seen.add(t.token), true)));
  },
});

// ── delivery ─────────────────────────────────────────────────────────────────────────────────

/** POST to Expo in batches; disable any token Expo reports as dead. */
export const deliver = internalAction({
  args: {
    tokens: v.array(v.object({ token: v.string(), sound: v.optional(v.string()) })),
    category: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    if (args.tokens.length === 0) return { sent: 0 };
    const category = args.category as PushCategory;
    const messages: ExpoPushMessage[] = args.tokens.map((t) =>
      buildExpoMessage({ token: t.token, category, copy: { title: args.title, body: args.body }, data: args.data, soundFile: t.sound }),
    );

    const dead: string[] = [];
    let sent = 0;
    for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(batch),
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        (json.data ?? []).forEach((ticket, i) => {
          if (ticket.status === "ok") sent++;
          else if (ticket.details?.error === "DeviceNotRegistered") dead.push(batch[i].to);
        });
      } catch {
        // Network blip — the event is transient, so we drop it rather than retry-storm.
      }
    }
    if (dead.length > 0) await ctx.runMutation(internal.push.disableTokens, { tokens: dead });
    return { sent };
  },
});

// ── event entry points (scheduled from the mutations that cause them) ────────────────────────

export const notifyCareLog = internalAction({
  args: {
    patientUserId: v.id("users"),
    authorName: v.string(),
    patientName: v.string(),
    kind: v.union(v.literal("food"), v.literal("insulin")),
    units: v.optional(v.number()),
    carbs: v.optional(v.number()),
    foodName: v.optional(v.string()),
    excludeUserId: v.optional(v.id("users")),
    excludeCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const tokens: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, {
      patientUserId: args.patientUserId,
      category: "careLog",
      excludeUserId: args.excludeUserId,
      excludeCode: args.excludeCode,
    });
    if (tokens.length === 0) return;
    const copy = careLogCopy(args);
    await ctx.runAction(internal.push.deliver, {
      tokens,
      category: "careLog",
      title: copy.title,
      body: copy.body,
      data: { kind: "care_log" },
    });
  },
});

export const notifyMessage = internalAction({
  args: {
    patientUserId: v.id("users"),
    senderName: v.string(),
    text: v.string(),
    threadKey: v.string(),
    toUserId: v.optional(v.id("users")),
    toCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const tokens: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, {
      patientUserId: args.patientUserId,
      category: "messages",
      onlyUserId: args.toUserId,
      onlyCode: args.toCode,
    });
    if (tokens.length === 0) return;
    const copy = messageCopy({ senderName: args.senderName, text: args.text });
    await ctx.runAction(internal.push.deliver, {
      tokens,
      category: "messages",
      title: copy.title,
      body: copy.body,
      data: { kind: "care_message", threadKey: args.threadKey },
    });
  },
});

export const notifyGlucose = internalAction({
  args: {
    patientUserId: v.id("users"),
    patientName: v.string(),
    value: v.number(),
    kind: v.string(),
    trendLabel: v.optional(v.string()),
    /** Wait-window flow: restrict to one device group (owner / coGuardians / codes). */
    scope: v.optional(v.union(v.literal("owner"), v.literal("coGuardians"), v.literal("codes"))),
    /** Extra sentence appended to the body (the owner's "confirm you are okay" line). */
    bodySuffix: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const kind = args.kind as GlucoseAlertKind;
    const category = categoryForGlucose(kind);
    const tokens: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, {
      patientUserId: args.patientUserId,
      category,
      ...(args.scope ? { scope: args.scope } : {}),
    });
    if (tokens.length === 0) return;
    const copy = glucoseCopy({ kind, value: args.value, patientName: args.patientName, trendLabel: args.trendLabel });
    await ctx.runAction(internal.push.deliver, {
      tokens,
      category,
      title: copy.title,
      body: args.bodySuffix ? `${copy.body} ${args.bodySuffix}` : copy.body,
      data: { kind: "glucose_alert", glucose: args.value, status: kind },
    });
  },
});

/** Resolve thresholds + name, classify the reading, and fire when the cooldown allows. */
export const evaluateGlucoseForPush = internalMutation({
  args: { patientUserId: v.id("users"), value: v.number() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.patientUserId))
      .unique();
    const kind = classifyGlucose(args.value, profile?.alertPreferences ?? {});
    if (!kind) return;

    const rows = await ctx.db
      .query("pushAlertState")
      .withIndex("by_patient_kind", (q) => q.eq("patientUserId", args.patientUserId).eq("kind", kind))
      .collect();
    const state = rows[0] ?? null;
    const now = Date.now();
    if (!shouldSendGlucoseAlert({ kind, lastKind: state ? kind : null, lastSentAt: state?.lastSentAt ?? null, nowMs: now })) {
      return;
    }
    if (state) await ctx.db.patch(state._id, { lastSentAt: now, lastValue: args.value });
    else await ctx.db.insert("pushAlertState", { patientUserId: args.patientUserId, kind, lastSentAt: now, lastValue: args.value });

    const patientName = profile?.childName?.trim() || "Your child";
    const prefs = profile?.alertPreferences ?? {};
    const isUrgent = kind === "urgent_low" || kind === "urgent_high";
    const waitMinutes = Math.min(15, Math.max(1, Math.round(prefs.waitWindowMinutes ?? 5)));
    const waitOn =
      profile?.accountRole === "adult" && prefs.waitWindowEnabled === true && isUrgent;
    // FAILSAFE (wait-window accounts only): beyond these extremes the caregiver alert is NEVER
    // held — code devices are alerted immediately no matter what is pending or pressed.
    const failsafe = waitOn && (args.value < 30 || args.value > 350);

    if (waitOn && !failsafe) {
      // The adult's own devices alert now, with the confirm line appended; co-guardian ACCOUNTS
      // alert now unchanged; access-CODE devices wait for the window (or an early release).
      await ctx.scheduler.runAfter(0, internal.push.notifyGlucose, {
        patientUserId: args.patientUserId,
        patientName,
        value: args.value,
        kind,
        scope: "owner",
        bodySuffix: `Please confirm you are okay in the next ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"} before a caregiver alert is sent out.`,
      });
      await ctx.scheduler.runAfter(0, internal.push.notifyGlucose, {
        patientUserId: args.patientUserId,
        patientName,
        value: args.value,
        kind,
        scope: "coGuardians",
      });
      // One active hold at a time — a second urgent event during a pending window rides the first.
      const pending = await ctx.db
        .query("emergencyWaits")
        .withIndex("by_patient_status", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "pending"))
        .first();
      if (!pending) {
        const waitId = await ctx.db.insert("emergencyWaits", {
          patientUserId: args.patientUserId,
          kind,
          value: args.value,
          minutes: waitMinutes,
          createdAt: now,
          fireAt: now + waitMinutes * 60_000,
          status: "pending",
        });
        await ctx.scheduler.runAfter(waitMinutes * 60_000, internal.push.fireEmergencyWait, { waitId });
      }
      return;
    }

    if (failsafe) {
      // Release any pending hold so its timer becomes a no-op — this immediate alert covers codes.
      const pending = await ctx.db
        .query("emergencyWaits")
        .withIndex("by_patient_status", (q) => q.eq("patientUserId", args.patientUserId).eq("status", "pending"))
        .collect();
      for (const w of pending) await ctx.db.patch(w._id, { status: "fired" });
    }

    await ctx.scheduler.runAfter(0, internal.push.notifyGlucose, {
      patientUserId: args.patientUserId,
      patientName,
      value: args.value,
      kind,
    });
  },
});

/** The wait window elapsed with no "I am OK": deliver the held caregiver (code-device) alert. */
export const fireEmergencyWait = internalMutation({
  args: { waitId: v.id("emergencyWaits") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.waitId);
    if (!row || row.status !== "pending") return; // confirmed OK, alerted early, or failsafe-covered
    await ctx.db.patch(row._id, { status: "fired" });
    const profile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", row.patientUserId))
      .unique();
    await ctx.scheduler.runAfter(0, internal.push.notifyGlucose, {
      patientUserId: row.patientUserId,
      patientName: profile?.childName?.trim() || "Your child",
      value: row.value,
      kind: row.kind,
      scope: "codes",
    });
  },
});

/** The adult's pending confirm window, if any — drives the in-app "are you okay?" popup. */
export const pendingEmergencyWait = query({
  args: { ...legacyAuthArgs },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const row = await ctx.db
      .query("emergencyWaits")
      .withIndex("by_patient_status", (q) => q.eq("patientUserId", user._id).eq("status", "pending"))
      .first();
    if (!row) return null;
    return { waitId: row._id, kind: row.kind, value: row.value, minutes: row.minutes, fireAt: row.fireAt };
  },
});

/** The adult's answer to the confirm popup: "ok" cancels the caregiver alert; "alertNow" fires it. */
export const resolveEmergencyWait = mutation({
  args: { ...legacyAuthArgs, waitId: v.id("emergencyWaits"), decision: v.union(v.literal("ok"), v.literal("alertNow")) },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const row = await ctx.db.get(args.waitId);
    if (!row || row.patientUserId !== user._id) throw new ConvexError("Not allowed");
    if (row.status !== "pending") return; // timer already fired / already resolved — idempotent
    if (args.decision === "ok") {
      await ctx.db.patch(row._id, { status: "canceled" });
      return;
    }
    await ctx.db.patch(row._id, { status: "fired" });
    const profile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", row.patientUserId))
      .unique();
    await ctx.scheduler.runAfter(0, internal.push.notifyGlucose, {
      patientUserId: row.patientUserId,
      patientName: profile?.childName?.trim() || "Your child",
      value: row.value,
      kind: row.kind,
      scope: "codes",
    });
  },
});

// ── doctor-portal events ─────────────────────────────────────────────────────────────────────

/** Resolve the patient behind a DOCTOR access code (the code the portal talks to the bridge with). */
export const resolveDoctorCode = internalQuery({
  args: { accessCode: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("patientProfiles")
      .withIndex("by_doctorCode", (q) => q.eq("doctorCode", args.accessCode))
      .first();
    if (!profile) return null;
    return { patientUserId: profile.userId, patientName: profile.childName?.trim() || "your child" };
  },
});

/**
 * Push for doctor-portal events (new message / treatment proposal) — the "doctor" category, so the
 * guardian hears about care-team activity even with the app closed. Fired from convex/doctor.ts.
 */
export const notifyDoctor = internalAction({
  args: { accessCode: v.string(), title: v.string(), body: v.string(), data: v.optional(v.any()) },
  handler: async (ctx, args): Promise<void> => {
    const target = await ctx.runQuery(internal.push.resolveDoctorCode, { accessCode: args.accessCode });
    if (!target) return;
    const tokens: { token: string; sound?: string }[] = await ctx.runQuery(internal.push.collectTokens, {
      patientUserId: target.patientUserId,
      category: "doctor",
    });
    if (tokens.length === 0) return;
    await ctx.runAction(internal.push.deliver, {
      tokens,
      category: "doctor",
      title: args.title,
      body: args.body,
      data: args.data ?? { kind: "doctor" },
    });
  },
});
