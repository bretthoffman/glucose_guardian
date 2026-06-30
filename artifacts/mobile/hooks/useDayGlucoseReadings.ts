import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CGMReading } from "@/components/CGMChart";
import { useAuth } from "@/context/AuthContext";
import { useGlucose, type GlucoseEntry } from "@/context/GlucoseContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import {
  clearDayGlucoseCache,
  getDayGlucoseCache,
  invalidateDayGlucoseCache,
  setDayGlucoseCache,
} from "@/utils/dayGlucoseCache";
import {
  isTimestampInLocalDay,
  isTodayOffset,
  localDayBoundaries,
  type LocalDayBoundaries,
} from "@/utils/localDayBoundaries";
import type { Id } from "../../../convex/_generated/dataModel";

export type DayGlucoseLoadStatus = "idle" | "loading" | "success" | "error";

function toCgmReadings(entries: GlucoseEntry[]): CGMReading[] {
  return entries.map((e) => ({ glucose: e.glucose, timestamp: e.timestamp }));
}

function filterLocalHistory(history: GlucoseEntry[], bounds: LocalDayBoundaries): CGMReading[] {
  return toCgmReadings(
    history.filter((r) => isTimestampInLocalDay(r.timestamp, bounds.startMs, bounds.endMs)),
  );
}

interface Options {
  enabled: boolean;
  dayOffset: number;
  selectedDay: Date;
}

export function useDayGlucoseReadings({ enabled, dayOffset, selectedDay }: Options) {
  const { account, isSignedIn, caregiverSession, caregiverCloudCode } = useAuth();
  const { history } = useGlucose();
  const [readings, setReadings] = useState<CGMReading[]>([]);
  const [status, setStatus] = useState<DayGlucoseLoadStatus>("idle");
  const requestIdRef = useRef(0);

  const bounds = useMemo(() => localDayBoundaries(selectedDay), [selectedDay]);
  const viewingToday = isTodayOffset(dayOffset);

  const load = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setStatus("loading");
    setReadings([]);

    const cached = getDayGlucoseCache(bounds.dayKey);
    if (cached && !viewingToday) {
      if (requestId === requestIdRef.current) {
        setReadings(cached);
        setStatus("success");
      }
      return;
    }

    try {
      const client = createConvexAuthClient();
      let remote: CGMReading[] | null = null;

      if (isSignedIn && account?.convexUserId && account.passwordHash) {
        remote = await client.query(api.patientGlucose.listForDayRange, {
          userId: account.convexUserId as Id<"users">,
          passwordHash: account.passwordHash,
          startTimestamp: bounds.startIso,
          endTimestamp: bounds.endIso,
        });
      } else if (caregiverSession && caregiverCloudCode) {
        remote = await client.query(api.patientGlucose.listForDayRangeForCaregiver, {
          code: caregiverCloudCode,
          startTimestamp: bounds.startIso,
          endTimestamp: bounds.endIso,
        });
      }

      if (requestId !== requestIdRef.current) return;

      if (remote) {
        setDayGlucoseCache(bounds.dayKey, remote);
        setReadings(remote);
        setStatus("success");

        if (viewingToday && isSignedIn && account?.convexUserId && account.passwordHash) {
          const yesterday = new Date(selectedDay);
          yesterday.setDate(yesterday.getDate() - 1);
          const yBounds = localDayBoundaries(yesterday);
          if (!getDayGlucoseCache(yBounds.dayKey)) {
            void client
              .query(api.patientGlucose.listForDayRange, {
                userId: account.convexUserId as Id<"users">,
                passwordHash: account.passwordHash,
                startTimestamp: yBounds.startIso,
                endTimestamp: yBounds.endIso,
              })
              .then((rows) => setDayGlucoseCache(yBounds.dayKey, rows))
              .catch(() => {});
          }
        }
        return;
      }

      const local = filterLocalHistory(history, bounds);
      setReadings(local);
      setStatus("success");
    } catch {
      if (requestId !== requestIdRef.current) return;
      const fallback = filterLocalHistory(history, bounds);
      if (fallback.length > 0) {
        setReadings(fallback);
        setStatus("success");
      } else {
        setStatus("error");
      }
    }
  }, [
    enabled,
    bounds,
    viewingToday,
    isSignedIn,
    account?.convexUserId,
    account?.passwordHash,
    caregiverSession,
    caregiverCloudCode,
    history,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // Today stays reactive as GlucoseContext history updates.
  useEffect(() => {
    if (!enabled || !viewingToday) return;
    invalidateDayGlucoseCache(bounds.dayKey);
    const local = filterLocalHistory(history, bounds);
    setReadings(local);
    if (status !== "loading") setStatus("success");
  }, [enabled, viewingToday, history, bounds, status]);

  useEffect(() => {
    if (!isSignedIn && !caregiverSession) clearDayGlucoseCache();
  }, [isSignedIn, caregiverSession]);

  const retry = useCallback(() => {
    invalidateDayGlucoseCache(bounds.dayKey);
    void load();
  }, [bounds.dayKey, load]);

  return { readings, status, bounds, retry, viewingToday };
}
