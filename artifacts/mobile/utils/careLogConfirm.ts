/**
 * Decides whether a session must CONFIRM before committing a food/insulin log, and whose name the
 * prompt should use. Pure so the rule is unit-testable and lives in one place (see
 * `hooks/useCareLogConfirm` for the prompt itself).
 *
 * Confirmation is for caregivers writing into someone else's medical record — the two caregiver
 * entry points:
 *   1. an accountless caregiver ACCESS-CODE session, and
 *   2. a Caregiver (nurse) ACCOUNT viewing a linked kid through that kid's code.
 * Everyone else logs straight through: the guardian on their own account, co-guardians (the circle
 * is theirs too), and child/kid code sessions (they're logging into their OWN profile, so a prompt
 * naming them would be nonsense).
 */
export interface LogConfirmInput {
  /** True for any access-code session (accountless kid or caregiver). */
  caregiverSession: boolean;
  /** Which kind of access code powers the session, when there is one. */
  accessCodeRole: "caregiver" | "child" | null;
  /** True when a Caregiver (nurse) account is inside a linked kid's view. */
  isCaregiverViewingChild: boolean;
  /** The name on the profile that would receive the log (the viewed kid / code owner's child). */
  patientName?: string | null;
  /** Secondary source for that name, used when `patientName` is blank. */
  fallbackName?: string | null;
}

/** The name to show in the confirmation, or null when this session logs without confirming. */
export function resolveLogConfirmName(input: LogConfirmInput): string | null {
  const accountlessCaregiverCode = input.caregiverSession && input.accessCodeRole === "caregiver";
  if (!accountlessCaregiverCode && !input.isCaregiverViewingChild) return null;
  return input.patientName?.trim() || input.fallbackName?.trim() || "this person";
}

/** The exact confirmation copy shown before a caregiver writes a log. */
export function logConfirmMessage(name: string): string {
  return `You are about to write a log into ${name}'s profile. Continue?`;
}
