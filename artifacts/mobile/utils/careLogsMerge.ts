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

/**
 * Age was doing the job of two different signals, and that was a data-loss bug.
 *
 * "Local-only" means one of two very different things: (a) the write never reached the server, or
 * (b) it did once and has since been removed remotely. Dropping (a) loses a real dose — log a bolus
 * offline, force-quit before the in-memory mutation queue drains, and two minutes later the merge
 * deleted it from disk. `computeActiveInsulin` then reported 0 u on board and the calculator
 * recommended a full correction on top of insulin that was actually active.
 *
 * `pendingSync` distinguishes them explicitly: it is set when an entry is written locally and
 * cleared only once the server has acknowledged it. So a pending entry is kept **regardless of age**
 * (it is the only copy that exists), while a non-pending local-only entry is still dropped — which
 * is what keeps a remote delete/clear respected, the behavior the age cutoff was protecting.
 *
 * The age cutoff remains as the fallback for entries written by older builds, which carry no flag.
 */
export function mergeCloudLogs<T extends { id: string; timestamp: string; pendingSync?: boolean }>(
  cloud: T[],
  local: T[],
  cap: number,
  nowMs: number = Date.now(),
): T[] {
  const cloudIds = new Set(cloud.map((e) => e.id));
  const recentLocalOnly = local.filter(
    (e) =>
      !cloudIds.has(e.id) &&
      (e.pendingSync === true || nowMs - entryCreationMs(e.id) < OPTIMISTIC_KEEP_MS),
  );
  const merged = [...cloud, ...recentLocalOnly];
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return merged.slice(0, cap);
}
