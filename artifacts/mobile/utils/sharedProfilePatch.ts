/**
 * Fields a co-guardian MEMBER may not change — they belong to the circle owner. Mirrors
 * `OWNER_ONLY_PROFILE_FIELDS` in `convex/careCircle.ts`; the server is the enforcement boundary and
 * throws for the whole patch if any of these arrive from a member.
 */
export const OWNER_ONLY_SHARED_FIELDS = [
  "dateOfBirth",
  "weightLbs",
  "insulinTypes",
  "carbRatio",
  "targetGlucose",
  "correctionFactor",
  "doseSettingsByTime",
] as const;

/**
 * Split a shared-profile patch into what this caller may actually send and what must be dropped.
 *
 * Why this exists: the server rejects the ENTIRE patch if it contains a single owner-locked field.
 * That is the right contract (a partial write would report failure while some values had changed),
 * but it meant a member saving a mixed patch — say the doctor's phone AND the child's weight — lost
 * BOTH, including the field they were entitled to change. The rejection was also swallowed, so it
 * looked like a successful save and reverted on the next poll.
 *
 * Filtering here means a member's legitimate edits always land, and the server's throw goes back to
 * being what it should be: a backstop for a client bug, not something reachable in normal use.
 *
 * Owners are unaffected — nothing is filtered for them.
 */
export function splitSharedProfilePatch<T extends Record<string, unknown>>(
  patch: T,
  isOwner: boolean,
): { sendable: Partial<T>; blocked: string[] } {
  if (isOwner) return { sendable: { ...patch }, blocked: [] };
  const sendable: Record<string, unknown> = {};
  const blocked: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((OWNER_ONLY_SHARED_FIELDS as readonly string[]).includes(key)) {
      blocked.push(key);
      continue;
    }
    sendable[key] = value;
  }
  return { sendable: sendable as Partial<T>, blocked };
}
