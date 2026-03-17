import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export interface GlucoseEntry {
  glucose: number;
  timestamp: string;
  anomaly: { warning: boolean; message?: string };
}

export interface GlucoseContextType {
  history: GlucoseEntry[];
  latestReading: GlucoseEntry | null;
  isLoading: boolean;
  addReading: (entry: GlucoseEntry) => void;
  clearHistory: () => void;
  carbRatio: number;
  targetGlucose: number;
  correctionFactor: number;
  setCarbRatio: (v: number) => void;
  setTargetGlucose: (v: number) => void;
  setCorrectionFactor: (v: number) => void;
}

const GlucoseContext = createContext<GlucoseContextType | null>(null);

const STORAGE_KEY = "@gluco_guardian_history";
const SETTINGS_KEY = "@gluco_guardian_settings";

export function GlucoseProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<GlucoseEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [carbRatio, setCarbRatioState] = useState(15);
  const [targetGlucose, setTargetGlucoseState] = useState(120);
  const [correctionFactor, setCorrectionFactorState] = useState(50);

  useEffect(() => {
    async function load() {
      try {
        const [stored, settings] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (stored) setHistory(JSON.parse(stored));
        if (settings) {
          const s = JSON.parse(settings);
          if (s.carbRatio) setCarbRatioState(s.carbRatio);
          if (s.targetGlucose) setTargetGlucoseState(s.targetGlucose);
          if (s.correctionFactor) setCorrectionFactorState(s.correctionFactor);
        }
      } catch {}
      setIsLoading(false);
    }
    load();
  }, []);

  const addReading = useCallback((entry: GlucoseEntry) => {
    setHistory((prev) => {
      const next = [...prev, entry].slice(-100);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  const setCarbRatio = useCallback((v: number) => {
    setCarbRatioState(v);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ ...curr, carbRatio: v })
        );
      })
      .catch(() => {});
  }, []);

  const setTargetGlucose = useCallback((v: number) => {
    setTargetGlucoseState(v);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ ...curr, targetGlucose: v })
        );
      })
      .catch(() => {});
  }, []);

  const setCorrectionFactor = useCallback((v: number) => {
    setCorrectionFactorState(v);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ ...curr, correctionFactor: v })
        );
      })
      .catch(() => {});
  }, []);

  const latestReading = history.length > 0 ? history[history.length - 1] : null;

  return (
    <GlucoseContext.Provider
      value={{
        history,
        latestReading,
        isLoading,
        addReading,
        clearHistory,
        carbRatio,
        targetGlucose,
        correctionFactor,
        setCarbRatio,
        setTargetGlucose,
        setCorrectionFactor,
      }}
    >
      {children}
    </GlucoseContext.Provider>
  );
}

export function useGlucose() {
  const ctx = useContext(GlucoseContext);
  if (!ctx) throw new Error("useGlucose must be used inside GlucoseProvider");
  return ctx;
}
