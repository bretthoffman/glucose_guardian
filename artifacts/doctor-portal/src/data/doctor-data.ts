import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  ApiError,
  customFetch,
  useGetPatientData,
  useLinkDoctorPatient,
  useListDoctorLinkedPatients,
  useUnlinkDoctorPatient,
} from "@doctor-portal/api-client-react";
import type {
  CGMReading,
  DoctorLinkedPatient,
  DoctorLinkPatientResponse,
  DoctorMessage,
  FoodLogEntry,
  InsulinLogEntry,
  PatientSnapshot,
} from "@doctor-portal/api-client-react";
import type {
  PatientDetail,
  ProposeOrderInput,
  QueryResult,
  TherapyOrder,
} from "./contracts";
import { USE_MOCK_DATA, mockMessages, mockSendMessage } from "./mock";
import { caregiverKey, type CaregiverTitle, type CaregiverTitleEntry } from "./caregivers";
import { normalizeOrgName, searchOrganizations } from "./organizations";
import { hasUploadedPhoto } from "@/lib/meal-photo";
import type { MockOrganization } from "./mock";
/**
 * Patient data comes from the live Glucose Guardian backend, authenticated with the doctor's
 * Bearer token. Linked patients come from GET /api/doctor/me/patients; linking by Doctor Code
 * goes through POST /api/doctor/me/patients/link. The organization directory stays mock.
 */

// ---- Real patient data by Doctor Code ----

export function usePatientSnapshot(accessCode: string): {
  snapshot: PatientSnapshot | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const res = useGetPatientData(accessCode, {
    // @ts-expect-error Generated hook merges partial query options at runtime
    query: { enabled: !!accessCode, refetchInterval: 30000 },
  });
  return {
    snapshot: res.data as PatientSnapshot | undefined,
    isLoading: res.isLoading,
    isFetching: res.isFetching,
    error: (res.error as Error | null) ?? null,
    refetch: () => {
      void res.refetch();
    },
  };
}

/**
 * Full CGM history for a time window, from the durable per-user store (the sync snapshot only
 * carries ~1 day). `readings` is `null` while loading or when the endpoint isn't deployed yet —
 * callers fall back to the snapshot's readings so the comparison always renders something.
 */
export function useGlucoseHistory(
  accessCode: string,
  fromMs: number,
  toMs: number,
): { readings: CGMReading[] | null; isLoading: boolean } {
  const query = useQuery({
    queryKey: ["glucose-history", accessCode, fromMs, toMs],
    enabled: !!accessCode && fromMs > 0 && fromMs < toMs,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => fetchGlucoseWindow(accessCode, fromMs, toMs),
  });
  return { readings: query.data ?? null, isLoading: query.isLoading };
}

/** Durable readings for one window; `null` when the endpoint isn't deployed / is unavailable. */
async function fetchGlucoseWindow(
  accessCode: string,
  fromMs: number,
  toMs: number,
): Promise<CGMReading[] | null> {
  try {
    const from = encodeURIComponent(new Date(fromMs).toISOString());
    const to = encodeURIComponent(new Date(toMs).toISOString());
    const r = await customFetch<{ readings?: CGMReading[] }>(
      `/api/doctor/patient/${encodeURIComponent(accessCode)}/readings?from=${from}&to=${to}`,
    );
    return r.readings ?? [];
  } catch {
    return null;
  }
}

// ---- Full history (the phone's sync only carries the latest slice) ----

const DAY_MS = 86_400_000;

/** Days of CGM history the patient page loads up front; the Charts view can ask for more. */
export const DEFAULT_HISTORY_DAYS = 90;

/** Endpoint window per request — ~4k readings at 5-min cadence; the server pages beyond that. */
const HISTORY_CHUNK_DAYS = 14;

/** Merge two reading lists, one reading per minute (phone and server carry the same samples). */
function mergeReadings(a: CGMReading[], b: CGMReading[]): CGMReading[] {
  const byMinute = new Map<number, { r: CGMReading; t: number }>();
  for (const r of [...a, ...b]) {
    const t = new Date(r.timestamp).getTime();
    const key = Math.floor(t / 60_000);
    if (!byMinute.has(key)) byMinute.set(key, { r, t });
  }
  return [...byMinute.values()].sort((x, y) => x.t - y.t).map((x) => x.r);
}

function combineHistory(results: UseQueryResult<CGMReading[] | null>[]): {
  readings: CGMReading[] | null;
  isLoading: boolean;
} {
  const loaded = results.map((r) => r.data).filter((d): d is CGMReading[] => Array.isArray(d));
  return {
    // null until at least one window arrives (or when the endpoint isn't deployed at all).
    readings: loaded.length ? mergeReadings([], loaded.flat()) : null,
    isLoading: results.some((r) => r.isLoading),
  };
}

/**
 * The patient's CGM history for the last `days` from the durable server store — the snapshot only
 * carries ~1 day. Fetched as fixed windows anchored on UTC midnight so each window's cache key is
 * stable: past windows never change, and only the one covering today refreshes (every 5 minutes;
 * the snapshot's 30-second poll keeps the newest readings current in between).
 */
export function usePatientGlucoseHistory(
  accessCode: string,
  days: number,
): { readings: CGMReading[] | null; isLoading: boolean } {
  const endMs = (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS;
  const startMs = endMs - days * DAY_MS;
  const windows: { fromMs: number; toMs: number }[] = [];
  for (let toMs = endMs; toMs > startMs; toMs -= HISTORY_CHUNK_DAYS * DAY_MS) {
    windows.push({ fromMs: Math.max(startMs, toMs - HISTORY_CHUNK_DAYS * DAY_MS), toMs });
  }
  return useQueries({
    queries: windows.map((w) => ({
      queryKey: ["glucose-history", accessCode, w.fromMs, w.toMs],
      enabled: !!accessCode,
      staleTime: w.toMs === endMs ? 5 * 60_000 : Infinity,
      refetchInterval: w.toMs === endMs ? 5 * 60_000 : (false as const),
      retry: false,
      queryFn: () => fetchGlucoseWindow(accessCode, w.fromMs, w.toMs),
    })),
    combine: combineHistory,
  });
}

/** The snapshot with the durable CGM history merged in — for the multi-day views only. */
export function withGlucoseHistory(
  snapshot: PatientSnapshot,
  history: CGMReading[] | null,
): PatientSnapshot {
  if (!history?.length) return snapshot;
  return { ...snapshot, glucoseReadings: mergeReadings(history, snapshot.glucoseReadings ?? []) };
}

interface CareLogs {
  food: FoodLogEntry[];
  insulin: InsulinLogEntry[];
}

/** How far back the logged food + insulin history reaches. */
const LOG_HISTORY_DAYS = 365;

/**
 * Every food + insulin entry logged for the patient in the last year, from the server-side log
 * (the phone's sync only carries its newest 100 of each). `null` until that endpoint is deployed;
 * refreshed every minute so entries logged on any circle member's device show up.
 */
function usePatientCareLogs(accessCode: string): CareLogs | null {
  const endMs = (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS;
  const fromMs = endMs - LOG_HISTORY_DAYS * DAY_MS;
  const query = useQuery({
    queryKey: ["care-logs", accessCode, fromMs, endMs],
    enabled: !!accessCode,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<CareLogs | null> => {
      try {
        const from = encodeURIComponent(new Date(fromMs).toISOString());
        const to = encodeURIComponent(new Date(endMs).toISOString());
        const r = await customFetch<Partial<CareLogs>>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/logs?from=${from}&to=${to}`,
        );
        return { food: r.food ?? [], insulin: r.insulin ?? [] };
      } catch {
        return null; // not deployed yet / unavailable → the snapshot's logs still render
      }
    },
  });
  return query.data ?? null;
}

/**
 * Union by entry id, newest first (the order the app syncs in). The server copy wins where both
 * exist — it carries later edits — while fields only the phone sends (meal photo thumbnails) and
 * entries the server hasn't received yet are kept.
 */
function mergeLogEntries<T extends { id: string; timestamp: string }>(phone: T[], server: T[]): T[] {
  const byId = new Map<string, T>();
  for (const e of phone) byId.set(e.id, e);
  for (const e of server) byId.set(e.id, { ...byId.get(e.id), ...e });
  return [...byId.values()]
    .map((e) => ({ e, t: new Date(e.timestamp).getTime() }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.e);
}

function withCareLogs(snapshot: PatientSnapshot, logs: CareLogs | null): PatientSnapshot {
  if (!logs) return snapshot;
  return {
    ...snapshot,
    foodLog: mergeLogEntries(snapshot.foodLog ?? [], logs.food),
    insulinLog: mergeLogEntries(snapshot.insulinLog ?? [], logs.insulin),
  };
}

// ---- Meal photos ----

/** Formats shown as a meal photo — raster only, never an SVG or page the browser could run. */
const MEAL_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A meal's full-size photo, which the app uploads to the server, as an object URL for an <img>
 * (revoked on unmount). Fetched through the api-server with the doctor's session, only for meals
 * flagged `hasPhoto`. `url` is null while loading, when there's none, or until the backend update
 * is deployed; `failed` is set when a flagged photo couldn't be loaded.
 */
export function useMealPhoto(
  accessCode: string,
  food: FoodLogEntry | undefined,
): { url: string | null; loading: boolean; failed: boolean } {
  const entryId = hasUploadedPhoto(food) ? food!.id : null;
  const query = useQuery({
    queryKey: ["meal-photo", accessCode, entryId],
    enabled: !!accessCode && !!entryId,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<Blob | null> => {
      try {
        const blob = await customFetch<Blob>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/food-photos/${encodeURIComponent(entryId!)}`,
          { responseType: "blob" },
        );
        return MEAL_PHOTO_TYPES.includes(blob.type) ? blob : null;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
        throw e;
      }
    },
  });
  const blob = query.data ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return {
    url: blob ? url : null,
    loading: !!entryId && (query.isPending || (!!blob && !url)),
    failed: !!entryId && (query.isError || (query.isSuccess && !blob)),
  };
}

// ---- Caregiver titles (doctor's labels for Care Circle members) ----

const caregiverTitlesKey = (accessCode: string) => ["caregiver-titles", accessCode];

/**
 * This doctor's labels for the people who log for the patient. `titles` is `null` until the
 * backend routes are deployed (or on error) — callers then show names without a label option.
 */
export function useCaregiverTitles(accessCode: string): { titles: CaregiverTitleEntry[] | null } {
  const query = useQuery({
    queryKey: caregiverTitlesKey(accessCode),
    enabled: !!accessCode,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<CaregiverTitleEntry[] | null> => {
      try {
        const r = await customFetch<{ titles?: CaregiverTitleEntry[] }>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/caregiver-titles`,
        );
        return r.titles ?? [];
      } catch {
        return null;
      }
    },
  });
  return { titles: query.data ?? null };
}

/** Save (or with `title: null`, clear) one caregiver's label; the list updates immediately. */
export function useSetCaregiverTitle(accessCode: string): {
  save: (name: string, title: CaregiverTitle | null, detail?: string) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const save = useCallback(
    async (name: string, title: CaregiverTitle | null, detail?: string) => {
      const key = caregiverTitlesKey(accessCode);
      const previous = queryClient.getQueryData<CaregiverTitleEntry[] | null>(key);
      const others = (previous ?? []).filter((t) => caregiverKey(t.name) !== caregiverKey(name));
      queryClient.setQueryData<CaregiverTitleEntry[]>(
        key,
        title
          ? [...others, { name: name.trim(), title, detail: detail?.trim() || undefined, updatedAt: Date.now() }]
          : others,
      );
      try {
        const r = await customFetch<{ titles?: CaregiverTitleEntry[] }>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/caregiver-titles`,
          { method: "PUT", body: JSON.stringify({ name, title, detail }) },
        );
        queryClient.setQueryData(key, r.titles ?? []);
        // Tagging someone School Nurse is what opens (or closes) a doctor chat with them.
        void queryClient.invalidateQueries({ queryKey: careCircleKey(accessCode) });
        void queryClient.invalidateQueries({ queryKey: nurseThreadsKey(accessCode) });
      } catch (e) {
        queryClient.setQueryData(key, previous ?? null);
        if (e instanceof ApiError && (e.status === 404 || e.status === 405 || e.status === 503)) {
          throw new Error(
            "Saving caregiver titles needs the pending backend deployment — it will work after the next deploy.",
          );
        }
        throw new Error("Could not save the title. Try again.");
      }
    },
    [accessCode, queryClient],
  );
  return { save };
}

// ---- Care Circle roster + school-nurse chats ----

export interface CareCircleMember {
  /** Opaque id — never an access code. */
  id: string;
  name: string;
  kind: "owner" | "patient" | "co_guardian" | "caregiver_code" | "patient_device";
  /** Nurse (caregiver) accounts signed in with this access code. */
  accounts: { name: string; organization?: string }[];
  lastUsedAt?: number;
  /** "parents" = the guardian thread, "nurse" = a doctor chat in the app, null = not messageable. */
  messaging: "parents" | "nurse" | null;
}

export interface NurseThread {
  codeId: string;
  name: string;
  messages: { id: string; text: string; fromDoctor: boolean; senderName: string; createdAt: number }[];
  unread: number;
}

const careCircleKey = (accessCode: string) => ["care-circle", accessCode];
const nurseThreadsKey = (accessCode: string) => ["nurse-threads", accessCode];

/**
 * Who is in the patient's Care Circle now. `null` while the backend functions aren't deployed
 * (the route answers 404/503); other failures keep the last list rather than blanking it.
 */
export function useCareCircle(accessCode: string): CareCircleMember[] | null {
  const query = useQuery({
    queryKey: careCircleKey(accessCode),
    enabled: !!accessCode,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<CareCircleMember[] | null> => {
      try {
        const r = await customFetch<{ members?: CareCircleMember[] }>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/care-circle`,
        );
        return r.members ?? [];
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return null;
        throw e;
      }
    },
  });
  return query.data ?? null;
}

/** This doctor's chats with the circle's school nurses, polled like the guardian thread. */
export function useNurseThreads(accessCode: string): NurseThread[] | null {
  const query = useQuery({
    queryKey: nurseThreadsKey(accessCode),
    enabled: !!accessCode,
    refetchInterval: 10_000,
    retry: false,
    queryFn: async (): Promise<NurseThread[] | null> => {
      try {
        const r = await customFetch<{ threads?: NurseThread[] }>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/nurse-threads`,
        );
        return r.threads ?? [];
      } catch {
        return null;
      }
    },
  });
  return query.data ?? null;
}

export function useNurseMessaging(accessCode: string): {
  send: (codeId: string, text: string) => Promise<void>;
  markRead: (codeId: string) => void;
} {
  const queryClient = useQueryClient();
  const base = `/api/doctor/patient/${encodeURIComponent(accessCode)}/nurse-threads`;
  const send = useCallback(
    async (codeId: string, text: string) => {
      try {
        await customFetch(`${base}/${encodeURIComponent(codeId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          throw new Error("Only caregivers you've tagged as School Nurse can be messaged.");
        }
        throw new Error("Message not sent. Try again.");
      }
      await queryClient.invalidateQueries({ queryKey: nurseThreadsKey(accessCode) });
    },
    [accessCode, base, queryClient],
  );
  const markRead = useCallback(
    (codeId: string) => {
      void customFetch(`${base}/${encodeURIComponent(codeId)}/read`, { method: "POST" })
        .then(() => queryClient.invalidateQueries({ queryKey: nurseThreadsKey(accessCode) }))
        .catch(() => {});
    },
    [accessCode, base, queryClient],
  );
  return { send, markRead };
}

// ---- Doctor alerts (bell feed) ----

export interface DoctorAlert {
  id: string;
  kind: string;
  accessCode: string;
  message: string;
  value?: number;
  createdAt: number;
  readAt?: number;
}

/**
 * The doctor's alert feed, polled every 60s. `alerts` is `null` until the backend alerts module
 * is deployed (or on error) — callers hide the bell entirely in that case.
 */
export function useDoctorAlerts(): {
  alerts: DoctorAlert[] | null;
  unreadCount: number;
  markAllRead: () => void;
} {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["doctor-alerts"],
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<{ alerts: DoctorAlert[]; unreadCount: number } | null> => {
      try {
        return await customFetch<{ alerts: DoctorAlert[]; unreadCount: number }>(
          "/api/doctor/me/alerts",
        );
      } catch {
        return null;
      }
    },
  });
  const markAllRead = useCallback(() => {
    void (async () => {
      try {
        await customFetch("/api/doctor/me/alerts/read", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await queryClient.invalidateQueries({ queryKey: ["doctor-alerts"] });
      } catch {
        /* endpoint pending deployment */
      }
    })();
  }, [queryClient]);
  return {
    alerts: q.data?.alerts ?? null,
    unreadCount: q.data?.unreadCount ?? 0,
    markAllRead,
  };
}

// ---- Compliance access log ----

export interface AccessLogEntry {
  action: string;
  at: number;
  doctorName: string;
}

/** Access log for a patient; `null` until the backend route is deployed. */
export function useAccessLog(accessCode: string): AccessLogEntry[] | null {
  const q = useQuery({
    queryKey: ["access-log", accessCode],
    enabled: !!accessCode,
    refetchInterval: 120_000,
    retry: false,
    queryFn: async (): Promise<AccessLogEntry[] | null> => {
      try {
        const r = await customFetch<{ entries: AccessLogEntry[] }>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/access-log`,
        );
        return r.entries ?? [];
      } catch {
        return null;
      }
    },
  });
  return q.data ?? null;
}

// ---- Lab A1C ----

export interface LabA1cInfo {
  value: number;
  measuredAt: string;
  enteredByName?: string;
  enteredAt?: string;
}

/** The doctor-recorded lab A1C carried on the patient GET response (top level, like proposals). */
export function readLabA1c(snapshot: unknown): LabA1cInfo | undefined {
  const l = (snapshot as { labA1c?: LabA1cInfo | null } | null | undefined)?.labA1c;
  return l ?? undefined;
}

export function useSetLabA1c(accessCode: string): {
  save: (value: number, measuredAt: string) => Promise<LabA1cInfo>;
  isPending: boolean;
} {
  const [isPending, setIsPending] = useState(false);
  const queryClient = useQueryClient();
  const save = useCallback(
    async (value: number, measuredAt: string) => {
      setIsPending(true);
      try {
        const saved = await customFetch<LabA1cInfo>(
          `/api/doctor/patient/${encodeURIComponent(accessCode)}/lab-a1c`,
          { method: "POST", body: JSON.stringify({ value, measuredAt }) },
        );
        await queryClient.invalidateQueries();
        return saved;
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 404 || e.status === 405 || e.status === 503) {
            throw new Error(
              "Saving lab A1C needs the pending backend deployment — it will work after the next deploy.",
            );
          }
          if (e.status === 400) {
            throw new Error("Enter an A1C between 3 and 20% with a valid past date.");
          }
        }
        throw new Error("Could not save the lab A1C. Try again.");
      } finally {
        setIsPending(false);
      }
    },
    [accessCode, queryClient],
  );
  return { save, isPending };
}

/** Server-side therapy proposal/decision fields (present once the comms backend is deployed). */
interface ServerTherapyProposal {
  id: string;
  proposedAt: string;
  proposedByDoctorId: string;
  proposedByName: string;
  note: string;
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
}
interface ServerTherapyDecision {
  proposalId: string;
  status: "approved" | "declined";
  decidedAt: string;
}
type SnapshotWithOrders = PatientSnapshot & {
  therapyProposal?: ServerTherapyProposal | null;
  therapyDecision?: ServerTherapyDecision | null;
  settingsHistory?: {
    changedAt: string;
    carbRatio?: number;
    correctionFactor?: number;
    targetGlucose?: number;
  }[];
};

function proposalToOrder(p: ServerTherapyProposal, patientId: string): TherapyOrder {
  return {
    id: p.id,
    patientId,
    version: 0,
    status: "proposed",
    proposedByDoctorId: p.proposedByDoctorId,
    proposedByName: p.proposedByName,
    proposedAt: p.proposedAt,
    note: p.note,
    carbRatio: p.carbRatio,
    correctionFactor: p.correctionFactor,
    targetGlucose: p.targetGlucose,
  };
}

function snapshotToDetail(accessCode: string, snapshot: PatientSnapshot): PatientDetail {
  const p = snapshot.profile;
  const a = snapshot.alertPreferences;
  const s = snapshot as SnapshotWithOrders;
  return {
    patientId: accessCode,
    accessCode,
    snapshot,
    canPrescribe: true,
    activeOrder: {
      id: `order_${accessCode}`,
      patientId: accessCode,
      version: 1,
      status: "active",
      proposedByDoctorId: "app",
      proposedByName: "Current settings",
      proposedAt: snapshot.syncedAt,
      carbRatio: p.carbRatio,
      correctionFactor: p.correctionFactor,
      targetGlucose: p.targetGlucose,
      insulinTypes: p.insulinTypes,
      alertThresholds: a
        ? {
            low: a.lowThreshold,
            high: a.highThreshold,
            urgentLow: a.urgentLowThreshold,
            urgentHigh: a.urgentHighThreshold,
          }
        : undefined,
    },
    proposedOrder: s.therapyProposal ? proposalToOrder(s.therapyProposal, accessCode) : undefined,
    lastDecision: s.therapyDecision ?? undefined,
    settingsHistory: s.settingsHistory ?? undefined,
  };
}

export function usePatientDetail(
  accessCode: string,
): QueryResult<PatientDetail> & { isFetching: boolean; refetch: () => void } {
  const { snapshot, isLoading, isFetching, error, refetch } = usePatientSnapshot(accessCode);
  const logs = usePatientCareLogs(accessCode);
  const data = useMemo(() => {
    if (!snapshot) return undefined;
    const source = (snapshot as PatientSnapshot & { source?: "phone" | "server" }).source;
    return {
      ...snapshotToDetail(accessCode, withCareLogs(snapshot, logs)),
      logsFromServer: !!logs,
      source,
    };
  }, [accessCode, snapshot, logs]);
  return { data, isLoading, error, isFetching, refetch };
}

// ---- Linked patients (device-stored until a backend grant table exists) ----

export function useDoctorPatients(): {
  data: DoctorLinkedPatient[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const res = useListDoctorLinkedPatients();
  return {
    data: res.data?.patients ?? [],
    isLoading: res.isLoading,
    error: (res.error as Error | null) ?? null,
    refetch: () => {
      void res.refetch();
    },
  };
}

export function useLinkPatient(): {
  mutate: (code: string) => Promise<DoctorLinkPatientResponse>;
  isPending: boolean;
  error: Error | null;
} {
  const link = useLinkDoctorPatient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mutate = useCallback(
    async (code: string) => {
      setIsPending(true);
      setError(null);
      try {
        // Auto-links by the patient's Doctor Code — the code itself is the consent.
        return await link.mutateAsync({ data: { accessCode: code } });
      } catch (e) {
        const status = e instanceof ApiError ? e.status : 0;
        const serverMessage =
          e instanceof ApiError ? (e.data as { error?: string } | null)?.error : undefined;
        const err = new Error(
          status === 429
            ? (serverMessage ?? "Too many attempts to add a patient. Try again later.")
            : status === 404
              ? "That Doctor Code isn't valid. Check it with the patient's family."
              : "Could not add the patient. Please try again.",
        );
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [link],
  );
  return { mutate, isPending, error };
}

export function useUnlinkPatient(): {
  mutate: (accessCode: string) => Promise<void>;
  isPending: boolean;
  error: Error | null;
} {
  const unlink = useUnlinkDoctorPatient();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mutate = useCallback(
    async (accessCode: string) => {
      setIsPending(true);
      setError(null);
      try {
        // Soft-unlink: revokes this doctor's link only. The patient's account and data stay in
        // Glucose Guardian and can be re-linked later with the same Doctor Code.
        await unlink.mutateAsync({ accessCode });
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Could not remove patient.");
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [unlink],
  );
  return { mutate, isPending, error };
}

// ---- Local / mock helpers (treatment-settings propose, messages, org search) ----

export interface Mutation<TInput, TResult> {
  mutate: (input: TInput) => Promise<TResult>;
  isPending: boolean;
  error: Error | null;
}

function useLocalMutation<TInput, TResult>(
  run: (input: TInput) => Promise<TResult>,
): Mutation<TInput, TResult> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mutate = useCallback(
    async (input: TInput) => {
      setIsPending(true);
      setError(null);
      try {
        return await run(input);
      } catch (e) {
        const err = e instanceof Error ? e : new Error("Request failed");
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [run],
  );
  return { mutate, isPending, error };
}

export function useProposeOrder(): Mutation<ProposeOrderInput, TherapyOrder> {
  // Real proposal: POST /api/doctor/patient/:code/orders stores it server-side; the caregiver
  // approves or declines it in the Glucose Guardian app (the approval card arrives on the app's
  // next sync). patientId here is the patient's access code.
  const run = useCallback(async (input: ProposeOrderInput) => {
    try {
      const proposal = await customFetch<ServerTherapyProposal>(
        `/api/doctor/patient/${encodeURIComponent(input.patientId)}/orders`,
        {
          method: "POST",
          body: JSON.stringify({
            carbRatio: input.values.carbRatio,
            correctionFactor: input.values.correctionFactor,
            targetGlucose: input.values.targetGlucose,
            note: input.note,
          }),
        },
      );
      return proposalToOrder(proposal, input.patientId);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 404 || e.status === 405) {
          throw new Error(
            "The backend doesn't accept treatment proposals yet — the server update is pending deployment.",
          );
        }
        if (e.status === 409) {
          throw new Error(
            "A change is already awaiting caregiver confirmation. You can propose another once it's resolved.",
          );
        }
      }
      throw e instanceof Error ? e : new Error("Could not propose the change.");
    }
  }, []);
  return useLocalMutation(run);
}

export function useSendMessage(accessCode: string): Mutation<string, DoctorMessage> {
  const run = useCallback((text: string) => mockSendMessage(accessCode, text), [accessCode]);
  return useLocalMutation(run);
}

export function useDoctorMessages(accessCode: string): QueryResult<DoctorMessage[]> {
  const data = useMemo(
    () => (USE_MOCK_DATA ? mockMessages(accessCode) : undefined),
    [accessCode],
  );
  return { data, isLoading: false, error: null };
}

export function useSeededMessages(accessCode: string): {
  messages: DoctorMessage[];
  append: (m: DoctorMessage) => void;
} {
  const { data } = useDoctorMessages(accessCode);
  const [messages, setMessages] = useState<DoctorMessage[]>(data ?? []);
  useEffect(() => {
    if (data) setMessages(data);
  }, [data]);
  const append = useCallback((m: DoctorMessage) => setMessages((prev) => [...prev, m]), []);
  return { messages, append };
}

interface RemoteOrg {
  id: string;
  name: string;
  domains?: string[];
  city?: string;
  state?: string;
}

/**
 * Organization directory search. Two sources, one search box:
 *  - Curated local directory (instant, offline, ~230 major U.S. systems).
 *  - Server-side directory at GET /api/doctor/organizations (CMS/NPPES import — the long tail),
 *    debounced as the doctor types. If the endpoint isn't deployed or fails, local results
 *    stand alone, so this never breaks the sign-in flow.
 * Results are merged and deduped by normalized name + state, curated entries first.
 */
export function useOrganizationSearch(query: string): MockOrganization[] {
  const local = useMemo(() => searchOrganizations(query), [query]);
  const [remote, setRemote] = useState<MockOrganization[]>([]);

  useEffect(() => {
    const q = query.trim();
    setRemote([]);
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
          const res = await fetch(
            `${base}/api/doctor/organizations?q=${encodeURIComponent(q)}&limit=12`,
            { signal: ctrl.signal },
          );
          if (!res.ok) return;
          const body = (await res.json()) as { organizations?: RemoteOrg[] };
          setRemote(
            (body.organizations ?? []).map((o) => ({
              id: o.id,
              name: o.name,
              slug: o.id,
              allowedDomains: o.domains ?? [],
              city: o.city,
              state: o.state,
            })),
          );
        } catch {
          /* offline or directory not deployed yet — local results already cover it */
        }
      })();
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query]);

  return useMemo(() => {
    const seen = new Set<string>();
    const out: MockOrganization[] = [];
    for (const o of [...local, ...remote]) {
      const key = `${normalizeOrgName(o.name)}|${(o.state ?? "").toUpperCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(o);
      if (out.length >= 12) break;
    }
    return out;
  }, [local, remote]);
}
