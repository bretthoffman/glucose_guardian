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
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";

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
  /** Incremented after each successful CGM sync (Convex status ok). Transient UI signals only. */
  cgmSyncSuccessTick: number;
  notifyCgmSyncSuccess: () => void;
}

const GlucoseContext = createContext<GlucoseContextType | null>(null);

const STORAGE_KEY = GLUCOSE_HISTORY_STORAGE_KEY;
const SETTINGS_KEY = GLUCOSE_SETTINGS_STORAGE_KEY;

function toConvexGlucosePayload(e: GlucoseEntry) {
  const payload: {
    glucose: number;
    timestamp: string;
    anomaly: { warning: boolean; message?: string };
    dexcomTrend?: number | string;
  } = {
    glucose: e.glucose,
    timestamp: e.timestamp,
    anomaly: {
      warning: e.anomaly?.warning ?? false,
      ...(e.anomaly?.message != null && e.anomaly.message !== ""
        ? { message: e.anomaly.message }
        : {}),
    },
  };
  if (e.dexcomTrend != null) payload.dexcomTrend = e.dexcomTrend;
  return payload;
}

function normalizeRemoteEntry(r: {
  glucose: number;
  timestamp: string;
  anomaly: { warning: boolean; message?: string };
  dexcomTrend?: number | string;
}): GlucoseEntry {
  return {
    glucose: r.glucose,
    timestamp: r.timestamp,
    anomaly: r.anomaly,
    ...(r.dexcomTrend != null ? { dexcomTrend: r.dexcomTrend } : {}),
  };
}

function parseLocalHistory(raw: string | null): GlucoseEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is GlucoseEntry =>
        !!x &&
        typeof x === "object" &&
        typeof (x as GlucoseEntry).glucose === "number" &&
        typeof (x as GlucoseEntry).timestamp === "string",
    );
  } catch {
    return [];
  }
}

export function GlucoseProvider({ children }: { children: React.ReactNode }) {
  const { account, isSignedIn, isLoading: authLoading, caregiverSession, caregiverCloudCode, caregiverCodeKind, viewingPatientId, profile, isCircleMember } = useAuth();
  const [history, setHistory] = useState<GlucoseEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [carbRatio, setCarbRatioState] = useState(15);
  const [targetGlucose, setTargetGlucoseState] = useState(120);
  const [correctionFactor, setCorrectionFactorState] = useState(50);
  const [cgmSyncSuccessTick, setCgmSyncSuccessTick] = useState(0);

  const notifyCgmSyncSuccess = useCallback(() => {
    setCgmSyncSuccessTick((t) => t + 1);
  }, []);

  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  /** Live mirror of viewingPatientId for the reading-write guards (co-guardian must not write). */
  const viewingPatientIdRef = useRef(viewingPatientId);
  useEffect(() => {
    viewingPatientIdRef.current = viewingPatientId;
  }, [viewingPatientId]);

  const prevCaregiverCloudCodeRef = useRef<string | null>(null);

  const flushHistoryToConvex = useCallback(async (entries: GlucoseEntry[]) => {
    const acc = accountRef.current;
    if (!acc?.convexUserId || entries.length === 0) return;
    const client = createConvexAuthClient();
    const userId = acc.convexUserId as Id<"users">;
    const payloads = entries.map(toConvexGlucosePayload);
    const chunk = 120;
    for (let i = 0; i < payloads.length; i += chunk) {
      const slice = payloads.slice(i, i + chunk);
      try {
        await client.mutation(api.patientGlucose.upsertBatch, {
          userId,
          passwordHash: acc.passwordHash,
          entries: slice,
        });
      } catch {
        break;
      }
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [stored, settings] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (stored) {
          const parsed = parseLocalHistory(stored);
          if (parsed.length > 0) setHistory(parsed);
        }
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

  useEffect(() => {
    if (authLoading) return;
    if (viewingPatientId) return; // co-guardian viewing overlay owns settings/history instead
    if (!account?.convexUserId || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      const settings = await AsyncStorage.getItem(SETTINGS_KEY);
      if (cancelled) return;
      if (settings) {
        try {
          const s = JSON.parse(settings) as Record<string, unknown>;
          if (typeof s.carbRatio === "number") setCarbRatioState(s.carbRatio);
          if (typeof s.targetGlucose === "number") setTargetGlucoseState(s.targetGlucose);
          if (typeof s.correctionFactor === "number") setCorrectionFactorState(s.correctionFactor);
        } catch {
          /* ignore */
        }
      } else {
        setCarbRatioState(15);
        setTargetGlucoseState(120);
        setCorrectionFactorState(50);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, account?.convexUserId, isSignedIn, viewingPatientId]);

  useEffect(() => {
    if (authLoading) return;
    if (viewingPatientId) return; // co-guardian viewing overlay owns history instead
    if (!account?.convexUserId || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      const client = createConvexAuthClient();
      const userId = account.convexUserId as Id<"users">;
      const passwordHash = account.passwordHash;
      try {
        const remote = await client.query(api.patientGlucose.listRecent, {
          userId,
          passwordHash,
          limit: 300,
        });
        if (cancelled) return;
        const storedRaw = await AsyncStorage.getItem(STORAGE_KEY);
        const localParsed = parseLocalHistory(storedRaw);

        let next: GlucoseEntry[];
        if (remote.length > 0) {
          next = remote.map(normalizeRemoteEntry);
        } else if (localParsed.length > 0) {
          const capped = localParsed.slice(-300);
          const payloads = capped.map(toConvexGlucosePayload);
          const chunk = 120;
          for (let i = 0; i < payloads.length; i += chunk) {
            const slice = payloads.slice(i, i + chunk);
            await client.mutation(api.patientGlucose.upsertBatch, {
              userId,
              passwordHash,
              entries: slice,
            });
          }
          if (cancelled) return;
          next = capped;
        } else {
          next = [];
        }
        setHistory(next);
        if (next.length > 0) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        /* offline — keep AsyncStorage / in-memory from initial load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, account?.convexUserId, account?.passwordHash, isSignedIn, viewingPatientId]);

  // ── Co-guardian viewing overlay: source the linked patient's readings + settings via the link ──
  // Polls every 60s so new readings the patient's device ingests (every ~5 min) appear here within
  // a minute, without the co-guardian doing anything (the "shows up without manual action" bar).
  const prevViewingPatientIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevViewingPatientIdRef.current;
    prevViewingPatientIdRef.current = viewingPatientId;
    // On exit, clear the borrowed data so the co-guardian's own effects repopulate their account.
    if (prev && !viewingPatientId) {
      setHistory([]);
      setCarbRatioState(15);
      setTargetGlucoseState(120);
      setCorrectionFactorState(50);
    }
    if (!viewingPatientId) return;
    const acc = accountRef.current;
    if (!acc?.convexUserId) return;
    let cancelled = false;

    async function fetchViewed() {
      try {
        const client = createConvexAuthClient();
        const remote = await client.query(api.careCircle.glucoseForLink, {
          userId: acc!.convexUserId as Id<"users">,
          passwordHash: acc!.passwordHash,
          patientUserId: viewingPatientId as Id<"users">,
          limit: 300,
        });
        if (cancelled) return;
        setHistory(remote.map(normalizeRemoteEntry));
      } catch {
        /* offline or access outside its schedule window — keep prior view until retry */
      }
    }

    setHistory([]); // don't briefly show the previous patient's / own readings
    void fetchViewed();
    const id = setInterval(fetchViewed, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [viewingPatientId]);

  useEffect(() => {
    if (authLoading) return;
    const prev = prevCaregiverCloudCodeRef.current;
    prevCaregiverCloudCodeRef.current = caregiverCloudCode;
    if (prev && caregiverCloudCode === null && !caregiverSession) {
      setHistory([]);
      AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
      setCarbRatioState(15);
      setTargetGlucoseState(120);
      setCorrectionFactorState(50);
      AsyncStorage.removeItem(SETTINGS_KEY).catch(() => {});
    }
  }, [authLoading, caregiverSession, caregiverCloudCode]);

  useEffect(() => {
    if (authLoading) return;
    if (!caregiverSession || !caregiverCloudCode) return;
    let cancelled = false;
    async function fetchCaregiverGlucose() {
      try {
        const client = createConvexAuthClient();
        // New Care Circle caregiver codes go through the schedule/permission-checked code query;
        // legacy 6-char codes keep the original anonymous path.
        const remote =
          caregiverCodeKind === "access"
            ? await client.query(api.careCircle.glucoseForAccessCode, {
                code: caregiverCloudCode as string,
                limit: 300,
              })
            : await client.query(api.patientGlucose.listRecentForCaregiver, {
                code: caregiverCloudCode as string,
                limit: 300,
              });
        if (cancelled) return;
        const next = remote.map(normalizeRemoteEntry);
        setHistory(next);
        if (next.length > 0) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } else {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        /* offline — keep prior history until retry */
      }
    }
    void fetchCaregiverGlucose();
    // New codes are schedule-bound; poll so an out-of-window code stops showing data on its own.
    const id = caregiverCodeKind === "access" ? setInterval(fetchCaregiverGlucose, 60_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [authLoading, caregiverSession, caregiverCloudCode, caregiverCodeKind]);

  // Apply the viewed profile's dose settings — for a standalone caregiver (code), a signed-in
  // co-guardian viewing a linked patient, or a LINKED CO-GUARDIAN whose whole app inherits the
  // circle owner's dose math (`profile` carries the owner's values in all three cases). For a
  // linked member the inherited values are also persisted: if they ever leave the circle they
  // keep the circle's current settings rather than reverting to stale pre-link math.
  useEffect(() => {
    const viewingSomeone = (caregiverSession && caregiverCloudCode) || viewingPatientId || isCircleMember;
    if (!viewingSomeone || !profile) return;
    if (typeof profile.carbRatio === "number") setCarbRatioState(profile.carbRatio);
    if (typeof profile.targetGlucose === "number") setTargetGlucoseState(profile.targetGlucose);
    if (typeof profile.correctionFactor === "number") setCorrectionFactorState(profile.correctionFactor);
    if (isCircleMember) {
      AsyncStorage.getItem(SETTINGS_KEY)
        .then((s) => {
          const curr = s ? JSON.parse(s) : {};
          return AsyncStorage.setItem(
            SETTINGS_KEY,
            JSON.stringify({
              ...curr,
              ...(typeof profile.carbRatio === "number" ? { carbRatio: profile.carbRatio } : {}),
              ...(typeof profile.targetGlucose === "number" ? { targetGlucose: profile.targetGlucose } : {}),
              ...(typeof profile.correctionFactor === "number" ? { correctionFactor: profile.correctionFactor } : {}),
            }),
          );
        })
        .catch(() => {});
    }
  }, [caregiverSession, caregiverCloudCode, viewingPatientId, isCircleMember, profile?.carbRatio, profile?.targetGlucose, profile?.correctionFactor]);

  const addReading = useCallback(
    (entry: GlucoseEntry) => {
      // A co-guardian viewing a linked patient must never write into the patient's stream.
      if (viewingPatientIdRef.current) return;
      setHistory((prev) => {
        const next = [...prev, entry].slice(-300);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        void flushHistoryToConvex([entry]);
        return next;
      });
    },
    [flushHistoryToConvex],
  );

  const bulkAddReadings = useCallback(
    (entries: GlucoseEntry[]) => {
      if (entries.length === 0) return;
      if (viewingPatientIdRef.current) return; // co-guardian viewing — never write into the stream
      setHistory((prev) => {
        const existingTs = new Set(prev.map((e) => e.timestamp));
        const newEntries = entries.filter((e) => !existingTs.has(e.timestamp));
        if (newEntries.length === 0) return prev;
        const combined = [...prev, ...newEntries];
        combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const next = combined.slice(-300);
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        void flushHistoryToConvex(newEntries);
        return next;
      });
    },
    [flushHistoryToConvex],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    const acc = accountRef.current;
    if (acc?.convexUserId) {
      void createConvexAuthClient()
        .mutation(api.patientGlucose.clearAll, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
        })
        .catch(() => {});
    }
  }, []);

  const resetGlucoseData = useCallback(() => {
    setHistory([]);
    setCarbRatioState(15);
    setTargetGlucoseState(120);
    setCorrectionFactorState(50);
    AsyncStorage.multiRemove([STORAGE_KEY, SETTINGS_KEY]).catch(() => {});
    const acc = accountRef.current;
    if (acc?.convexUserId) {
      void createConvexAuthClient()
        .mutation(api.patientGlucose.clearAll, {
          userId: acc.convexUserId as Id<"users">,
          passwordHash: acc.passwordHash,
        })
        .catch(() => {});
    }
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
          JSON.stringify({ ...curr, carbRatio: cr, targetGlucose: tg, correctionFactor: cf }),
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
        cgmSyncSuccessTick,
        notifyCgmSyncSuccess,
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
