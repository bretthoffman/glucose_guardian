/**
 * Tracks which caregiver treatment-decisions the signed-in doctor has already seen, so the portal
 * can badge new approvals/declines like a phone notification. Purely client-side (localStorage),
 * keyed by doctorId so a shared clinic computer never leaks one doctor's "seen" state to the next.
 *
 * The decision itself is read straight off the synced patient snapshot (no backend needed) — the
 * app writes the caregiver's approve/decline into `doctorPortalState.therapyDecision`, which the
 * portal already fetches per patient.
 */
export interface TherapyDecisionInfo {
  proposalId: string;
  status: "approved" | "declined";
  decidedAt: string;
}

const KEY = "gg_doc_seen_decisions";
const MAX_PER_DOCTOR = 200;

function decisionId(accessCode: string, d: TherapyDecisionInfo): string {
  return `${accessCode}:${d.proposalId}:${d.status}`;
}

/** The caregiver's latest decision from a raw patient snapshot (present once decided in the app). */
export function readDecision(snapshot: unknown): TherapyDecisionInfo | undefined {
  const d = (snapshot as { therapyDecision?: TherapyDecisionInfo | null } | null | undefined)
    ?.therapyDecision;
  return d ?? undefined;
}

/** Whether a proposed change is still awaiting the caregiver. */
export function hasPendingProposal(snapshot: unknown): boolean {
  return !!(snapshot as { therapyProposal?: unknown } | null | undefined)?.therapyProposal;
}

function readAll(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

/** A decision the doctor hasn't opened yet (drives the notification badge). */
export function isDecisionUnseen(
  doctorId: string | undefined,
  accessCode: string,
  decision: TherapyDecisionInfo,
): boolean {
  if (!doctorId) return false;
  return !(readAll()[doctorId] ?? []).includes(decisionId(accessCode, decision));
}

export function markDecisionSeen(
  doctorId: string | undefined,
  accessCode: string,
  decision: TherapyDecisionInfo,
): void {
  if (!doctorId) return;
  try {
    const all = readAll();
    const id = decisionId(accessCode, decision);
    const seen = all[doctorId] ?? [];
    if (seen.includes(id)) return;
    all[doctorId] = [...seen, id].slice(-MAX_PER_DOCTOR);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
