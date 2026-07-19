/**
 * Downsampled glucose history for the AI chat context: one reading per 20-minute slot (3/hour)
 * over the last 24 hours — enough shape for the model to reason about the day without shipping
 * every 5-minute reading. Keeps the LATEST reading in each slot; output is oldest → newest.
 */
export interface ContextReading {
  glucose: number;
  timestamp: string;
}

export const CONTEXT_HISTORY_WINDOW_HOURS = 24;
export const CONTEXT_HISTORY_INTERVAL_MINUTES = 20;

export function downsampleReadingsForContext(
  readings: ContextReading[],
  nowMs: number,
  windowHours: number = CONTEXT_HISTORY_WINDOW_HOURS,
  intervalMinutes: number = CONTEXT_HISTORY_INTERVAL_MINUTES,
): ContextReading[] {
  const windowMs = windowHours * 3_600_000;
  const intervalMs = intervalMinutes * 60_000;
  const startMs = nowMs - windowMs;

  // A reading exactly at `nowMs` would land one slot past the window's last bucket — clamp it in.
  const lastBucket = Math.ceil(windowMs / intervalMs) - 1;
  const buckets = new Map<number, { reading: ContextReading; t: number }>();
  for (const r of readings) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t) || t < startMs || t > nowMs) continue;
    const bucket = Math.min(Math.floor((t - startMs) / intervalMs), lastBucket);
    const existing = buckets.get(bucket);
    if (!existing || t > existing.t) buckets.set(bucket, { reading: r, t });
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v.reading);
}

/** Device-local clock label, prefixed with "Yesterday" when the reading is from the prior day. */
export function formatReadingTimeLabel(timestamp: string, nowMs: number): string {
  const d = new Date(timestamp);
  const now = new Date(nowMs);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? time : `Yesterday ${time}`;
}
