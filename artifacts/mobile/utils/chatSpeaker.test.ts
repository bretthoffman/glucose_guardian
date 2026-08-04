import { describe, expect, it } from "vitest";
import { resolveChatSpeaker } from "./chatSpeaker";

describe("resolveChatSpeaker — the AI must never call a caregiver by the patient's name", () => {
  it("CAREGIVER access code → caregiver, even though isChildMode is true for it", () => {
    // The regression: `isChildMode` is `childModeEnabled || caregiverSession`, so a caregiver code
    // has it set. Testing it alone made the assistant greet the caregiver as the patient.
    expect(
      resolveChatSpeaker({ caregiverSession: true, isChildMode: true, accessCodeRole: "caregiver" }),
    ).toEqual({ kind: "caregiver" });
    // Legacy codes carry no role at all — still a caregiver, not the patient.
    expect(resolveChatSpeaker({ caregiverSession: true, isChildMode: true })).toEqual({ kind: "caregiver" });
  });

  it("KID access code → patient (the assistant uses the kid's own name)", () => {
    expect(
      resolveChatSpeaker({ caregiverSession: true, isChildMode: true, accessCodeRole: "child" }),
    ).toEqual({ kind: "patient" });
  });

  it("guardian device switched into child mode → patient (the kid is holding the phone)", () => {
    expect(resolveChatSpeaker({ isChildMode: true, caregiverSession: false, accountRole: "parent" }))
      .toEqual({ kind: "patient" });
  });

  it("caregiver EMAIL account, and a nurse viewing a kid by code → caregiver", () => {
    expect(resolveChatSpeaker({ accountRole: "caregiver" })).toEqual({ kind: "caregiver" });
    expect(resolveChatSpeaker({ accountRole: "caregiver", nurseViewCode: "ABCD1234" })).toEqual({
      kind: "caregiver",
    });
  });

  it("parent account and co-guardian viewing → guardian, carrying their own name when known", () => {
    expect(resolveChatSpeaker({ accountRole: "parent", parentName: "Brian" })).toEqual({
      kind: "guardian",
      name: "Brian",
    });
    expect(resolveChatSpeaker({ viewingPatientId: "user_123" })).toEqual({ kind: "guardian", name: undefined });
    // Blank/whitespace names collapse to undefined so the server falls back to "<name>'s guardian".
    expect(resolveChatSpeaker({ accountRole: "parent", parentName: "   " })).toEqual({
      kind: "guardian",
      name: undefined,
    });
  });

  it("alert deep-link from a guardian → guardian", () => {
    expect(resolveChatSpeaker({ fromParent: true, parentName: "Mom" })).toEqual({ kind: "guardian", name: "Mom" });
  });

  it("an adult managing their own diabetes → patient (their own name)", () => {
    expect(resolveChatSpeaker({ accountRole: "adult" })).toEqual({ kind: "patient" });
    expect(resolveChatSpeaker({})).toEqual({ kind: "patient" });
  });

  it("caregiver identity outranks a guardian one when both look true", () => {
    expect(
      resolveChatSpeaker({ accountRole: "caregiver", viewingPatientId: "user_123", parentName: "Nina" }),
    ).toEqual({ kind: "caregiver" });
  });
});
