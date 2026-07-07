import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import { GLUCOSE_HISTORY_STORAGE_KEY, GLUCOSE_SETTINGS_STORAGE_KEY } from "@/constants/storage-keys";
import { apiUrl } from "@/utils/api-base-url";
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
  type: "bolus" | "correction" | "manual";
  note?: string;
  foodLogId?: string;
}

export interface UserAccount {
  email: string;
  passwordHash: string;
  /** Convex document id for `users` — set for cloud-backed accounts. */
  convexUserId?: string;
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

export type GuardianPinStatus =
  | "loading"
  | "not_set"
  | "active"
  | "temporarily_locked"
  | "unauthorized";

export type GuardianPinVerifyResult =
  | { result: "verified" }
  | { result: "invalid" }
  | { result: "temporarily_locked"; lockoutRemainingMs: number }
  | { result: "setup_required" }
  | { result: "unauthorized" };

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
  guardianPinStatus: GuardianPinStatus;
  guardianPinLockoutRemainingMs: number | null;
  /** True when a backend (or legacy local) PIN is configured. */
  guardianPinConfigured: boolean;
  isGuardianUnlocked: boolean;
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
  setupGuardianPin: (pin: string, pinConfirm: string) => Promise<{ ok: boolean; error?: string }>;
  verifyGuardianPin: (pin: string) => Promise<GuardianPinVerifyResult>;
  unlockGuardian: (pin: string) => Promise<GuardianPinVerifyResult>;
  refreshGuardianPinStatus: () => Promise<void>;
  lockGuardian: () => void;
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
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_KEY = "@gluco_guardian_profile";
const CGM_KEY = "@gluco_guardian_cgm";
const FOOD_LOG_KEY = "@gluco_guardian_food_log";
const INSULIN_LOG_KEY = "@gluco_guardian_insulin_log";
const EMERGENCY_CONTACTS_KEY = "@gluco_guardian_emergency_contacts";
const ALERT_PREFS_KEY = "@gluco_guardian_alert_prefs";
/** @deprecated Legacy local-only PIN storage — backend is authoritative when signed into Convex. */
const GUARDIAN_PIN_KEY = "@gluco_guardian_pin";
const ACCOUNT_KEY = "@gluco_guardian_account";
const SESSION_KEY = "@gluco_guardian_session";
const DOCTOR_MESSAGES_KEY = "@gluco_guardian_doctor_messages";
const THERAPY_PROPOSAL_KEY = "@gluco_guardian_therapy_proposal";

const DEFAULT_ALERT_PREFS: AlertPreferences = {
  notificationsEnabled: false,
  emergencyAlertsEnabled: false,
  urgentLowThreshold: 55,
  lowThreshold: 70,
  highThreshold: 180,
  urgentHighThreshold: 250,
};

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

function normalizeCaregiverInputCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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
  const [guardianPinStatus, setGuardianPinStatus] = useState<GuardianPinStatus>("loading");
  const [guardianPinLockoutRemainingMs, setGuardianPinLockoutRemainingMs] = useState<number | null>(null);
  const [legacyLocalPinPresent, setLegacyLocalPinPresent] = useState(false);
  const [isGuardianUnlocked, setIsGuardianUnlocked] = useState(false);
  const [caregiverSession, setCaregiverSession] = useState(false);
  const [doctorSession, setDoctorSession] = useState(false);
  const [caregiverCloudCode, setCaregiverCloudCode] = useState<string | null>(null);
  const [doctorMessages, setDoctorMessages] = useState<DoctorMessage[]>([]);
  const [therapyProposal, setTherapyProposal] = useState<TherapyProposal | null>(null);

  const profileRef = useRef(profile);
  const accountRef = useRef<UserAccount | null>(null);
  const caregiverCloudCodeRef = useRef<string | null>(null);
  const insulinLogRef = useRef(insulinLog);
  const foodLogRef = useRef(foodLog);
  const alertPrefsRef = useRef(alertPrefs);
  const doctorMessagesRef = useRef(doctorMessages);
  const therapyProposalRef = useRef(therapyProposal);
  /** Id of a proposal the caregiver just decided, so a racing sync poll can't resurrect it. */
  const recentlyDecidedProposalIdRef = useRef<string | null>(null);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { accountRef.current = account; }, [account]);
  useEffect(() => { caregiverCloudCodeRef.current = caregiverCloudCode; }, [caregiverCloudCode]);
  useEffect(() => { insulinLogRef.current = insulinLog; }, [insulinLog]);
  useEffect(() => { foodLogRef.current = foodLog; }, [foodLog]);
  useEffect(() => { alertPrefsRef.current = alertPrefs; }, [alertPrefs]);
  useEffect(() => { doctorMessagesRef.current = doctorMessages; }, [doctorMessages]);
  useEffect(() => { therapyProposalRef.current = therapyProposal; }, [therapyProposal]);

  const refreshGuardianPinStatus = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc?.convexUserId) {
      try {
        const stored = await AsyncStorage.getItem(GUARDIAN_PIN_KEY);
        setLegacyLocalPinPresent(!!stored);
        setGuardianPinStatus(stored ? "active" : "not_set");
        setGuardianPinLockoutRemainingMs(null);
      } catch {
        setLegacyLocalPinPresent(false);
        setGuardianPinStatus("not_set");
        setGuardianPinLockoutRemainingMs(null);
      }
      return;
    }
    try {
      const client = createConvexAuthClient();
      const status = await client.query(api.patientGuardianPin.getStatus, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
      });
      if (status.status === "unauthorized") {
        setGuardianPinStatus("unauthorized");
        setGuardianPinLockoutRemainingMs(null);
        return;
      }
      if (status.status === "temporarily_locked") {
        setGuardianPinStatus("temporarily_locked");
        setGuardianPinLockoutRemainingMs(status.lockoutRemainingMs);
        return;
      }
      setGuardianPinStatus(status.status);
      setGuardianPinLockoutRemainingMs(null);
      setLegacyLocalPinPresent(false);
    } catch {
      setGuardianPinStatus("not_set");
      setGuardianPinLockoutRemainingMs(null);
    }
  }, []);

  const verifyGuardianPin = useCallback(async (pin: string): Promise<GuardianPinVerifyResult> => {
    const acc = accountRef.current;
    if (!acc?.convexUserId) {
      try {
        const stored = await AsyncStorage.getItem(GUARDIAN_PIN_KEY);
        if (!stored) return { result: "setup_required" };
        if (stored === pin) return { result: "verified" };
        return { result: "invalid" };
      } catch {
        return { result: "invalid" };
      }
    }
    try {
      const client = createConvexAuthClient();
      const res = await client.action(api.patientGuardianPinActions.verifyPin, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        pin,
      });
      if (res.result === "temporarily_locked") {
        setGuardianPinStatus("temporarily_locked");
        setGuardianPinLockoutRemainingMs(res.lockoutRemainingMs);
      }
      return res;
    } catch {
      return { result: "invalid" };
    }
  }, []);

  const setupGuardianPin = useCallback(async (pin: string, pinConfirm: string) => {
    const acc = accountRef.current;
    if (!acc?.convexUserId) {
      if (pin !== pinConfirm) return { ok: false, error: "PINs don't match" };
      if (!/^\d{4}$/.test(pin)) return { ok: false, error: "PIN must be exactly 4 digits" };
      await AsyncStorage.setItem(GUARDIAN_PIN_KEY, pin);
      setLegacyLocalPinPresent(true);
      setGuardianPinStatus("active");
      return { ok: true };
    }
    try {
      const client = createConvexAuthClient();
      const res = await client.action(api.patientGuardianPinActions.setupPin, {
        userId: acc.convexUserId as Id<"users">,
        passwordHash: acc.passwordHash,
        pin,
        pinConfirm,
      });
      if (res.result === "ok") {
        await AsyncStorage.removeItem(GUARDIAN_PIN_KEY);
        setLegacyLocalPinPresent(false);
        setGuardianPinStatus("active");
        setGuardianPinLockoutRemainingMs(null);
        return { ok: true };
      }
      if (res.result === "mismatch") return { ok: false, error: "PINs don't match" };
      if (res.result === "invalid_format") return { ok: false, error: "PIN must be exactly 4 digits" };
      if (res.result === "already_active") return { ok: false, error: "Guardian PIN is already configured" };
      if (res.result === "unauthorized") return { ok: false, error: "Not authorized to set Guardian PIN" };
      return { ok: false, error: "Could not save Guardian PIN. Try again." };
    } catch {
      return { ok: false, error: "Could not save Guardian PIN. Check your connection." };
    }
  }, []);

  const unlockGuardian = useCallback(async (pin: string): Promise<GuardianPinVerifyResult> => {
    const res = await verifyGuardianPin(pin);
    if (res.result === "verified") {
      setIsGuardianUnlocked(true);
    }
    return res;
  }, [verifyGuardianPin]);

  const guardianPinConfigured =
    guardianPinStatus === "active" || (legacyLocalPinPresent && !account?.convexUserId);

  const commitProfile = useCallback(async (updated: UserProfile) => {
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
    async function load() {
      try {
        const [
          storedProfile,
          storedCGM,
          storedFoodLog,
          storedInsulinLog,
          storedContacts,
          storedAlertPrefs,
          storedPin,
          storedAccount,
          storedSession,
          storedDoctorMessages,
          storedTherapyProposal,
        ] = await Promise.all([
          AsyncStorage.getItem(PROFILE_KEY),
          AsyncStorage.getItem(CGM_KEY),
          AsyncStorage.getItem(FOOD_LOG_KEY),
          AsyncStorage.getItem(INSULIN_LOG_KEY),
          AsyncStorage.getItem(EMERGENCY_CONTACTS_KEY),
          AsyncStorage.getItem(ALERT_PREFS_KEY),
          AsyncStorage.getItem(GUARDIAN_PIN_KEY),
          AsyncStorage.getItem(ACCOUNT_KEY),
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(DOCTOR_MESSAGES_KEY),
          AsyncStorage.getItem(THERAPY_PROPOSAL_KEY),
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
        if (storedPin) setLegacyLocalPinPresent(true);
        if (storedDoctorMessages) setDoctorMessages(JSON.parse(storedDoctorMessages));
        if (storedTherapyProposal) {
          try { setTherapyProposal(JSON.parse(storedTherapyProposal) as TherapyProposal); } catch { /* ignore corrupt proposal */ }
        }

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
                const client = createConvexAuthClient();
                const userId = acc.convexUserId as Id<"users">;
                try {
                  const remote = await client.query(api.patientProfile.get, {
                    userId,
                    passwordHash: acc.passwordHash,
                  });
                  if (cancelled) return;
                  if (remote) {
                    const p = remote as UserProfile;
                    profileRef.current = p;
                    setProfile(p);
                    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
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
                await refreshGuardianPinStatus();
              } else {
                await AsyncStorage.removeItem(SESSION_KEY);
              }
            } else {
              setIsSignedIn(true);
            }
          }
        } else if (storedPin) {
          setLegacyLocalPinPresent(true);
          setGuardianPinStatus("active");
        } else {
          setGuardianPinStatus("not_set");
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

  const ageYears = profile?.dateOfBirth ? computeAge(profile.dateOfBirth) : null;
  const isMinor = ageYears !== null ? ageYears < 18 : false;

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
    setGuardianPinStatus("not_set");
    setGuardianPinLockoutRemainingMs(null);
    setLegacyLocalPinPresent(false);
    setIsGuardianUnlocked(false);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
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
      GUARDIAN_PIN_KEY,
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
        profileRef.current = null;
        setProfile(null);
        await AsyncStorage.multiSet([
          [ACCOUNT_KEY, JSON.stringify(acc)],
          [SESSION_KEY, "true"],
        ]);
        await AsyncStorage.removeItem(PROFILE_KEY);
        await AsyncStorage.removeItem(CGM_KEY);
        await AsyncStorage.removeItem(GLUCOSE_HISTORY_STORAGE_KEY);
        await AsyncStorage.removeItem(GLUCOSE_SETTINGS_STORAGE_KEY);
        setCGMConnectionState({ type: null });
        try {
          const remote = await client.query(api.patientProfile.get, {
            userId: acc.convexUserId as Id<"users">,
            passwordHash: acc.passwordHash,
          });
          if (remote) {
            const p = remote as UserProfile;
            profileRef.current = p;
            setProfile(p);
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
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
        await refreshGuardianPinStatus();
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
    setIsGuardianUnlocked(false);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const setupProfile = useCallback(async (p: UserProfile) => {
    await commitProfile(p);
  }, [commitProfile]);

  const updateProfile = useCallback(async (partial: Partial<UserProfile>) => {
    const prev = profileRef.current;
    if (!prev) return;
    await commitProfile({ ...prev, ...partial });
  }, [commitProfile]);

  const setCGMConnection = useCallback(async (conn: CGMConnection) => {
    await commitCGMConnection(conn);
  }, [commitCGMConnection]);

  const addFoodLogEntry = useCallback((entry: Omit<FoodLogEntry, "id">) => {
    const id = `food_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const full: FoodLogEntry = { ...entry, id };
    setFoodLog((prev) => {
      const next = [full, ...prev].slice(0, 200);
      AsyncStorage.setItem(FOOD_LOG_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearFoodLog = useCallback(() => {
    setFoodLog([]);
    AsyncStorage.removeItem(FOOD_LOG_KEY).catch(() => {});
  }, []);

  const logInsulinDose = useCallback((entry: Omit<InsulinLogEntry, "id">) => {
    const id = `ins_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const full: InsulinLogEntry = { ...entry, id };
    setInsulinLog((prev) => {
      const next = [full, ...prev].slice(0, 500);
      AsyncStorage.setItem(INSULIN_LOG_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearInsulinLog = useCallback(() => {
    setInsulinLog([]);
    AsyncStorage.removeItem(INSULIN_LOG_KEY).catch(() => {});
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
    setGuardianPinStatus("not_set");
    setGuardianPinLockoutRemainingMs(null);
    setLegacyLocalPinPresent(false);
    setIsGuardianUnlocked(false);
    setIsSignedIn(false);
    setCaregiverSession(false);
    setCaregiverCloudCode(null);
    setDoctorSession(false);
    await AsyncStorage.multiRemove([
      PROFILE_KEY,
      CGM_KEY,
      FOOD_LOG_KEY,
      INSULIN_LOG_KEY,
      EMERGENCY_CONTACTS_KEY,
      ALERT_PREFS_KEY,
      GUARDIAN_PIN_KEY,
      SESSION_KEY,
      ACCOUNT_KEY,
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
  }, []);

  const removeEmergencyContact = useCallback(async (id: string) => {
    setEmergencyContacts((prev) => {
      const next = prev.filter((c) => c.id !== id);
      AsyncStorage.setItem(EMERGENCY_CONTACTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const updateAlertPrefs = useCallback(async (partial: Partial<AlertPreferences>) => {
    setAlertPrefsState((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(ALERT_PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const lockGuardian = useCallback(() => {
    setIsGuardianUnlocked(false);
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
      if (normalized.length !== 6) return false;

      const localStored = profile?.caregiverCode;
      if (localStored) {
        const localNorm = normalizeCaregiverInputCode(localStored);
        if (localNorm === normalized) {
          setCaregiverCloudCode(null);
          setCaregiverSession(true);
          return true;
        }
      }

      if (isSignedIn) {
        return false;
      }

      try {
        const client = createConvexAuthClient();
        const remote = await client.query(api.patientProfile.getByCaregiverCode, { code: normalized });
        if (!remote) return false;
        const { userId: _userId, ...profileFields } = remote as UserProfile & { userId: Id<"users"> };
        const nextProfile = profileFields as UserProfile;
        profileRef.current = nextProfile;
        setProfile(nextProfile);
        await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(nextProfile));
        setCaregiverCloudCode(normalized);
        setCaregiverSession(true);
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
        GUARDIAN_PIN_KEY,
      ]);
    }
  }, [isSignedIn]);

  const generateDoctorCode = useCallback(async (): Promise<string> => {
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
    const currentProfile = profileRef.current;
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
    const code = profileRef.current?.doctorCode?.toUpperCase();
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

  const isChildMode = !!(profile?.childModeEnabled || caregiverSession);

  return (
    <AuthContext.Provider
      value={{
        profile,
        account,
        isLoading,
        isLoggedIn: !!profile,
        isSignedIn,
        isMinor,
        ageYears,
        cgmConnection,
        foodLog,
        insulinLog,
        emergencyContacts,
        alertPrefs,
        guardianPinStatus,
        guardianPinLockoutRemainingMs,
        guardianPinConfigured,
        isGuardianUnlocked,
        caregiverSession,
        doctorSession,
        isChildMode,
        caregiverCloudCode,
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
        setupGuardianPin,
        verifyGuardianPin,
        unlockGuardian,
        refreshGuardianPinStatus,
        lockGuardian,
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
