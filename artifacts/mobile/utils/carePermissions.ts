import type { CarePermissions } from "../../../convex/careSchedule";

/**
 * Apply one permission toggle, enforcing the dependency between viewing and adding logs.
 *
 * `log` (Add logs) cannot be granted without `viewLogs` (View food & insulin logs): writing an entry
 * you can't then see is a trap — the caregiver gets no confirmation it landed, can't spot a mistake,
 * and can't tell a duplicate from a missing one. The reverse is a legitimate setting, so viewing stays
 * independently grantable.
 *
 *  - turning `viewLogs` OFF  → also turns `log` OFF (nothing to write into)
 *  - turning `log` ON        → also turns `viewLogs` ON (so the write is visible)
 *  - turning `viewLogs` ON   → leaves `log` alone (read-only is a normal grant)
 *  - turning `log` OFF       → leaves `viewLogs` alone
 *
 * Pure so the same rule can back the UI and be re-asserted server-side; a stale client must not be
 * able to persist `log: true, viewLogs: false`.
 */
export function applyPermissionChange(
  value: CarePermissions,
  key: keyof CarePermissions,
  on: boolean,
): CarePermissions {
  const next: CarePermissions = { ...value, [key]: on };
  if (key === "viewLogs" && !on) next.log = false;
  if (key === "log" && on) next.viewLogs = true;
  return next;
}

/**
 * Repair any permission set that already violates the rule above — for grants created before it
 * existed, or handed in by a client that doesn't enforce it. Drops `log` rather than granting
 * `viewLogs`, because silently widening what someone can SEE is the wrong direction to fail.
 */
export function normalizeCarePermissions(value: CarePermissions): CarePermissions {
  if (value.log && !value.viewLogs) return { ...value, log: false };
  return value;
}
