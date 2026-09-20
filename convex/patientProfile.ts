import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";
import { doseSettingsByTime } from "./schema";
import { circleAnchorFor } from "./careCircle";

const accessLogEntry = v.object({
  id: v.string(),
  timestamp: v.string(),
  action: v.string(),
  actor: v.union(v.literal("owner"), v.literal("caregiver"), v.literal("doctor")),
});

/** Account-scoped alert prefs that travel with an access code: the four glucose thresholds plus
 *  the owner's Emergency Text Alerts toggle (mirrored LOCKED on kid/caregiver sessions). */
const alertPreferencesPayload = v.object({
  lowThreshold: v.optional(v.number()),
  highThreshold: v.optional(v.number()),
  urgentLowThreshold: v.optional(v.number()),
  urgentHighThreshold: v.optional(v.number()),
  emergencyAlertsEnabled: v.optional(v.boolean()),
  oneTapTextEnabled: v.optional(v.boolean()),
  waitWindowEnabled: v.optional(v.boolean()),
  waitWindowMinutes: v.optional(v.number()),
});

/** Matches mobile `UserProfile` (required + optional fields). */
export const patientProfilePayload = v.object({
  childName: v.string(),
  childLastName: v.optional(v.string()),
  parentName: v.optional(v.string()),
  parentLastName: v.optional(v.string()),
  accountRole: v.optional(v.union(v.literal("parent"), v.literal("adult"), v.literal("caregiver"))),
  organization: v.optional(v.string()),
  diabetesType: v.union(v.literal("type1"), v.literal("type2"), v.literal("other")),
  dateOfBirth: v.string(),
  weightLbs: v.optional(v.number()),
  doctorName: v.optional(v.string()),
  doctorEmail: v.optional(v.string()),
  doctorPhone: v.optional(v.string()),
  doctorInstitution: v.optional(v.string()),
  insulinTypes: v.optional(v.array(v.string())),
  profilePhotoUri: v.optional(v.string()),
  childModeEnabled: v.optional(v.boolean()),
  caregiverCode: v.optional(v.string()),
  caregiverCodeIssuedAt: v.optional(v.string()),
  doctorCode: v.optional(v.string()),
  doctorCodeIssuedAt: v.optional(v.string()),
  accessLog: v.optional(v.array(accessLogEntry)),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  doseSettingsByTime: v.optional(doseSettingsByTime),
});

function normalizeCaregiverCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/** Public lookup for caregiver login (code is the credential). */
export const getByCaregiverCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizeCaregiverCode(args.code);
    if (normalized.length !== 6) return null;
    const row = await ctx.db
      .query("patientProfiles")
      .withIndex("by_caregiverCode", (q) => q.eq("caregiverCode", normalized))
      .first();
    if (!row?.caregiverCode) return null;
    if (row.caregiverCode.toUpperCase() !== normalized) return null;
    return {
      userId: row.userId,
      childName: row.childName,
      parentName: row.parentName,
      accountRole: row.accountRole,
      diabetesType: row.diabetesType,
      dateOfBirth: row.dateOfBirth,
      weightLbs: row.weightLbs,
      doctorName: row.doctorName,
      doctorEmail: row.doctorEmail,
      doctorPhone: row.doctorPhone,
      doctorInstitution: row.doctorInstitution,
      insulinTypes: row.insulinTypes,
      profilePhotoUri: row.profilePhotoUri,
      childModeEnabled: row.childModeEnabled,
      caregiverCode: row.caregiverCode,
      caregiverCodeIssuedAt: row.caregiverCodeIssuedAt,
      doctorCode: row.doctorCode,
      doctorCodeIssuedAt: row.doctorCodeIssuedAt,
      accessLog: row.accessLog,
      carbRatio: row.carbRatio,
      targetGlucose: row.targetGlucose,
      correctionFactor: row.correctionFactor,
      doseSettingsByTime: row.doseSettingsByTime,
    };
  },
});

/**
 * DOSE SETTINGS ARE SERVER-OWNED.
 *
 * carbRatio / targetGlucose / correctionFactor / doseSettingsByTime used to ride along in the
 * whole-document `replace` below, so ANY client that saved ANY profile field also decided the dose
 * math — a device with a stale cache, an old app bundle, onboarding re-run after an empty profile
 * read. Each of those silently reverted or reset real ratios, for the owner and everyone who
 * inherits from them. Now:
 *   - `setDoseSettings` is the ONLY way to change them (explicit intent, validated, audited);
 *   - `replace` carries the existing values forward and records any attempt to change them;
 *   - `get` resolves a linked co-guardian's dose settings from the circle OWNER's row, so a member
 *     can never be shown (or dose from) the stale values on their own row.
 */
type DoseFields = {
  carbRatio?: number;
  targetGlucose?: number;
  correctionFactor?: number;
  doseSettingsByTime?: Doc<"patientProfiles">["doseSettingsByTime"];
};

function doseOf(row: DoseFields | null | undefined): DoseFields {
  return {
    carbRatio: row?.carbRatio,
    targetGlucose: row?.targetGlucose,
    correctionFactor: row?.correctionFactor,
    doseSettingsByTime: row?.doseSettingsByTime,
  };
}

function hasAnyDose(d: DoseFields): boolean {
  return d.carbRatio !== undefined || d.targetGlucose !== undefined || d.correctionFactor !== undefined || d.doseSettingsByTime !== undefined;
}

function sameDose(a: DoseFields, b: DoseFields): boolean {
  return (
    a.carbRatio === b.carbRatio &&
    a.targetGlucose === b.targetGlucose &&
    a.correctionFactor === b.correctionFactor &&
    JSON.stringify(a.doseSettingsByTime ?? null) === JSON.stringify(b.doseSettingsByTime ?? null)
  );
}

function auditValues(d: DoseFields) {
  return {
    ...(d.carbRatio !== undefined ? { carbRatio: d.carbRatio } : {}),
    ...(d.targetGlucose !== undefined ? { targetGlucose: d.targetGlucose } : {}),
    ...(d.correctionFactor !== undefined ? { correctionFactor: d.correctionFactor } : {}),
    hasTimeOverrides: d.doseSettingsByTime != null && Object.keys(d.doseSettingsByTime).length > 0,
  };
}

export const get = query({
  args: {
    ...legacyAuthArgs,
  },
  handler: async (ctx, args) => {
    const user = await userCompat(ctx, args);
    if (!user) return null;
    const row = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!row) return null;
    // A linked co-guardian inherits the circle owner's dose math. Resolve it HERE so every client —
    // including one whose overlay query hasn't landed, failed, or predates it — reads the right
    // numbers; the member's own row may hold stale values from before they joined.
    let dose = doseOf(row);
    const { anchor, isOwner } = await circleAnchorFor(ctx, user._id);
    if (!isOwner) {
      const ownerRow = await ctx.db
        .query("patientProfiles")
        .withIndex("by_userId", (q) => q.eq("userId", anchor))
        .unique();
      if (ownerRow && hasAnyDose(doseOf(ownerRow))) dose = doseOf(ownerRow);
    }
    return {
      childName: row.childName,
      childLastName: row.childLastName,
      parentName: row.parentName,
      parentLastName: row.parentLastName,
      accountRole: row.accountRole,
      organization: row.organization,
      diabetesType: row.diabetesType,
      dateOfBirth: row.dateOfBirth,
      weightLbs: row.weightLbs,
      doctorName: row.doctorName,
      doctorEmail: row.doctorEmail,
      doctorPhone: row.doctorPhone,
      doctorInstitution: row.doctorInstitution,
      insulinTypes: row.insulinTypes,
      profilePhotoUri: row.profilePhotoUri,
      childModeEnabled: row.childModeEnabled,
      caregiverCode: row.caregiverCode,
      caregiverCodeIssuedAt: row.caregiverCodeIssuedAt,
      doctorCode: row.doctorCode,
      doctorCodeIssuedAt: row.doctorCodeIssuedAt,
      accessLog: row.accessLog,
      carbRatio: dose.carbRatio,
      targetGlucose: dose.targetGlucose,
      correctionFactor: dose.correctionFactor,
      doseSettingsByTime: dose.doseSettingsByTime,
      alertPreferences: row.alertPreferences,
    };
  },
});

export const replace = mutation({
  args: {
    ...legacyAuthArgs,
    profile: patientProfilePayload,
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const existing = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const now = Date.now();
    // Dose settings: an existing row's values are carried forward untouched — this generic save
    // cannot change them (see the note above `get`). Only a row that has NONE yet (onboarding's first
    // write, or a legacy row from before they were stored server-side) takes them from the payload.
    const existingDose = doseOf(existing);
    const incomingDose = doseOf(args.profile);
    const keepExisting = !!existing && hasAnyDose(existingDose);
    const dose = keepExisting ? existingDose : incomingDose;
    const { isOwner } = await circleAnchorFor(ctx, user._id);
    if (keepExisting && isOwner && hasAnyDose(incomingDose) && !sameDose(existingDose, incomingDose)) {
      // A stale device / old bundle tried to write different dose math. Not applied — but recorded.
      await ctx.db.insert("doseSettingsAudit", {
        patientUserId: user._id,
        actorUserId: user._id,
        kind: "ignored",
        source: "profile-save",
        before: auditValues(existingDose),
        after: auditValues(incomingDose),
        at: now,
      });
    } else if (!keepExisting && hasAnyDose(incomingDose)) {
      await ctx.db.insert("doseSettingsAudit", {
        patientUserId: user._id,
        actorUserId: user._id,
        kind: "changed",
        source: existing ? "profile-save-initial" : "onboarding",
        before: auditValues(existingDose),
        after: auditValues(incomingDose),
        at: now,
      });
    }
    const doc = {
      userId: user._id,
      ...args.profile,
      carbRatio: dose.carbRatio,
      targetGlucose: dose.targetGlucose,
      correctionFactor: dose.correctionFactor,
      doseSettingsByTime: dose.doseSettingsByTime,
      doseSettingsUpdatedAt: keepExisting ? existing?.doseSettingsUpdatedAt : hasAnyDose(incomingDose) ? now : undefined,
      doseSettingsUpdatedBy: keepExisting ? existing?.doseSettingsUpdatedBy : hasAnyDose(incomingDose) ? (existing ? "profile-save-initial" : "onboarding") : undefined,
      // `replace` overwrites the whole doc and the profile payload carries no thresholds — carry the
      // account's existing alert thresholds forward so a profile save never wipes them.
      alertPreferences: existing?.alertPreferences,
      /**
       * Same carry-forward, extended to the SERVER-GENERATED / append-only fields. These are minted
       * by the app (access codes) or accumulated (the access log) — a client never deliberately
       * clears them through a profile save, so their absence from the payload means "not included",
       * never "delete this".
       *
       * Why this backstop exists: a client that reaches onboarding with an empty profile — e.g. an
       * offline sign-in that couldn't tell "no profile" from "couldn't reach the server" — would
       * otherwise replace the document and silently destroy the account's live caregiver code, doctor
       * code and entire access log. The client side of that is fixed too, but a whole-document
       * replace should not be one bug away from data loss.
       *
       * NOT carried forward: doctorName / doctorEmail / doctorPhone / doctorInstitution. Those are
       * user-editable, so a user clearing one must actually clear it.
       */
      caregiverCode: args.profile.caregiverCode ?? existing?.caregiverCode,
      caregiverCodeIssuedAt: args.profile.caregiverCodeIssuedAt ?? existing?.caregiverCodeIssuedAt,
      doctorCode: args.profile.doctorCode ?? existing?.doctorCode,
      doctorCodeIssuedAt: args.profile.doctorCodeIssuedAt ?? existing?.doctorCodeIssuedAt,
      accessLog:
        args.profile.accessLog && args.profile.accessLog.length > 0
          ? args.profile.accessLog
          : existing?.accessLog,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("patientProfiles", doc);
    }
  },
});

const inRange = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

/**
 * THE way to change dose settings. Explicit, validated, and audited: every change records who made
 * it, from where, the app version, and the before/after values — in `doseSettingsAudit` and as an
 * entry in the profile's access log, where the account holder can see it.
 *
 * Writes the caller's OWN row. A linked co-guardian inherits the owner's dose settings and cannot
 * set their own here (their row is shadowed while linked); the owner changes them for the circle.
 */
export const setDoseSettings = mutation({
  args: {
    ...legacyAuthArgs,
    carbRatio: v.number(),
    targetGlucose: v.number(),
    correctionFactor: v.number(),
    /** Per-meal-window overrides. `null` clears them; omitted leaves them as they are. */
    doseSettingsByTime: v.optional(v.union(doseSettingsByTime, v.null())),
    /** Where the change was made: "dashboard", "treatment-proposal", "onboarding", … */
    source: v.string(),
    appVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    if (!inRange(args.carbRatio, 1, 500) || !inRange(args.targetGlucose, 60, 300) || !inRange(args.correctionFactor, 1, 1000)) {
      throw new ConvexError("Dose settings are out of range.");
    }
    const { isOwner } = await circleAnchorFor(ctx, user._id);
    if (!isOwner) throw new ConvexError("Dose settings are inherited from the circle owner.");
    const existing = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (!existing) throw new ConvexError("No profile to attach dose settings to.");
    const before = doseOf(existing);
    const after: DoseFields = {
      carbRatio: args.carbRatio,
      targetGlucose: args.targetGlucose,
      correctionFactor: args.correctionFactor,
      doseSettingsByTime:
        args.doseSettingsByTime === undefined ? existing.doseSettingsByTime : args.doseSettingsByTime === null ? undefined : args.doseSettingsByTime,
    };
    if (sameDose(before, after)) return { changed: false };
    const now = Date.now();
    const source = args.source.slice(0, 40);
    const fmt = (d: DoseFields) => `CR ${d.carbRatio ?? "—"} · Target ${d.targetGlucose ?? "—"} · ISF ${d.correctionFactor ?? "—"}`;
    const entry = {
      id: `dose-${now}`,
      timestamp: new Date(now).toISOString(),
      action: `Dose settings changed (${source}): ${fmt(before)} → ${fmt(after)}`,
      actor: (source.startsWith("doctor") || source === "treatment-proposal" ? "doctor" : "owner") as "owner" | "doctor",
    };
    await ctx.db.patch(existing._id, {
      carbRatio: after.carbRatio,
      targetGlucose: after.targetGlucose,
      correctionFactor: after.correctionFactor,
      doseSettingsByTime: after.doseSettingsByTime,
      doseSettingsUpdatedAt: now,
      doseSettingsUpdatedBy: source,
      accessLog: [...(existing.accessLog ?? []), entry].slice(-50),
      updatedAt: now,
    });
    await ctx.db.insert("doseSettingsAudit", {
      patientUserId: user._id,
      actorUserId: user._id,
      kind: "changed",
      source,
      before: auditValues(before),
      after: auditValues(after),
      appVersion: args.appVersion?.slice(0, 60),
      at: now,
    });
    return { changed: true };
  },
});

/** Persist this account's glucose alert thresholds (account-scoped; travels with access codes). */
export const setAlertPreferences = mutation({
  args: {
    ...legacyAuthArgs,
    alertPreferences: alertPreferencesPayload,
  },
  handler: async (ctx, args) => {
    const user = await requireUserCompat(ctx, args);
    const existing = await ctx.db
      .query("patientProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    // Thresholds live on the profile row; if the profile hasn't been created yet there's nothing to
    // attach them to (onboarding writes the profile first), so silently no-op.
    if (!existing) return;
    await ctx.db.patch(existing._id, { alertPreferences: args.alertPreferences, updatedAt: Date.now() });
  },
});
