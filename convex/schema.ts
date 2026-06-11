import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const doctorMessage = v.object({
  id: v.string(),
  timestamp: v.string(),
  text: v.string(),
  sender: v.union(v.literal("doctor"), v.literal("guardian")),
  read: v.boolean(),
});

const profile = v.object({
  childName: v.string(),
  parentName: v.optional(v.string()),
  diabetesType: v.string(),
  dateOfBirth: v.string(),
  weightLbs: v.optional(v.number()),
  doctorName: v.optional(v.string()),
  insulinTypes: v.optional(v.array(v.string())),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
});

const glucoseReading = v.object({
  value: v.number(),
  trend: v.string(),
  timestamp: v.string(),
});

const alertPreferences = v.object({
  lowThreshold: v.optional(v.number()),
  highThreshold: v.optional(v.number()),
  urgentLowThreshold: v.optional(v.number()),
  urgentHighThreshold: v.optional(v.number()),
});

/** Patient app accounts (email + legacy client hash). Source of truth for signup/signin. */
const users = defineTable({
  email: v.string(),
  passwordHash: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_email", ["email"]);

const patientAccessLogEntry = v.object({
  id: v.string(),
  timestamp: v.string(),
  action: v.string(),
  actor: v.union(v.literal("owner"), v.literal("caregiver"), v.literal("doctor")),
});

/** One profile row per Convex-backed patient user (mobile `UserProfile`). */
const patientProfiles = defineTable({
  userId: v.id("users"),
  childName: v.string(),
  parentName: v.optional(v.string()),
  accountRole: v.optional(v.union(v.literal("parent"), v.literal("adult"))),
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
  accessLog: v.optional(v.array(patientAccessLogEntry)),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  updatedAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_caregiverCode", ["caregiverCode"])
  .index("by_doctorCode", ["doctorCode"]);

/** Doctor portal accounts (separate from patient `users`). */
const doctorAccounts = defineTable({
  email: v.string(),
  passwordHash: v.string(),
  displayName: v.string(),
  institution: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_email", ["email"]);

/** Bearer session tokens for doctor API auth (token stored as SHA-256 hash). */
const doctorSessions = defineTable({
  doctorId: v.id("doctorAccounts"),
  tokenHash: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
})
  .index("by_tokenHash", ["tokenHash"])
  .index("by_doctorId", ["doctorId"]);

/** Persistent association between a doctor account and a patient access code. */
const doctorPatientLinks = defineTable({
  doctorId: v.id("doctorAccounts"),
  accessCode: v.string(),
  patientUserId: v.optional(v.id("users")),
  displayName: v.optional(v.string()),
  linkedAt: v.number(),
  revokedAt: v.optional(v.number()),
})
  .index("by_doctorId", ["doctorId"])
  .index("by_doctorId_accessCode", ["doctorId", "accessCode"])
  .index("by_accessCode", ["accessCode"]);

/** At most one CGM metadata row per Convex patient user (mobile `CGMConnection` when connected). */
const patientCgmConnections = defineTable({
  userId: v.id("users"),
  type: v.union(v.literal("dexcom"), v.literal("libre")),
  sessionId: v.optional(v.string()),
  token: v.optional(v.string()),
  outsideUS: v.optional(v.boolean()),
  libreApiBase: v.optional(v.string()),
  connectedAt: v.optional(v.string()),
  updatedAt: v.number(),
}).index("by_userId", ["userId"]);

/**
 * Server-only Dexcom Share credentials (API + Convex secret gate).
 * Not exposed to mobile queries; used for silent session refresh.
 */
const patientDexcomCredentials = defineTable({
  userId: v.id("users"),
  dexcomUsername: v.string(),
  dexcomPassword: v.string(),
  outsideUS: v.boolean(),
  updatedAt: v.number(),
}).index("by_userId", ["userId"]);

/**
 * Server-only LibreLink Up credentials (API + Convex secret gate).
 * Not exposed to mobile queries; used for silent session refresh.
 */
const patientLibreCredentials = defineTable({
  userId: v.id("users"),
  libreEmail: v.string(),
  librePassword: v.string(),
  libreApiBase: v.optional(v.string()),
  updatedAt: v.number(),
}).index("by_userId", ["userId"]);

/** Patient glucose readings (mobile `GlucoseEntry`); dedupe by `userId` + `timestamp`. */
const patientGlucoseReadings = defineTable({
  userId: v.id("users"),
  glucose: v.number(),
  timestamp: v.string(),
  anomaly: v.object({
    warning: v.boolean(),
    message: v.optional(v.string()),
  }),
  dexcomTrend: v.optional(v.union(v.number(), v.string())),
}).index("by_user_time", ["userId", "timestamp"]);

/** One row per doctor access code: optional full patient payload (after sync), always carries messages thread. */
export default defineSchema({
  users,
  patientProfiles,
  patientCgmConnections,
  patientDexcomCredentials,
  patientLibreCredentials,
  patientGlucoseReadings,
  doctorAccounts,
  doctorSessions,
  doctorPatientLinks,
  doctorPortalState: defineTable({
    accessCode: v.string(),
    messages: v.array(doctorMessage),
    profile: v.optional(profile),
    glucoseReadings: v.optional(v.array(glucoseReading)),
    insulinLog: v.optional(v.array(v.any())),
    foodLog: v.optional(v.array(v.any())),
    alertPreferences: v.optional(alertPreferences),
    syncedAt: v.optional(v.string()),
  }).index("by_accessCode", ["accessCode"]),
});
