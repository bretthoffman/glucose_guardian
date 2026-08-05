import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { legacyAuthArgs, requireUserCompat, userCompat } from "./identity";
import { doseSettingsByTime } from "./schema";

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
      carbRatio: row.carbRatio,
      targetGlucose: row.targetGlucose,
      correctionFactor: row.correctionFactor,
      doseSettingsByTime: row.doseSettingsByTime,
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
    const doc = {
      userId: user._id,
      ...args.profile,
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
