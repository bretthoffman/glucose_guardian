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

/** A lab-measured A1C the doctor recorded in the portal (compared against the estimated GMI). */
const labA1c = v.object({
  value: v.number(),
  measuredAt: v.string(),
  enteredByDoctorId: v.string(),
  enteredByName: v.string(),
  enteredAt: v.string(),
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
  /** Optional last name for the child/adult/nurse (first name stays in `childName`). */
  childLastName: v.optional(v.string()),
  parentName: v.optional(v.string()),
  /** Optional last name for the guardian (first name stays in `parentName`). */
  parentLastName: v.optional(v.string()),
  accountRole: v.optional(v.union(v.literal("parent"), v.literal("adult"), v.literal("caregiver"))),
  /** Caregiver (school nurse) accounts: the org they're with, e.g. a school name. Optional. */
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
  accessLog: v.optional(v.array(patientAccessLogEntry)),
  carbRatio: v.optional(v.number()),
  targetGlucose: v.optional(v.number()),
  correctionFactor: v.optional(v.number()),
  // Glucose alert thresholds, account-scoped so an access-code (kid/caregiver) device shows the
  // code owner's ranges — not whatever was cached locally from a previous sign-in.
  alertPreferences: v.optional(alertPreferences),
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

/**
 * Doctor-facing alerts (urgent low/high, stale data, caregiver decisions). Rows are created by
 * the 5-minute scan cron in `doctorAlerts.ts` (with per-kind cooldowns) and by `doctor.decideOrder`
 * when a caregiver acts on a proposal. Read/badged by the portal; optionally emailed via Resend.
 */
const doctorAlerts = defineTable({
  doctorId: v.id("doctorAccounts"),
  accessCode: v.string(),
  kind: v.union(
    v.literal("urgent_low"),
    v.literal("urgent_high"),
    v.literal("stale_data"),
    v.literal("decision_approved"),
    v.literal("decision_declined"),
  ),
  message: v.string(),
  value: v.optional(v.number()),
  proposalId: v.optional(v.string()),
  createdAt: v.number(),
  readAt: v.optional(v.number()),
  emailedAt: v.optional(v.number()),
})
  .index("by_doctorId", ["doctorId"])
  .index("by_doctor_code_kind", ["doctorId", "accessCode", "kind"]);

/**
 * Compliance access log: who (doctor) did what on which patient, when. "viewed" entries are
 * deduped to one per 30 minutes per doctor+patient (the portal polls continuously).
 */
const doctorAccessLogs = defineTable({
  doctorId: v.id("doctorAccounts"),
  accessCode: v.string(),
  action: v.string(),
  createdAt: v.number(),
})
  .index("by_accessCode", ["accessCode"])
  .index("by_doctor_code_action", ["doctorId", "accessCode", "action"]);

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
  /** Lowercased/trimmed username — lets Care Circle surface other accounts on the same sensor. */
  usernameKey: v.optional(v.string()),
})
  .index("by_userId", ["userId"])
  .index("by_usernameKey", ["usernameKey"]);

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

// ─── Care Circle (account roles + linking) — see CARE_CIRCLE_ROLES_AUDIT_01.md ───────────────

/** Uniform per-member grant object — same shape for links, access codes, and the patient device. */
const carePermissions = v.object({
  viewReadings: v.boolean(),
  viewLogs: v.boolean(),
  log: v.boolean(),
  useCalculator: v.boolean(),
  chat: v.boolean(),
});

/**
 * When a member may access the patient's data. Evaluated lazily at request time
 * (`convex/careSchedule.ts`) — no crons; "expired" is just what the evaluator reports.
 */
const careAccess = v.union(
  v.object({ mode: v.literal("always") }),
  v.object({ mode: v.literal("disabled") }),
  /** One-time window (grandma's visit): [startMs, endMs). */
  v.object({ mode: v.literal("window"), startMs: v.number(), endMs: v.number() }),
  /** Recurring weekly schedule (school hours). Days 0–6 (Sun–Sat) in the setter's timezone. */
  v.object({
    mode: v.literal("weekly"),
    days: v.array(v.number()),
    startMinute: v.number(),
    endMinute: v.number(),
    tzOffsetMinutes: v.number(),
  }),
);

/** Account-based care-circle membership (co-guardians: parents/spouses). Max 3 active per patient. */
const careLinks = defineTable({
  patientUserId: v.id("users"),
  memberUserId: v.id("users"),
  role: v.literal("co_guardian"),
  /** Snapshot of the member's display name for lists and log bylines. */
  displayName: v.string(),
  permissions: carePermissions,
  access: careAccess,
  status: v.union(v.literal("active"), v.literal("revoked")),
  createdAt: v.number(),
  updatedAt: v.number(),
  revokedAt: v.optional(v.number()),
  revokedBy: v.optional(v.union(v.literal("patient_side"), v.literal("member"))),
})
  .index("by_patient", ["patientUserId", "status"])
  .index("by_member", ["memberUserId", "status"])
  .index("by_patient_member", ["patientUserId", "memberUserId"]);

/** Short-lived (48h) co-guardian invite codes; redemption by a signed-in account creates the link. */
const careInvites = defineTable({
  patientUserId: v.id("users"),
  code: v.string(),
  role: v.literal("co_guardian"),
  presetPermissions: carePermissions,
  presetAccess: careAccess,
  createdByUserId: v.id("users"),
  // Directed invite: when set, this invite is "addressed" to a specific account, which sees it as an
  // incoming request it can accept in-app (no out-of-band code sharing). Untargeted invites (this
  // field absent) are the shareable-code flow — anyone with the code may redeem.
  targetUserId: v.optional(v.id("users")),
  expiresAt: v.number(),
  status: v.union(v.literal("pending"), v.literal("redeemed"), v.literal("cancelled")),
  redeemedByUserId: v.optional(v.id("users")),
  redeemedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_code", ["code"])
  .index("by_patient", ["patientUserId", "status"])
  .index("by_target", ["targetUserId", "status"]);

/**
 * Named, persistent access codes for EXTERNAL guardians (teacher / babysitter / relative) — no
 * account required; the code is the credential. Permissioned + schedule-bound, retire-able.
 * 8-char codes (legacy 6-char profile caregiverCode stays on its own separate path).
 */
const careAccessCodes = defineTable({
  patientUserId: v.id("users"),
  code: v.string(),
  /** Who/what this code is for, e.g. "Ms. Rivera (teacher)". Also the log byline if `log` is granted. */
  label: v.string(),
  /**
   * "caregiver" = external view-first access (teacher/babysitter). "child" = the patient's own kid
   * on their own phone (kids have no account) — full-ish permissions the parent controls. Absent =
   * legacy caregiver.
   */
  kind: v.optional(v.union(v.literal("caregiver"), v.literal("child"))),
  permissions: carePermissions,
  access: careAccess,
  status: v.union(v.literal("active"), v.literal("retired")),
  createdAt: v.number(),
  updatedAt: v.number(),
  retiredAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
})
  .index("by_code", ["code"])
  .index("by_patient", ["patientUserId", "status"]);

/**
 * Per-patient care-circle settings. Deliberately NOT on patientProfiles: the mobile app replaces
 * that document wholesale (`patientProfile.replace`), which would clobber fields it doesn't know.
 * `dependentMode` = parent-kid mode: admin control moves from the patient account to co-guardians,
 * and `devicePermissions` governs what the patient's own (kid's) device may do.
 */
const careSettings = defineTable({
  patientUserId: v.id("users"),
  dependentMode: v.boolean(),
  devicePermissions: carePermissions,
  updatedAt: v.number(),
}).index("by_patient", ["patientUserId"]);

/**
 * Per-patient shared care data beyond logs: the Quick Lookup meals list and the emergency-contact
 * pool. One row per circle (keyed by the owner/patient account); every co-guardian reads and
 * writes the same row, so an edit by one appears on all of them. Kept off `patientProfiles`
 * because the mobile app replaces that document wholesale (`patientProfile.replace`).
 */
/**
 * Persistent links from a signed-in Caregiver (school-nurse) account to the access codes it manages.
 * A nurse adds a guardian-issued access code and that child appears on their menu until the code is
 * retired (the code — not a careLink — remains the credential; schedules still gate live access).
 * One row per (caregiver, code); `patientUserId` is resolved at add-time for listing convenience.
 */
const caregiverLinks = defineTable({
  caregiverUserId: v.id("users"),
  code: v.string(),
  patientUserId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_caregiver", ["caregiverUserId"])
  .index("by_caregiver_code", ["caregiverUserId", "code"]);

const careShared = defineTable({
  patientUserId: v.id("users"),
  quickFoods: v.optional(v.array(v.string())),
  emergencyContacts: v.optional(
    v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        phone: v.string(),
        relation: v.string(),
      }),
    ),
  ),
  updatedAt: v.number(),
}).index("by_patient", ["patientUserId"]);

// ─── Care Circle shared log bucket (Phase 2) ─────────────────────────────────────────────────
// One authored bucket per patient. Every care-circle member (patient, co-guardians, and external
// code holders with the `log` grant) writes here with their own identity; every viewer reads the
// merged stream. `clientId` is the device-generated entry id — the idempotency key so migration
// and retries never duplicate. Because the mobile app already reads foodLog/insulinLog from one
// place (AuthContext), sourcing them here gives the whole app multi-author logs for free.

const careFoodLogs = defineTable({
  patientUserId: v.id("users"),
  authorUserId: v.optional(v.id("users")), // absent when authored via an external access code
  authorName: v.string(),
  clientId: v.string(),
  timestamp: v.string(),
  foodName: v.string(),
  estimatedCarbs: v.number(),
  insulinUnits: v.number(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  fromPhoto: v.boolean(),
  photoUri: v.optional(v.string()),
  createdAt: v.number(),
  edited: v.optional(v.boolean()), // true once a viewer has edited this entry in place
})
  .index("by_patient_time", ["patientUserId", "timestamp"])
  .index("by_patient_client", ["patientUserId", "clientId"]);

const careInsulinLogs = defineTable({
  patientUserId: v.id("users"),
  authorUserId: v.optional(v.id("users")),
  authorName: v.string(),
  clientId: v.string(),
  timestamp: v.string(),
  units: v.number(),
  type: v.union(v.literal("bolus"), v.literal("correction"), v.literal("manual"), v.literal("basal")),
  note: v.optional(v.string()),
  foodLogId: v.optional(v.string()),
  insulinType: v.optional(v.string()),
  recommendedUnits: v.optional(v.number()),
  manualOverride: v.optional(v.boolean()),
  createdAt: v.number(),
  edited: v.optional(v.boolean()),
})
  .index("by_patient_time", ["patientUserId", "timestamp"])
  .index("by_patient_client", ["patientUserId", "clientId"]);

// ─── Care Circle direct messaging (guardians ↔ access codes) ─────────────────────────────────
// In-app messaging between any two participants of one patient's circle: a guardian (owner or
// co-guardian) and an access code (kid/caregiver), or two access codes. NOT guardian↔guardian.
// A participant is an "endpoint": `user:<userId>` for a guardian, `code:<CODE>` for an access code
// (a nurse account viewing via a code messages AS that code). A thread is the two endpoint keys
// sorted + joined by "|" — DERIVED from the circle roster, so a fresh code's threads exist before
// the code is ever used. `senderKey` is the author's endpoint; `read` = the recipient (the other
// endpoint) has seen it. Messaging is always-on (ignores the `chat` grant); code endpoints stay
// gated by the schedule window (`careAccessAllowed`). Circles are tiny, so reads scan by_patient.
const careMessages = defineTable({
  patientUserId: v.id("users"),
  threadKey: v.string(),
  senderKey: v.string(),
  /** Snapshot of the sender's display name at send time (byline in the thread). */
  senderName: v.string(),
  text: v.string(),
  /** True once the recipient endpoint has opened the thread. */
  read: v.boolean(),
  createdAt: v.number(),
})
  .index("by_thread", ["patientUserId", "threadKey", "createdAt"])
  .index("by_patient", ["patientUserId"]);

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
  careLinks,
  careInvites,
  careAccessCodes,
  careSettings,
  careShared,
  caregiverLinks,
  careFoodLogs,
  careInsulinLogs,
  careMessages,
  doctorAccounts,
  doctorSessions,
  doctorAlerts,
  doctorAccessLogs,
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
    /** Lab-measured A1C recorded by a doctor in the portal (doctor-owned; survives syncs). */
    labA1c: v.optional(labA1c),
    syncedAt: v.optional(v.string()),
  }).index("by_accessCode", ["accessCode"]),
});
