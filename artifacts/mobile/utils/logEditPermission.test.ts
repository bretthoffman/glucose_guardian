import { describe, expect, it } from "vitest";
import { canEditExistingLogs, type LogEditPermissionInput } from "./logEditPermission";

const base: LogEditPermissionInput = {
  isCaregiverAccount: false,
  caregiverSession: false,
  accessCodeRole: null,
  canAddLogs: false,
};

describe("canEditExistingLogs", () => {
  it("lets a guardian / co-guardian edit regardless of any code grant", () => {
    expect(canEditExistingLogs(base)).toBe(true);
    expect(canEditExistingLogs({ ...base, canAddLogs: true })).toBe(true);
  });

  it("lets the kid's own child code edit, grant or not (it is their own record)", () => {
    const child = { ...base, caregiverSession: true, accessCodeRole: "child" as const };
    expect(canEditExistingLogs(child)).toBe(true);
    expect(canEditExistingLogs({ ...child, canAddLogs: true })).toBe(true);
  });

  describe("caregiver ACCESS CODE — the Add-logs grant is the gate", () => {
    const code = { ...base, caregiverSession: true, accessCodeRole: "caregiver" as const };
    it("may edit WITH the grant", () => {
      expect(canEditExistingLogs({ ...code, canAddLogs: true })).toBe(true);
    });
    it("is read-only WITHOUT it", () => {
      expect(canEditExistingLogs({ ...code, canAddLogs: false })).toBe(false);
    });
  });

  describe("caregiver EMAIL (nurse) account — identical rule", () => {
    const nurse = { ...base, isCaregiverAccount: true };
    it("may edit WITH the grant", () => {
      expect(canEditExistingLogs({ ...nurse, canAddLogs: true })).toBe(true);
    });
    it("is read-only WITHOUT it", () => {
      expect(canEditExistingLogs({ ...nurse, canAddLogs: false })).toBe(false);
    });
    it("applies while viewing a kid through that kid's code", () => {
      const viewing = { ...nurse, caregiverSession: true, accessCodeRole: "caregiver" as const };
      expect(canEditExistingLogs({ ...viewing, canAddLogs: true })).toBe(true);
      expect(canEditExistingLogs({ ...viewing, canAddLogs: false })).toBe(false);
    });
  });

  it("treats a legacy code with no role as a caregiver, not a child", () => {
    const legacy = { ...base, caregiverSession: true, accessCodeRole: null };
    expect(canEditExistingLogs({ ...legacy, canAddLogs: false })).toBe(false);
    expect(canEditExistingLogs({ ...legacy, canAddLogs: true })).toBe(true);
  });
});
