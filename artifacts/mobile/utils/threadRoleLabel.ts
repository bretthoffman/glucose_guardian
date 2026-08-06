import type { CareThread } from "@/context/MessagesContext";

/**
 * The qualifier shown beside a name in the Messages list — "Brian *Guardian*".
 *
 * Returns null for an ADULT on purpose: someone managing their own diabetes is the person the app is
 * about, so labelling them explains nothing. Everyone else gets the role that says how they relate to
 * that person.
 *
 * "Co-Guardian" is decided server-side from the circle's live guardian count, so it appears for every
 * guardian as soon as a second one joins and reverts to "Guardian" if one leaves.
 */
export function threadRoleLabel(kind: CareThread["otherKind"]): string | null {
  switch (kind) {
    case "adult":
      return null;
    case "co-guardian":
      return "Co-Guardian";
    case "guardian":
      return "Guardian";
    case "child":
      return "Child";
    case "caregiver":
      return "Caregiver";
    default:
      return null;
  }
}
