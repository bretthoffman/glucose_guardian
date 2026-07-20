/**
 * Merge helpers for the Care Circle shared log bucket. Cloud is the source of truth; a very-recent
 * local-only entry is preserved so an in-flight optimistic write survives a racing poll — but stale
 * local entries are NOT resurrected (so a remote "clear" is respected). Pure + unit-tested.
 */

/** Creation time embedded in a log id (`food_<ms>_<rand>`); 0 when unparseable. */
export function entryCreationMs(id: string): number {
  const n = Number(id.split("_")[1]);
  return Number.isFinite(n) ? n : 0;
}

/** Local-only entries younger than this survive a merge; older ones defer to the cloud result. */
export const OPTIMISTIC_KEEP_MS = 2 * 60 * 1000;

export function mergeCloudLogs<T extends { id: string; timestamp: string }>(
  cloud: T[],
  local: T[],
  cap: number,
  nowMs: number = Date.now(),
): T[] {
  const cloudIds = new Set(cloud.map((e) => e.id));
  const recentLocalOnly = local.filter(
    (e) => !cloudIds.has(e.id) && nowMs - entryCreationMs(e.id) < OPTIMISTIC_KEEP_MS,
  );
  const merged = [...cloud, ...recentLocalOnly];
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return merged.slice(0, cap);
}
