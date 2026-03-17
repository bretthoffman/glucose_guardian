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
  dateOfBirth?: string;
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
}

export interface AuthContextType {
  profile: UserProfile | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  dashboardPin: string | null;
  cgmConnection: CGMConnection;
  foodLog: FoodLogEntry[];
  setupProfile: (profile: UserProfile) => Promise<void>;
  updateProfile: (profile: Partial<UserProfile>) => Promise<void>;
  setDashboardPin: (pin: string | null) => Promise<void>;
  setCGMConnection: (conn: CGMConnection) => Promise<void>;
  addFoodLogEntry: (entry: Omit<FoodLogEntry, "id">) => void;
  clearFoodLog: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const PROFILE_KEY = "@gluco_guardian_profile";
const PIN_KEY = "@gluco_guardian_pin";
const CGM_KEY = "@gluco_guardian_cgm";
const FOOD_LOG_KEY = "@gluco_guardian_food_log";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardPin, setDashboardPinState] = useState<string | null>(null);
  const [cgmConnection, setCGMConnectionState] = useState<CGMConnection>({ type: null });
  const [foodLog, setFoodLog] = useState<FoodLogEntry[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const [storedProfile, storedPin, storedCGM, storedFoodLog] = await Promise.all([
          AsyncStorage.getItem(PROFILE_KEY),
          AsyncStorage.getItem(PIN_KEY),
          AsyncStorage.getItem(CGM_KEY),
          AsyncStorage.getItem(FOOD_LOG_KEY),
        ]);
        if (storedProfile) setProfile(JSON.parse(storedProfile));
        if (storedPin) setDashboardPinState(storedPin);
        if (storedCGM) setCGMConnectionState(JSON.parse(storedCGM));
        if (storedFoodLog) setFoodLog(JSON.parse(storedFoodLog));
      } catch {}
      setIsLoading(false);
    }
    load();
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

  const setDashboardPin = useCallback(async (pin: string | null) => {
    setDashboardPinState(pin);
    if (pin) {
      await AsyncStorage.setItem(PIN_KEY, pin);
    } else {
      await AsyncStorage.removeItem(PIN_KEY);
    }
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
    await AsyncStorage.multiRemove([PROFILE_KEY, PIN_KEY, CGM_KEY]);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        profile,
        isLoading,
        isLoggedIn: !!profile,
        dashboardPin,
        cgmConnection,
        foodLog,
        setupProfile,
        updateProfile,
        setDashboardPin,
        setCGMConnection,
        addFoodLogEntry,
        clearFoodLog,
        logout,
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
