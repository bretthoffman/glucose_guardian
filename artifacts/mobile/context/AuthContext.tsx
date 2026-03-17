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
  doctorName?: string;
  doctorEmail?: string;
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
  lowThreshold: number;
  highThreshold: number;
}

export interface AuthContextType {
  profile: UserProfile | null;
  isLoading: boolean;
  isLoggedIn: boolean;
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
  addFoodLogEntry: (entry: Omit<FoodLogEntry, "id">) => void;
  clearFoodLog: () => void;
  logout: () => Promise<void>;
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
const EMERGENCY_CONTACTS_KEY = "@gluco_guardian_emergency_contacts";
const ALERT_PREFS_KEY = "@gluco_guardian_alert_prefs";
const GUARDIAN_PIN_KEY = "@gluco_guardian_pin";

const DEFAULT_ALERT_PREFS: AlertPreferences = {
  notificationsEnabled: false,
  emergencyAlertsEnabled: false,
  lowThreshold: 70,
  highThreshold: 250,
};

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
  const [isLoading, setIsLoading] = useState(true);
  const [cgmConnection, setCGMConnectionState] = useState<CGMConnection>({ type: null });
  const [foodLog, setFoodLog] = useState<FoodLogEntry[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [alertPrefs, setAlertPrefsState] = useState<AlertPreferences>(DEFAULT_ALERT_PREFS);
  const [guardianPin, setGuardianPinState] = useState<string | null>(null);
  const [isGuardianUnlocked, setIsGuardianUnlocked] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [storedProfile, storedCGM, storedFoodLog, storedContacts, storedAlertPrefs, storedPin] = await Promise.all([
          AsyncStorage.getItem(PROFILE_KEY),
          AsyncStorage.getItem(CGM_KEY),
          AsyncStorage.getItem(FOOD_LOG_KEY),
          AsyncStorage.getItem(EMERGENCY_CONTACTS_KEY),
          AsyncStorage.getItem(ALERT_PREFS_KEY),
          AsyncStorage.getItem(GUARDIAN_PIN_KEY),
        ]);
        if (storedProfile) setProfile(JSON.parse(storedProfile));
        if (storedCGM) setCGMConnectionState(JSON.parse(storedCGM));
        if (storedFoodLog) setFoodLog(JSON.parse(storedFoodLog));
        if (storedContacts) setEmergencyContacts(JSON.parse(storedContacts));
        if (storedAlertPrefs) setAlertPrefsState({ ...DEFAULT_ALERT_PREFS, ...JSON.parse(storedAlertPrefs) });
        if (storedPin) setGuardianPinState(storedPin);
      } catch {}
      setIsLoading(false);
    }
    load();
  }, []);

  const ageYears = profile?.dateOfBirth ? computeAge(profile.dateOfBirth) : null;
  const isMinor = ageYears !== null ? ageYears < 18 : false;

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

  const logout = useCallback(async () => {
    setProfile(null);
    setCGMConnectionState({ type: null });
    setFoodLog([]);
    setEmergencyContacts([]);
    setAlertPrefsState(DEFAULT_ALERT_PREFS);
    setGuardianPinState(null);
    setIsGuardianUnlocked(false);
    await AsyncStorage.multiRemove([
      PROFILE_KEY,
      CGM_KEY,
      FOOD_LOG_KEY,
      EMERGENCY_CONTACTS_KEY,
      ALERT_PREFS_KEY,
      GUARDIAN_PIN_KEY,
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
        isLoading,
        isLoggedIn: !!profile,
        isMinor,
        ageYears,
        cgmConnection,
        foodLog,
        emergencyContacts,
        alertPrefs,
        guardianPin,
        isGuardianUnlocked,
        setupProfile,
        updateProfile,
        setCGMConnection,
        addFoodLogEntry,
        clearFoodLog,
        logout,
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
