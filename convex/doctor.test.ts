import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/!(*.test).*s");

const SECRET = "test-ingest-secret";
const CODE = "ABC123";

beforeEach(() => {
  vi.stubEnv("CONVEX_DOCTOR_INGEST_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function makeProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: "prop-1",
    proposedAt: new Date(2026, 6, 1).toISOString(),
    proposedByDoctorId: "doc-1",
    proposedByName: "Dr. Chen",
    note: "Reduce dinner I:C ratio.",
    carbRatio: 12,
    ...overrides,
  };
}

const baseSnapshotArgs = {
  serverSecret: SECRET,
  accessCode: CODE,
  profile: {
    childName: "Emma",
    diabetesType: "Type 1",
    dateOfBirth: "2014-06-15",
    carbRatio: 10,
    correctionFactor: 50,
    targetGlucose: 110,
  },
  glucoseReadings: [],
  insulinLog: [],
  foodLog: [],
  messages: [],
  syncedAt: new Date(2026, 6, 1).toISOString(),
};

describe("doctor.proposeOrder", () => {
  it("stores a proposal on a code that has no synced doc yet", async () => {
    const t = convexTest(schema, modules);
    const proposal = makeProposal();
    const returned = await t.mutation(api.doctor.proposeOrder, {
      serverSecret: SECRET,
      accessCode: CODE,
      proposal,
    });
    expect(returned).toEqual(proposal);

    const state = await t.query(api.doctor.getState, { serverSecret: SECRET, accessCode: CODE });
    expect(state?.therapyProposal).toEqual(proposal);
    expect(state?.therapyDecision).toBeUndefined();
  });

  it("rejects a second proposal while one is pending (→ 409)", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.doctor.proposeOrder, {
      serverSecret: SECRET,
      accessCode: CODE,
      proposal: makeProposal({ id: "prop-1" }),
    });
    await expect(
      t.mutation(api.doctor.proposeOrder, {
        serverSecret: SECRET,
        accessCode: CODE,
        proposal: makeProposal({ id: "prop-2" }),
      }),
    ).rejects.toThrow(/PENDING_PROPOSAL_EXISTS/);
  });

  it("rejects an invalid server secret", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.doctor.proposeOrder, {
        serverSecret: "wrong",
        accessCode: CODE,
        proposal: makeProposal(),
      }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

describe("doctor proposal preservation across patient sync", () => {
  it("upsertFromSync does not clobber a pending proposal", async () => {
    const t = convexTest(schema, modules);
    // First a normal patient sync creates the doc.
    await t.mutation(api.doctor.upsertFromSync, baseSnapshotArgs);
    // Doctor proposes a change.
    const proposal = makeProposal();
    await t.mutation(api.doctor.proposeOrder, { serverSecret: SECRET, accessCode: CODE, proposal });
    // A later patient sync (which does a full replace) must keep the proposal.
    await t.mutation(api.doctor.upsertFromSync, {
      ...baseSnapshotArgs,
      messages: [
        { id: "m1", timestamp: "t", text: "hi", sender: "guardian" as const, read: true },
      ],
    });
    const state = await t.query(api.doctor.getState, { serverSecret: SECRET, accessCode: CODE });
    expect(state?.therapyProposal).toEqual(proposal);
    expect(state?.messages).toHaveLength(1);
  });

  it("appendMessage does not clobber a pending proposal", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(api.doctor.upsertFromSync, baseSnapshotArgs);
    const proposal = makeProposal();
    await t.mutation(api.doctor.proposeOrder, { serverSecret: SECRET, accessCode: CODE, proposal });
    await t.mutation(api.doctor.appendMessage, {
      serverSecret: SECRET,
      accessCode: CODE,
      message: { id: "m2", timestamp: "t", text: "doc reply", sender: "doctor", read: false },
    });
    const state = await t.query(api.doctor.getState, { serverSecret: SECRET, accessCode: CODE });
    expect(state?.therapyProposal).toEqual(proposal);
    expect(state?.messages.some((m) => m.id === "m2")).toBe(true);
  });
});

describe("doctor.decideOrder", () => {
  it("approves a pending proposal, clears it, and records the decision", async () => {
    const t = convexTest(schema, modules);
    const proposal = makeProposal();
    await t.mutation(api.doctor.proposeOrder, { serverSecret: SECRET, accessCode: CODE, proposal });

    const res = await t.mutation(api.doctor.decideOrder, {
      serverSecret: SECRET,
      accessCode: CODE,
      proposalId: proposal.id,
      status: "approved",
    });
    expect(res.applied).toBe(true);

    const state = await t.query(api.doctor.getState, { serverSecret: SECRET, accessCode: CODE });
    expect(state?.therapyProposal).toBeUndefined();
    expect(state?.therapyDecision?.proposalId).toBe(proposal.id);
    expect(state?.therapyDecision?.status).toBe("approved");
  });

  it("is idempotent for a proposal that was already decided", async () => {
    const t = convexTest(schema, modules);
    const proposal = makeProposal();
    await t.mutation(api.doctor.proposeOrder, { serverSecret: SECRET, accessCode: CODE, proposal });
    await t.mutation(api.doctor.decideOrder, {
      serverSecret: SECRET,
      accessCode: CODE,
      proposalId: proposal.id,
      status: "declined",
    });
    const second = await t.mutation(api.doctor.decideOrder, {
      serverSecret: SECRET,
      accessCode: CODE,
      proposalId: proposal.id,
      status: "declined",
    });
    expect(second.applied).toBe(false);
    expect(second.alreadyDecided).toBe(true);
  });

  it("lets a doctor propose again after a decision (clearing the stale decision)", async () => {
    const t = convexTest(schema, modules);
    const first = makeProposal({ id: "prop-1" });
    await t.mutation(api.doctor.proposeOrder, { serverSecret: SECRET, accessCode: CODE, proposal: first });
    await t.mutation(api.doctor.decideOrder, {
      serverSecret: SECRET,
      accessCode: CODE,
      proposalId: first.id,
      status: "approved",
    });

    const second = makeProposal({ id: "prop-2", carbRatio: 14 });
    await t.mutation(api.doctor.proposeOrder, { serverSecret: SECRET, accessCode: CODE, proposal: second });

    const state = await t.query(api.doctor.getState, { serverSecret: SECRET, accessCode: CODE });
    expect(state?.therapyProposal?.id).toBe("prop-2");
    expect(state?.therapyDecision).toBeUndefined();
  });
});
