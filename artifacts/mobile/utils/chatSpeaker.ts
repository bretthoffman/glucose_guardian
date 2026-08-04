/**
 * WHO is typing in the AI chat — so the assistant addresses the right person and never calls a
 * guardian or caregiver by the patient's name. The api-server turns this into the speaker label it
 * writes into the prompt ("Bella's caregiver", "Brian, Bella's guardian", or the patient's own name).
 *
 * THE TRAP THIS ENCODES: `isChildMode` is true for EVERY access-code session — it's defined as
 * `childModeEnabled || caregiverSession` — so testing it alone classifies a CAREGIVER as the
 * patient. That's what made the assistant greet a caregiver as "Brett" and tell them "you have
 * type 1 diabetes". Only a kid's OWN code, or a guardian device switched into child mode, is
 * actually the patient typing.
 *
 * Order matters: kid identities first, then caregivers, then guardians, then the plain adult owner.
 */
export type ChatSpeakerKind = "patient" | "guardian" | "caregiver";

export interface ChatSpeaker {
  kind: ChatSpeakerKind;
  /** Guardians only — their own first name, when the profile carries one. */
  name?: string;
}

export interface ChatSpeakerInput {
  /** Access-code role for a code session: "child" = the kid's own code. */
  accessCodeRole?: string | null;
  /** True for ANY access-code session (kid or caregiver) — never a caregiver test on its own. */
  caregiverSession?: boolean;
  /** `childModeEnabled || caregiverSession` — see the trap above. */
  isChildMode?: boolean;
  /** A caregiver (nurse) email account currently viewing a linked kid via their code. */
  nurseViewCode?: string | null;
  /** The signed-in account's role, when there is one. */
  accountRole?: string | null;
  /** Set while a co-guardian is viewing a linked patient. */
  viewingPatientId?: string | null;
  /** Deep-link flag set when a guardian opens chat from an alert. */
  fromParent?: boolean;
  /** The guardian's own name, if the profile records one. */
  parentName?: string | null;
}

export function resolveChatSpeaker(input: ChatSpeakerInput): ChatSpeaker {
  const {
    accessCodeRole,
    caregiverSession,
    isChildMode,
    nurseViewCode,
    accountRole,
    viewingPatientId,
    fromParent,
    parentName,
  } = input;

  // The patient themselves: their own access code, or a guardian's device handed to them in child
  // mode. `!caregiverSession` is what keeps a caregiver code out of this branch.
  if (accessCodeRole === "child" || (isChildMode && !caregiverSession)) return { kind: "patient" };

  // Caregiver identities: a caregiver access code, a nurse email account, or a nurse viewing a kid.
  if (nurseViewCode || accountRole === "caregiver" || caregiverSession) return { kind: "caregiver" };

  // Guardian identities: parent accounts and co-guardians viewing a linked patient.
  if (viewingPatientId || accountRole === "parent" || fromParent) {
    return { kind: "guardian", name: parentName?.trim() || undefined };
  }

  // An adult managing their own diabetes — the assistant uses their own name.
  return { kind: "patient" };
}
