/**
 * Glucose readings for a multi-day window (the Visit Summary and quick notes). The phone only keeps
 * about a day of readings, so this asks the server one local day at a time, through exactly the same
 * per-identity queries the day-by-day graph uses (hooks/useDayGlucoseReadings), a few days at once.
 */
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { daysInWindow, type SummaryReading } from "@/utils/visitSummary";
import type { Id } from "../../../convex/_generated/dataModel";

export interface GlucoseIdentity {
  isSignedIn: boolean;
  convexUserId?: string | null;
  passwordHash?: string | null;
  caregiverSession: boolean;
  caregiverCloudCode?: string | null;
  caregiverCodeKind?: string | null;
  nurseViewCode?: string | null;
  viewingPatientId?: string | null;
}

/** A stable key for whose readings these are, so a cache never serves another person's data. */
export function identityKey(id: GlucoseIdentity): string {
  return id.nurseViewCode ?? id.viewingPatientId ?? id.caregiverCloudCode ?? id.convexUserId ?? "anon";
}

type Client = ReturnType<typeof createConvexAuthClient>;

async function queryDay(client: Client, id: GlucoseIdentity, startIso: string, endIso: string): Promise<SummaryReading[]> {
  const range = { startTimestamp: startIso, endTimestamp: endIso };
  if (id.nurseViewCode) {
    return client.query(api.careCircle.listForDayRangeForAccessCode, { code: id.nurseViewCode, ...range });
  }
  if (id.viewingPatientId && id.isSignedIn && id.convexUserId) {
    return client.query(api.careCircle.listForDayRangeForLink, { patientUserId: id.viewingPatientId as Id<"users">, ...range });
  }
  if (id.isSignedIn && id.convexUserId) {
    return client.query(api.patientGlucose.listForDayRange, {
      userId: id.convexUserId as Id<"users">,
      passwordHash: id.passwordHash ?? undefined,
      ...range,
    });
  }
  if (id.caregiverSession && id.caregiverCloudCode) {
    return id.caregiverCodeKind === "access"
      ? client.query(api.careCircle.listForDayRangeForAccessCode, { code: id.caregiverCloudCode, ...range })
      : client.query(api.patientGlucose.listForDayRangeForCaregiver, { code: id.caregiverCloudCode, ...range });
  }
  return [];
}

/**
 * Every reading in [startMs, endMs). Throws only when EVERY day failed (offline); a few failed days
 * just leave gaps, which the report shows as missing sensor data.
 */
export async function fetchGlucoseRange(
  id: GlucoseIdentity,
  startMs: number,
  endMs: number,
  onProgress?: (done: number, total: number) => void,
): Promise<SummaryReading[]> {
  const days = daysInWindow(startMs, endMs);
  const client = createConvexAuthClient();
  const out: SummaryReading[] = [];
  let done = 0;
  let failed = 0;
  const CONCURRENCY = 6;
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const batch = days.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (dayStart) => {
        const next = new Date(dayStart);
        next.setDate(next.getDate() + 1);
        const s = Math.max(dayStart, startMs);
        const e = Math.min(next.getTime(), endMs);
        try {
          return await queryDay(client, id, new Date(s).toISOString(), new Date(e).toISOString());
        } catch {
          failed++;
          return [];
        } finally {
          done++;
          onProgress?.(done, days.length);
        }
      }),
    );
    for (const rows of results) for (const r of rows) out.push({ glucose: r.glucose, timestamp: r.timestamp });
  }
  if (failed === days.length && days.length > 0) throw new Error("Could not load glucose readings.");
  return out;
}

/** Merge reading lists, one per timestamp (later lists win), oldest first. */
export function mergeReadings(...lists: SummaryReading[][]): SummaryReading[] {
  const byTs = new Map<string, SummaryReading>();
  for (const list of lists) for (const r of list) byTs.set(r.timestamp, { glucose: r.glucose, timestamp: r.timestamp });
  return [...byTs.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
