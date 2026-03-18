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
  dexcomTrend?: number | string;
}

export interface GlucoseContextType {
  history: GlucoseEntry[];
  latestReading: GlucoseEntry | null;
  isLoading: boolean;
  addReading: (entry: GlucoseEntry) => void;
  bulkAddReadings: (entries: GlucoseEntry[]) => void;
  clearHistory: () => void;
  resetGlucoseData: () => void;
  carbRatio: number;
  targetGlucose: number;
  correctionFactor: number;
  setCarbRatio: (v: number) => void;
  setTargetGlucose: (v: number) => void;
  setCorrectionFactor: (v: number) => void;
  saveFormula: (carbRatio: number, targetGlucose: number, correctionFactor: number) => void;
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
      const next = [...prev, entry].slice(-300);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const bulkAddReadings = useCallback((entries: GlucoseEntry[]) => {
    if (entries.length === 0) return;
    setHistory((prev) => {
      const existingTs = new Set(prev.map((e) => e.timestamp));
      const newEntries = entries.filter((e) => !existingTs.has(e.timestamp));
      if (newEntries.length === 0) return prev;
      const combined = [...prev, ...newEntries];
      combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const next = combined.slice(-300);
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  const resetGlucoseData = useCallback(() => {
    setHistory([]);
    setCarbRatioState(15);
    setTargetGlucoseState(120);
    setCorrectionFactorState(50);
    AsyncStorage.multiRemove([STORAGE_KEY, SETTINGS_KEY]).catch(() => {});
  }, []);

  const setCarbRatio = useCallback((v: number) => {
    setCarbRatioState(v);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...curr, carbRatio: v }));
      })
      .catch(() => {});
  }, []);

  const setTargetGlucose = useCallback((v: number) => {
    setTargetGlucoseState(v);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...curr, targetGlucose: v }));
      })
      .catch(() => {});
  }, []);

  const setCorrectionFactor = useCallback((v: number) => {
    setCorrectionFactorState(v);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...curr, correctionFactor: v }));
      })
      .catch(() => {});
  }, []);

  const saveFormula = useCallback((cr: number, tg: number, cf: number) => {
    setCarbRatioState(cr);
    setTargetGlucoseState(tg);
    setCorrectionFactorState(cf);
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((s) => {
        const curr = s ? JSON.parse(s) : {};
        return AsyncStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ ...curr, carbRatio: cr, targetGlucose: tg, correctionFactor: cf })
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
        bulkAddReadings,
        clearHistory,
        resetGlucoseData,
        carbRatio,
        targetGlucose,
        correctionFactor,
        setCarbRatio,
        setTargetGlucose,
        setCorrectionFactor,
        saveFormula,
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
