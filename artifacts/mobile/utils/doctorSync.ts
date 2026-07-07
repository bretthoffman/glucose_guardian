/**
 * Pure reconciliation helpers for the doctor-comms sync (no React Native imports, so they run
 * under the shared vitest config). The mobile `AuthContext.syncToDoctor` pushes a snapshot to the
 * api-server and now reads the response back through these to surface doctor messages and
 * treatment proposals to the caregiver.
 */

export interface DoctorMessage {
  id: string;
  timestamp: string;
  text: string;
  sender: "doctor" | "guardian";
  read: boolean;
}

export interface TherapyProposal {
  id: string;
  proposedAt: string;
  proposedByDoctorId: string;
  proposedByName: string;
  note: string;
  carbRatio?: number;
  correctionFactor?: number;
  targetGlucose?: number;
}

/**
 * Merge the server's message thread into the local one. The server holds both sides of the
 * conversation and is authoritative for message *content*, but the local device owns the `read`
 * flag for messages it already had (so pulling doesn't mark-unread things the caregiver read).
 * Returns the merged thread (oldest→newest) plus the doctor messages that are new to this device,
 * for firing a notification.
 */
export function mergeDoctorMessages(
  local: DoctorMessage[],
  incoming: DoctorMessage[],
): { merged: DoctorMessage[]; newDoctorMessages: DoctorMessage[] } {
  const localById = new Map(local.map((m) => [m.id, m]));
  const byId = new Map<string, DoctorMessage>();
  for (const m of local) byId.set(m.id, m);

  const newDoctorMessages: DoctorMessage[] = [];
  for (const m of incoming) {
    const existing = localById.get(m.id);
    if (existing) {
      byId.set(m.id, { ...m, read: existing.read });
    } else {
      byId.set(m.id, m);
      if (m.sender === "doctor") newDoctorMessages.push(m);
    }
  }

  const merged = [...byId.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  return { merged, newDoctorMessages };
}

/**
 * Decide what to do with the proposal the server returned relative to local state.
 * `recentlyDecidedId` guards against a proposal the caregiver just approved/declined reappearing
 * before the server has cleared it (the decision POST and the next poll can race).
 */
export function reconcileTherapyProposal(
  current: TherapyProposal | null,
  incoming: TherapyProposal | null,
  recentlyDecidedId: string | null,
): { next: TherapyProposal | null; isNew: boolean } {
  if (!incoming) return { next: null, isNew: false };
  if (recentlyDecidedId && incoming.id === recentlyDecidedId) {
    return { next: null, isNew: false };
  }
  const isNew = !current || current.id !== incoming.id;
  return { next: incoming, isNew };
}

/** Human-readable one-line summary of what a proposal changes, for cards and notifications. */
export function summarizeProposal(p: TherapyProposal): string {
  const parts: string[] = [];
  if (typeof p.carbRatio === "number") parts.push(`carb ratio 1:${p.carbRatio}`);
  if (typeof p.correctionFactor === "number") parts.push(`correction factor 1:${p.correctionFactor}`);
  if (typeof p.targetGlucose === "number") parts.push(`target ${p.targetGlucose} mg/dL`);
  if (parts.length === 0) return "a treatment setting";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
