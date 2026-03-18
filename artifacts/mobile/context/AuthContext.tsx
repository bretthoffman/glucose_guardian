import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface UserProfile {
  childName: string;
  diabetesType: "type1" | "type2" | "other";
  dateOfBirth: string;
  weightLbs?: number;
  doctorName?: string;
  doctorEmail?: string;
  insulinTypes?: string[];
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
}

export interface CGMConnection {
  type: "dexcom" | "libre" | null;
  sessionId?: string;
  token?: string;
  outsideUS?: boolean;
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
  guardianPin: string | null;
  isGuardianUnlocked: boolean;
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
  setGuardianPin: (pin: string) => Promise<void>;
  unlockGuardian: (pin: string) => boolean;
  lockGuardian: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_KEY = "@gluco_guardian_profile";
const CGM_KEY = "@gluco_guardian_cgm";
const FOOD_LOG_KEY = "@gluco_guardian_food_log";
const INSULIN_LOG_KEY = "@gluco_guardian_insulin_log";
const EMERGENCY_CONTACTS_KEY = "@gluco_guardian_emergency_contacts";
const ALERT_PREFS_KEY = "@gluco_guardian_alert_prefs";
const GUARDIAN_PIN_KEY = "@gluco_guardian_pin";
const ACCOUNT_KEY = "@gluco_guardian_account";
const SESSION_KEY = "@gluco_guardian_session";

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
  const [guardianPin, setGuardianPinState] = useState<string | null>(null);
  const [isGuardianUnlocked, setIsGuardianUnlocked] = useState(false);

  useEffect(() => {
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
        ]);
        if (storedProfile) setProfile(JSON.parse(storedProfile));
        if (storedCGM) setCGMConnectionState(JSON.parse(storedCGM));
        if (storedFoodLog) setFoodLog(JSON.parse(storedFoodLog));
        if (storedInsulinLog) setInsulinLog(JSON.parse(storedInsulinLog));
        if (storedContacts) setEmergencyContacts(JSON.parse(storedContacts));
        if (storedAlertPrefs) setAlertPrefsState({ ...DEFAULT_ALERT_PREFS, ...JSON.parse(storedAlertPrefs) });
        if (storedPin) setGuardianPinState(storedPin);
        if (storedAccount) {
          const acc = JSON.parse(storedAccount) as UserAccount;
          setAccount(acc);
          if (storedSession === "true") {
            setIsSignedIn(true);
          }
        }
      } catch {}
      setIsLoading(false);
    }
    load();
  }, []);

  const ageYears = profile?.dateOfBirth ? computeAge(profile.dateOfBirth) : null;
  const isMinor = ageYears !== null ? ageYears < 18 : false;

  const createAccount = useCallback(async (email: string, password: string) => {
    const acc: UserAccount = { email: email.trim().toLowerCase(), passwordHash: hashPassword(password) };
    setProfile(null);
    setCGMConnectionState({ type: null });
    setFoodLog([]);
    setInsulinLog([]);
    setEmergencyContacts([]);
    setAlertPrefsState(DEFAULT_ALERT_PREFS);
    setGuardianPinState(null);
    setIsGuardianUnlocked(false);
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
    ]);
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<boolean> => {
    const storedRaw = await AsyncStorage.getItem(ACCOUNT_KEY);
    if (!storedRaw) return false;
    const stored = JSON.parse(storedRaw) as UserAccount;
    if (
      stored.email === email.trim().toLowerCase() &&
      stored.passwordHash === hashPassword(password)
    ) {
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
    await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const setupProfile = useCallback(async (p: UserProfile) => {
    setProfile(p);
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  }, []);

  const updateProfile = useCallback(async (partial: Partial<UserProfile>) => {
    setProfile((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...partial };
      AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }, []);

  const setCGMConnection = useCallback(async (conn: CGMConnection) => {
    setCGMConnectionState(conn);
    await AsyncStorage.setItem(CGM_KEY, JSON.stringify(conn));
  }, []);

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
    setProfile(null);
    setCGMConnectionState({ type: null });
    setFoodLog([]);
    setInsulinLog([]);
    setEmergencyContacts([]);
    setAlertPrefsState(DEFAULT_ALERT_PREFS);
    setGuardianPinState(null);
    setIsGuardianUnlocked(false);
    setIsSignedIn(false);
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

  const setGuardianPin = useCallback(async (pin: string) => {
    setGuardianPinState(pin);
    await AsyncStorage.setItem(GUARDIAN_PIN_KEY, pin);
  }, []);

  const unlockGuardian = useCallback((pin: string): boolean => {
    if (pin === guardianPin) {
      setIsGuardianUnlocked(true);
      return true;
    }
    return false;
  }, [guardianPin]);

  const lockGuardian = useCallback(() => {
    setIsGuardianUnlocked(false);
  }, []);

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
        guardianPin,
        isGuardianUnlocked,
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
        setGuardianPin,
        unlockGuardian,
        lockGuardian,
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
