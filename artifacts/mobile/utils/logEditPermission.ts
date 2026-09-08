/**
 * Who may EDIT or DELETE an existing food/insulin log. Pure so the rule is unit-testable and lives
 * in ONE place — the Log page and the home-screen chart markers both open the same detail modal, and
 * a rule duplicated across two screens is a rule that drifts.
 *
 * The "Add logs" grant is the single gate for caregivers: a caregiver trusted to write entries is
 * trusted to correct one. The person who mistyped a dose is the one best placed to fix it, and a
 * wrong entry is not inert — the calculator reads the same pool, so a bad dose keeps skewing IOB
 * math until someone repairs it. Caregivers WITHOUT the grant stay strictly read-only.
 *
 * This covers BOTH caregiver identities, which reach the same server-side authorization
 * (`codeEntryAuth` in convex/careLogs.ts) by different routes:
 *   1. an accountless caregiver ACCESS-CODE session, and
 *   2. a Caregiver (nurse) EMAIL account viewing a linked kid — AuthContext routes its writes
 *      through that kid's code, so the server sees a code either way.
 * The server already gates exactly on `permissions.log`, so this client rule and the backend agree
 * with no Convex change. Keep them in step: loosening one without the other creates either a dead
 * button or an unenforced restriction.
 *
 * Guardians, co-guardians, and the kid's own CHILD code always may — a child code is the patient's
 * own device editing their own record.
 */
export interface LogEditPermissionInput {
  /** True for a Caregiver (nurse) EMAIL account — `profile.accountRole === "caregiver"`. */
  isCaregiverAccount: boolean;
  /** True for any access-code session (accountless caregiver or kid). */
  caregiverSession: boolean;
  /** Which kind of code powers the session, when there is one. Legacy codes have none. */
  accessCodeRole: "caregiver" | "child" | null;
  /** The session's "Add logs" grant (`accessCodePermissions.log`). */
  canAddLogs: boolean;
}

/** True when this session may edit/delete an existing entry. */
export function canEditExistingLogs(input: LogEditPermissionInput): boolean {
  // A legacy code carries no role, so `!== "child"` deliberately treats it as a caregiver.
  const isCaregiverViewer =
    input.isCaregiverAccount || (input.caregiverSession && input.accessCodeRole !== "child");
  if (!isCaregiverViewer) return true;
  return input.canAddLogs;
}
