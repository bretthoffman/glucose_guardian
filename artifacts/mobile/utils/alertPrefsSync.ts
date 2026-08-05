/**
 * Which alert-preference fields actually reach the backend. Mirrors `thresholdsToBackend` in
 * `AuthContext` — the push pipeline reads these server-side, so if the server's copy disagrees with
 * the screen, alerts fire on the wrong numbers.
 *
 * `notificationsEnabled` and `alertToChatOnOpenEnabled` are deliberately NOT here: they are
 * device-local, so the device's value IS the source of truth and a server failure is irrelevant to
 * them.
 */
export const SYNCED_ALERT_PREF_KEYS = [
  "lowThreshold",
  "highThreshold",
  "urgentLowThreshold",
  "urgentHighThreshold",
  "emergencyAlertsEnabled",
  "oneTapTextEnabled",
  "waitWindowEnabled",
  "waitWindowMinutes",
] as const;

export type SyncedAlertPrefKey = (typeof SYNCED_ALERT_PREF_KEYS)[number];

/** True when a patch contains at least one field the backend cares about. */
export function patchTouchesBackend(patch: object): boolean {
  const rec = patch as Record<string, unknown>;
  return (SYNCED_ALERT_PREF_KEYS as readonly string[]).some(
    (k) => Object.prototype.hasOwnProperty.call(rec, k) && rec[k] !== undefined,
  );
}

/**
 * Restore ONLY the backend-synced fields from `prev`, keeping any device-local changes in `next`.
 *
 * Used when a preferences write fails. Reverting everything would throw away a device-only toggle the
 * user legitimately changed (that one never needed the server); reverting nothing would leave the
 * screen showing thresholds the server never accepted — which is the dangerous direction, because the
 * push pipeline would keep evaluating readings against the OLD numbers while the UI claimed the new
 * ones were live.
 */
export function rollbackSyncedKeys<T extends object>(next: T, prev: T): T {
  const out = { ...next } as Record<string, unknown>;
  const prevRec = prev as unknown as Record<string, unknown>;
  for (const k of SYNCED_ALERT_PREF_KEYS) {
    if (Object.prototype.hasOwnProperty.call(prevRec, k)) out[k] = prevRec[k];
  }
  return out as T;
}
