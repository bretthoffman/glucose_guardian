import { describe, expect, it } from "vitest";
import { logConfirmMessage, resolveLogConfirmName } from "./careLogConfirm";

const base = {
  caregiverSession: false,
  accessCodeRole: null,
  isCaregiverViewingChild: false,
  patientName: "Bella",
} as const;

describe("resolveLogConfirmName", () => {
  it("prompts an accountless caregiver access-code session, naming the patient", () => {
    expect(
      resolveLogConfirmName({ ...base, caregiverSession: true, accessCodeRole: "caregiver" }),
    ).toBe("Bella");
  });

  it("prompts a Caregiver (nurse) account viewing a linked kid", () => {
    expect(resolveLogConfirmName({ ...base, isCaregiverViewingChild: true })).toBe("Bella");
    // A nurse's code for the kid may be a child-kind code — the nurse flag still governs.
    expect(
      resolveLogConfirmName({
        ...base,
        caregiverSession: true,
        accessCodeRole: "child",
        isCaregiverViewingChild: true,
      }),
    ).toBe("Bella");
  });

  it("does NOT prompt the patient's own account or a co-guardian", () => {
    expect(resolveLogConfirmName(base)).toBeNull();
  });

  it("does NOT prompt a kid/child access-code session (they log into their own profile)", () => {
    expect(
      resolveLogConfirmName({ ...base, caregiverSession: true, accessCodeRole: "child" }),
    ).toBeNull();
  });

  it("falls back through blank names so the prompt always names someone", () => {
    const caregiver = { ...base, caregiverSession: true, accessCodeRole: "caregiver" } as const;
    expect(resolveLogConfirmName({ ...caregiver, patientName: "  ", fallbackName: "Claire" })).toBe("Claire");
    expect(resolveLogConfirmName({ ...caregiver, patientName: null, fallbackName: null })).toBe("this person");
  });

  it("builds the confirmation copy", () => {
    expect(logConfirmMessage("Bella")).toBe(
      "You are about to write a log into Bella's profile. Continue?",
    );
  });
});
