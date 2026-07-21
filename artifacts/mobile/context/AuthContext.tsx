import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { mergeCloudLogs } from "@/utils/careLogsMerge";
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

export type AccountRole = "parent" | "adult";

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

export interface UserProfile {
  childName: string;
  parentName?: string;
  accountRole?: AccountRole;
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
}

export interface InsulinLogEntry {
  id: string;
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
}

export interface UserAccount {
  email: string;
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
  timestamp: string;
  foodName: string;
  estimatedCarbs: number;
  insulinUnits: number;
  confidence: "high" | "medium" | "low";
  fromPhoto: boolean;
  photoUri?: string;
  /** Care Circle shared bucket: who logged this. Absent on legacy device-local entries. */
  authorUserId?: string;
  authorName?: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
}

export interface AlertPreferences {
  notificationsEnabled: boolean;
  emergencyAlertsEnabled: boolean;
  urgentLowThreshold: number;
  lowThreshold: number;
  highThreshold: number;
  urgentHighThreshold: number;
}

export interface AuthContextType {
  profile: UserProfile | null;
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
  updateProfile: (profile: Partial<UserProfile>) => Promise<void>;
  setCGMConnection: (conn: CGMConnection) => Promise<void>;
  insulinLog: InsulinLogEntry[];
  addFoodLogEntry: (entry: Omit<FoodLogEntry, "id">) => void;
  clearFoodLog: () => void;
  logInsulinDose: (entry: Omit<InsulinLogEntry, "id">) => void;
  clearInsulinLog: () => void;
  logout: () => Promise<void>;
  signOut: () => Promise<void>;
  createAccount: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  addEmergencyContact: (contact: Omit<EmergencyContact, "id">) => Promise<void>;
  removeEmergencyContact: (id: string) => Promise<void>;
  updateAlertPrefs: (prefs: Partial<AlertPreferences>) => Promise<void>;
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

/** Stable empty arrays for co-guardian viewing mode — prevents new [] identities each render. */
const EMPTY_FOOD_LOG: FoodLogEntry[] = [];
const EMPTY_INSULIN_LOG: InsulinLogEntry[] = [];

/** Care-circle log payloads: the local entry `id` is the cloud `clientId` (idempotency key). */
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
  };
}

/** Optimistic byline for my own writes — the server re-derives the authoritative name on read. */
function deriveOwnAuthorName(profile: UserProfile | null, account: UserAccount | null): string {
  return profile?.parentName?.trim() || profile?.childName?.trim() || account?.email?.split("@")[0] || "Me";
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
  notificationsEnabled: false,
  emergencyAlertsEnabled: false,
  urgentLowThreshold: 55,
  lowThreshold: 70,
  highThreshold: 180,
  urgentHighThreshold: 250,
};

type RemoteThresholds = {
  lowThreshold?: number | null;
  highThreshold?: number | null;
  urgentLowThreshold?: number | null;
  urgentHighThreshold?: number | null;
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

/** The account-scoped subset of alert prefs that persists to the backend profile. */
function thresholdsToBackend(prefs: AlertPreferences) {
  return {
    lowThreshold: prefs.lowThreshold,
    highThreshold: prefs.highThreshold,
    urgentLowThreshold: prefs.urgentLowThreshold,
    urgentHighThreshold: prefs.urgentHighThreshold,
  };
}

/** Profile fields that belong to the CIRCLE (owner's account) while linked; the rest is personal. */
const SHARED_PROFILE_EDIT_KEYS = [
  "childName",
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
] as const;

/** Max Quick Lookup entries (list length stays constant; saving pushes the oldest off). */
const QUICK_FOODS_MAX = DEFAULT_QUICK_FOODS.length;

function hashPassword(password: string): string {
  const salted = `gg::${password}::glucose_guardian_2025`;
  let encoded = "";
  for (let i = 0; i < salted.length; i++) {
    encoded += salted.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return encoded;
}

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
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { accountRef.current = account; }, [account]);
  useEffect(() => { caregiverCloudCodeRef.current = caregiverCloudCode; }, [caregiverCloudCode]);
  useEffect(() => { caregiverSessionRef.current = caregiverSession; }, [caregiverSession]);
  useEffect(() => { insulinLogRef.current = insulinLog; }, [insulinLog]);
  useEffect(() => { foodLogRef.current = foodLog; }, [foodLog]);
  useEffect(() => { alertPrefsRef.current = alertPrefs; }, [alertPrefs]);
  useEffect(() => { doctorMessagesRef.current = doctorMessages; }, [doctorMessages]);
  useEffect(() => { therapyProposalRef.current = therapyProposal; }, [therapyProposal]);

  const commitProfile = useCallback(async (updated: UserProfile) => {
    lastProfileCommitAtRef.current = Date.now();
    profileRef.current = updated;
    setProfile(updated);
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    } catch {
      /* ignore */
    }
    const acc = accountRef.current;
    if (!acc?.convexUserId) return;
    try {
      const client = createConvexAuthClient();
      const profilePayload = JSON.parse(JSON.stringify(updated));
      await client.mutation(api.patientProfile.replace, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        profile: profilePayload,
      });
    } catch {
      /* offline — local cache remains */
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
                };
                profileRef.current = nextProfile;
                setProfile(nextProfile);
                await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
                // Show the code owner's alert thresholds for this restored session (in memory only).
                setAlertPrefsState((prev) => ({ ...prev, ...DEFAULT_ALERT_PREFS, ...(thresholdOverlay(slim.alertPreferences) ?? {}) }));
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
                    const overlay = thresholdOverlay(remotePrefs);
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
            // Own thresholds only apply when NOT inheriting a circle owner's.
            if (!circleSharedRef.current) {
              const overlay = thresholdOverlay(remotePrefs);
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

  // ── Viewed patient's shared logs (co-guardian viewing) — fetch + poll every 60s. ──
  useEffect(() => {
    if (!viewingPatientId || !account?.convexUserId) return;
    const userId = account.convexUserId as Id<"users">;
    const passwordHash = account.passwordHash;
    const patientUserId = viewingPatientId as Id<"users">;
    let cancelled = false;

    async function fetchViewedLogs() {
      try {
        const client = createConvexAuthClient();
        const remote = await client.query(api.careLogs.listLogs, {
          userId,
          passwordHash,
          patientUserId,
        });
        if (cancelled || !remote) return;
        setViewedFoodLog((prev) => mergeCloudLogs(remote.foodLog as FoodLogEntry[], prev, 200));
        setViewedInsulinLog((prev) => mergeCloudLogs(remote.insulinLog as InsulinLogEntry[], prev, 500));
      } catch {
        /* offline or outside the link's schedule — keep prior view */
      }
    }

    void fetchViewedLogs();
    const id = setInterval(fetchViewedLogs, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
        setFoodLog((remote?.foodLog ?? []) as FoodLogEntry[]);
        setInsulinLog((remote?.insulinLog ?? []) as InsulinLogEntry[]);
      } catch {
        /* offline — keep prior */
      }
    }
    void fetchCodeLogs();
    const id = setInterval(fetchCodeLogs, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
    let cancelled = false;
    async function checkAccess() {
      try {
        const client = createConvexAuthClient();
        if (inCaregiverAccess) {
          const resolved = await client.query(api.careCircle.resolveAccessCode, { code: caregiverCloudCode as string });
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
  }, [caregiverCodeKind, caregiverCloudCode, viewingPatientId, account?.convexUserId, account?.passwordHash]);

  const createAccount = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(password);
    const client = createConvexAuthClient();
    const convexUserId = await client.mutation(api.auth.register, {
      email: normalizedEmail,
      passwordHash,
    });
    const acc: UserAccount = {
      email: normalizedEmail,
      passwordHash,
      convexUserId: String(convexUserId),
    };
    accountRef.current = acc;
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
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = hashPassword(password);
    const client = createConvexAuthClient();
    try {
      const result = await client.query(api.auth.login, {
        email: normalizedEmail,
        passwordHash,
      });
      if (result) {
        const acc: UserAccount = {
          email: result.email,
          passwordHash,
          convexUserId: String(result.userId),
        };
        accountRef.current = acc;
        setAccount(acc);
        setIsSignedIn(true);
        setCaregiverSession(false);
        setCaregiverCloudCode(null);
        setDoctorSession(false);
        setCareMemberships([]);
        setCircleShared(null);
        circleSharedRef.current = null;
        setQuickFoods(DEFAULT_QUICK_FOODS);
        profileRef.current = null;
        setProfile(null);
        await AsyncStorage.multiSet([
          [ACCOUNT_KEY, JSON.stringify(acc)],
          [SESSION_KEY, "true"],
        ]);
        await AsyncStorage.removeItem(PROFILE_KEY);
        await AsyncStorage.removeItem(CGM_KEY);
        await AsyncStorage.removeItem(CAREGIVER_CODE_KEY);
        await AsyncStorage.removeItem(CARE_MEMBERSHIPS_KEY);
        await AsyncStorage.removeItem(CIRCLE_SHARED_KEY);
        await AsyncStorage.removeItem(QUICK_FOODS_STORAGE_KEY);
        await AsyncStorage.removeItem(GLUCOSE_HISTORY_STORAGE_KEY);
        await AsyncStorage.removeItem(GLUCOSE_SETTINGS_STORAGE_KEY);
        setCGMConnectionState({ type: null });
        try {
          const remote = await client.query(api.patientProfile.get, {
            userId: acc.convexUserId as Id<"users">,
            passwordHash: acc.passwordHash,
          });
          if (remote) {
            const { alertPreferences: remotePrefs, ...p } = remote as UserProfile & { alertPreferences?: RemoteThresholds };
            profileRef.current = p as UserProfile;
            setProfile(p as UserProfile);
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
            // Thresholds are account-scoped. Adopt this account's saved ranges over a clean default
            // base so nothing carries over from a previous session; if the account has none yet,
            // fall back to defaults (migration from a local-only account happens on the next boot,
            // where the device's stored thresholds are still intact — see the boot-restore path).
            const next = { ...DEFAULT_ALERT_PREFS, ...(thresholdOverlay(remotePrefs) ?? {}) };
            setAlertPrefsState(next);
            await AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)).catch(() => {});
          }
          const remoteCgm = await client.query(api.patientCgm.get, {
            userId: acc.convexUserId as Id<"users">,
            passwordHash: acc.passwordHash,
          });
          if (remoteCgm) {
            const cgm = remoteCgm as CGMConnection;
            setCGMConnectionState(cgm);
            await AsyncStorage.setItem(CGM_KEY, JSON.stringify(cgm));
          }
        } catch {
          /* offline — profile / CGM empty until network */
        }
        return true;
      }
    } catch {
      // Offline or Convex error — try legacy single-device account below.
    }
    const storedRaw = await AsyncStorage.getItem(ACCOUNT_KEY);
    if (!storedRaw) return false;
    const stored = JSON.parse(storedRaw) as UserAccount;
    if (
      stored.email === normalizedEmail &&
      stored.passwordHash === passwordHash &&
      !stored.convexUserId
    ) {
      accountRef.current = stored;
      setAccount(stored);
      setIsSignedIn(true);
      await AsyncStorage.setItem(SESSION_KEY, "true");
      return true;
    }
    return false;
  }, []);

  const signOut = useCallback(async () => {
    setIsSignedIn(false);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    setCareMemberships([]);
    setCircleShared(null);
    circleSharedRef.current = null;
    setViewingPatientId(null);
    setViewedProfile(null);
    setViewedFoodLog([]);
    setViewedInsulinLog([]);
    await AsyncStorage.multiRemove([SESSION_KEY, CAREGIVER_CODE_KEY, CARE_MEMBERSHIPS_KEY, CIRCLE_SHARED_KEY]);
  }, []);

  const setupProfile = useCallback(async (p: UserProfile) => {
    await commitProfile(p);
  }, [commitProfile]);

  const updateProfile = useCallback(async (partial: Partial<UserProfile>) => {
    // A linked co-guardian's shared fields live on the OWNER's account: route those through the
    // circle mutation (optimistically reflected via the overlay) and keep only personal fields on
    // this account's own document. Owner-locked fields are rejected server-side as a backstop.
    const shared = circleSharedRef.current;
    const acc = accountRef.current;
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
        createConvexAuthClient()
          .mutation(api.careCircle.updateSharedProfile, {
            userId: acc.convexUserId as Id<"users">,
            passwordHash: acc.passwordHash,
            patch: sharedPatch,
          })
          .catch(() => {
            /* offline or owner-only field — the next poll re-syncs the authoritative copy */
          });
      }
      if (Object.keys(personal).length > 0) {
        const prev = profileRef.current;
        if (prev) await commitProfile({ ...prev, ...personal });
      }
      return;
    }
    const prev = profileRef.current;
    if (!prev) return;
    await commitProfile({ ...prev, ...partial });
  }, [commitProfile]);

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
      ...(acc?.convexUserId ? { authorUserId: acc.convexUserId } : {}),
      authorName: deriveOwnAuthorName(profileRef.current, acc),
    };
    // Access-code session (a child, or a caregiver granted `log`) writes via the code, not an account.
    if (codeWrite) {
      if (!codeWrite.canLog) return;
      setFoodLog((prev) => [full, ...prev].slice(0, 200));
      createConvexAuthClient()
        .mutation(api.careLogs.addFoodLogViaCode, { code: codeWrite.code, entry: toFoodEntryPayload(full) })
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
      ...(acc?.convexUserId ? { authorUserId: acc.convexUserId } : {}),
      authorName: deriveOwnAuthorName(profileRef.current, acc),
    };
    if (codeWrite) {
      if (!codeWrite.canLog) return;
      setInsulinLog((prev) => [full, ...prev].slice(0, 500));
      createConvexAuthClient()
        .mutation(api.careLogs.addInsulinLogViaCode, { code: codeWrite.code, entry: toInsulinEntryPayload(full) })
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

  const logout = useCallback(async () => {
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
    ]);
  }, []);

  const addEmergencyContact = useCallback(async (contact: Omit<EmergencyContact, "id">) => {
    const full: EmergencyContact = {
      ...contact,
      id: `ec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    };
    setEmergencyContacts((prev) => {
      const next = [...prev, full].slice(0, 5);
      AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    // Mutual circle pool: the contact appears on every co-guardian's list within a poll.
    // (Never from an access-code session — that device is borrowing a view, not the account.)
    const acc = accountRef.current;
    if (acc?.convexUserId && !caregiverSessionRef.current) {
      createConvexAuthClient()
        .mutation(api.careCircle.addSharedEmergencyContact, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
          contact: full,
        })
        .catch(() => {});
    }
  }, []);

  const removeEmergencyContact = useCallback(async (id: string) => {
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

  const updateAlertPrefs = useCallback(async (partial: Partial<AlertPreferences>) => {
    // In an access-code (kid/caregiver) session the thresholds on screen belong to the code owner —
    // this device is only viewing. Update in memory for the current view, but never persist: don't
    // touch this device's local cache and don't write the owner's backend thresholds.
    if (caregiverSessionRef.current) {
      setAlertPrefsState((prev) => ({ ...prev, ...partial }));
      return;
    }
    // A linked co-guardian inherits the OWNER's thresholds read-only: keep their personal
    // notification toggles, drop any threshold keys (the UI hides Edit; this is the backstop),
    // and never push thresholds to the backend from a member device.
    if (circleSharedRef.current) {
      const { notificationsEnabled, emergencyAlertsEnabled } = partial;
      const toggles: Partial<AlertPreferences> = {
        ...(notificationsEnabled !== undefined ? { notificationsEnabled } : {}),
        ...(emergencyAlertsEnabled !== undefined ? { emergencyAlertsEnabled } : {}),
      };
      setAlertPrefsState((prev) => {
        const next = { ...prev, ...toggles };
        AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
      return;
    }
    setAlertPrefsState((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)).catch(() => {});
      // Persist thresholds to the account so any access code it issues carries these ranges.
      const acc = accountRef.current;
      if (acc?.convexUserId) {
        createConvexAuthClient()
          .mutation(api.patientProfile.setAlertPreferences, {
            userId: acc.convexUserId as Id<"users">,
            passwordHash: acc.passwordHash,
            alertPreferences: thresholdsToBackend(next),
          })
          .catch(() => {});
      }
      return next;
    });
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
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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

      // 1) Legacy: the owner's own 6-char profile code matches (offline self-test).
      const localStored = profile?.caregiverCode;
      if (localStored && normalizeCaregiverInputCode(localStored) === normalized) {
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
            };
            profileRef.current = nextProfile;
            setProfile(nextProfile);
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
            // Adopt the code owner's alert thresholds for this session (in memory only — never write
            // this borrowed view over the device's own account thresholds). Fall back to the owner's
            // defaults so we never leave the previous account's ranges in place.
            setAlertPrefsState((prev) => ({ ...prev, ...DEFAULT_ALERT_PREFS, ...(thresholdOverlay(slim?.alertPreferences) ?? {}) }));
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
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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

  const exitViewingMode = useCallback(() => {
    setViewingPatientId(null);
    setViewedProfile(null);
    setViewedFoodLog([]);
    setViewedInsulinLog([]);
    setAccessLock(null);
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

  return (
    <AuthContext.Provider
      value={{
        profile: effectiveProfile,
        account,
        isLoading,
        isLoggedIn: !!effectiveProfile,
        isSignedIn,
        isMinor,
        ageYears,
        cgmConnection,
        foodLog: effectiveFoodLog,
        insulinLog: effectiveInsulinLog,
        emergencyContacts,
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
        addFoodLogEntry,
        clearFoodLog,
        logInsulinDose,
        clearInsulinLog,
        logout,
        signOut,
        createAccount,
        signIn,
        addEmergencyContact,
        removeEmergencyContact,
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
