/**
 * On-demand Estimated-A1C range loading. Ranges >1D are fetched from Convex as aggregated
 * window stats (never raw readings) in ≤15-day chunks — each chunk stays well under Convex
 * document-scan limits — and merged client-side. 1D is always served from in-memory history.
 */
export interface GlucoseWindowStats {
  count: number;
  sum: number;
  lowCount: number;
  highCount: number;
  oldestTimestamp: string | null;
}

export const A1C_FETCH_CHUNK_DAYS = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Contiguous [start, end) ISO windows covering the last `days`, each at most `chunkDays` long. */
export function windowChunks(
  days: number,
  nowMs: number,
  chunkDays: number = A1C_FETCH_CHUNK_DAYS,
): { startTimestamp: string; endTimestamp: string }[] {
  const chunks: { startTimestamp: string; endTimestamp: string }[] = [];
  const startMs = nowMs - days * DAY_MS;
  for (let s = startMs; s < nowMs; s += chunkDays * DAY_MS) {
    const e = Math.min(s + chunkDays * DAY_MS, nowMs);
    chunks.push({ startTimestamp: new Date(s).toISOString(), endTimestamp: new Date(e).toISOString() });
  }
  return chunks;
}

export function mergeWindowStats(parts: GlucoseWindowStats[]): GlucoseWindowStats {
  const merged: GlucoseWindowStats = { count: 0, sum: 0, lowCount: 0, highCount: 0, oldestTimestamp: null };
  for (const p of parts) {
    merged.count += p.count;
    merged.sum += p.sum;
    merged.lowCount += p.lowCount;
    merged.highCount += p.highCount;
    if (p.oldestTimestamp != null && (merged.oldestTimestamp == null || p.oldestTimestamp < merged.oldestTimestamp)) {
      merged.oldestTimestamp = p.oldestTimestamp;
    }
  }
  return merged;
}

/** Local equivalent of the backend aggregation — the 1D path and the offline/old-backend fallback. */
export function statsFromEntries(
  entries: { glucose: number; timestamp: string }[],
  lowThreshold: number,
  highThreshold: number,
): GlucoseWindowStats {
  const stats: GlucoseWindowStats = { count: 0, sum: 0, lowCount: 0, highCount: 0, oldestTimestamp: null };
  for (const e of entries) {
    stats.count++;
    stats.sum += e.glucose;
    if (e.glucose < lowThreshold) stats.lowCount++;
    else if (e.glucose > highThreshold) stats.highCount++;
    if (stats.oldestTimestamp == null || e.timestamp < stats.oldestTimestamp) {
      stats.oldestTimestamp = e.timestamp;
    }
  }
  return stats;
}

/**
 * Days of data actually backing a range, measured from the OLDEST reading in the window — middle
 * gaps (a sensor-off day) don't shrink coverage; only history ending early does. Capped to the
 * requested range so full coverage compares equal.
 */
export function availableDaysFromOldest(
  oldestTimestamp: string | null,
  nowMs: number,
  requestedDays: number,
): number {
  if (oldestTimestamp == null) return 0;
  const t = new Date(oldestTimestamp).getTime();
  if (!Number.isFinite(t)) return 0;
  const spanDays = Math.ceil(Math.max(0, nowMs - t) / DAY_MS);
  return Math.min(requestedDays, Math.max(1, spanDays));
}
