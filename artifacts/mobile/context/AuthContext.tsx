import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "convex/react";
import { useAuth as useClerkAuth, useSSO, useSignIn, useSignUp, useUser } from "@clerk/clerk-expo";
import * as Linking from "expo-linking";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CarePermissions } from "../../../convex/careSchedule";
import { GLUCOSE_HISTORY_STORAGE_KEY, GLUCOSE_SETTINGS_STORAGE_KEY, QUICK_FOODS_STORAGE_KEY } from "@/constants/storage-keys";
import { apiUrl } from "@/utils/api-base-url";
import type { DoseSettingsByTime } from "@/utils/doseSettings";
import { mergeCloudLogs } from "@/utils/careLogsMerge";
import { generateAccessCode } from "@/utils/accessCodeGen";
import { splitSharedProfilePatch } from "@/utils/sharedProfilePatch";
import { patchTouchesBackend, rollbackSyncedKeys } from "@/utils/alertPrefsSync";
import { resolveLogConfirmName } from "@/utils/careLogConfirm";
import { DEFAULT_QUICK_FOODS, insertQuickFood, parseStoredQuickFoods } from "@/utils/quickFoods";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import {
  mergeDoctorMessages,
  reconcileTherapyProposal,
  summarizeProposal,
  type TherapyProposal,
} from "@/utils/doctorSync";
import {
  scheduleDoctorMessageNotification,
  scheduleTreatmentProposalNotification,
} from "@/services/notifications";

export type AccountRole = "parent" | "adult" | "caregiver";

export interface AccessLogEntry {
  id: string;
  timestamp: string;
  action: string;
  actor: "owner" | "caregiver" | "doctor";
}

export interface DoctorMessage {
  id: string;
  timestamp: string;
  text: string;
  sender: "doctor" | "guardian";
  read: boolean;
}

/**
 * Who "I" am for cross-account (careMessages) messaging. A code session — an accountless access
 * code, or a nurse account viewing a child via that code — messages AS the code; an owner or
 * co-guardian messages as their account within their circle; every other session (doctor, nurse on
 * their menu, signed-out) has no messaging identity.
 */
export type MessagingIdentity =
  | { kind: "guardian"; userId: string; passwordHash: string; patientUserId: string }
  | { kind: "code"; code: string }
  | null;

export interface UserProfile {
  childName: string;
  /** Optional last name (first name stays in `childName`). Displayed only where disambiguation is
   *  needed, e.g. the nurse's roster of kids. */
  childLastName?: string;
  parentName?: string;
  /** Optional guardian last name (first name stays in `parentName`). */
  parentLastName?: string;
  accountRole?: AccountRole;
  /** Caregiver (school-nurse) accounts: the organization they're with (e.g. a school). Optional. */
  organization?: string;
  diabetesType: "type1" | "type2" | "other";
  dateOfBirth: string;
  weightLbs?: number;
  doctorName?: string;
  doctorEmail?: string;
  doctorPhone?: string;
  doctorInstitution?: string;
  insulinTypes?: string[];
  profilePhotoUri?: string;
  childModeEnabled?: boolean;
  caregiverCode?: string;
  caregiverCodeIssuedAt?: string;
  doctorCode?: string;
  doctorCodeIssuedAt?: string;
  accessLog?: AccessLogEntry[];
  /** Optional — may mirror bolus settings for doctor sync payload. */
  carbRatio?: number;
  targetGlucose?: number;
  correctionFactor?: number;
  /** Optional per-meal-window overrides of carbRatio/correctionFactor (see utils/doseSettings). */
  doseSettingsByTime?: DoseSettingsByTime;
}

export interface InsulinLogEntry {
  id: string;
  /**
   * The access code that wrote this entry (code sessions only). Lets a caregiver/kid device recognise
   * its OWN entries — an accountless session has no `authorUserId`, so without this every screen fell
   * back to the code's label and the writer couldn't be distinguished from anyone else.
   */
  authorCode?: string;
  /**
   * LOCAL-ONLY: set when the entry is written on-device and cleared once the server acknowledges it.
   * `mergeCloudLogs` never drops a pending entry, so a dose written offline survives a force-quit
   * instead of being deleted after two minutes. Never sent to Convex.
   */
  pendingSync?: boolean;
  timestamp: string;
  units: number;
  type: "bolus" | "correction" | "manual" | "basal";
  note?: string;
  foodLogId?: string;
  /** Profile insulinTypes chip label in effect for this dose, e.g. "Humalog · 100 u/mL". */
  insulinType?: string;
  /** Calculator's recommended dose at log time — compare against `units` (the taken dose). */
  recommendedUnits?: number;
  /** True when the taken dose was manually edited away from the recommendation. */
  manualOverride?: boolean;
  /** Care Circle shared bucket: who logged this. Absent on legacy device-local entries. */
  authorUserId?: string;
  authorName?: string;
  /** True once this entry has been edited in place (shown as "Edited" on the log). */
  edited?: boolean;
}

export interface InsulinLogPatch {
  units?: number;
  note?: string;
  timestamp?: string;
}

export interface UserAccount {
  email: string;
  /**
   * LEGACY credential, kept only so pre-Clerk sessions restored from storage keep working during the
   * migration. Clerk-authenticated accounts set this to "" — the backend's `userCompat` treats an
   * empty value as "no legacy credential" and falls through to the verified Clerk identity, so
   * nothing has to change at the ~40 call sites that still pass it.
   */
  passwordHash: string;
  /** Convex document id for `users` — set for cloud-backed accounts. */
  convexUserId?: string;
}

/** A patient whose care circle I belong to as a co-guardian (drives "viewing Bella" mode). */
export interface CareMembership {
  linkId: string;
  patientUserId: string;
  patientName: string;
  permissions: {
    viewReadings: boolean;
    viewLogs: boolean;
    log: boolean;
    useCalculator: boolean;
    chat: boolean;
  };
  accessState: { state: "ok" | "before_window" | "outside_window" | "disabled"; nextStartMs?: number };
  dependentMode: boolean;
}

/**
 * The circle owner's settings a linked co-guardian's app inherits wholesale. While a membership is
 * active these — not the member's own stored values — are what the whole app displays and doses
 * with (thresholds ride separately into `alertPrefs`). Personal fields (parent name, photo,
 * notification toggles, chat) deliberately never appear here.
 */
export interface CircleSharedProfile {
  childName?: string;
  childLastName?: string;
  diabetesType?: "type1" | "type2" | "other";
  dateOfBirth?: string;
  weightLbs?: number;
  doctorName?: string;
  doctorEmail?: string;
  doctorPhone?: string;
  doctorInstitution?: string;
  insulinTypes?: string[];
  carbRatio?: number;
  targetGlucose?: number;
  correctionFactor?: number;
  alertPreferences?: {
    lowThreshold?: number | null;
    highThreshold?: number | null;
    urgentLowThreshold?: number | null;
    urgentHighThreshold?: number | null;
  } | null;
  doctorCode?: string;
  doctorCodeIssuedAt?: string;
}

export interface CircleShared {
  anchorPatientUserId: string;
  ownerName: string;
  profile: CircleSharedProfile;
}

export interface CGMConnection {
  type: "dexcom" | "libre" | null;
  sessionId?: string;
  token?: string;
  outsideUS?: boolean;
  libreApiBase?: string;
  connectedAt?: string;
}

export interface FoodLogEntry {
  id: string;
  /**
   * The access code that wrote this entry (code sessions only). Lets a caregiver/kid device recognise
   * its OWN entries — an accountless session has no `authorUserId`, so without this every screen fell
   * back to the code's label and the writer couldn't be distinguished from anyone else.
   */
  authorCode?: string;
  /** LOCAL-ONLY sync marker — see the note on {@link InsulinLogEntry.pendingSync}. */
  pendingSync?: boolean;
  timestamp: string;
  foodName: string;
  estimatedCarbs: number;
  insulinUnits: number;
  confidence: "high" | "medium" | "low";
  fromPhoto: boolean;
  photoUri?: string;
  /** Optional nutrition context from the AI analysis — carbs-only entries stay fully supported. */
  fatGrams?: number;
  proteinGrams?: number;
  /** How fast this meal's carbs hit: fast (~2h), medium (~3h, default), slow/high-fat (~4h). */
  absorption?: "fast" | "medium" | "slow";
  /** Care Circle shared bucket: who logged this. Absent on legacy device-local entries. */
  authorUserId?: string;
  authorName?: string;
  /** True once this entry has been edited in place (shown as "Edited" on the log). */
  edited?: boolean;
}

export interface FoodLogPatch {
  foodName?: string;
  estimatedCarbs?: number;
  insulinUnits?: number;
  timestamp?: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
  /** The ONE contact the emergency banner's one-tap text targets (radio: at most one is true). */
  primary?: boolean;
}

export interface AlertPreferences {
  notificationsEnabled: boolean;
  emergencyAlertsEnabled: boolean;
  urgentLowThreshold: number;
  lowThreshold: number;
  highThreshold: number;
  urgentHighThreshold: number;
  /** One-tap SMS banner (build-the-text-for-you). Default OFF; main accounts only. */
  oneTapTextEnabled?: boolean;
  /** ADULT main accounts: hold the caregiver code-device emergency push this many minutes. */
  waitWindowEnabled?: boolean;
  waitWindowMinutes?: number;
  /** Tapping a glucose alert offers a Dismiss / Send-to-chat popup on the Glucose page. */
  alertToChatOnOpenEnabled?: boolean;
}

export interface AuthContextType {
  profile: UserProfile | null;
  /** The signed-in person's OWN name, even while viewing someone else's profile. */
  ownParentName: string | null;
  account: UserAccount | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  isSignedIn: boolean;
  isMinor: boolean;
  ageYears: number | null;
  cgmConnection: CGMConnection;
  foodLog: FoodLogEntry[];
  emergencyContacts: EmergencyContact[];
  alertPrefs: AlertPreferences;
  caregiverSession: boolean;
  doctorSession: boolean;
  isChildMode: boolean;
  setupProfile: (profile: UserProfile) => Promise<void>;
  /** Resolves TRUE only when the change is durable (server accepted, or local-only account). */
  updateProfile: (profile: Partial<UserProfile>) => Promise<boolean>;
  setCGMConnection: (conn: CGMConnection) => Promise<void>;
  /** Durable disconnect: resolves FALSE if the server still has the connection (nothing changed). */
  disconnectCGM: () => Promise<boolean>;
  insulinLog: InsulinLogEntry[];
  addFoodLogEntry: (entry: Omit<FoodLogEntry, "id">) => void;
  clearFoodLog: () => void;
  logInsulinDose: (entry: Omit<InsulinLogEntry, "id">) => void;
  clearInsulinLog: () => void;
  deleteFoodLogEntry: (id: string) => void;
  deleteInsulinLogEntry: (id: string) => void;
  editFoodLogEntry: (id: string, patch: FoodLogPatch) => void;
  editInsulinLogEntry: (id: string, patch: InsulinLogPatch) => void;
  logout: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Delete an account whose onboarding was never finished (the "back out and start over" choice),
   * freeing its email for a fresh sign-up. False = nothing was deleted (setup was already complete,
   * or we couldn't reach Convex/Clerk) — the caller should fall back to just signing out.
   */
  abandonSignup: () => Promise<boolean>;
  /** Resolves "needs_verification" when the Clerk instance requires an emailed code first. */
  createAccount: (email: string, password: string) => Promise<{ status: "complete" | "needs_verification" }>;
  /** Finish a sign-up that required an emailed verification code. */
  verifyEmailCode: (code: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  /** Google sign-in via Clerk SSO. Returns false if the user cancels. */
  signInWithGoogle: () => Promise<boolean>;
  /** Email a password-reset code (Clerk-delivered). */
  requestPasswordReset: (email: string) => Promise<boolean>;
  /** Complete the reset with the emailed code + new password; also signs in. */
  resetPassword: (code: string, newPassword: string) => Promise<boolean>;
  /** Resolves TRUE only when the contact is durable (shared with the circle). */
  addEmergencyContact: (contact: Omit<EmergencyContact, "id">) => Promise<boolean>;
  removeEmergencyContact: (id: string) => Promise<void>;
  /** Radio toggle: mark ONE contact as the one-tap emergency text target (null clears all). */
  setPrimaryEmergencyContact: (id: string | null) => Promise<void>;
  /** Resolves TRUE only when the change is durable. */
  updateAlertPrefs: (prefs: Partial<AlertPreferences>) => Promise<boolean>;
  setChildMode: (enabled: boolean) => Promise<void>;
  generateCaregiverCode: () => Promise<string>;
  enterCaregiverMode: (code: string) => Promise<boolean>;
  exitCaregiverMode: () => void;
  generateDoctorCode: () => Promise<string>;
  enterDoctorMode: (code: string) => boolean;
  exitDoctorMode: () => void;
  addAccessLogEntry: (action: string, actor?: "owner" | "caregiver" | "doctor") => Promise<void>;
  doctorMessages: DoctorMessage[];
  addDoctorMessage: (text: string, sender: "doctor" | "guardian") => void;
  markDoctorMessagesRead: () => void;
  syncToDoctor: (glucoseReadings?: { value: number; trend: string; timestamp: string }[]) => Promise<void>;
  /** A doctor-proposed treatment change awaiting the caregiver's confirmation (null when none). */
  therapyProposal: TherapyProposal | null;
  /**
   * Record the caregiver's decision on the pending proposal. Clears it locally and notifies the
   * backend. NOTE: applying approved settings to live dosing is done by the caller (it needs
   * GlucoseContext), see TreatmentProposalCard.
   */
  decideTherapyProposal: (status: "approved" | "declined") => Promise<void>;
  /** When set, glucose is loaded read-only from Convex using this caregiver code (standalone caregiver device). */
  caregiverCloudCode: string | null;
  /** Distinguishes a legacy 6-char caregiver code session from a new Care Circle caregiver code. */
  caregiverCodeKind: "legacy" | "access" | null;
  /** Role of the active access-code session (caregiver vs the patient's own child), null otherwise. */
  accessCodeRole: "caregiver" | "child" | null;
  /** Permissions granted to the active access-code session (gates logging/calculator/chat UI). */
  accessCodePermissions: CarePermissions | null;
  /** Care circles this signed-in account belongs to as a co-guardian. */
  careMemberships: CareMembership[];
  refreshCareMemberships: () => Promise<void>;
  /**
   * True while this signed-in account is a linked co-guardian in someone else's circle: the app
   * then runs on the circle owner's inherited settings and owner-only settings are read-only here.
   */
  isCircleMember: boolean;
  /** Display name of the circle owner whose settings this member inherits (lock-copy in the UI). */
  circleOwnerName: string | null;
  /** Quick Lookup meals — the circle's mutual list for cloud accounts, device-local otherwise. */
  quickFoods: string[];
  /** Put a meal at the front of the Quick Lookup list (syncs to every guardian in the circle). */
  saveQuickFood: (name: string) => void;
  /** The linked patient's userId currently being viewed (null = viewing my own account). */
  viewingPatientId: string | null;
  viewingPatientName: string | null;
  /** True while a signed-in co-guardian is viewing a linked patient's data. */
  isViewingLinkedPatient: boolean;
  enterViewingMode: (patientUserId: string) => Promise<boolean>;
  exitViewingMode: () => void;
  /** True when the signed-in account is a Caregiver (school-nurse) account. */
  isCaregiverAccount: boolean;
  /** True while a caregiver (nurse) account is viewing a child — settings are inherited read-only. */
  isCaregiverViewingChild: boolean;
  /** Non-null when logs must be confirmed before writing (caregiver sessions) — the profile owner's name. */
  logConfirmPatientName: string | null;
  /**
   * Nurse opens a linked child's live view via their access code (like a co-guardian's "View
   * glucose"). Sets the viewing overlay + the code's permissions; data is sourced from the code, and
   * the schedule lock engages when the code is out of its window. Returns false only if the code is
   * no longer valid.
   */
  enterKidView: (code: string, patientUserId: string, patientName: string) => Promise<boolean>;
  /** The access code currently powering a nurse's kid-view (null otherwise). Used to source data. */
  nurseViewCode: string | null;
  /** Identity for cross-account messaging (careMessages); null when this session can't message. */
  messagingIdentity: MessagingIdentity;
  /** Non-null when the active caregiver/co-guardian session is outside its schedule or removed. */
  accessLock: { reason: "outside_window" | "disabled" | "revoked"; nextStartMs?: number } | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_KEY = "@gluco_guardian_profile";
const CGM_KEY = "@gluco_guardian_cgm";
const FOOD_LOG_KEY = "@gluco_guardian_food_log";
const INSULIN_LOG_KEY = "@gluco_guardian_insulin_log";
/** Per-account marker (suffixed with the Convex userId) so local→cloud log migration runs once. */
const LOGS_MIGRATED_KEY_PREFIX = "@gluco_guardian_logs_migrated_";
const EMERGENCY_CONTACTS_KEY = "@gluco_guardian_emergency_contacts";
const ALERT_PREFS_KEY = "@gluco_guardian_alert_prefs";
const ACCOUNT_KEY = "@gluco_guardian_account";
const SESSION_KEY = "@gluco_guardian_session";
/** Persisted access-code session so a caregiver/child stays signed in across app restarts. */
const CAREGIVER_CODE_KEY = "@gluco_guardian_caregiver_code";
/** Persisted co-guardian memberships so the circle anchor is known instantly on cold start. */
const CARE_MEMBERSHIPS_KEY = "@gluco_guardian_care_memberships";
/** Persisted owner-settings overlay so a member's app inherits offline too. */
const CIRCLE_SHARED_KEY = "@gluco_guardian_circle_shared";
const DOCTOR_MESSAGES_KEY = "@gluco_guardian_doctor_messages";
const THERAPY_PROPOSAL_KEY = "@gluco_guardian_therapy_proposal";
/**
 * PER-ACCESS-CODE notification settings. Suffixed with the code, so each caregiver/kid code on a
 * shared phone keeps its OWN switches instead of inheriting the last session's — the same reason
 * `pushTokens` rows are keyed per (device, identity).
 *
 * Only the DEVICE-LOCAL prefs live here (see ALERT_PREFS_CODE_FIELDS). Thresholds are deliberately NOT
 * included: a code session inherits the owner's clinical ranges read-only, so a caregiver can't set
 * "low = 55" and miss an alert the guardian would have received.
 */
const ALERT_PREFS_CODE_KEY_PREFIX = "@gluco_guardian_alert_prefs_code_";

/** The alert-pref fields an access-code session owns for itself. */
const ALERT_PREFS_CODE_FIELDS = ["notificationsEnabled", "alertToChatOnOpenEnabled"] as const;

function alertPrefsCodeKey(code: string): string {
  return ALERT_PREFS_CODE_KEY_PREFIX + code.trim().toUpperCase();
}

/** Pick just the fields a code session persists for itself. */
function pickCodeAlertPrefs(prefs: Partial<AlertPreferences>): Partial<AlertPreferences> {
  const out: Partial<AlertPreferences> = {};
  for (const k of ALERT_PREFS_CODE_FIELDS) {
    if (prefs[k] !== undefined) (out as Record<string, unknown>)[k] = prefs[k];
  }
  return out;
}

/** Read a code session's own saved switches (empty when it has never changed one). */
async function loadCodeAlertPrefs(code: string | null): Promise<Partial<AlertPreferences>> {
  if (!code) return {};
  try {
    const raw = await AsyncStorage.getItem(alertPrefsCodeKey(code));
    return raw ? pickCodeAlertPrefs(JSON.parse(raw) as Partial<AlertPreferences>) : {};
  } catch {
    return {};
  }
}

/** Stable empty arrays for co-guardian viewing mode — prevents new [] identities each render. */
const EMPTY_FOOD_LOG: FoodLogEntry[] = [];
const EMPTY_INSULIN_LOG: InsulinLogEntry[] = [];

/** Care-circle log payloads: the local entry `id` is the cloud `clientId` (idempotency key). */
/**
 * Server acknowledged this entry — drop its `pendingSync` marker so a later remote delete is
 * respected again. No-op when nothing is pending, so it can't cause a needless re-render/write.
 */
function clearPendingMarker<T extends { id: string; pendingSync?: boolean }>(
  setList: React.Dispatch<React.SetStateAction<T[]>>,
  id: string,
  storageKey: string | null,
) {
  setList((prev) => {
    if (!prev.some((e) => e.id === id && e.pendingSync)) return prev;
    const next = prev.map((e) => (e.id === id ? { ...e, pendingSync: undefined } : e));
    if (storageKey) AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
    return next;
  });
}

function toFoodEntryPayload(e: FoodLogEntry) {
  return {
    clientId: e.id,
    timestamp: e.timestamp,
    foodName: e.foodName,
    estimatedCarbs: e.estimatedCarbs,
    insulinUnits: e.insulinUnits,
    confidence: e.confidence,
    fromPhoto: e.fromPhoto,
    ...(e.photoUri != null ? { photoUri: e.photoUri } : {}),
    ...(e.fatGrams != null ? { fatGrams: e.fatGrams } : {}),
    ...(e.proteinGrams != null ? { proteinGrams: e.proteinGrams } : {}),
    ...(e.absorption != null ? { absorption: e.absorption } : {}),
  };
}

/** Optimistic byline for my own writes — the server re-derives the authoritative name on read.
 *  Mirrors the server's `guardianDisplayName`: the guardian's own name, never the child's (a parent
 *  account that hasn't set a name falls back to the email handle, not the shared child name). */
function deriveOwnAuthorName(profile: UserProfile | null, account: UserAccount | null): string {
  const parent = profile?.parentName?.trim();
  if (parent) return parent;
  // Adult + caregiver (nurse) accounts store the person's own name in childName.
  if (profile?.accountRole === "adult" || profile?.accountRole === "caregiver") {
    const own = profile.childName?.trim();
    if (own) return own;
  }
  return account?.email?.split("@")[0] || profile?.childName?.trim() || "Me";
}

function toInsulinEntryPayload(e: InsulinLogEntry) {
  return {
    clientId: e.id,
    timestamp: e.timestamp,
    units: e.units,
    type: e.type,
    ...(e.note != null ? { note: e.note } : {}),
    ...(e.foodLogId != null ? { foodLogId: e.foodLogId } : {}),
    ...(e.insulinType != null ? { insulinType: e.insulinType } : {}),
    ...(e.recommendedUnits != null ? { recommendedUnits: e.recommendedUnits } : {}),
    ...(e.manualOverride != null ? { manualOverride: e.manualOverride } : {}),
  };
}

const DEFAULT_ALERT_PREFS: AlertPreferences = {
  // Glucose alerts start ON for every new account and every fresh access-code session — protective
  // by default; each device can still turn them off.
  notificationsEnabled: true,
  emergencyAlertsEnabled: false,
  urgentLowThreshold: 55,
  lowThreshold: 70,
  highThreshold: 180,
  urgentHighThreshold: 250,
  // One-tap SMS building starts OFF until the account turns it on in Emergency settings.
  oneTapTextEnabled: false,
  waitWindowEnabled: false,
  waitWindowMinutes: 5,
  alertToChatOnOpenEnabled: true,
};

type RemoteThresholds = {
  lowThreshold?: number | null;
  highThreshold?: number | null;
  urgentLowThreshold?: number | null;
  urgentHighThreshold?: number | null;
  /** Owner's Emergency Text Alerts toggle — synced so restricted sessions can mirror it locked. */
  emergencyAlertsEnabled?: boolean | null;
} | null | undefined;

/** Pull just the four numeric thresholds out of a backend `alertPreferences` (notification toggles
 *  stay device-local). Returns `null` when the account has no stored thresholds. */
function thresholdOverlay(remote: RemoteThresholds): Partial<AlertPreferences> | null {
  if (!remote) return null;
  const out: Partial<AlertPreferences> = {};
  if (typeof remote.urgentLowThreshold === "number") out.urgentLowThreshold = remote.urgentLowThreshold;
  if (typeof remote.lowThreshold === "number") out.lowThreshold = remote.lowThreshold;
  if (typeof remote.highThreshold === "number") out.highThreshold = remote.highThreshold;
  if (typeof remote.urgentHighThreshold === "number") out.urgentHighThreshold = remote.urgentHighThreshold;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Thresholds PLUS the owner's Emergency Text Alerts toggle. Used wherever a device adopts an
 * ACCOUNT's alert state — the owner's own sign-in/hydrate (cross-device sync) and kid/caregiver
 * sessions (which mirror the owner's emergency setting LOCKED). Co-guardians keep using
 * `thresholdOverlay`: they inherit ranges but own their personal emergency toggle.
 */
function sessionAlertOverlay(remote: RemoteThresholds): Partial<AlertPreferences> | null {
  const out: Partial<AlertPreferences> = { ...(thresholdOverlay(remote) ?? {}) };
  if (remote && typeof remote.emergencyAlertsEnabled === "boolean") {
    out.emergencyAlertsEnabled = remote.emergencyAlertsEnabled;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The account-scoped subset of alert prefs that persists to the backend profile. */
function thresholdsToBackend(prefs: AlertPreferences) {
  return {
    lowThreshold: prefs.lowThreshold,
    highThreshold: prefs.highThreshold,
    urgentLowThreshold: prefs.urgentLowThreshold,
    urgentHighThreshold: prefs.urgentHighThreshold,
    emergencyAlertsEnabled: prefs.emergencyAlertsEnabled,
    // The wait-window pair must reach the backend — the PUSH PIPELINE reads them server-side.
    oneTapTextEnabled: prefs.oneTapTextEnabled,
    waitWindowEnabled: prefs.waitWindowEnabled,
    waitWindowMinutes: prefs.waitWindowMinutes,
  };
}

/** Profile fields that belong to the CIRCLE (owner's account) while linked; the rest is personal. */
const SHARED_PROFILE_EDIT_KEYS = [
  "childName",
  "childLastName",
  "diabetesType",
  "dateOfBirth",
  "weightLbs",
  "doctorName",
  "doctorEmail",
  "doctorPhone",
  "doctorInstitution",
  "insulinTypes",
  "carbRatio",
  "targetGlucose",
  "correctionFactor",
  "doseSettingsByTime",
] as const;

/** Max Quick Lookup entries (list length stays constant; saving pushes the oldest off). */
const QUICK_FOODS_MAX = DEFAULT_QUICK_FOODS.length;

/** Mirrors MAX_EMERGENCY_CONTACTS in convex/careCircle.ts — the server throws past this. */
const MAX_EMERGENCY_CONTACTS_CLIENT = 5;

/** Local profile can be seeded to Convex once if it has the minimum required fields. */
function isMigratableLocalProfile(p: unknown): p is UserProfile {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.childName === "string" &&
    o.childName.length > 0 &&
    typeof o.dateOfBirth === "string" &&
    o.dateOfBirth.length > 0 &&
    (o.diabetesType === "type1" || o.diabetesType === "type2" || o.diabetesType === "other")
  );
}

function isMigratableLocalCgm(c: unknown): c is CGMConnection {
  if (!c || typeof c !== "object") return false;
  const o = c as CGMConnection;
  return o.type === "dexcom" || o.type === "libre";
}

function computeAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/** Accepts both legacy 6-char caregiver codes and new 8-char Care Circle caregiver codes. */
function normalizeCaregiverInputCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/** Max wait for Convex `getUser` during cold start — avoids hanging boot if network stalls. */
const CONVEX_SESSION_RESTORE_MS = 10_000;

async function restoreConvexBackedSession(acc: UserAccount): Promise<boolean> {
  if (!acc.convexUserId) return true;
  try {
    const client = createConvexAuthClient();
    const stillThere = await Promise.race([
      client.query(api.auth.getUser, {
        userId: acc.convexUserId as Id<"users">,
      }),
      new Promise<null>((_, reject) => {
        setTimeout(() => reject(new Error("convex session restore timeout")), CONVEX_SESSION_RESTORE_MS);
      }),
    ]);
    return !!stillThere;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Clerk owns identity now (Google + email/password). These hooks must live at component level.
  const { signIn: clerkSignIn, setActive: setSignInActive } = useSignIn();
  const { signUp: clerkSignUp, setActive: setSignUpActive } = useSignUp();
  const { signOut: clerkSignOut, isSignedIn: clerkIsSignedIn } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { startSSOFlow } = useSSO();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [cgmConnection, setCGMConnectionState] = useState<CGMConnection>({ type: null });
  const [foodLog, setFoodLog] = useState<FoodLogEntry[]>([]);
  const [insulinLog, setInsulinLog] = useState<InsulinLogEntry[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [alertPrefs, setAlertPrefsState] = useState<AlertPreferences>(DEFAULT_ALERT_PREFS);
  const [caregiverSession, setCaregiverSession] = useState(false);
  const [doctorSession, setDoctorSession] = useState(false);
  const [caregiverCloudCode, setCaregiverCloudCode] = useState<string | null>(null);
  /** "legacy" = old 6-char profile caregiverCode; "access" = new Care Circle caregiver access code. */
  const [caregiverCodeKind, setCaregiverCodeKind] = useState<"legacy" | "access" | null>(null);
  /** For a new access-code session: whether it's a caregiver or the patient's own child, + grants. */
  const [accessCodeRole, setAccessCodeRole] = useState<"caregiver" | "child" | null>(null);
  const [accessCodePermissions, setAccessCodePermissions] = useState<CarePermissions | null>(null);
  // ── Co-guardian viewing overlay (signed-in account viewing a linked patient's data) ──
  const [careMemberships, setCareMemberships] = useState<CareMembership[]>([]);
  /** Owner-settings inheritance for a linked co-guardian (null when solo / circle owner). */
  const [circleShared, setCircleShared] = useState<CircleShared | null>(null);
  /** Bumped to force an immediate circle re-hydrate (e.g. right after joining/leaving a circle). */
  const [hydrateNonce, setHydrateNonce] = useState(0);
  /** Quick Lookup meals — hydrated from the circle pool for cloud accounts. */
  const [quickFoods, setQuickFoods] = useState<string[]>(DEFAULT_QUICK_FOODS);
  const [viewingPatientId, setViewingPatientId] = useState<string | null>(null);
  const [viewedProfile, setViewedProfile] = useState<UserProfile | null>(null);
  const [viewedFoodLog, setViewedFoodLog] = useState<FoodLogEntry[]>([]);
  const [viewedInsulinLog, setViewedInsulinLog] = useState<InsulinLogEntry[]>([]);
  /** When a Caregiver (nurse) is viewing a linked child, the access code powering it (null else). */
  const [nurseViewCode, setNurseViewCode] = useState<string | null>(null);
  /** The viewed child's shared emergency contacts, inherited read-only while a nurse views them. */
  const [viewedEmergencyContacts, setViewedEmergencyContacts] = useState<EmergencyContact[]>([]);
  /** Set when the current "someone else's data" session falls outside its schedule / is removed. */
  const [accessLock, setAccessLock] = useState<{ reason: "outside_window" | "disabled" | "revoked"; nextStartMs?: number } | null>(null);
  const [doctorMessages, setDoctorMessages] = useState<DoctorMessage[]>([]);
  const [therapyProposal, setTherapyProposal] = useState<TherapyProposal | null>(null);

  const profileRef = useRef(profile);
  const accountRef = useRef<UserAccount | null>(null);
  const caregiverCloudCodeRef = useRef<string | null>(null);
  const caregiverSessionRef = useRef(false);
  const insulinLogRef = useRef(insulinLog);
  const foodLogRef = useRef(foodLog);
  const alertPrefsRef = useRef(alertPrefs);
  const doctorMessagesRef = useRef(doctorMessages);
  const therapyProposalRef = useRef(therapyProposal);
  /** Id of a proposal the caregiver just decided, so a racing sync poll can't resurrect it. */
  const recentlyDecidedProposalIdRef = useRef<string | null>(null);
  /** Live mirrors for the log-write path (which patient bucket + what byline to use). */
  const viewingPatientIdRef = useRef<string | null>(null);
  useEffect(() => { viewingPatientIdRef.current = viewingPatientId; }, [viewingPatientId]);
  const nurseViewCodeRef = useRef<string | null>(null);
  useEffect(() => { nurseViewCodeRef.current = nurseViewCode; }, [nurseViewCode]);
  /** The circle bucket this account's logs/settings target: owner's account when a member, else self. */
  const circleAnchorRef = useRef<string | null>(null);
  useEffect(() => {
    circleAnchorRef.current = careMemberships[0]?.patientUserId ?? account?.convexUserId ?? null;
  }, [careMemberships, account?.convexUserId]);
  const circleSharedRef = useRef<CircleShared | null>(null);
  useEffect(() => { circleSharedRef.current = circleShared; }, [circleShared]);
  const emergencyContactsRef = useRef<EmergencyContact[]>([]);
  useEffect(() => { emergencyContactsRef.current = emergencyContacts; }, [emergencyContacts]);
  const quickFoodsRef = useRef<string[]>(DEFAULT_QUICK_FOODS);
  useEffect(() => { quickFoodsRef.current = quickFoods; }, [quickFoods]);
  /** Set on every local profile commit so the hydrate poll never clobbers an in-flight edit. */
  const lastProfileCommitAtRef = useRef(0);
  /** For an access-code session that may write logs (child, or a caregiver granted `log`). */
  const codeWriteRef = useRef<{ code: string; canLog: boolean } | null>(null);
  useEffect(() => {
    codeWriteRef.current =
      caregiverCodeKind === "access" && caregiverCloudCode
        ? { code: caregiverCloudCode, canLog: !!accessCodePermissions?.log }
        : null;
  }, [caregiverCodeKind, caregiverCloudCode, accessCodePermissions]);
  /** A signed-in nurse viewing a child via an access code that grants `log` — writes go via the code
   *  (shared bucket) but are attributed to the nurse's account. */
  const nurseWriteRef = useRef<{ code: string; canLog: boolean } | null>(null);
  useEffect(() => {
    nurseWriteRef.current = nurseViewCode
      ? { code: nurseViewCode, canLog: !!accessCodePermissions?.log }
      : null;
  }, [nurseViewCode, accessCodePermissions]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { accountRef.current = account; }, [account]);
  useEffect(() => { caregiverCloudCodeRef.current = caregiverCloudCode; }, [caregiverCloudCode]);
  useEffect(() => { caregiverSessionRef.current = caregiverSession; }, [caregiverSession]);
  useEffect(() => { insulinLogRef.current = insulinLog; }, [insulinLog]);
  useEffect(() => { foodLogRef.current = foodLog; }, [foodLog]);
  useEffect(() => { alertPrefsRef.current = alertPrefs; }, [alertPrefs]);
  useEffect(() => { doctorMessagesRef.current = doctorMessages; }, [doctorMessages]);
  useEffect(() => { therapyProposalRef.current = therapyProposal; }, [therapyProposal]);

  /**
   * Returns TRUE only when the change is durable — the server accepted it, or this is a local-only
   * account with no server copy to disagree with. Returns FALSE when the backend write failed.
   *
   * This return value is the whole point: the local cache and UI update optimistically, but the 60s
   * hydrate poll (and the next cold start) overwrite them from the server. So a swallowed failure
   * presented as a successful save that silently reverted a minute later — indistinguishable, from
   * the user's side, from the app losing their edit. Callers gate their success feedback on this.
   */
  const commitProfile = useCallback(async (updated: UserProfile): Promise<boolean> => {
    lastProfileCommitAtRef.current = Date.now();
    profileRef.current = updated;
    setProfile(updated);
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    } catch {
      /* ignore */
    }
    const acc = accountRef.current;
    if (!acc?.convexUserId) return true; // local-only account — nothing to sync, so this IS durable
    try {
      const client = createConvexAuthClient();
      const profilePayload = JSON.parse(JSON.stringify(updated));
      await client.mutation(api.patientProfile.replace, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        profile: profilePayload,
      });
      return true;
    } catch {
      /* offline or rejected — local cache remains but the server disagrees; tell the caller */
      return false;
    }
  }, []);

  const commitCGMConnection = useCallback(async (conn: CGMConnection) => {
    setCGMConnectionState(conn);
    try {
      await AsyncStorage.setItem(CGM_KEY, JSON.stringify(conn));
    } catch {
      /* ignore */
    }
    const acc = accountRef.current;
    if (!acc?.convexUserId) return;
    try {
      const client = createConvexAuthClient();
      const userId = acc.convexUserId as Id<"users">;
      if (conn.type === null) {
        await client.mutation(api.patientCgm.clear, {
          userId,
          passwordHash: acc.passwordHash,
        });
      } else {
        const connection = JSON.parse(JSON.stringify(conn));
        await client.mutation(api.patientCgm.replace, {
          userId,
          passwordHash: acc.passwordHash,
          connection,
        });
      }
    } catch {
      /* offline — local cache remains */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Rehydrate a persisted access-code session (caregiver or child) on cold start. Re-validates
    // against Convex so a revoked / view-readings-removed code is dropped (bounce to sign-in), an
    // out-of-window code is still restored (the accessLock overlay handles the window), and an
    // offline start falls back to the cached role/permissions so the code never has to be re-typed.
    async function restoreCaregiverCodeSession(raw: string) {
      let parsed: { code?: string; kind?: string; role?: string; permissions?: CarePermissions | null };
      try {
        parsed = JSON.parse(raw);
      } catch {
        await AsyncStorage.removeItem(CAREGIVER_CODE_KEY);
        return;
      }
      const code = normalizeCaregiverInputCode(parsed.code ?? "");
      const kind = parsed.kind === "access" ? "access" : parsed.kind === "legacy" ? "legacy" : null;
      if (!code || !kind) {
        await AsyncStorage.removeItem(CAREGIVER_CODE_KEY);
        return;
      }

      // An access-code session is accountless — drop any stale signed-out account state.
      accountRef.current = null;
      setAccount(null);

      const client = createConvexAuthClient();

      // Forget the code and return to a clean signed-out state. Used when the code has been deleted
      // or its core view-readings grant removed — re-entering it on the auth screen would fail too.
      const clearAndBounce = async () => {
        profileRef.current = null;
        setProfile(null);
        setCaregiverSession(false);
        setCaregiverCloudCode(null);
        setCaregiverCodeKind(null);
        setAccessCodeRole(null);
        setAccessCodePermissions(null);
        await AsyncStorage.multiRemove([
          CAREGIVER_CODE_KEY,
          PROFILE_KEY,
          CGM_KEY,
          FOOD_LOG_KEY,
          INSULIN_LOG_KEY,
          EMERGENCY_CONTACTS_KEY,
          ALERT_PREFS_KEY,
        ]);
      };

      if (kind === "access") {
        try {
          const resolved = await Promise.race([
            client.query(api.careCircle.resolveAccessCode, { code }),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error("resolve timeout")), CONVEX_SESSION_RESTORE_MS),
            ),
          ]);
          if (cancelled) return;
          if (resolved === null) {
            await clearAndBounce();
            return;
          }
          if (resolved) {
            if (!resolved.permissions.viewReadings) {
              await clearAndBounce();
              return;
            }
            // Refresh the patient's slim profile (out-of-window is fine — accessLock handles it).
            // Timeout-guarded like the sibling boot queries so a stalled network can't hang boot.
            try {
              const slim = await Promise.race([
                client.query(api.careCircle.profileForAccessCode, { code }),
                new Promise<null>((_, reject) =>
                  setTimeout(() => reject(new Error("profile fetch timeout")), CONVEX_SESSION_RESTORE_MS),
                ),
              ]);
              if (cancelled) return;
              if (slim) {
                const nextProfile: UserProfile = {
                  childName: slim.childName ?? resolved.patientName,
                  diabetesType: slim.diabetesType ?? "type1",
                  dateOfBirth: slim.dateOfBirth ?? "",
                  weightLbs: slim.weightLbs,
                  insulinTypes: slim.insulinTypes,
                  profilePhotoUri: slim.profilePhotoUri,
                  carbRatio: slim.carbRatio,
                  targetGlucose: slim.targetGlucose,
                  correctionFactor: slim.correctionFactor,
                  // Meal-window overrides MUST come along: without them a caregiver/nurse doses on the
                  // owner's BASE ratio while the owner's own phone uses the per-window override — a
                  // silent dosing discrepancy with no UI signal. slimPatientProfile already sends it.
                  doseSettingsByTime: slim.doseSettingsByTime,
                };
                profileRef.current = nextProfile;
                setProfile(nextProfile);
                await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
                // Owner's thresholds for this restored session, then THIS code's own saved switches
                // on top — otherwise DEFAULT_ALERT_PREFS below silently reset them every launch.
                {
                  const ownPrefs = await loadCodeAlertPrefs(code);
                  setAlertPrefsState((prev) => ({
                    ...prev,
                    ...DEFAULT_ALERT_PREFS,
                    ...(sessionAlertOverlay(slim.alertPreferences) ?? {}),
                    ...ownPrefs,
                  }));
                }
              }
            } catch {
              /* keep the AsyncStorage-cached profile */
            }
            setCaregiverCloudCode(code);
            setCaregiverCodeKind("access");
            setAccessCodeRole(resolved.kind);
            setAccessCodePermissions(resolved.permissions);
            setCaregiverSession(true);
            await AsyncStorage.setItem(
              CAREGIVER_CODE_KEY,
              JSON.stringify({ code, kind: "access", role: resolved.kind, permissions: resolved.permissions }),
            );
            client.mutation(api.careCircle.touchAccessCode, { code }).catch(() => {});
            return;
          }
        } catch {
          /* offline / timeout — fall through to the cached optimistic restore below */
        }
        if (cancelled) return;
        // Offline: restore from the cached profile + last-known role/permissions so the caregiver /
        // child isn't forced to re-enter the code just because the network is down at launch.
        const role = parsed.role === "caregiver" || parsed.role === "child" ? parsed.role : null;
        setCaregiverCloudCode(code);
        setCaregiverCodeKind("access");
        setAccessCodeRole(role);
        setAccessCodePermissions(parsed.permissions ?? null);
        setCaregiverSession(true);
        return;
      }

      // Legacy anonymous 6-char caregiver code.
      try {
        const remote = await Promise.race([
          client.query(api.patientProfile.getByCaregiverCode, { code }),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("resolve timeout")), CONVEX_SESSION_RESTORE_MS),
          ),
        ]);
        if (cancelled) return;
        if (remote === null) {
          await clearAndBounce();
          return;
        }
        if (remote) {
          const { userId: _userId, ...profileFields } = remote as UserProfile & { userId: Id<"users"> };
          const nextProfile = profileFields as UserProfile;
          profileRef.current = nextProfile;
          setProfile(nextProfile);
          await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
          setCaregiverCloudCode(code);
          setCaregiverCodeKind("legacy");
          setCaregiverSession(true);
          return;
        }
      } catch {
        /* offline / timeout — fall through to the cached optimistic restore below */
      }
      if (cancelled) return;
      setCaregiverCloudCode(code);
      setCaregiverCodeKind("legacy");
      setCaregiverSession(true);
    }

    async function load() {
      try {
        const [
          storedProfile,
          storedCGM,
          storedFoodLog,
          storedInsulinLog,
          storedContacts,
          storedAlertPrefs,
          storedAccount,
          storedSession,
          storedDoctorMessages,
          storedTherapyProposal,
          storedCaregiverCode,
          storedMemberships,
          storedCircleShared,
          storedQuickFoods,
        ] = await Promise.all([
          AsyncStorage.getItem(PROFILE_KEY),
          AsyncStorage.getItem(CGM_KEY),
          AsyncStorage.getItem(FOOD_LOG_KEY),
          AsyncStorage.getItem(INSULIN_LOG_KEY),
          AsyncStorage.getItem(EMERGENCY_CONTACTS_KEY),
          AsyncStorage.getItem(ALERT_PREFS_KEY),
          AsyncStorage.getItem(ACCOUNT_KEY),
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(DOCTOR_MESSAGES_KEY),
          AsyncStorage.getItem(THERAPY_PROPOSAL_KEY),
          AsyncStorage.getItem(CAREGIVER_CODE_KEY),
          AsyncStorage.getItem(CARE_MEMBERSHIPS_KEY),
          AsyncStorage.getItem(CIRCLE_SHARED_KEY),
          AsyncStorage.getItem(QUICK_FOODS_STORAGE_KEY),
        ]);

        if (storedSession === "true" && !storedAccount) {
          await AsyncStorage.removeItem(SESSION_KEY);
        }

        let localProfileFromStorage: UserProfile | null = null;
        if (storedProfile) {
          try {
            const parsed = JSON.parse(storedProfile) as UserProfile;
            localProfileFromStorage = parsed;
            profileRef.current = parsed;
            setProfile(parsed);
          } catch {
            /* ignore corrupt profile */
          }
        }
        let localCgmFromStorage: CGMConnection | null = null;
        if (storedCGM) {
          try {
            const parsed = JSON.parse(storedCGM) as CGMConnection;
            localCgmFromStorage = parsed;
            setCGMConnectionState(parsed);
          } catch {
            /* ignore corrupt cgm */
          }
        }
        if (storedFoodLog) setFoodLog(JSON.parse(storedFoodLog));
        if (storedInsulinLog) setInsulinLog(JSON.parse(storedInsulinLog));
        if (storedContacts) setEmergencyContacts(JSON.parse(storedContacts));
        if (storedAlertPrefs) setAlertPrefsState({ ...DEFAULT_ALERT_PREFS, ...JSON.parse(storedAlertPrefs) });
        if (storedDoctorMessages) setDoctorMessages(JSON.parse(storedDoctorMessages));
        // Circle state: restore instantly so a co-guardian's first render is already anchored to
        // the shared pool + owner settings (the hydrate poll re-verifies against Convex right after).
        if (storedMemberships) {
          try {
            const rows = JSON.parse(storedMemberships) as CareMembership[];
            if (Array.isArray(rows)) setCareMemberships(rows);
          } catch { /* ignore corrupt cache */ }
        }
        if (storedCircleShared) {
          try {
            const parsed = JSON.parse(storedCircleShared) as CircleShared;
            if (parsed && typeof parsed === "object" && parsed.profile) setCircleShared(parsed);
          } catch { /* ignore corrupt cache */ }
        }
        const parsedQuickFoods = parseStoredQuickFoods(storedQuickFoods);
        if (parsedQuickFoods) setQuickFoods(parsedQuickFoods.slice(0, QUICK_FOODS_MAX));
        if (storedTherapyProposal) {
          try { setTherapyProposal(JSON.parse(storedTherapyProposal) as TherapyProposal); } catch { /* ignore corrupt proposal */ }
        }

        let signedInRestored = false;
        if (storedAccount) {
          let acc: UserAccount;
          try {
            acc = JSON.parse(storedAccount) as UserAccount;
          } catch {
            await AsyncStorage.multiRemove([ACCOUNT_KEY, SESSION_KEY]);
            return;
          }
          if (cancelled) return;
          accountRef.current = acc;
          setAccount(acc);
          if (storedSession === "true") {
            if (acc.convexUserId) {
              const ok = await restoreConvexBackedSession(acc);
              if (cancelled) return;
              if (ok) {
                setIsSignedIn(true);
                signedInRestored = true;
                const client = createConvexAuthClient();
                const userId = acc.convexUserId as Id<"users">;
                try {
                  const remote = await client.query(api.patientProfile.get, {
                    userId,
                    passwordHash: acc.passwordHash,
                  });
                  if (cancelled) return;
                  if (remote) {
                    const { alertPreferences: remotePrefs, ...p } = remote as UserProfile & { alertPreferences?: RemoteThresholds };
                    profileRef.current = p as UserProfile;
                    setProfile(p as UserProfile);
                    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
                    // Account-scoped thresholds: adopt the account's saved ranges, or seed the backend
                    // from this device's local thresholds if the account has none yet.
                    const overlay = sessionAlertOverlay(remotePrefs);
                    if (overlay) {
                      const next = { ...DEFAULT_ALERT_PREFS, ...(storedAlertPrefs ? JSON.parse(storedAlertPrefs) : {}), ...overlay };
                      setAlertPrefsState(next);
                      await AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)).catch(() => {});
                    } else if (storedAlertPrefs) {
                      client.mutation(api.patientProfile.setAlertPreferences, {
                        userId,
                        passwordHash: acc.passwordHash,
                        alertPreferences: thresholdsToBackend({ ...DEFAULT_ALERT_PREFS, ...JSON.parse(storedAlertPrefs) }),
                      }).catch(() => {});
                    }
                  } else if (localProfileFromStorage && isMigratableLocalProfile(localProfileFromStorage)) {
                    const profilePayload = JSON.parse(JSON.stringify(localProfileFromStorage));
                    await client.mutation(api.patientProfile.replace, {
                      userId,
                      passwordHash: acc.passwordHash,
                      profile: profilePayload,
                    });
                    if (cancelled) return;
                    profileRef.current = localProfileFromStorage;
                    setProfile(localProfileFromStorage);
                    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(localProfileFromStorage));
                  } else if (!localProfileFromStorage) {
                    profileRef.current = null;
                    setProfile(null);
                    await AsyncStorage.removeItem(PROFILE_KEY);
                  }

                  const remoteCgm = await client.query(api.patientCgm.get, {
                    userId,
                    passwordHash: acc.passwordHash,
                  });
                  if (cancelled) return;
                  if (remoteCgm) {
                    const cgm = remoteCgm as CGMConnection;
                    setCGMConnectionState(cgm);
                    await AsyncStorage.setItem(CGM_KEY, JSON.stringify(cgm));
                  } else if (localCgmFromStorage && isMigratableLocalCgm(localCgmFromStorage)) {
                    const connection = JSON.parse(JSON.stringify(localCgmFromStorage));
                    await client.mutation(api.patientCgm.replace, {
                      userId,
                      passwordHash: acc.passwordHash,
                      connection,
                    });
                    if (cancelled) return;
                    setCGMConnectionState(localCgmFromStorage);
                    await AsyncStorage.setItem(CGM_KEY, JSON.stringify(localCgmFromStorage));
                  } else {
                    setCGMConnectionState({ type: null });
                    await AsyncStorage.removeItem(CGM_KEY);
                  }
                } catch {
                  /* offline: keep AsyncStorage-hydrated profile and CGM */
                }
              } else {
                await AsyncStorage.removeItem(SESSION_KEY);
              }
            } else {
              setIsSignedIn(true);
              signedInRestored = true;
            }
          }
        }

        // Restore a persisted access-code (caregiver / child) session so it survives app restarts
        // exactly like an email account does — no re-typing the code. Skipped when a signed-in
        // account was restored above (the two are mutually exclusive).
        if (!signedInRestored && storedCaregiverCode) {
          await restoreCaregiverCodeSession(storedCaregiverCode);
        }
      } catch {
        try {
          await AsyncStorage.removeItem(SESSION_KEY);
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // While a co-guardian views a linked patient, the app reads the patient's (slim) profile and
  // shared logs everywhere it reads `profile`/`foodLog`/`insulinLog`; the co-guardian's own state
  // is preserved internally for when they exit.
  const isViewingLinkedPatient = viewingPatientId != null && viewedProfile != null;

  // ── Owner-settings inheritance: a linked co-guardian's app runs on the circle owner's shared
  // fields, with only truly personal fields (their name, photo, account role, notifications, chat)
  // coming from their own profile. The member's own stored values are fully shadowed while linked —
  // no trace on screen or in any tool — which is exactly what makes four calculators agree.
  const isCircleMember = isSignedIn && !!account?.convexUserId && circleShared != null;
  const mergedOwnProfile = useMemo(() => {
    if (!isCircleMember || !circleShared) return profile;
    const overlay: Partial<UserProfile> = {};
    for (const key of [...SHARED_PROFILE_EDIT_KEYS, "doctorCode", "doctorCodeIssuedAt"] as const) {
      const value = circleShared.profile[key as keyof CircleSharedProfile];
      if (value !== undefined && value !== null) (overlay as Record<string, unknown>)[key] = value;
    }
    const base: UserProfile =
      profile ?? ({ childName: "", diabetesType: "type1", dateOfBirth: "" } as UserProfile);
    return { ...base, ...overlay };
  }, [isCircleMember, circleShared, profile]);

  const effectiveProfile = isViewingLinkedPatient ? viewedProfile : mergedOwnProfile;
  /**
   * The SIGNED-IN person's own name — never the viewed patient's.
   *
   * `profile` is the EFFECTIVE profile, which becomes the viewed patient's while a co-guardian is
   * viewing a linked patient. Anything that needs to know who is *using* the app (the AI chat's
   * speaker label, for one) must not read `profile.parentName` there: it would resolve to the circle
   * OWNER, so a co-guardian got addressed by the owner's name. `parentName` is not a shared-overlay
   * field, so the own profile always carries the right one.
   */
  const ownParentName = mergedOwnProfile?.parentName?.trim() || null;
  const effectiveFoodLog = isViewingLinkedPatient ? viewedFoodLog : foodLog;
  const effectiveInsulinLog = isViewingLinkedPatient ? viewedInsulinLog : insulinLog;
  const viewingPatientName = isViewingLinkedPatient ? viewedProfile.childName : null;
  /** Doctor sync + report paths must see the INHERITED profile (owner's child data + doctor code). */
  const effectiveProfileRef = useRef<UserProfile | null>(null);
  useEffect(() => { effectiveProfileRef.current = effectiveProfile; }, [effectiveProfile]);

  const ageYears = effectiveProfile?.dateOfBirth ? computeAge(effectiveProfile.dateOfBirth) : null;
  const isMinor = ageYears !== null ? ageYears < 18 : false;

  // Load the circles this account co-guardians on sign-in (and when the account changes).
  useEffect(() => {
    if (!isSignedIn || !account?.convexUserId) {
      setCareMemberships([]);
      setViewingPatientId(null);
      setViewedProfile(null);
      return;
    }
    void refreshCareMemberships();
    // refreshCareMemberships depends on viewingPatientId; we intentionally key only on identity here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, account?.convexUserId, account?.passwordHash]);

  // ── Circle hydrate poll (every 60s): memberships → anchor, owner-settings overlay + pools,
  // one-time local→cloud log migration into the ANCHOR bucket, then the pooled logs themselves.
  // This is why a co-guardian's entry shows up on every guardian's Logs tab / calculator / chat
  // within a minute — and STAYS: the poll reads the same circle bucket the writes land in.
  useEffect(() => {
    if (isLoading) return; // wait for the boot AsyncStorage load so migration sees local logs
    if (!isSignedIn || !account?.convexUserId) return;
    const userId = account.convexUserId as Id<"users">;
    const passwordHash = account.passwordHash;
    let cancelled = false;

    async function hydrateOwn() {
      try {
        const client = createConvexAuthClient();

        // 0) Memberships → the circle anchor. On network failure fall back to the cached anchor.
        let anchor: Id<"users"> = (circleAnchorRef.current as Id<"users">) ?? userId;
        try {
          const rows = (await client.query(api.careCircle.myMemberships, {
            userId,
            passwordHash,
          })) as CareMembership[];
          if (cancelled) return;
          setCareMemberships(rows);
          AsyncStorage.setItem(CARE_MEMBERSHIPS_KEY, JSON.stringify(rows)).catch(() => {});
          anchor = (rows[0]?.patientUserId as Id<"users">) ?? userId;
          circleAnchorRef.current = anchor;
        } catch {
          /* offline — keep cached anchor */
        }

        // 1) Owner-settings overlay + the mutual quick-meals / emergency-contact pools.
        try {
          const circle = await client.query(api.careCircle.circleContext, { userId, passwordHash });
          if (cancelled) return;
          if (circle) {
            if (!circle.isOwner && circle.shared) {
              const nextShared: CircleShared = {
                anchorPatientUserId: String(circle.anchorPatientUserId),
                ownerName: circle.ownerName,
                profile: circle.shared as CircleSharedProfile,
              };
              circleSharedRef.current = nextShared;
              setCircleShared(nextShared);
              AsyncStorage.setItem(CIRCLE_SHARED_KEY, JSON.stringify(nextShared)).catch(() => {});
              // The owner's alert thresholds are the circle's thresholds (notif toggles stay local).
              const overlay = thresholdOverlay(nextShared.profile.alertPreferences);
              if (overlay) {
                setAlertPrefsState((prev) => {
                  const merged = { ...prev, ...overlay };
                  AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(merged)).catch(() => {});
                  return merged;
                });
              }
            } else {
              circleSharedRef.current = null;
              setCircleShared(null);
              AsyncStorage.removeItem(CIRCLE_SHARED_KEY).catch(() => {});
            }
            if (Array.isArray(circle.quickFoods)) {
              const pool = (circle.quickFoods as string[]).slice(0, QUICK_FOODS_MAX);
              const next = pool.length > 0 ? pool : DEFAULT_QUICK_FOODS;
              setQuickFoods(next);
              AsyncStorage.setItem(QUICK_FOODS_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
            } else if (circle.isOwner && quickFoodsRef.current.length > 0) {
              // Seed the pool once from this device's list (owner only — a joiner's old local list
              // must never displace the owner's).
              client
                .mutation(api.careCircle.setQuickFoods, { userId, passwordHash, foods: quickFoodsRef.current })
                .catch(() => {});
            } else if (!circle.isOwner) {
              // Member of a circle whose pool isn't seeded yet: show the clean default list, never
              // this device's pre-link leftovers (the owner's list becomes THE list on join).
              setQuickFoods(DEFAULT_QUICK_FOODS);
              AsyncStorage.setItem(QUICK_FOODS_STORAGE_KEY, JSON.stringify(DEFAULT_QUICK_FOODS)).catch(() => {});
            }
            if (Array.isArray(circle.emergencyContacts)) {
              const pool = circle.emergencyContacts as EmergencyContact[];
              setEmergencyContacts(pool);
              AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(pool)).catch(() => {});
            } else if (circle.isOwner && emergencyContactsRef.current.length > 0) {
              client
                .mutation(api.careCircle.importSharedEmergencyContacts, {
                  userId,
                  passwordHash,
                  contacts: emergencyContactsRef.current,
                })
                .catch(() => {});
            } else if (!circle.isOwner) {
              setEmergencyContacts([]);
              AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, "[]").catch(() => {});
            }
          }
        } catch {
          /* offline — cached overlay/pools remain */
        }

        // 2) Migrate local AsyncStorage logs into the cloud once per account+bucket (idempotent by
        // clientId). Bucket-scoped so joining a circle re-runs it INTO the pool.
        const migratedKey = `${LOGS_MIGRATED_KEY_PREFIX}${userId}_${anchor}`;
        const already =
          (await AsyncStorage.getItem(migratedKey)) ??
          // Original single-bucket marker still counts when we're our own bucket.
          (anchor === userId ? await AsyncStorage.getItem(`${LOGS_MIGRATED_KEY_PREFIX}${userId}`) : null);
        if (!already) {
          const localFood = foodLogRef.current;
          const localInsulin = insulinLogRef.current;
          if (localFood.length > 0 || localInsulin.length > 0) {
            await client.mutation(api.careLogs.importLogs, {
              userId,
              passwordHash,
              patientUserId: anchor,
              food: localFood.map(toFoodEntryPayload),
              insulin: localInsulin.map(toInsulinEntryPayload),
            });
          }
          await AsyncStorage.setItem(migratedKey, "1");
        }

        // 3) The pooled logs (server also redirects a self-read, so a stale anchor still pools).
        const remote = await client.query(api.careLogs.listLogs, {
          userId,
          passwordHash,
          patientUserId: anchor,
        });
        if (cancelled || !remote) return;
        setFoodLog((prev) => {
          const next = mergeCloudLogs(remote.foodLog as FoodLogEntry[], prev, 200);
          AsyncStorage.setItem(FOOD_LOG_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        setInsulinLog((prev) => {
          const next = mergeCloudLogs(remote.insulinLog as InsulinLogEntry[], prev, 500);
          AsyncStorage.setItem(INSULIN_LOG_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });

        // 4) Refresh this account's own profile so a co-guardian's edit to shared fields (which
        // lands on the OWNER's document) reaches the owner's device without a re-login. Skipped
        // briefly after a local commit so an in-flight edit can't be clobbered by a stale read.
        if (Date.now() - lastProfileCommitAtRef.current > 15_000) {
          const remoteProfile = await client.query(api.patientProfile.get, { userId, passwordHash });
          if (cancelled) return;
          if (remoteProfile) {
            const { alertPreferences: remotePrefs, ...p } = remoteProfile as UserProfile & {
              alertPreferences?: RemoteThresholds;
            };
            if (JSON.stringify(p) !== JSON.stringify(profileRef.current)) {
              profileRef.current = p as UserProfile;
              setProfile(p as UserProfile);
              AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
            }
            // Own thresholds only apply when NOT inheriting (a circle owner's, or a viewed child's).
            if (!circleSharedRef.current && !nurseViewCodeRef.current) {
              const overlay = sessionAlertOverlay(remotePrefs);
              if (overlay) {
                setAlertPrefsState((prev) => {
                  const merged = { ...prev, ...overlay };
                  AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(merged)).catch(() => {});
                  return merged;
                });
              }
            }
          }
        }
      } catch {
        /* offline — AsyncStorage-cached logs remain until the next poll */
      }
    }

    void hydrateOwn();
    const id = setInterval(hydrateOwn, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isLoading, isSignedIn, account?.convexUserId, account?.passwordHash, hydrateNonce]);

  // ── Viewed patient's shared logs — fetch + poll every 60s. A co-guardian sources them through
  // their account link (careLogs.listLogs); a nurse sources them through the child's access code
  // (careLogs.listLogsViaCode), which the schedule window gates server-side. ──
  useEffect(() => {
    if (!viewingPatientId || !account?.convexUserId) return;
    const userId = account.convexUserId as Id<"users">;
    const passwordHash = account.passwordHash;
    const patientUserId = viewingPatientId as Id<"users">;
    let cancelled = false;

    async function fetchViewedLogs() {
      try {
        const client = createConvexAuthClient();
        const viaCode = nurseViewCodeRef.current;
        const remote = viaCode
          ? await client.query(api.careLogs.listLogsViaCode, { code: viaCode })
          : await client.query(api.careLogs.listLogs, { userId, passwordHash, patientUserId });
        if (cancelled || !remote) return;
        setViewedFoodLog((prev) => mergeCloudLogs(remote.foodLog as FoodLogEntry[], prev, 200));
        setViewedInsulinLog((prev) => mergeCloudLogs(remote.insulinLog as InsulinLogEntry[], prev, 500));
      } catch {
        /* offline or outside the link's schedule — keep prior view */
      }
    }

    // One-shot for an immediate paint; the subscription above keeps it fresh from here.
    void fetchViewedLogs();
    return () => {
      cancelled = true;
    };
  }, [viewingPatientId, account?.convexUserId, account?.passwordHash]);

  // ── Caregiver access-code session: source the patient's shared logs via the code (when the code
  // grants view-logs and is inside its schedule). Legacy 6-char caregiver codes have no shared logs. ──
  useEffect(() => {
    if (caregiverCodeKind !== "access" || !caregiverCloudCode) return;
    let cancelled = false;
    async function fetchCodeLogs() {
      try {
        const client = createConvexAuthClient();
        const remote = await client.query(api.careLogs.listLogsViaCode, { code: caregiverCloudCode as string });
        if (cancelled) return;
        // No view-logs grant / outside the window → the pool is off for this session, show nothing.
        if (!remote) {
          setFoodLog([]);
          setInsulinLog([]);
          return;
        }
        // Merge (don't replace) so this device's own just-logged entry survives a racing poll until
        // the server has it — the same protection the account/co-guardian paths use. Otherwise a kid's
        // or caregiver's fresh log would flash then vanish for up to a poll cycle.
        setFoodLog((prev) => mergeCloudLogs(remote.foodLog as FoodLogEntry[], prev, 200));
        setInsulinLog((prev) => mergeCloudLogs(remote.insulinLog as InsulinLogEntry[], prev, 500));
      } catch {
        /* offline — keep prior */
      }
    }
    // One-shot for an immediate paint; the reactive subscription above owns freshness. Access loss
    // is covered two ways — see the note there (revocation re-fires the query; a schedule window
    // closing is caught by the `checkAccess` lock, not by this query).
    void fetchCodeLogs();
    return () => {
      cancelled = true;
    };
  }, [caregiverCodeKind, caregiverCloudCode]);

  // ── Out-of-schedule lock: watch the active "someone else's data" session's access state and
  // raise a lock when a code/link falls outside its window or is removed mid-session. ──
  useEffect(() => {
    const inCaregiverAccess = caregiverCodeKind === "access" && !!caregiverCloudCode;
    const inViewing = !!viewingPatientId && !!account?.convexUserId;
    if (!inCaregiverAccess && !inViewing) {
      setAccessLock(null);
      return;
    }
    const viaCode = nurseViewCode; // a nurse's kid-view is gated by the child's access code
    let cancelled = false;
    async function checkAccess() {
      try {
        const client = createConvexAuthClient();
        if (inCaregiverAccess || viaCode) {
          const code = (inCaregiverAccess ? caregiverCloudCode : viaCode) as string;
          const resolved = await client.query(api.careCircle.resolveAccessCode, { code });
          if (cancelled) return;
          if (!resolved) setAccessLock({ reason: "revoked" });
          else if (resolved.accessState.state !== "ok") {
            setAccessLock({ reason: resolved.accessState.state === "disabled" ? "disabled" : "outside_window", nextStartMs: resolved.accessState.nextStartMs });
          } else setAccessLock(null);
        } else {
          const rows = (await client.query(api.careCircle.myMemberships, {
            userId: account!.convexUserId as Id<"users">,
            passwordHash: account!.passwordHash,
          })) as CareMembership[];
          if (cancelled) return;
          const m = rows.find((r) => r.patientUserId === viewingPatientId);
          if (!m) setAccessLock({ reason: "revoked" });
          else if (m.accessState.state !== "ok") {
            setAccessLock({ reason: m.accessState.state === "disabled" ? "disabled" : "outside_window", nextStartMs: m.accessState.nextStartMs });
          } else setAccessLock(null);
        }
      } catch {
        /* offline — don't lock on a transient network error */
      }
    }
    void checkAccess();
    const id = setInterval(checkAccess, 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [caregiverCodeKind, caregiverCloudCode, viewingPatientId, nurseViewCode, account?.convexUserId, account?.passwordHash]);

  /**
   * Adopt a freshly-activated Clerk session: provision/find the Convex `users` row and build the
   * local account. Clerk's `setActive` and ConvexProviderWithClerk's token attach are asynchronous
   * with respect to each other, so `ensureUser` is retried briefly — otherwise the very first call
   * can land before the client has a token and fail as unauthenticated.
   */
  const adoptClerkSession = useCallback(async (emailForAccount: string): Promise<UserAccount> => {
    const client = createConvexAuthClient();
    let lastErr: unknown = null;
    // Give ConvexProviderWithClerk a beat to attach the fresh token before the first attempt —
    // otherwise attempt 1 reliably lands unauthenticated and logs a scary (but harmless) console
    // error on every single sign-in.
    await new Promise((r) => setTimeout(r, 400));
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await client.mutation(api.identity.ensureUser, {});
        return {
          email: emailForAccount || res.email || "",
          passwordHash: "",
          convexUserId: String(res.userId),
        };
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
      }
    }
    throw lastErr ?? new Error("Could not finish signing in");
  }, []);

  /**
   * Clear every "borrowed session" overlay: co-guardian viewing, the nurse kid-view (code +
   * inherited role/permissions/contacts), access-code session kind, and the schedule lock. This must
   * run at every ACCOUNT BOUNDARY (sign-in, sign-out, create, logout) — the smoke test that skipped
   * it had a nurse's kid-view survive a sign-out and bleed into the next (owner) account, which then
   * greeted as "Jimbo's Caregiver" and MESSAGED AS THE CODE, making both sides render the same
   * message as their own. Unconditional, unlike `exitViewingMode` (which only tears down nurse state
   * when a nurse view is active).
   */
  const clearSessionOverlay = useCallback(() => {
    setViewingPatientId(null);
    setViewedProfile(null);
    setViewedFoodLog([]);
    setViewedInsulinLog([]);
    setViewedEmergencyContacts([]);
    setAccessLock(null);
    setNurseViewCode(null);
    nurseViewCodeRef.current = null;
    setAccessCodeRole(null);
    setAccessCodePermissions(null);
    setCaregiverCodeKind(null);
  }, []);

  /**
   * The single "this Clerk account now owns this device" commit, shared by every entry path (email
   * sign-in, Google SSO, email verification, password reset). Fetches the account's remote
   * profile/CGM/thresholds FIRST (so routing decides off complete state — no onboarding flash),
   * then atomically replaces ALL per-account state and storage. Clearing everything matters: the
   * device may hold a previous account's cached profile/logs/CGM, and the Google path skipping this
   * was exactly the "old name + phantom Dexcom + skipped onboarding" bug in the first smoke test.
   */
  const commitClerkAccount = useCallback(async (acc: UserAccount): Promise<void> => {
    const client = createConvexAuthClient();
    let nextProfile: UserProfile | null = null;
    let appliedAlertPrefs: AlertPreferences | null = null;
    let nextCgm: CGMConnection | null = null;
    /**
     * CRITICAL DISTINCTION. `nextProfile === null` used to mean two irreconcilable things:
     *   (a) the server answered and this account genuinely has NO profile → un-onboarded, correct
     *       to route into onboarding;
     *   (b) the query THREW because we're offline → account state is UNKNOWN.
     * Both fell into the same branch, so an offline sign-in cleared PROFILE_KEY, the router sent the
     * user to /onboarding, and finishing setup called `patientProfile.replace` — a whole-document
     * replace — wiping the server's doctor contact fields, caregiver/doctor codes and access log.
     * A network blip destroyed real data. Tracked separately now.
     */
    let profileFetchOk = false;
    try {
      // Identity rides the Clerk token on the shared client — no credentials in the args.
      const remote = await client.query(api.patientProfile.get, {});
      profileFetchOk = true;
      if (remote) {
        const { alertPreferences: remotePrefs, ...p } = remote as UserProfile & { alertPreferences?: RemoteThresholds };
        nextProfile = p as UserProfile;
        appliedAlertPrefs = { ...DEFAULT_ALERT_PREFS, ...(sessionAlertOverlay(remotePrefs) ?? {}) };
      }
    } catch {
      /* offline — state unknown; handled below, never treated as "no profile" */
    }
    // Separate try: a CGM fetch failure must not make the PROFILE result look unreachable.
    try {
      const remoteCgm = await client.query(api.patientCgm.get, {});
      if (remoteCgm) nextCgm = remoteCgm as CGMConnection;
    } catch {
      /* offline — the hydrate poll fills this in later */
    }

    // Couldn't reach the server: fall back to this device's cached profile rather than declaring the
    // account un-onboarded. Signing back in offline is the common case and the cache is usually right.
    let preservedCachedProfile = false;
    if (!profileFetchOk && !nextProfile) {
      try {
        const cached = await AsyncStorage.getItem(PROFILE_KEY);
        if (cached) {
          nextProfile = JSON.parse(cached) as UserProfile;
          preservedCachedProfile = true;
        }
      } catch {
        /* corrupt cache — fall through */
      }
    }

    // Commit in one batch. `setIsSignedIn(true)` goes last so the first render that observes it
    // already carries the resolved profile.
    accountRef.current = acc;
    setAccount(acc);
    clearSessionOverlay();
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    setCareMemberships([]);
    setCircleShared(null);
    circleSharedRef.current = null;
    setQuickFoods(DEFAULT_QUICK_FOODS);
    setFoodLog([]);
    setInsulinLog([]);
    setEmergencyContacts([]);
    profileRef.current = nextProfile;
    setProfile(nextProfile);
    setAlertPrefsState(appliedAlertPrefs ?? DEFAULT_ALERT_PREFS);
    setCGMConnectionState(nextCgm ?? { type: null });
    setIsSignedIn(true);

    await AsyncStorage.multiSet([
      [ACCOUNT_KEY, JSON.stringify(acc)],
      [SESSION_KEY, "true"],
    ]);
    await AsyncStorage.multiRemove([
      CAREGIVER_CODE_KEY,
      CARE_MEMBERSHIPS_KEY,
      CIRCLE_SHARED_KEY,
      QUICK_FOODS_STORAGE_KEY,
      GLUCOSE_HISTORY_STORAGE_KEY,
      GLUCOSE_SETTINGS_STORAGE_KEY,
      FOOD_LOG_KEY,
      INSULIN_LOG_KEY,
      EMERGENCY_CONTACTS_KEY,
    ]);
    if (nextProfile && !preservedCachedProfile) {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
    } else if (!nextProfile && profileFetchOk) {
      // The server ANSWERED and there is no profile — genuinely un-onboarded, so clear the cache.
      await AsyncStorage.removeItem(PROFILE_KEY);
    }
    // Implicit third case: offline with a cached profile — leave PROFILE_KEY exactly as it is.
    if (appliedAlertPrefs) await AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(appliedAlertPrefs)).catch(() => {});
    else await AsyncStorage.removeItem(ALERT_PREFS_KEY).catch(() => {});
    if (nextCgm?.type) await AsyncStorage.setItem(CGM_KEY, JSON.stringify(nextCgm));
    else await AsyncStorage.removeItem(CGM_KEY);
  }, [clearSessionOverlay]);

  /** Clerk's "You're already signed in." — a stale Keychain session (it survives app reinstall). */
  const isClerkSessionExistsError = (e: unknown): boolean => {
    const errors = (e as { errors?: { code?: string }[] } | null)?.errors;
    return Array.isArray(errors) && errors.some((err) => err?.code === "session_exists");
  };

  /** Human-readable message out of a Clerk API error (or any Error) for on-screen surfacing. */
  const clerkErrorMessage = (e: unknown): string | null => {
    const err = (e as { errors?: { longMessage?: string; message?: string }[] } | null)?.errors?.[0];
    return err?.longMessage ?? err?.message ?? (e instanceof Error && e.message ? e.message : null);
  };

  /**
   * Google sign-in. Clerk's SSO flow opens a browser session and returns a Clerk session id; from
   * there it converges with the email/password path (`adoptClerkSession`), so the rest of the app
   * sees no difference between how someone signed in.
   */
  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    // Full account commit — fetches this account's remote profile (new Google account ⇒ none ⇒
    // onboarding) and clears every trace of any previous account cached on this device.
    const adoptAndCommit = async () => {
      const acc = await adoptClerkSession("");
      await commitClerkAccount(acc);
      return true;
    };
    const runFlow = () =>
      startSSOFlow({
        strategy: "oauth_google",
        // Standalone builds must redirect to a URL on the Clerk dashboard's "Allowlist for mobile
        // SSO redirect" (Native applications page). The bundle-id scheme is registered in the
        // binary alongside "mobile" and is collision-proof; Expo Go ignores the scheme override
        // and keeps using its own exp:// URL.
        redirectUrl: Linking.createURL("callback", { scheme: "com.bretthoffman.glucoseguardian" }),
      });

    let flow;
    try {
      flow = await runFlow();
    } catch (e) {
      if (!isClerkSessionExistsError(e)) {
        throw new Error(clerkErrorMessage(e) ?? "Google sign-in could not start.");
      }
      // A session survived in the Keychain (reinstalls keep it). Adopt it if it still works;
      // if it's a zombie (token no longer refreshes), purge it and run the flow fresh.
      try {
        return await adoptAndCommit();
      } catch {
        await clerkSignOut().catch(() => {});
        try {
          flow = await runFlow();
        } catch (retryErr) {
          throw new Error(clerkErrorMessage(retryErr) ?? "Google sign-in could not start.");
        }
      }
    }

    const { createdSessionId, setActive: setSsoActive } = flow;
    if (createdSessionId && setSsoActive) {
      await setSsoActive({ session: createdSessionId });
      return await adoptAndCommit();
    }
    // No new session and no error: the user backed out of the browser sheet — stay quiet —
    // unless an (adoptable) existing session is signed in underneath.
    if (clerkIsSignedIn) {
      try {
        return await adoptAndCommit();
      } catch {
        await clerkSignOut().catch(() => {});
        return false;
      }
    }
    return false;
  }, [startSSOFlow, adoptClerkSession, commitClerkAccount, clerkIsSignedIn, clerkSignOut]);

  const createAccount = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!clerkSignUp || !setSignUpActive) throw new Error("Sign-up isn't ready yet — try again.");
    let attempt;
    try {
      attempt = await clerkSignUp.create({ emailAddress: normalizedEmail, password });
    } catch (e) {
      // A session already lives in the Keychain (survives reinstall) — adopt it instead of
      // erroring with "You're already signed in." on a screen with no way out.
      if (isClerkSessionExistsError(e)) {
        const acc = await adoptClerkSession(normalizedEmail);
        await commitClerkAccount(acc);
        return { status: "complete" as const };
      }
      throw e;
    }
    if (attempt.status !== "complete") {
      // The Clerk instance requires email verification. Kick off the code and let the UI collect it;
      // `verifyEmailCode` finishes the job.
      await clerkSignUp.prepareEmailAddressVerification({ strategy: "email_code" });
      return { status: "needs_verification" as const };
    }
    await setSignUpActive({ session: attempt.createdSessionId });
    const acc = await adoptClerkSession(normalizedEmail);
    accountRef.current = acc;
    clearSessionOverlay();
    setProfile(null);
    profileRef.current = null;
    setCGMConnectionState({ type: null });
    setFoodLog([]);
    setInsulinLog([]);
    setEmergencyContacts([]);
    setAlertPrefsState(DEFAULT_ALERT_PREFS);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    setCareMemberships([]);
    setCircleShared(null);
    circleSharedRef.current = null;
    setQuickFoods(DEFAULT_QUICK_FOODS);
    setAccount(acc);
    setIsSignedIn(true);
    await AsyncStorage.multiSet([
      [ACCOUNT_KEY, JSON.stringify(acc)],
      [SESSION_KEY, "true"],
    ]);
    await AsyncStorage.multiRemove([
      PROFILE_KEY,
      CGM_KEY,
      FOOD_LOG_KEY,
      INSULIN_LOG_KEY,
      EMERGENCY_CONTACTS_KEY,
      ALERT_PREFS_KEY,
      CAREGIVER_CODE_KEY,
      CARE_MEMBERSHIPS_KEY,
      CIRCLE_SHARED_KEY,
      QUICK_FOODS_STORAGE_KEY,
      GLUCOSE_HISTORY_STORAGE_KEY,
      GLUCOSE_SETTINGS_STORAGE_KEY,
    ]);
    return { status: "complete" as const };
  }, [clerkSignUp, setSignUpActive, adoptClerkSession, clearSessionOverlay, commitClerkAccount]);

  /** Finish an email/password sign-up that required an emailed verification code. */
  const verifyEmailCode = useCallback(async (code: string): Promise<boolean> => {
    if (!clerkSignUp || !setSignUpActive) return false;
    const attempt = await clerkSignUp.attemptEmailAddressVerification({ code });
    if (attempt.status !== "complete") return false;
    await setSignUpActive({ session: attempt.createdSessionId });
    const acc = await adoptClerkSession(accountRef.current?.email ?? "");
    await commitClerkAccount(acc);
    return true;
  }, [clerkSignUp, setSignUpActive, adoptClerkSession, commitClerkAccount]);

  /** Email a password-reset code. Clerk owns delivery, templates, expiry, and rate limiting. */
  const requestPasswordReset = useCallback(async (email: string): Promise<boolean> => {
    if (!clerkSignIn) return false;
    try {
      await clerkSignIn.create({
        strategy: "reset_password_email_code",
        identifier: email.trim().toLowerCase(),
      });
      return true;
    } catch {
      return false;
    }
  }, [clerkSignIn]);

  /** Complete the reset with the emailed code + a new password, which also signs the user in. */
  const resetPassword = useCallback(async (code: string, newPassword: string): Promise<boolean> => {
    if (!clerkSignIn || !setSignInActive) return false;
    try {
      const attempt = await clerkSignIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code,
        password: newPassword,
      });
      if (attempt.status !== "complete") return false;
      await setSignInActive({ session: attempt.createdSessionId });
      const acc = await adoptClerkSession(accountRef.current?.email ?? "");
      await commitClerkAccount(acc);
      return true;
    } catch {
      return false;
    }
  }, [clerkSignIn, setSignInActive, adoptClerkSession, commitClerkAccount]);

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!clerkSignIn || !setSignInActive) return false;
    try {
      const attempt = await clerkSignIn.create({ identifier: normalizedEmail, password });
      if (attempt.status !== "complete") return false;
      await setSignInActive({ session: attempt.createdSessionId });
      const acc = await adoptClerkSession(normalizedEmail);
      {
        await commitClerkAccount(acc);
        return true;
      }
    } catch (e) {
      // A Keychain session from a previous install blocks new sign-ins — adopt it instead.
      if (isClerkSessionExistsError(e)) {
        try {
          const acc = await adoptClerkSession(normalizedEmail);
          await commitClerkAccount(acc);
          return true;
        } catch {
          /* fall through to false */
        }
      }
      // Wrong password, unknown email, or offline. The pre-Convex "legacy single-device account"
      // fallback that used to live here is gone: Clerk is the only credential store now, and it
      // can't verify a password held locally.
    }
    return false;
  }, [clerkSignIn, setSignInActive, adoptClerkSession, commitClerkAccount]);

  /**
   * Back out of onboarding, DELETING the half-made account so the same email is free to sign up
   * again from scratch. Convex first (its guard refuses if setup actually completed), then the
   * Clerk user — the credential that would otherwise answer "an account already exists".
   * Returns false if either half fails, so the UI can offer "finish later" instead of lying.
   */
  const abandonSignup = useCallback(async (): Promise<boolean> => {
    try {
      const res = await createConvexAuthClient().mutation(api.identity.discardUnfinishedAccount, {});
      if (res && res.deleted === false && res.reason === "setup_complete") return false;
    } catch {
      return false; // offline / unreachable — better to keep the account than orphan a Clerk user
    }
    try {
      await clerkUser?.delete();
    } catch {
      return false;
    }
    await clerkSignOut().catch(() => {});
    return true;
  }, [clerkUser, clerkSignOut]);

  const signOut = useCallback(async () => {
    // End the Clerk session first; otherwise the persisted token would restore the user on relaunch.
    await clerkSignOut().catch(() => {});
    setIsSignedIn(false);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    setCareMemberships([]);
    setCircleShared(null);
    circleSharedRef.current = null;
    clearSessionOverlay();
    await AsyncStorage.multiRemove([SESSION_KEY, CAREGIVER_CODE_KEY, CARE_MEMBERSHIPS_KEY, CIRCLE_SHARED_KEY]);
  }, [clerkSignOut, clearSessionOverlay]);

  const setupProfile = useCallback(async (p: UserProfile) => {
    await commitProfile(p);
  }, [commitProfile]);

  /** TRUE when the change is durable. See the note on {@link commitProfile}. */
  const updateProfile = useCallback(async (partial: Partial<UserProfile>): Promise<boolean> => {
    // A linked co-guardian's shared fields live on the OWNER's account: route those through the
    // circle mutation (optimistically reflected via the overlay) and keep only personal fields on
    // this account's own document. Owner-locked fields are rejected server-side as a backstop.
    const shared = circleSharedRef.current;
    const acc = accountRef.current;
    let sharedOk = true;
    if (shared && acc?.convexUserId) {
      const sharedPatch: Partial<Pick<UserProfile, (typeof SHARED_PROFILE_EDIT_KEYS)[number]>> = {};
      const personal: Partial<UserProfile> = {};
      for (const [key, value] of Object.entries(partial)) {
        if ((SHARED_PROFILE_EDIT_KEYS as readonly string[]).includes(key)) {
          (sharedPatch as Record<string, unknown>)[key] = value;
        } else {
          (personal as Record<string, unknown>)[key] = value;
        }
      }
      if (Object.keys(sharedPatch).length > 0) {
        const nextShared: CircleShared = {
          ...shared,
          profile: { ...shared.profile, ...(sharedPatch as Partial<CircleSharedProfile>) },
        };
        circleSharedRef.current = nextShared;
        setCircleShared(nextShared);
        AsyncStorage.setItem(CIRCLE_SHARED_KEY, JSON.stringify(nextShared)).catch(() => {});
        // The server rejects the WHOLE patch if it contains any owner-locked field, so send only what
        // this member may actually change. Otherwise one disallowed field discards their legitimate
        // edits too (and the optimistic overlay above would keep showing a value the server refused).
        const { sendable, blocked } = splitSharedProfilePatch(sharedPatch, false);
        if (blocked.length > 0) {
          // Roll the overlay back for the fields we're not sending, so the UI stops showing them.
          const rolledBack: CircleShared = { ...nextShared, profile: { ...nextShared.profile } };
          for (const k of blocked) {
            (rolledBack.profile as Record<string, unknown>)[k] =
              (shared.profile as Record<string, unknown>)[k];
          }
          circleSharedRef.current = rolledBack;
          setCircleShared(rolledBack);
          AsyncStorage.setItem(CIRCLE_SHARED_KEY, JSON.stringify(rolledBack)).catch(() => {});
          sharedOk = false; // something the caller asked for did not stick
        }
        if (Object.keys(sendable).length > 0) {
          const sentOk = await createConvexAuthClient()
            .mutation(api.careCircle.updateSharedProfile, {
              userId: acc.convexUserId as Id<"users">,
              passwordHash: acc.passwordHash,
              patch: sendable,
            })
            .then(() => true)
            .catch(() => false);
          if (!sentOk) sharedOk = false;
        }
      }
      if (Object.keys(personal).length > 0) {
        const prev = profileRef.current;
        if (prev) return (await commitProfile({ ...prev, ...personal })) && sharedOk;
      }
      return sharedOk;
    }
    const prev = profileRef.current;
    if (!prev) return false;
    return await commitProfile({ ...prev, ...partial });
  }, [commitProfile]);

  /**
   * Durable CGM disconnect — SERVER FIRST, local state only on success.
   *
   * The old flow cleared local state optimistically and swallowed a failed `patientCgm.clear`. The
   * result was a lie in the dangerous direction: the app said "Connect CGM" while the server kept the
   * connection row, so the every-minute ingest cron carried on pulling from the sensor and publishing
   * readings to caregivers and the doctor portal — and the next sign-in re-hydrated "connected",
   * silently undoing the user's disconnect.
   *
   * Deliberately NOT touched: the server-wins rehydrate that powers auto-relink (an account keeps its
   * CGM link forever and re-attaches on any device). That behavior is correct and is exactly why a
   * half-failed disconnect used to come back — the fix is to make the disconnect actually land, not to
   * weaken the rehydrate.
   *
   * `patientCgm.clear` deletes the connection row AND its `cgmSyncState` work-queue rows, so once this
   * resolves true the cron has genuinely stopped for this patient.
   */
  const disconnectCGM = useCallback(async (): Promise<boolean> => {
    const acc = accountRef.current;
    if (acc?.convexUserId) {
      try {
        await createConvexAuthClient().mutation(api.patientCgm.clear, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
        });
      } catch {
        // Still connected server-side. Leave local state alone so the UI keeps telling the truth.
        return false;
      }
    }
    setCGMConnectionState({ type: null });
    try {
      await AsyncStorage.removeItem(CGM_KEY);
    } catch {
      /* the server is already clear, which is what the cron reads */
    }
    return true;
  }, []);

  const setCGMConnection = useCallback(async (conn: CGMConnection) => {
    await commitCGMConnection(conn);
  }, [commitCGMConnection]);

  /**
   * Care Circle shared-bucket writes: optimistically update the currently-displayed patient's log
   * (viewed patient when a co-guardian is viewing, else my own), then persist to Convex where the
   * server re-derives the authoritative byline. Own writes also cache to AsyncStorage for offline.
   * Legacy local-only accounts (no convexUserId) stay AsyncStorage-only exactly as before.
   */
  const addFoodLogEntry = useCallback((entry: Omit<FoodLogEntry, "id">) => {
    const id = `food_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const acc = accountRef.current;
    const codeWrite = codeWriteRef.current;
    const full: FoodLogEntry = {
      ...entry,
      id,
      // Marked unsynced until the server acknowledges it below — see `pendingSync`.
      pendingSync: true,
      ...(acc?.convexUserId ? { authorUserId: acc.convexUserId } : {}),
      authorName: deriveOwnAuthorName(profileRef.current, acc),
    };
    // A signed-in nurse viewing a child via the child's access code: write via the code (lands in the
    // circle's shared bucket) but attributed to the nurse's account so guardians see the nurse's name.
    const nurseWrite = nurseWriteRef.current;
    if (nurseWrite && acc?.convexUserId) {
      if (!nurseWrite.canLog) return;
      setViewedFoodLog((prev) => [full, ...prev].slice(0, 200));
      createConvexAuthClient()
        .mutation(api.careLogs.addFoodLogViaCode, {
          code: nurseWrite.code,
          entry: toFoodEntryPayload(full),
          authorUserId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
        })
        .then(() => clearPendingMarker(setViewedFoodLog, id, null))
        .catch(() => {});
      return;
    }
    // Access-code session (a child, or a caregiver granted `log`) writes via the code, not an account.
    if (codeWrite) {
      if (!codeWrite.canLog) return;
      // Stamp the writing code locally too, so this device reads "by you" immediately rather than
      // only after the server copy comes back.
      full.authorCode = codeWrite.code;
      setFoodLog((prev) => [full, ...prev].slice(0, 200));
      createConvexAuthClient()
        .mutation(api.careLogs.addFoodLogViaCode, { code: codeWrite.code, entry: toFoodEntryPayload(full) })
        .then(() => clearPendingMarker(setFoodLog, id, null))
        .catch(() => {});
      return;
    }
    const targetPatientId = viewingPatientIdRef.current ?? circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (viewingPatientIdRef.current) {
      setViewedFoodLog((prev) => [full, ...prev].slice(0, 200));
    } else {
      setFoodLog((prev) => {
        const next = [full, ...prev].slice(0, 200);
        AsyncStorage.setItem(FOOD_LOG_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
    if (acc?.convexUserId && targetPatientId) {
      createConvexAuthClient()
        .mutation(api.careLogs.addFoodLog, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          patientUserId: targetPatientId as Id<"users">,
          entry: toFoodEntryPayload(full),
        })
        .then(() =>
          viewingPatientIdRef.current
            ? clearPendingMarker(setViewedFoodLog, id, null)
            : clearPendingMarker(setFoodLog, id, FOOD_LOG_KEY),
        )
        .catch(() => {});
    }
  }, []);

  const clearFoodLog = useCallback(() => {
    const acc = accountRef.current;
    const targetPatientId = viewingPatientIdRef.current ?? circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (viewingPatientIdRef.current) setViewedFoodLog([]);
    else {
      setFoodLog([]);
      AsyncStorage.removeItem(FOOD_LOG_KEY).catch(() => {});
    }
    if (acc?.convexUserId && targetPatientId) {
      createConvexAuthClient()
        .mutation(api.careLogs.clearFood, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          patientUserId: targetPatientId as Id<"users">,
        })
        .catch(() => {});
    }
  }, []);

  const logInsulinDose = useCallback((entry: Omit<InsulinLogEntry, "id">) => {
    const id = `ins_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const acc = accountRef.current;
    const codeWrite = codeWriteRef.current;
    const full: InsulinLogEntry = {
      ...entry,
      id,
      // Marked unsynced until the server acknowledges it below — see `pendingSync`.
      pendingSync: true,
      ...(acc?.convexUserId ? { authorUserId: acc.convexUserId } : {}),
      authorName: deriveOwnAuthorName(profileRef.current, acc),
    };
    // Nurse viewing a child via the child's access code — attribute the dose to the nurse's account.
    const nurseWrite = nurseWriteRef.current;
    if (nurseWrite && acc?.convexUserId) {
      if (!nurseWrite.canLog) return;
      setViewedInsulinLog((prev) => [full, ...prev].slice(0, 500));
      createConvexAuthClient()
        .mutation(api.careLogs.addInsulinLogViaCode, {
          code: nurseWrite.code,
          entry: toInsulinEntryPayload(full),
          authorUserId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
        })
        .then(() => clearPendingMarker(setViewedInsulinLog, id, null))
        .catch(() => {});
      return;
    }
    if (codeWrite) {
      if (!codeWrite.canLog) return;
      full.authorCode = codeWrite.code;
      setInsulinLog((prev) => [full, ...prev].slice(0, 500));
      createConvexAuthClient()
        .mutation(api.careLogs.addInsulinLogViaCode, { code: codeWrite.code, entry: toInsulinEntryPayload(full) })
        .then(() => clearPendingMarker(setInsulinLog, id, null))
        .catch(() => {});
      return;
    }
    const targetPatientId = viewingPatientIdRef.current ?? circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (viewingPatientIdRef.current) {
      setViewedInsulinLog((prev) => [full, ...prev].slice(0, 500));
    } else {
      setInsulinLog((prev) => {
        const next = [full, ...prev].slice(0, 500);
        AsyncStorage.setItem(INSULIN_LOG_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
    if (acc?.convexUserId && targetPatientId) {
      createConvexAuthClient()
        .mutation(api.careLogs.addInsulinLog, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          patientUserId: targetPatientId as Id<"users">,
          entry: toInsulinEntryPayload(full),
        })
        .then(() =>
          viewingPatientIdRef.current
            ? clearPendingMarker(setViewedInsulinLog, id, null)
            : clearPendingMarker(setInsulinLog, id, INSULIN_LOG_KEY),
        )
        .catch(() => {});
    }
  }, []);

  const clearInsulinLog = useCallback(() => {
    const acc = accountRef.current;
    const targetPatientId = viewingPatientIdRef.current ?? circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (viewingPatientIdRef.current) setViewedInsulinLog([]);
    else {
      setInsulinLog([]);
      AsyncStorage.removeItem(INSULIN_LOG_KEY).catch(() => {});
    }
    if (acc?.convexUserId && targetPatientId) {
      createConvexAuthClient()
        .mutation(api.careLogs.clearInsulin, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          patientUserId: targetPatientId as Id<"users">,
        })
        .catch(() => {});
    }
  }, []);

  // ── Per-entry edit / delete. Routes to the same shared bucket as add (via access code for a
  //    nurse/kid/teacher session, else the account mutation) so a change propagates to every circle
  //    member + access-code viewer and drops out of / updates the shared dose math. Optimistic. ──
  const mutateFoodEntry = useCallback((
    localUpdate: (prev: FoodLogEntry[]) => FoodLogEntry[],
    viaCode: (client: ReturnType<typeof createConvexAuthClient>, code: string) => Promise<unknown>,
    viaAccount: (client: ReturnType<typeof createConvexAuthClient>, userId: Id<"users">, passwordHash: string, patientUserId: Id<"users">) => Promise<unknown>,
  ) => {
    const acc = accountRef.current;
    const nurseWrite = nurseWriteRef.current;
    const codeWrite = codeWriteRef.current;
    if (nurseWrite && acc?.convexUserId) {
      if (!nurseWrite.canLog) return;
      setViewedFoodLog(localUpdate);
      viaCode(createConvexAuthClient(), nurseWrite.code).catch(() => {});
      return;
    }
    if (codeWrite) {
      if (!codeWrite.canLog) return;
      setFoodLog(localUpdate);
      viaCode(createConvexAuthClient(), codeWrite.code).catch(() => {});
      return;
    }
    const targetPatientId = viewingPatientIdRef.current ?? circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (viewingPatientIdRef.current) {
      setViewedFoodLog(localUpdate);
    } else {
      setFoodLog((prev) => {
        const next = localUpdate(prev);
        AsyncStorage.setItem(FOOD_LOG_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
    if (acc?.convexUserId && targetPatientId) {
      viaAccount(createConvexAuthClient(), acc.convexUserId as Id<"users">, acc.passwordHash, targetPatientId as Id<"users">).catch(() => {});
    }
  }, []);

  const mutateInsulinEntry = useCallback((
    localUpdate: (prev: InsulinLogEntry[]) => InsulinLogEntry[],
    viaCode: (client: ReturnType<typeof createConvexAuthClient>, code: string) => Promise<unknown>,
    viaAccount: (client: ReturnType<typeof createConvexAuthClient>, userId: Id<"users">, passwordHash: string, patientUserId: Id<"users">) => Promise<unknown>,
  ) => {
    const acc = accountRef.current;
    const nurseWrite = nurseWriteRef.current;
    const codeWrite = codeWriteRef.current;
    if (nurseWrite && acc?.convexUserId) {
      if (!nurseWrite.canLog) return;
      setViewedInsulinLog(localUpdate);
      viaCode(createConvexAuthClient(), nurseWrite.code).catch(() => {});
      return;
    }
    if (codeWrite) {
      if (!codeWrite.canLog) return;
      setInsulinLog(localUpdate);
      viaCode(createConvexAuthClient(), codeWrite.code).catch(() => {});
      return;
    }
    const targetPatientId = viewingPatientIdRef.current ?? circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (viewingPatientIdRef.current) {
      setViewedInsulinLog(localUpdate);
    } else {
      setInsulinLog((prev) => {
        const next = localUpdate(prev);
        AsyncStorage.setItem(INSULIN_LOG_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
    if (acc?.convexUserId && targetPatientId) {
      viaAccount(createConvexAuthClient(), acc.convexUserId as Id<"users">, acc.passwordHash, targetPatientId as Id<"users">).catch(() => {});
    }
  }, []);

  const deleteFoodLogEntry = useCallback((id: string) => {
    mutateFoodEntry(
      (prev) => prev.filter((f) => f.id !== id),
      (client, code) => client.mutation(api.careLogs.deleteFoodLogViaCode, { code, clientId: id }),
      (client, userId, passwordHash, patientUserId) => client.mutation(api.careLogs.deleteFoodLog, { userId, passwordHash, patientUserId, clientId: id }),
    );
  }, [mutateFoodEntry]);

  const deleteInsulinLogEntry = useCallback((id: string) => {
    mutateInsulinEntry(
      (prev) => prev.filter((i) => i.id !== id),
      (client, code) => client.mutation(api.careLogs.deleteInsulinLogViaCode, { code, clientId: id }),
      (client, userId, passwordHash, patientUserId) => client.mutation(api.careLogs.deleteInsulinLog, { userId, passwordHash, patientUserId, clientId: id }),
    );
  }, [mutateInsulinEntry]);

  const editFoodLogEntry = useCallback((id: string, patch: FoodLogPatch) => {
    const clean: FoodLogPatch = {
      ...(patch.foodName !== undefined ? { foodName: patch.foodName } : {}),
      ...(patch.estimatedCarbs !== undefined ? { estimatedCarbs: patch.estimatedCarbs } : {}),
      ...(patch.insulinUnits !== undefined ? { insulinUnits: patch.insulinUnits } : {}),
      ...(patch.timestamp !== undefined ? { timestamp: patch.timestamp } : {}),
    };
    mutateFoodEntry(
      (prev) => prev.map((f) => (f.id === id ? { ...f, ...clean, edited: true } : f)),
      (client, code) => client.mutation(api.careLogs.updateFoodLogViaCode, { code, clientId: id, patch: clean }),
      (client, userId, passwordHash, patientUserId) => client.mutation(api.careLogs.updateFoodLog, { userId, passwordHash, patientUserId, clientId: id, patch: clean }),
    );
  }, [mutateFoodEntry]);

  const editInsulinLogEntry = useCallback((id: string, patch: InsulinLogPatch) => {
    const clean: InsulinLogPatch = {
      ...(patch.units !== undefined ? { units: patch.units } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.timestamp !== undefined ? { timestamp: patch.timestamp } : {}),
    };
    mutateInsulinEntry(
      (prev) => prev.map((i) => (i.id === id ? { ...i, ...clean, edited: true } : i)),
      (client, code) => client.mutation(api.careLogs.updateInsulinLogViaCode, { code, clientId: id, patch: clean }),
      (client, userId, passwordHash, patientUserId) => client.mutation(api.careLogs.updateInsulinLog, { userId, passwordHash, patientUserId, clientId: id, patch: clean }),
    );
  }, [mutateInsulinEntry]);

  const logout = useCallback(async () => {
    await clerkSignOut().catch(() => {});
    clearSessionOverlay();
    profileRef.current = null;
    accountRef.current = null;
    setProfile(null);
    setAccount(null);
    setCGMConnectionState({ type: null });
    setFoodLog([]);
    setInsulinLog([]);
    setEmergencyContacts([]);
    setAlertPrefsState(DEFAULT_ALERT_PREFS);
    setIsSignedIn(false);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    setCareMemberships([]);
    setCircleShared(null);
    circleSharedRef.current = null;
    setQuickFoods(DEFAULT_QUICK_FOODS);
    setViewingPatientId(null);
    setViewedProfile(null);
    setViewedFoodLog([]);
    setViewedInsulinLog([]);
    // The doctor thread and any pending dose proposal are CLINICAL content belonging to the account
    // that just left. They were previously the only state with no clearing path at all, so the next
    // person on the phone was shown the previous guardian's conversation with their doctor — and
    // could approve an insulin-dose change meant for them.
    setDoctorMessages([]);
    doctorMessagesRef.current = [];
    setTherapyProposal(null);
    therapyProposalRef.current = null;
    recentlyDecidedProposalIdRef.current = null;
    await AsyncStorage.multiRemove([
      PROFILE_KEY,
      CGM_KEY,
      FOOD_LOG_KEY,
      INSULIN_LOG_KEY,
      EMERGENCY_CONTACTS_KEY,
      ALERT_PREFS_KEY,
      SESSION_KEY,
      ACCOUNT_KEY,
      CAREGIVER_CODE_KEY,
      CARE_MEMBERSHIPS_KEY,
      CIRCLE_SHARED_KEY,
      QUICK_FOODS_STORAGE_KEY,
      GLUCOSE_HISTORY_STORAGE_KEY,
      GLUCOSE_SETTINGS_STORAGE_KEY,
      DOCTOR_MESSAGES_KEY,
      THERAPY_PROPOSAL_KEY,
    ]);
  }, [clerkSignOut, clearSessionOverlay]);

  /** TRUE when the contact is durable. See the note on {@link commitProfile}. */
  const addEmergencyContact = useCallback(async (contact: Omit<EmergencyContact, "id">): Promise<boolean> => {
    // A nurse viewing a child sees the child's shared pool read-only — never edits it.
    if (nurseViewCodeRef.current) return false;
    const full: EmergencyContact = {
      ...contact,
      id: `ec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    // Check the cap BEFORE writing anything. The old code did `.slice(0, 5)`, which quietly dropped
    // the new contact locally, while the server did the same and still reported success — so a 6th
    // emergency contact vanished with a success haptic. Refuse up front instead.
    if (emergencyContactsRef.current.length >= MAX_EMERGENCY_CONTACTS_CLIENT) return false;
    setEmergencyContacts((prev) => {
      const next = [...prev, full].slice(0, MAX_EMERGENCY_CONTACTS_CLIENT);
      AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    // Mutual circle pool: the contact appears on every co-guardian's list within a poll.
    // (Never from an access-code session — that device is borrowing a view, not the account.)
    const acc = accountRef.current;
    if (acc?.convexUserId && !caregiverSessionRef.current) {
      // Emergency contacts are safety-critical: a contact that only exists on this device is one the
      // other guardians can't see and the alert flow won't have. Report the failure.
      return await createConvexAuthClient()
        .mutation(api.careCircle.addSharedEmergencyContact, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          contact: full,
        })
        .then(() => true)
        .catch(() => false);
    }
    return true;
  }, []);

  const removeEmergencyContact = useCallback(async (id: string) => {
    if (nurseViewCodeRef.current) return; // read-only borrowed pool while a nurse views a child
    setEmergencyContacts((prev) => {
      const next = prev.filter((c) => c.id !== id);
      AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    const acc = accountRef.current;
    if (acc?.convexUserId && !caregiverSessionRef.current) {
      createConvexAuthClient()
        .mutation(api.careCircle.removeSharedEmergencyContact, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          contactId: id,
        })
        .catch(() => {});
    }
  }, []);

  /** Radio semantics locally AND server-side: setting one contact clears every other. */
  const setPrimaryEmergencyContact = useCallback(async (id: string | null) => {
    if (nurseViewCodeRef.current) return; // read-only borrowed pool while a nurse views a child
    setEmergencyContacts((prev) => {
      const next = prev.map((c) => ({ ...c, primary: id != null && c.id === id ? true : undefined }));
      AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    const acc = accountRef.current;
    if (acc?.convexUserId && !caregiverSessionRef.current) {
      createConvexAuthClient()
        .mutation(api.careCircle.setPrimaryEmergencyContact, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          contactId: id,
        })
        .catch(() => {});
    }
  }, []);

  /** Quick Lookup meals: front-insert locally, then sync the circle's mutual list. */
  const saveQuickFood = useCallback((name: string) => {
    setQuickFoods((prev) => {
      const next = insertQuickFood(prev, name, QUICK_FOODS_MAX);
      AsyncStorage.setItem(QUICK_FOODS_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      const acc = accountRef.current;
      if (acc?.convexUserId && !caregiverSessionRef.current) {
        createConvexAuthClient()
          .mutation(api.careCircle.setQuickFoods, {
            userId: acc.convexUserId as Id<"users">,
            passwordHash: acc.passwordHash,
            foods: next,
          })
          .catch(() => {});
      }
      return next;
    });
  }, []);

  /** TRUE when the change is durable. See the note on {@link commitProfile}. */
  const updateAlertPrefs = useCallback(async (partial: Partial<AlertPreferences>): Promise<boolean> => {
    // In an access-code (kid/caregiver) session the thresholds on screen belong to the code owner —
    // this device is only viewing. Update in memory for the current view, but never persist: don't
    // touch this device's local cache and don't write the owner's backend thresholds.
    if (caregiverSessionRef.current) {
      // Emergency Text Alerts mirror the OWNER's setting in a code session — locked here.
      const { emergencyAlertsEnabled: _locked, ...personal } = partial;
      setAlertPrefsState((prev) => ({ ...prev, ...personal }));
      /**
       * PERSIST this session's OWN switches, scoped to its code.
       *
       * These used to be memory-only, so a caregiver or kid who turned notifications off (or turned
       * off Send Alerts to Chat) had it silently reset on the next app launch — the restore path
       * re-applies DEFAULT_ALERT_PREFS plus the owner's overlay. Thresholds are still never written
       * here: only the device-local fields this session actually owns, under a per-code key so two
       * codes on one phone don't inherit each other's choices.
       */
      const own = pickCodeAlertPrefs(personal);
      const code = caregiverCloudCodeRef.current;
      if (Object.keys(own).length > 0 && code) {
        const merged = { ...(await loadCodeAlertPrefs(code)), ...own };
        AsyncStorage.setItem(alertPrefsCodeKey(code), JSON.stringify(merged)).catch(() => {});
      }
      return true; // thresholds are the owner's — nothing to sync, so this is not a failure
    }
    // A linked co-guardian OR a nurse viewing a child inherits the owner's thresholds read-only: keep
    // personal notification toggles, drop any threshold keys (the UI hides Edit; backstop here), and
    // never push thresholds to the backend from this borrowing session.
    if (circleSharedRef.current || nurseViewCodeRef.current) {
      const { notificationsEnabled, emergencyAlertsEnabled, alertToChatOnOpenEnabled } = partial;
      const toggles: Partial<AlertPreferences> = {
        ...(notificationsEnabled !== undefined ? { notificationsEnabled } : {}),
        ...(alertToChatOnOpenEnabled !== undefined ? { alertToChatOnOpenEnabled } : {}),
        // A nurse viewing a kid mirrors the owner's LOCKED emergency setting; a co-guardian
        // (circleShared) keeps their own personal toggle.
        ...(emergencyAlertsEnabled !== undefined && !nurseViewCodeRef.current ? { emergencyAlertsEnabled } : {}),
      };
      setAlertPrefsState((prev) => {
        const next = { ...prev, ...toggles };
        AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      return true; // personal toggles are device-local by design — nothing to sync
    }
    // Computed from the ref rather than inside the state updater: the backend write used to be fired
    // from within `setAlertPrefsState`, which made it impossible to await (and ran a side effect
    // inside a reducer). Awaiting it is what lets the caller know the thresholds actually stuck —
    // otherwise the server keeps alarming on the OLD numbers while the UI shows the new ones.
    const prev = alertPrefsRef.current;
    const next = { ...prev, ...partial };
    const applyLocal = (v: AlertPreferences) => {
      alertPrefsRef.current = v;
      setAlertPrefsState(v);
      AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(v)).catch(() => {});
    };
    applyLocal(next); // optimistic so a switch never lags behind the tap
    const acc = accountRef.current;
    if (!acc?.convexUserId) return true;
    // Device-local-only change (e.g. the Send-Alerts-to-Chat switch): nothing for the server to
    // accept or reject, so don't round-trip and don't let an unrelated failure revert it.
    if (!patchTouchesBackend(partial)) return true;
    try {
      // Persist thresholds to the account so any access code it issues carries these ranges.
      await createConvexAuthClient().mutation(api.patientProfile.setAlertPreferences, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        alertPreferences: thresholdsToBackend(next),
      });
      return true;
    } catch {
      /**
       * ROLL BACK the synced fields. Leaving them applied is the dangerous direction: the push
       * pipeline keeps evaluating readings against the OLD server thresholds while the screen shows
       * the new ones, so a widened urgent-low silently never fires. The 60s hydrate poll would revert
       * the display a minute later anyway — this just makes it immediate and honest.
       *
       * Device-local fields in the same patch are KEPT (see rollbackSyncedKeys): they never needed the
       * server, so a network failure shouldn't undo them.
       */
      applyLocal(rollbackSyncedKeys(next, prev));
      return false;
    }
  }, []);

  const setChildMode = useCallback(async (enabled: boolean) => {
    await updateProfile({ childModeEnabled: enabled });
  }, [updateProfile]);

  const addAccessLogEntry = useCallback(async (action: string, actor: "owner" | "caregiver" | "doctor" = "owner") => {
    const prev = profileRef.current;
    if (!prev) return;
    const entry: AccessLogEntry = { id: `log_${Date.now()}`, timestamp: new Date().toISOString(), action, actor };
    const newLog = [...(prev.accessLog ?? []), entry].slice(-50);
    await commitProfile({ ...prev, accessLog: newLog });
  }, [commitProfile]);

  const generateCaregiverCode = useCallback(async (): Promise<string> => {
    const prev = profileRef.current;
    if (!prev) return "";
    // Crypto-random, not Math.random — this code is a bearer credential. See utils/accessCodeGen.ts.
    const code = generateAccessCode();
    const now = new Date().toISOString();
    const entry: AccessLogEntry = { id: `log_${Date.now()}`, timestamp: now, action: "Caregiver code generated", actor: "owner" };
    const updated = {
      ...prev,
      caregiverCode: code,
      caregiverCodeIssuedAt: now,
      accessLog: [...(prev.accessLog ?? []), entry].slice(-50),
    };
    await commitProfile(updated);
    return code;
  }, [commitProfile]);

  const enterCaregiverMode = useCallback(
    async (code: string): Promise<boolean> => {
      const normalized = normalizeCaregiverInputCode(code);
      if (normalized.length < 6) return false;

      /**
       * An access-code session is ACCOUNTLESS. If a signed-out account is still lingering (sign-out
       * historically left it in memory and on disk), it must be dropped before the session starts:
       * `LogHistory` derives `myUserId` from `account.convexUserId`, so a stale value makes every log
       * the PREVIOUS guardian wrote render as "· by you" to this caregiver. The cold-start restore
       * path already does exactly this (see the accountless comment there); the live path did not.
       *
       * Guarded on `!isSignedIn` so an owner self-testing their own code keeps their live account.
       * Called only once a code has actually matched — an invalid code shouldn't clear anything.
       */
      const dropStaleSignedOutAccount = () => {
        if (isSignedIn) return;
        accountRef.current = null;
        setAccount(null);
      };

      // 1) Legacy: the owner's own 6-char profile code matches (offline self-test).
      const localStored = profile?.caregiverCode;
      if (localStored && normalizeCaregiverInputCode(localStored) === normalized) {
        dropStaleSignedOutAccount();
        setCaregiverCloudCode(null);
        setCaregiverCodeKind("legacy");
        setCaregiverSession(true);
        return true;
      }

      if (isSignedIn) return false;

      const client = createConvexAuthClient();

      // 2) New Care Circle caregiver code (8-char). Requires view-readings + an open schedule.
      if (normalized.length === 8) {
        try {
          const resolved = await client.query(api.careCircle.resolveAccessCode, { code: normalized });
          if (resolved) {
            if (!resolved.permissions.viewReadings) return false;
            if (resolved.accessState.state !== "ok") return false;
            const slim = await client.query(api.careCircle.profileForAccessCode, { code: normalized });
            const nextProfile: UserProfile = {
              childName: slim?.childName ?? resolved.patientName,
              diabetesType: slim?.diabetesType ?? "type1",
              dateOfBirth: slim?.dateOfBirth ?? "",
              weightLbs: slim?.weightLbs,
              insulinTypes: slim?.insulinTypes,
              profilePhotoUri: slim?.profilePhotoUri,
              carbRatio: slim?.carbRatio,
              targetGlucose: slim?.targetGlucose,
              correctionFactor: slim?.correctionFactor,
              // See the note in restoreCaregiverCodeSession — the overrides must travel with the base.
              doseSettingsByTime: slim?.doseSettingsByTime,
            };
            profileRef.current = nextProfile;
            setProfile(nextProfile);
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
            // Adopt the code owner's alert thresholds for this session (in memory only — never write
            // this borrowed view over the device's own account thresholds). Fall back to the owner's
            // defaults so we never leave the previous account's ranges in place.
            {
              // Same as the restore path: the owner's thresholds, then this code's own switches.
              const ownPrefs = await loadCodeAlertPrefs(normalized);
              setAlertPrefsState((prev) => ({
                ...prev,
                ...DEFAULT_ALERT_PREFS,
                ...(sessionAlertOverlay(slim?.alertPreferences) ?? {}),
                ...ownPrefs,
              }));
            }
            // Drop any CGM connection left over from the account previously signed in on THIS
            // device. An access-code session never owns a sensor, and a stale connection made the
            // caregiver screen behave like the old guardian's (pull-to-sync hint, "reconnect
            // needed" banner) on a phone that had been signed into the main account.
            setCGMConnectionState({ type: null });
            await AsyncStorage.removeItem(CGM_KEY);
            dropStaleSignedOutAccount();
            setCaregiverCloudCode(normalized);
            setCaregiverCodeKind("access");
            setAccessCodeRole(resolved.kind);
            setAccessCodePermissions(resolved.permissions);
            setCaregiverSession(true);
            // Persist so this access-code session survives app restarts (no re-typing the code).
            await AsyncStorage.setItem(
              CAREGIVER_CODE_KEY,
              JSON.stringify({ code: normalized, kind: "access", role: resolved.kind, permissions: resolved.permissions }),
            );
            client.mutation(api.careCircle.touchAccessCode, { code: normalized }).catch(() => {});
            return true;
          }
        } catch {
          /* fall through to legacy */
        }
      }

      // 3) Legacy anonymous 6-char caregiver code (backward compatibility).
      try {
        const remote = await client.query(api.patientProfile.getByCaregiverCode, { code: normalized });
        if (!remote) return false;
        const { userId: _userId, ...profileFields } = remote as UserProfile & { userId: Id<"users"> };
        const nextProfile = profileFields as UserProfile;
        profileRef.current = nextProfile;
        setProfile(nextProfile);
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
        // Same leftover-connection cleanup as the access-code path above.
        setCGMConnectionState({ type: null });
        await AsyncStorage.removeItem(CGM_KEY);
        dropStaleSignedOutAccount();
        setCaregiverCloudCode(normalized);
        setCaregiverCodeKind("legacy");
        setCaregiverSession(true);
        // Persist so this access-code session survives app restarts (no re-typing the code).
        await AsyncStorage.setItem(
          CAREGIVER_CODE_KEY,
          JSON.stringify({ code: normalized, kind: "legacy" }),
        );
        return true;
      } catch {
        return false;
      }
    },
    [profile?.caregiverCode, isSignedIn],
  );

  const exitCaregiverMode = useCallback(() => {
    const hadCloudCaregiver = caregiverCloudCodeRef.current != null;
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setCaregiverCodeKind(null);
    setAccessCodeRole(null);
    setAccessCodePermissions(null);
    setAccessLock(null);
    setFoodLog([]);
    setInsulinLog([]);
    // Drop the owner's borrowed thresholds so they can't bleed into the next (real-account) sign-in.
    setAlertPrefsState(DEFAULT_ALERT_PREFS);
    // Manual caregiver/child sign-out — forget the persisted access code so it won't auto-restore.
    void AsyncStorage.removeItem(CAREGIVER_CODE_KEY);
    if (hadCloudCaregiver && !isSignedIn) {
      profileRef.current = null;
      setProfile(null);
      void AsyncStorage.multiRemove([
        PROFILE_KEY,
        CGM_KEY,
        FOOD_LOG_KEY,
        INSULIN_LOG_KEY,
        EMERGENCY_CONTACTS_KEY,
        ALERT_PREFS_KEY,
      ]);
    }
  }, [isSignedIn]);

  const generateDoctorCode = useCallback(async (): Promise<string> => {
    // Only the circle owner rotates the shared doctor code — a member device returns the
    // inherited one untouched (the UI hides the buttons; this is the backstop).
    if (circleSharedRef.current) return circleSharedRef.current.profile.doctorCode ?? "";
    const prev = profileRef.current;
    if (!prev) return "";
    // Crypto-random, not Math.random — this code is a bearer credential. See utils/accessCodeGen.ts.
    const code = generateAccessCode();
    const now = new Date().toISOString();
    const entry: AccessLogEntry = { id: `log_${Date.now()}`, timestamp: now, action: "Doctor code generated", actor: "owner" };
    const updated = {
      ...prev,
      doctorCode: code,
      doctorCodeIssuedAt: now,
      accessLog: [...(prev.accessLog ?? []), entry].slice(-50),
    };
    await commitProfile(updated);
    return code;
  }, [commitProfile]);

  const enterDoctorMode = useCallback((code: string): boolean => {
    const prev = profileRef.current;
    if (!prev?.doctorCode) return false;
    if (code.trim().toUpperCase() !== prev.doctorCode.toUpperCase()) return false;
    setDoctorSession(true);
    const entry: AccessLogEntry = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: "Doctor accessed account",
      actor: "doctor",
    };
    const updated = { ...prev, accessLog: [...(prev.accessLog ?? []), entry].slice(-50) };
    void commitProfile(updated);
    return true;
  }, [commitProfile]);

  const exitDoctorMode = useCallback(() => {
    setDoctorSession(false);
  }, []);

  // ── Co-guardian viewing overlay ──────────────────────────────────────────────────────────
  const refreshCareMemberships = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc?.convexUserId) {
      setCareMemberships([]);
      return;
    }
    try {
      const client = createConvexAuthClient();
      const rows = await client.query(api.careCircle.myMemberships, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
      });
      setCareMemberships(rows as CareMembership[]);
      AsyncStorage.setItem(CARE_MEMBERSHIPS_KEY, JSON.stringify(rows)).catch(() => {});
      circleAnchorRef.current =
        (rows as CareMembership[])[0]?.patientUserId ?? acc.convexUserId ?? null;
      // Re-run the full circle hydrate NOW (owner settings + pools + pooled logs) so accepting or
      // leaving a circle takes effect immediately, not on the next 60s poll.
      setHydrateNonce((n) => n + 1);
      // If we're viewing a patient whose link vanished (revoked / left), drop back to our own data.
      const stillValid = (rows as CareMembership[]).some((m) => m.patientUserId === viewingPatientId);
      if (viewingPatientId && !stillValid) {
        setViewingPatientId(null);
        setViewedProfile(null);
      }
    } catch {
      /* offline — keep the last known memberships */
    }
  }, [viewingPatientId]);

  const enterViewingMode = useCallback(async (patientUserId: string): Promise<boolean> => {
    const acc = accountRef.current;
    if (!acc?.convexUserId) return false;
    try {
      const client = createConvexAuthClient();
      const slim = await client.query(api.careCircle.profileForLink, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        patientUserId: patientUserId as Id<"users">,
      });
      if (!slim) return false; // link inactive, out of window, or lacking viewReadings
      const nextProfile: UserProfile = {
        childName: slim.childName,
        diabetesType: slim.diabetesType,
        dateOfBirth: slim.dateOfBirth ?? "",
        weightLbs: slim.weightLbs,
        insulinTypes: slim.insulinTypes,
        profilePhotoUri: slim.profilePhotoUri,
        carbRatio: slim.carbRatio,
        targetGlucose: slim.targetGlucose,
        correctionFactor: slim.correctionFactor,
        // A co-guardian must dose on the SAME math as the owner, overrides included.
        doseSettingsByTime: slim.doseSettingsByTime,
      };
      setViewedFoodLog([]);
      setViewedInsulinLog([]);
      setViewedProfile(nextProfile);
      setViewingPatientId(patientUserId);
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * A nurse opens a linked child's live view through the child's access code. Mirrors the co-guardian
   * viewing overlay (viewedProfile + viewingPatientId drive the banner + effective data), but sources
   * everything from the code — so it enters even when the code is outside its window (the schedule
   * lock overlay then takes over) and gates the tabs by the code's permissions.
   */
  const enterKidView = useCallback(
    async (code: string, patientUserId: string, patientName: string): Promise<boolean> => {
      const acc = accountRef.current;
      if (!acc?.convexUserId) return false;
      try {
        const client = createConvexAuthClient();
        const resolved = await client.query(api.careCircle.resolveAccessCode, { code });
        if (!resolved) return false; // code retired/removed
        // Slim profile is null when the code is out of its window — fall back to the name we already
        // have so the (locked) view still renders a header.
        let slim: Awaited<ReturnType<typeof client.query>> | null = null;
        try {
          slim = await client.query(api.careCircle.profileForAccessCode, { code });
        } catch {
          /* keep the fallback profile */
        }
        const s = slim as {
          childName?: string; diabetesType?: "type1" | "type2" | "other"; dateOfBirth?: string;
          weightLbs?: number; insulinTypes?: string[]; profilePhotoUri?: string;
          carbRatio?: number; targetGlucose?: number; correctionFactor?: number;
          // `profileForAccessCode` spreads `slimPatientProfile`, which has always returned this —
          // it was only missing from this hand-written cast, so the nurse view silently lost the
          // child's meal-window dose overrides.
          doseSettingsByTime?: DoseSettingsByTime;
          alertPreferences?: RemoteThresholds;
          emergencyContacts?: EmergencyContact[];
        } | null;
        const nextProfile: UserProfile = {
          childName: s?.childName ?? resolved.patientName ?? patientName,
          diabetesType: s?.diabetesType ?? "type1",
          dateOfBirth: s?.dateOfBirth ?? "",
          weightLbs: s?.weightLbs,
          insulinTypes: s?.insulinTypes,
          profilePhotoUri: s?.profilePhotoUri,
          carbRatio: s?.carbRatio,
          targetGlucose: s?.targetGlucose,
          correctionFactor: s?.correctionFactor,
          // A nurse dosing this child must use the child's meal-window overrides too.
          doseSettingsByTime: s?.doseSettingsByTime,
        };
        setViewedFoodLog([]);
        setViewedInsulinLog([]);
        setViewedProfile(nextProfile);
        // Inherit THIS child's alert thresholds (in-memory only — never persisted to the nurse's
        // account). Keep the nurse's own notification toggles; only the 4 thresholds are borrowed.
        setAlertPrefsState((prev) => ({
          ...prev,
          urgentLowThreshold: DEFAULT_ALERT_PREFS.urgentLowThreshold,
          lowThreshold: DEFAULT_ALERT_PREFS.lowThreshold,
          highThreshold: DEFAULT_ALERT_PREFS.highThreshold,
          urgentHighThreshold: DEFAULT_ALERT_PREFS.urgentHighThreshold,
          ...(sessionAlertOverlay(s?.alertPreferences) ?? {}),
        }));
        // Inherit the child's shared emergency-contact pool (read-only view).
        setViewedEmergencyContacts(s?.emergencyContacts ?? []);
        setAccessCodeRole(resolved.kind);
        setAccessCodePermissions(resolved.permissions);
        setNurseViewCode(code);
        nurseViewCodeRef.current = code;
        setViewingPatientId(patientUserId);
        client.mutation(api.careCircle.touchAccessCode, { code }).catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const exitViewingMode = useCallback(() => {
    setViewingPatientId(null);
    setViewedProfile(null);
    setViewedFoodLog([]);
    setViewedInsulinLog([]);
    setAccessLock(null);
    // Nurse kid-view teardown: clear the code + its borrowed permissions/settings so the menu resets.
    if (nurseViewCodeRef.current) {
      setNurseViewCode(null);
      nurseViewCodeRef.current = null;
      setAccessCodeRole(null);
      setAccessCodePermissions(null);
      setViewedEmergencyContacts([]);
      // Drop the borrowed thresholds back to defaults; keep the nurse's own notification toggles.
      setAlertPrefsState((prev) => ({
        ...prev,
        urgentLowThreshold: DEFAULT_ALERT_PREFS.urgentLowThreshold,
        lowThreshold: DEFAULT_ALERT_PREFS.lowThreshold,
        highThreshold: DEFAULT_ALERT_PREFS.highThreshold,
        urgentHighThreshold: DEFAULT_ALERT_PREFS.urgentHighThreshold,
      }));
    }
  }, []);

  const addDoctorMessage = useCallback((text: string, sender: "doctor" | "guardian") => {
    const msg: DoctorMessage = {
      id: `dm_${Date.now()}`,
      timestamp: new Date().toISOString(),
      text,
      sender,
      read: sender === "guardian",
    };
    setDoctorMessages((prev) => {
      const updated = [...prev, msg];
      AsyncStorage.setItem(DOCTOR_MESSAGES_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const markDoctorMessagesRead = useCallback(() => {
    setDoctorMessages((prev) => {
      const updated = prev.map((m) => ({ ...m, read: true }));
      AsyncStorage.setItem(DOCTOR_MESSAGES_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  /**
   * Apply the doctor-sync response: pull down the merged message thread and any pending treatment
   * proposal, persist them, and fire a local notification for anything genuinely new (recent).
   */
  const ingestDoctorSyncResponse = useCallback(
    (data: { messages?: DoctorMessage[]; therapyProposal?: TherapyProposal | null }) => {
      const RECENT_MS = 15 * 60 * 1000;
      const isRecent = (iso: string) => {
        const t = new Date(iso).getTime();
        return Number.isFinite(t) && Date.now() - t < RECENT_MS;
      };

      // 1) Merge the doctor↔caregiver thread (server holds both sides; device owns `read`).
      if (Array.isArray(data.messages)) {
        const prev = doctorMessagesRef.current;
        const { merged, newDoctorMessages } = mergeDoctorMessages(prev, data.messages);
        const changed =
          merged.length !== prev.length ||
          merged.some(
            (m, i) => prev[i]?.id !== m.id || prev[i]?.read !== m.read || prev[i]?.text !== m.text,
          );
        if (changed) {
          doctorMessagesRef.current = merged;
          setDoctorMessages(merged);
          AsyncStorage.setItem(DOCTOR_MESSAGES_KEY, JSON.stringify(merged)).catch(() => {});
        }
        const freshDoctorMsgs = newDoctorMessages.filter((m) => isRecent(m.timestamp));
        if (freshDoctorMsgs.length > 0) {
          scheduleDoctorMessageNotification({
            doctorName: profileRef.current?.doctorName,
            count: freshDoctorMsgs.length,
            preview: freshDoctorMsgs[freshDoctorMsgs.length - 1]?.text ?? "",
          }).catch(() => {});
        }
      }

      // 2) Reconcile a doctor-proposed treatment change (the caregiver's approval card). Only act
      // when the server actually reported the field — the new api-server always includes it
      // (null or an object); an older deployment omits it, and we must not clear a local proposal
      // just because a stale server didn't mention it.
      if (data.therapyProposal !== undefined) {
        const incomingProposal = data.therapyProposal as TherapyProposal | null;
        const { next, isNew } = reconcileTherapyProposal(
          therapyProposalRef.current,
          incomingProposal,
          recentlyDecidedProposalIdRef.current,
        );
        if ((next?.id ?? null) !== (therapyProposalRef.current?.id ?? null)) {
          therapyProposalRef.current = next;
          setTherapyProposal(next);
          if (next) AsyncStorage.setItem(THERAPY_PROPOSAL_KEY, JSON.stringify(next)).catch(() => {});
          else AsyncStorage.removeItem(THERAPY_PROPOSAL_KEY).catch(() => {});
        }
        if (isNew && next && isRecent(next.proposedAt)) {
          scheduleTreatmentProposalNotification({
            doctorName: next.proposedByName,
            summary: summarizeProposal(next),
          }).catch(() => {});
        }
      }
    },
    [],
  );

  const syncToDoctor = useCallback(async (
    glucoseReadings: { value: number; trend: string; timestamp: string }[] = [],
  ) => {
    // The EFFECTIVE profile: a linked co-guardian syncs the owner's child data under the owner's
    // shared doctor code, so every guardian feeds the same portal thread.
    const currentProfile = effectiveProfileRef.current ?? profileRef.current;
    const currentInsulinLog = insulinLogRef.current;
    const currentFoodLog = foodLogRef.current;
    const currentAlertPrefs = alertPrefsRef.current;
    const currentMessages = doctorMessagesRef.current;
    if (!currentProfile?.doctorCode) return;
    try {
      const snapshot = {
        accessCode: currentProfile.doctorCode.toUpperCase(),
        profile: {
          childName: currentProfile.childName,
          parentName: currentProfile.parentName,
          diabetesType: currentProfile.diabetesType,
          dateOfBirth: currentProfile.dateOfBirth,
          weightLbs: currentProfile.weightLbs,
          doctorName: currentProfile.doctorName,
          insulinTypes: currentProfile.insulinTypes,
          carbRatio: currentProfile.carbRatio,
          targetGlucose: currentProfile.targetGlucose,
          correctionFactor: currentProfile.correctionFactor,
          // The doctor reviews dosing decisions — sending only base ratios hid the meal-window
          // overrides the patient is actually dosing on.
          doseSettingsByTime: currentProfile.doseSettingsByTime,
        },
        glucoseReadings: glucoseReadings.slice(-300),
        insulinLog: currentInsulinLog.slice(0, 100),
        foodLog: currentFoodLog.slice(0, 100),
        messages: currentMessages,
        alertPreferences: {
          lowThreshold: currentAlertPrefs.lowThreshold,
          highThreshold: currentAlertPrefs.highThreshold,
          urgentLowThreshold: currentAlertPrefs.urgentLowThreshold,
          urgentHighThreshold: currentAlertPrefs.urgentHighThreshold,
        },
        syncedAt: new Date().toISOString(),
      };
      const res = await fetch(apiUrl("/api/doctor/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: DoctorMessage[];
        therapyProposal?: TherapyProposal | null;
      };
      ingestDoctorSyncResponse(data);
    } catch {}
  }, [ingestDoctorSyncResponse]);

  /**
   * Record the caregiver's decision on the pending proposal. Clears it locally immediately and
   * posts to the backend; the decision is stored server-side independently of the next full sync,
   * so the doctor portal reflects approved/declined right away. Applying approved settings to live
   * dosing is the caller's job (see TreatmentProposalCard) because it needs GlucoseContext.
   */
  const decideTherapyProposal = useCallback(async (status: "approved" | "declined") => {
    const p = therapyProposalRef.current;
    if (!p) return;
    const code = (effectiveProfileRef.current ?? profileRef.current)?.doctorCode?.toUpperCase();
    recentlyDecidedProposalIdRef.current = p.id;
    therapyProposalRef.current = null;
    setTherapyProposal(null);
    AsyncStorage.removeItem(THERAPY_PROPOSAL_KEY).catch(() => {});
    if (!code) return;
    try {
      await fetch(apiUrl("/api/doctor/order-decision"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: code, proposalId: p.id, status }),
      });
    } catch {
      /* best-effort — the local decision stands; the portal reflects it on next successful POST */
    }
  }, []);

  // A co-guardian viewing a linked patient is never in child mode — they're the admin, not the kid.
  const isChildMode = !isViewingLinkedPatient && !!(profile?.childModeEnabled || caregiverSession);
  // Based on the OWN profile (not the viewed kid's) so it stays true while a nurse views a child.
  const isCaregiverAccount = isSignedIn && profile?.accountRole === "caregiver";
  // A nurse actively inside a child's view (via their access code) — drives read-only inherited settings.
  const isCaregiverViewingChild = isCaregiverAccount && nurseViewCode != null;
  // While a nurse views a child, the emergency list is the child's shared pool (inherited read-only).
  const effectiveEmergencyContacts = isCaregiverViewingChild ? viewedEmergencyContacts : emergencyContacts;

  /**
   * Non-null when this session writes logs into SOMEONE ELSE'S profile via an access code, and so
   * must confirm before committing one — the value is that person's name for the prompt. Covers the
   * two caregiver entry points: an accountless caregiver access-code session, and a Caregiver
   * (nurse) account viewing a linked kid through their code. Deliberately excludes child/kid code
   * sessions (they log into their own profile) and co-guardians (the circle is theirs too).
   */
  const logConfirmPatientName = useMemo(
    () =>
      // `effectiveProfile` is the viewed kid's profile for a nurse, and the code owner's for an
      // accountless code — either way it names the person whose profile receives the log.
      resolveLogConfirmName({
        caregiverSession,
        accessCodeRole,
        isCaregiverViewingChild,
        patientName: effectiveProfile?.childName,
        fallbackName: viewingPatientName,
      }),
    [caregiverSession, accessCodeRole, isCaregiverViewingChild, effectiveProfile, viewingPatientName],
  );

  // ── LIVE pooled logs (Stage 2): the circle's shared log bucket as a subscription, so a
  // co-guardian's entry appears on every guardian's phone the moment it's written — the 60s hydrate
  // poll still runs for memberships/profile/settings, but log freshness no longer waits on it.
  // Skipped for access-code sessions (they read via code queries) and while viewing another patient
  // (the viewing overlay owns the visible logs).
  const liveLogsArgs =
    !isLoading && isSignedIn && account?.convexUserId && !caregiverSession && !doctorSession
      ? { patientUserId: (careMemberships[0]?.patientUserId ?? account.convexUserId) as Id<"users"> }
      : ("skip" as const);
  const liveLogs = useQuery(api.careLogs.listLogs, liveLogsArgs);
  useEffect(() => {
    if (!liveLogs || viewingPatientIdRef.current) return;
    setFoodLog((prev) => {
      const next = mergeCloudLogs(liveLogs.foodLog as FoodLogEntry[], prev, 200);
      AsyncStorage.setItem(FOOD_LOG_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    setInsulinLog((prev) => {
      const next = mergeCloudLogs(liveLogs.insulinLog as InsulinLogEntry[], prev, 500);
      AsyncStorage.setItem(INSULIN_LOG_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // RETRY unsynced writes. A fresh cloud snapshot that still doesn't contain a `pendingSync` entry
    // proves that entry never landed — the mutation died with the app before the in-memory queue
    // drained. `upsertFood`/`upsertInsulin` are idempotent on `clientId`, so re-sending cannot
    // duplicate; on success the marker clears and the entry becomes a normal cloud-backed row.
    // Without this, preserving the entry locally would keep it off the server forever.
    const acc = accountRef.current;
    const target = circleAnchorRef.current ?? acc?.convexUserId ?? null;
    if (!acc?.convexUserId || !target) return;
    const client = createConvexAuthClient();
    const cloudFoodIds = new Set((liveLogs.foodLog as FoodLogEntry[]).map((e) => e.id));
    const cloudInsulinIds = new Set((liveLogs.insulinLog as InsulinLogEntry[]).map((e) => e.id));
    for (const e of foodLogRef.current) {
      if (!e.pendingSync || cloudFoodIds.has(e.id)) continue;
      client
        .mutation(api.careLogs.addFoodLog, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          patientUserId: target as Id<"users">,
          entry: toFoodEntryPayload(e),
        })
        .then(() => clearPendingMarker(setFoodLog, e.id, FOOD_LOG_KEY))
        .catch(() => {
          /* still offline / not permitted — stays pending and is retried on the next snapshot */
        });
    }
    for (const e of insulinLogRef.current) {
      if (!e.pendingSync || cloudInsulinIds.has(e.id)) continue;
      client
        .mutation(api.careLogs.addInsulinLog, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          patientUserId: target as Id<"users">,
          entry: toInsulinEntryPayload(e),
        })
        .then(() => clearPendingMarker(setInsulinLog, e.id, INSULIN_LOG_KEY))
        .catch(() => {
          /* see above */
        });
    }
  }, [liveLogs]);

  // ── LIVE logs for VIEWER sessions — the same real-time treatment the owner gets above.
  // Access-code sessions and a nurse/co-guardian viewing a patient used to refresh on 60s
  // setInterval timers. iOS throttles (and can suspend) JS timers, so those sessions drifted behind
  // the owner: a caregiver could be minutes stale on insulin and food entries, which matters for
  // dose stacking, not just freshness. Same fix that already worked for glucose readings.
  const codeLogsCode = caregiverCodeKind === "access" ? caregiverCloudCode : null;
  const codeLogs = useQuery(
    api.careLogs.listLogsViaCode,
    !isLoading && codeLogsCode ? { code: codeLogsCode as string } : "skip",
  );
  useEffect(() => {
    if (!codeLogsCode || codeLogs === undefined) return;
    // null = this code no longer grants view-logs. Show nothing rather than the last cached pool.
    // NOTE on what the subscription does and does not catch: Convex invalidates on DATA changes, not
    // wall-clock time. A REVOCATION or permission edit is a row write, so it re-fires this query
    // immediately. A schedule WINDOW closing is pure time and does NOT — that case is owned by the
    // 45s `checkAccess` watcher below, which raises `accessLock` and blocks the whole tab UI via
    // AccessLockScreen. Both paths are needed; neither replaces the other.
    if (codeLogs === null) {
      setFoodLog([]);
      setInsulinLog([]);
      return;
    }
    setFoodLog((prev) => mergeCloudLogs(codeLogs.foodLog as FoodLogEntry[], prev, 200));
    setInsulinLog((prev) => mergeCloudLogs(codeLogs.insulinLog as InsulinLogEntry[], prev, 500));

    // Retry unsynced writes made in this code session — closes the gap left by the pendingSync work,
    // which could preserve a caregiver's entry locally but had no subscription to retry it on.
    const write = codeWriteRef.current;
    if (!write?.canLog) return;
    const client = createConvexAuthClient();
    const cloudFoodIds = new Set((codeLogs.foodLog as FoodLogEntry[]).map((e) => e.id));
    const cloudInsulinIds = new Set((codeLogs.insulinLog as InsulinLogEntry[]).map((e) => e.id));
    for (const e of foodLogRef.current) {
      if (!e.pendingSync || cloudFoodIds.has(e.id)) continue;
      client
        .mutation(api.careLogs.addFoodLogViaCode, { code: write.code, entry: toFoodEntryPayload(e) })
        .then(() => clearPendingMarker(setFoodLog, e.id, null))
        .catch(() => {});
    }
    for (const e of insulinLogRef.current) {
      if (!e.pendingSync || cloudInsulinIds.has(e.id)) continue;
      client
        .mutation(api.careLogs.addInsulinLogViaCode, { code: write.code, entry: toInsulinEntryPayload(e) })
        .then(() => clearPendingMarker(setInsulinLog, e.id, null))
        .catch(() => {});
    }
  }, [codeLogs, codeLogsCode]);

  // A nurse views a child through the child's access code; a co-guardian through their account link.
  const viewLogsViaCode = viewingPatientId ? nurseViewCode : null;
  const viewedCodeLogs = useQuery(
    api.careLogs.listLogsViaCode,
    !isLoading && viewLogsViaCode ? { code: viewLogsViaCode } : "skip",
  );
  const viewedLinkLogs = useQuery(
    api.careLogs.listLogs,
    !isLoading && viewingPatientId && !nurseViewCode && account?.convexUserId
      ? {
          userId: account.convexUserId as Id<"users">,
          passwordHash: account.passwordHash,
          patientUserId: viewingPatientId as Id<"users">,
        }
      : "skip",
  );
  useEffect(() => {
    const remote = viewedCodeLogs ?? viewedLinkLogs;
    if (!viewingPatientId || !remote) return;
    setViewedFoodLog((prev) => mergeCloudLogs(remote.foodLog as FoodLogEntry[], prev, 200));
    setViewedInsulinLog((prev) => mergeCloudLogs(remote.insulinLog as InsulinLogEntry[], prev, 500));
  }, [viewedCodeLogs, viewedLinkLogs, viewingPatientId]);

  const messagingIdentity: MessagingIdentity = useMemo(() => {
    // A code session (accountless access code, or a nurse viewing via a code) messages AS the code.
    if (caregiverCodeKind === "access" && caregiverCloudCode) return { kind: "code", code: caregiverCloudCode };
    if (nurseViewCode) return { kind: "code", code: nurseViewCode };
    // An owner or co-guardian messages as their account, scoped to their circle (anchor = owner id).
    if (isSignedIn && account?.convexUserId && !isCaregiverAccount) {
      return {
        kind: "guardian",
        userId: account.convexUserId,
        passwordHash: account.passwordHash,
        patientUserId: careMemberships[0]?.patientUserId ?? account.convexUserId,
      };
    }
    return null;
  }, [
    caregiverCodeKind, caregiverCloudCode, nurseViewCode, isSignedIn,
    account?.convexUserId, account?.passwordHash, isCaregiverAccount, careMemberships,
  ]);

  return (
    <AuthContext.Provider
      value={{
        profile: effectiveProfile,
        ownParentName,
        account,
        isLoading,
        isLoggedIn: !!effectiveProfile,
        isSignedIn,
        isMinor,
        ageYears,
        cgmConnection,
        foodLog: effectiveFoodLog,
        insulinLog: effectiveInsulinLog,
        emergencyContacts: effectiveEmergencyContacts,
        alertPrefs,
        caregiverSession,
        doctorSession,
        isChildMode,
        caregiverCloudCode,
        caregiverCodeKind,
        accessCodeRole,
        accessCodePermissions,
        setupProfile,
        updateProfile,
        setCGMConnection,
        disconnectCGM,
        addFoodLogEntry,
        clearFoodLog,
        logInsulinDose,
        clearInsulinLog,
        deleteFoodLogEntry,
        deleteInsulinLogEntry,
        editFoodLogEntry,
        editInsulinLogEntry,
        logout,
        signOut,
        abandonSignup,
        createAccount,
        signInWithGoogle,
        verifyEmailCode,
        requestPasswordReset,
        resetPassword,
        signIn,
        addEmergencyContact,
        removeEmergencyContact,
        setPrimaryEmergencyContact,
        updateAlertPrefs,
        setChildMode,
        generateCaregiverCode,
        enterCaregiverMode,
        exitCaregiverMode,
        generateDoctorCode,
        enterDoctorMode,
        exitDoctorMode,
        addAccessLogEntry,
        doctorMessages,
        addDoctorMessage,
        markDoctorMessagesRead,
        syncToDoctor,
        therapyProposal,
        decideTherapyProposal,
        careMemberships,
        refreshCareMemberships,
        isCircleMember,
        circleOwnerName: isCircleMember ? circleShared?.ownerName ?? null : null,
        quickFoods,
        saveQuickFood,
        viewingPatientId,
        viewingPatientName,
        isViewingLinkedPatient,
        enterViewingMode,
        exitViewingMode,
        isCaregiverAccount,
        messagingIdentity,
        isCaregiverViewingChild,
        logConfirmPatientName,
        enterKidView,
        nurseViewCode,
        accessLock,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
