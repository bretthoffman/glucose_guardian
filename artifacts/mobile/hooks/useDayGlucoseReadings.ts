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
  const { account, isSignedIn, caregiverSession, caregiverCloudCode, caregiverCodeKind, nurseViewCode, viewingPatientId } = useAuth();
  const { history } = useGlucose();
  const [readings, setReadings] = useState<CGMReading[]>([]);
  const [status, setStatus] = useState<DayGlucoseLoadStatus>("idle");
  const requestIdRef = useRef(0);

  const bounds = useMemo(() => localDayBoundaries(selectedDay), [selectedDay]);
  // Cache is scoped to WHOSE data is on screen — a nurse flipping between kids (or a co-guardian
  // exiting viewing mode) must never be served another identity's cached day.
  const cacheKey = `${bounds.dayKey}|${nurseViewCode ?? viewingPatientId ?? caregiverCloudCode ?? account?.convexUserId ?? "anon"}`;
  const viewingToday = isTodayOffset(dayOffset);

  const load = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestIdRef.current;
    setStatus("loading");
    setReadings([]);

    const cached = getDayGlucoseCache(cacheKey);
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

      if (nurseViewCode) {
        // Nurse (caregiver account) inside a kid's view: day-browse the KID's readings via the code.
        // Without this branch the signed-in path below queried the NURSE's own (empty) readings and
        // fell back to the ~1-day in-memory overlay — the "history caps after a day" bug.
        remote = await client.query(api.careCircle.listForDayRangeForAccessCode, {
          code: nurseViewCode,
          startTimestamp: bounds.startIso,
          endTimestamp: bounds.endIso,
        });
      } else if (viewingPatientId && isSignedIn && account?.convexUserId) {
        // Co-guardian viewing a linked patient: day-browse the patient's readings via the link.
        remote = await client.query(api.careCircle.listForDayRangeForLink, {
          patientUserId: viewingPatientId as Id<"users">,
          startTimestamp: bounds.startIso,
          endTimestamp: bounds.endIso,
        });
      } else if (isSignedIn && account?.convexUserId) {
        remote = await client.query(api.patientGlucose.listForDayRange, {
          userId: account.convexUserId as Id<"users">,
          passwordHash: account.passwordHash,
          startTimestamp: bounds.startIso,
          endTimestamp: bounds.endIso,
        });
      } else if (caregiverSession && caregiverCloudCode) {
        // New 8-char Care Circle codes (kid/caregiver) resolve via careCircle; the legacy
        // patientGlucose query is 6-char-only and returns [] for them (which would blank the graph).
        remote =
          caregiverCodeKind === "access"
            ? await client.query(api.careCircle.listForDayRangeForAccessCode, {
                code: caregiverCloudCode,
                startTimestamp: bounds.startIso,
                endTimestamp: bounds.endIso,
              })
            : await client.query(api.patientGlucose.listForDayRangeForCaregiver, {
                code: caregiverCloudCode,
                startTimestamp: bounds.startIso,
                endTimestamp: bounds.endIso,
              });
      }

      if (requestId !== requestIdRef.current) return;

      // An empty array must NOT clobber a populated local history (the reactive today-effect already
      // painted it) — fall through to the local fallback below when the remote day-range is empty.
      if (remote && remote.length > 0) {
        setDayGlucoseCache(cacheKey, remote);
        setReadings(remote);
        setStatus("success");

        if (viewingToday && isSignedIn && account?.convexUserId && !nurseViewCode && !viewingPatientId) {
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
    caregiverCodeKind,
    nurseViewCode,
    viewingPatientId,
    cacheKey,
    history,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // Today stays reactive as GlucoseContext history updates.
  useEffect(() => {
    if (!enabled || !viewingToday) return;
    invalidateDayGlucoseCache(cacheKey);
    const local = filterLocalHistory(history, bounds);
    setReadings(local);
    if (status !== "loading") setStatus("success");
  }, [enabled, viewingToday, history, bounds, status]);

  useEffect(() => {
    if (!isSignedIn && !caregiverSession) clearDayGlucoseCache();
  }, [isSignedIn, caregiverSession]);

  const retry = useCallback(() => {
    invalidateDayGlucoseCache(cacheKey);
    void load();
  }, [bounds.dayKey, load]);

  return { readings, status, bounds, retry, viewingToday };
}
