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

describe("speaker identity across every account type (audit)", () => {
  it("GUARDIAN account: the kid's guardian, named", () => {
    expect(resolveChatSpeaker({ accountRole: "parent", parentName: "Brian" }))
      .toEqual({ kind: "guardian", name: "Brian" });
  });

  it("CO-GUARDIAN viewing a linked patient: still a guardian, with THEIR OWN name", () => {
    // The name passed in must be the signed-in person's own — chat.tsx now sources it from
    // `ownParentName`, because `profile` is the VIEWED patient's while viewing.
    expect(resolveChatSpeaker({ viewingPatientId: "p1", parentName: "Dad" }))
      .toEqual({ kind: "guardian", name: "Dad" });
  });

  it("ADULT managing their own diabetes: themselves", () => {
    expect(resolveChatSpeaker({ accountRole: "adult", parentName: null }).kind).toBe("patient");
  });

  it("KID access code: the patient, so the AI uses the kid's name", () => {
    expect(resolveChatSpeaker({ accessCodeRole: "child", caregiverSession: true, isChildMode: true }).kind)
      .toBe("patient");
  });

  it("CAREGIVER access code: a caregiver, never the patient", () => {
    // isChildMode is TRUE for every code session — the trap that made this say "patient".
    expect(resolveChatSpeaker({ accessCodeRole: "caregiver", caregiverSession: true, isChildMode: true }).kind)
      .toBe("caregiver");
  });

  it("LEGACY caregiver code (no role recorded): still a caregiver", () => {
    expect(resolveChatSpeaker({ caregiverSession: true, isChildMode: true }).kind).toBe("caregiver");
  });

  it("CAREGIVER EMAIL account: a caregiver", () => {
    expect(resolveChatSpeaker({ accountRole: "caregiver" }).kind).toBe("caregiver");
  });

  it("CAREGIVER EMAIL account inside a linked kid's view: a caregiver, not that kid's guardian", () => {
    expect(resolveChatSpeaker({ accountRole: "caregiver", nurseViewCode: "ABCD1234", viewingPatientId: "kid1" }).kind)
      .toBe("caregiver");
  });

  it("a kid code wins over every caregiver signal", () => {
    // Ordering guard: a kid's own device must never be labelled a caregiver.
    expect(resolveChatSpeaker({
      accessCodeRole: "child", caregiverSession: true, isChildMode: true,
      nurseViewCode: "X", accountRole: "caregiver",
    }).kind).toBe("patient");
  });
});
