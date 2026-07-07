import { describe, expect, it } from "vitest";
import {
  mergeDoctorMessages,
  reconcileTherapyProposal,
  summarizeProposal,
  type DoctorMessage,
  type TherapyProposal,
} from "./doctorSync";

function msg(overrides: Partial<DoctorMessage> & { id: string }): DoctorMessage {
  return {
    timestamp: new Date(2026, 6, 1, 12, 0, 0).toISOString(),
    text: "hello",
    sender: "guardian",
    read: false,
    ...overrides,
  };
}

function proposal(overrides: Partial<TherapyProposal> = {}): TherapyProposal {
  return {
    id: "ord-1",
    proposedAt: new Date(2026, 6, 1).toISOString(),
    proposedByDoctorId: "doc-1",
    proposedByName: "Dr. Chen",
    note: "note",
    carbRatio: 12,
    ...overrides,
  };
}

describe("mergeDoctorMessages", () => {
  it("adds server doctor messages and flags them as new", () => {
    const local = [msg({ id: "g1", sender: "guardian", read: true })];
    const incoming = [
      msg({ id: "g1", sender: "guardian", read: false }),
      msg({ id: "d1", sender: "doctor", read: false, timestamp: new Date(2026, 6, 1, 13).toISOString() }),
    ];
    const { merged, newDoctorMessages } = mergeDoctorMessages(local, incoming);
    expect(merged.map((m) => m.id)).toEqual(["g1", "d1"]);
    expect(newDoctorMessages.map((m) => m.id)).toEqual(["d1"]);
  });

  it("preserves the local read flag for messages already known", () => {
    const local = [msg({ id: "d1", sender: "doctor", read: true })];
    const incoming = [msg({ id: "d1", sender: "doctor", read: false })];
    const { merged, newDoctorMessages } = mergeDoctorMessages(local, incoming);
    expect(merged[0].read).toBe(true);
    expect(newDoctorMessages).toHaveLength(0);
  });

  it("does not duplicate messages and sorts oldest to newest", () => {
    const local = [msg({ id: "b", timestamp: new Date(2026, 6, 1, 14).toISOString() })];
    const incoming = [
      msg({ id: "a", timestamp: new Date(2026, 6, 1, 10).toISOString() }),
      msg({ id: "b", timestamp: new Date(2026, 6, 1, 14).toISOString() }),
    ];
    const { merged } = mergeDoctorMessages(local, incoming);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("keeps a local-only unsynced message", () => {
    const local = [msg({ id: "pending", sender: "guardian" })];
    const { merged } = mergeDoctorMessages(local, []);
    expect(merged.map((m) => m.id)).toEqual(["pending"]);
  });
});

describe("reconcileTherapyProposal", () => {
  it("returns null for no incoming proposal", () => {
    expect(reconcileTherapyProposal(proposal(), null, null)).toEqual({ next: null, isNew: false });
  });

  it("flags a first proposal as new", () => {
    const p = proposal();
    expect(reconcileTherapyProposal(null, p, null)).toEqual({ next: p, isNew: true });
  });

  it("does not re-flag the same proposal as new", () => {
    const p = proposal();
    expect(reconcileTherapyProposal(p, p, null)).toEqual({ next: p, isNew: false });
  });

  it("flags a different proposal id as new", () => {
    const p2 = proposal({ id: "ord-2" });
    const res = reconcileTherapyProposal(proposal({ id: "ord-1" }), p2, null);
    expect(res.isNew).toBe(true);
    expect(res.next?.id).toBe("ord-2");
  });

  it("ignores a proposal that was just decided locally", () => {
    const p = proposal({ id: "ord-1" });
    expect(reconcileTherapyProposal(null, p, "ord-1")).toEqual({ next: null, isNew: false });
  });
});

describe("summarizeProposal", () => {
  it("joins multiple changes readably", () => {
    expect(summarizeProposal(proposal({ carbRatio: 12, targetGlucose: 110 }))).toBe(
      "carb ratio 1:12 and target 110 mg/dL",
    );
  });
  it("handles a single change", () => {
    expect(summarizeProposal(proposal({ carbRatio: undefined, correctionFactor: 45, targetGlucose: undefined }))).toBe(
      "correction factor 1:45",
    );
  });
});
