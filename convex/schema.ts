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
  /** Caregiver phone, when the app captures + syncs it (surfaced in the portal patient header). */
  caregiverPhone: v.optional(v.string()),
  diabetesType: v.string(),
  dateOfBirth: v.string(),
  weightLbs: v.optional(v.number()),
  doctorName: v.optional(v.string()),
  insulinTypes: v.optional(v.array(v.string())),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  /** Small (~192px JPEG) base64 data-URI of the patient's photo, synced from the app. */
  photoDataUri: v.optional(v.string()),
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

/**
 * A doctor-proposed treatment-setting change awaiting caregiver confirmation. At most one is
 * pending per access code (`doctorPortalState.therapyProposal`). Built server-side (api-server)
 * from the doctor's authenticated identity — never trusted from the mobile app.
 */
const therapyProposal = v.object({
  id: v.string(),
  proposedAt: v.string(),
  proposedByDoctorId: v.string(),
  proposedByName: v.string(),
  note: v.string(),
  carbRatio: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
});

/** The caregiver's decision on the most recent proposal (surfaced back to the doctor portal). */
const therapyDecision = v.object({
  proposalId: v.string(),
  status: v.union(v.literal("approved"), v.literal("declined")),
  decidedAt: v.string(),
});

/**
 * One entry in the treatment-settings change history. Auto-captured on sync whenever the patient's
 * carb ratio / correction factor / target glucose differs from the previous entry — so the portal
 * can show when each value changed and compare glucose trends before vs after.
 */
const settingsChange = v.object({
  changedAt: v.string(),
  carbRatio: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
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

/**
 * Guardian Mode PIN verifier — one row per authenticated patient account (`users`).
 * Hash/salt are server-only; client queries return safe status via `patientGuardianPin.getStatus`.
 */
const patientGuardianPins = defineTable({
  userId: v.id("users"),
  pinHash: v.string(),
  pinSalt: v.string(),
  hashVersion: v.number(),
  state: v.union(v.literal("active")),
  failedAttempts: v.number(),
  lastFailedAt: v.optional(v.number()),
  lockoutUntil: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  /** Sanitized marker when row was created via legacy missing-PIN recovery. */
  migrationMarker: v.optional(v.string()),
}).index("by_userId", ["userId"]);

/** Doctor portal accounts (separate from patient `users`). */
const doctorAccounts = defineTable({
  email: v.string(),
  passwordHash: v.string(),
  /** Full name for portal display, e.g. "Dr. Alex Rivera" (composed from the parts below). */
  displayName: v.string(),
  /** Structured name. `title` + `lastName` form the patient-facing byline on treatment proposals. */
  title: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  /** Clinical specialty / position shown in the portal (e.g. "Pediatric Endocrinology"). */
  specialty: v.optional(v.string()),
  /** Small (~256px JPEG) base64 data-URI avatar the doctor uploads in the portal. */
  photoDataUri: v.optional(v.string()),
  institution: v.optional(v.string()),
  /**
   * Account-level portal quick-unlock PIN (client-hashed; server stores/compares the hash only).
   * Lives on the account — not the device — so a doctor who signs in from any clinic computer
   * uses the same PIN instead of re-creating one per machine. The real auth boundary remains the
   * Bearer session; the PIN only re-gates an already-authenticated session after idle.
   */
  pinHash: v.optional(v.string()),
  pinUpdatedAt: v.optional(v.number()),
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

/**
 * Durable per-(user, provider) ingestion health + work-queue state for the Convex-owned CGM
 * ingestion system (`convex/cgmIngest.ts`). This is the source of truth for scheduling, leasing,
 * cursor, retry/backoff, and connection health — never console logs.
 *
 * One row per connected provider per user. Created/reset on connect (`patientCgm.replace`),
 * deleted on disconnect (`patientCgm.clear`), and lazily seeded for pre-existing connections by the
 * dispatcher. All operational fields beyond identity are optional so existing rows (and any future
 * migration) stay backward compatible.
 */
const cgmSyncState = defineTable({
  userId: v.id("users"),
  provider: v.union(v.literal("dexcom"), v.literal("libre")),

  // --- cursor / progress ---
  /** ISO timestamp of the latest successfully PERSISTED provider reading. Advances only after persistence. */
  lastReadingTimestamp: v.optional(v.string()),
  lastSuccessAt: v.optional(v.number()),
  lastAttemptAt: v.optional(v.number()),
  /** Last time a deep/reconcile fetch ran (drives interior-gap reconciliation cadence). */
  lastBackfillAt: v.optional(v.number()),

  // --- retry / health ---
  consecutiveFailures: v.number(),
  status: v.union(
    v.literal("ok"),
    v.literal("pending"),
    v.literal("retrying"),
    v.literal("needs_reconnect"), // invalid/expired credentials — user must reconnect
    v.literal("no_credentials"), // connected but no server-stored credentials to ingest with
    v.literal("connected_no_data"), // Libre: authenticated, patient found, no readings yet
    v.literal("no_shared_patient"), // Libre: authenticated, no shared connections
  ),
  /** Sanitized failure category (enum string from `cgm/core`); never raw provider/error text. */
  lastFailureCategory: v.optional(v.string()),
  lastFailureAt: v.optional(v.number()),
  /** Client-safe diagnostic category (see `convex/cgm/diagnostics.ts`). */
  providerDiagnosticCategory: v.optional(v.string()),
  /** Stable message key for mobile copy — not raw provider text. */
  providerDiagnosticMessageKey: v.optional(v.string()),
  /** Libre-only: count of shared connections on last successful provider contact. */
  libreConnectionCount: v.optional(v.number()),
  /** Whether the patient must reconnect (derived from diagnostic category). */
  reconnectRequired: v.optional(v.boolean()),
  /** Due time: the dispatcher only processes rows whose `nextEligibleAt <= now`. */
  nextEligibleAt: v.number(),
  /** True when inactivity exceeded provider retention so an interior period is unrecoverable. */
  unrecoverableGap: v.optional(v.boolean()),

  // --- lease (mutual exclusion across cron runs + expedited syncs) ---
  leaseOwner: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  /** Monotonic; bumped on every committed state update so stale workers cannot overwrite newer state. */
  generation: v.number(),

  updatedAt: v.number(),
})
  .index("by_user_provider", ["userId", "provider"])
  .index("by_due", ["nextEligibleAt"]);

/** One row per doctor access code: optional full patient payload (after sync), always carries messages thread. */
export default defineSchema({
  users,
  patientProfiles,
  patientGuardianPins,
  patientCgmConnections,
  patientDexcomCredentials,
  patientLibreCredentials,
  patientGlucoseReadings,
  cgmSyncState,
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
    /** A doctor-proposed change awaiting caregiver confirmation (cleared once decided). */
    therapyProposal: v.optional(therapyProposal),
    /** Outcome of the most recent proposal, shown back to the doctor portal. */
    therapyDecision: v.optional(therapyDecision),
    /** Chronological log of treatment-setting changes (oldest→newest), for trend comparison. */
    settingsHistory: v.optional(v.array(settingsChange)),
    syncedAt: v.optional(v.string()),
  }).index("by_accessCode", ["accessCode"]),
});
