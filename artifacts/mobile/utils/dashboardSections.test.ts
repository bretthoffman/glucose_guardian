import { describe, expect, it } from "vitest";
import {
  availableDashboardSections,
  dashboardSectionVisibility,
  type DashboardRoleFlags,
} from "./dashboardSections";

// A regular signed-in patient who owns the account (parent role), not in child/caregiver/doctor mode.
const patientParent: DashboardRoleFlags = {
  isChildMode: false,
  caregiverSession: false,
  doctorSession: false,
  isParent: true,
  isAdult: false,
};

const keys = (role: DashboardRoleFlags) => availableDashboardSections(role).map((s) => s.key);

describe("dashboardSectionVisibility", () => {
  it("shows every group to a regular patient", () => {
    expect(dashboardSectionVisibility(patientParent)).toEqual({
      showPatientSections: true,
      showDoctorCareTeam: true,
      showAccessManagement: true,
    });
  });

  it("hides patient sections + access in a read-only caregiver session, keeps Doctor & Care Team", () => {
    const vis = dashboardSectionVisibility({ ...patientParent, caregiverSession: true });
    expect(vis.showPatientSections).toBe(false);
    expect(vis.showAccessManagement).toBe(false);
    expect(vis.showDoctorCareTeam).toBe(true);
  });

  it("in doctor mode keeps patient sections but hides Doctor & Care Team and Access Management", () => {
    const vis = dashboardSectionVisibility({ ...patientParent, doctorSession: true });
    expect(vis.showPatientSections).toBe(true);
    expect(vis.showDoctorCareTeam).toBe(false);
    expect(vis.showAccessManagement).toBe(false);
  });

  it("hides patient sections in child view but still allows Doctor & Care Team", () => {
    const vis = dashboardSectionVisibility({ ...patientParent, isChildMode: true });
    expect(vis.showPatientSections).toBe(false);
    expect(vis.showDoctorCareTeam).toBe(true);
    expect(vis.showAccessManagement).toBe(false);
  });

  it("grants Access Management to both parent and adult account owners", () => {
    expect(dashboardSectionVisibility(patientParent).showAccessManagement).toBe(true);
    expect(
      dashboardSectionVisibility({ ...patientParent, isParent: false, isAdult: true }).showAccessManagement,
    ).toBe(true);
  });

  it("withholds Access Management from a non-owner (neither parent nor adult)", () => {
    expect(
      dashboardSectionVisibility({ ...patientParent, isParent: false, isAdult: false }).showAccessManagement,
    ).toBe(false);
  });
});

describe("availableDashboardSections", () => {
  it("returns all six cards in authoritative grid order for a regular patient", () => {
    expect(keys(patientParent)).toEqual([
      "notifications",
      "thresholds",
      "emergency",
      "insulin",
      "doctor",
      "access",
    ]);
  });

  it("returns only Doctor & Care Team in a caregiver session", () => {
    expect(keys({ ...patientParent, caregiverSession: true })).toEqual(["doctor"]);
  });

  it("returns only Doctor & Care Team in child view", () => {
    expect(keys({ ...patientParent, isChildMode: true })).toEqual(["doctor"]);
  });

  it("returns the four patient sections (no doctor/access) in doctor mode", () => {
    expect(keys({ ...patientParent, doctorSession: true })).toEqual([
      "notifications",
      "thresholds",
      "emergency",
      "insulin",
    ]);
  });

  it("omits Access Management for a non-owner patient, yielding an odd count", () => {
    const k = keys({ ...patientParent, isParent: false, isAdult: false });
    expect(k).toEqual(["notifications", "thresholds", "emergency", "insulin", "doctor"]);
    expect(k.length % 2).toBe(1); // last lone card stays in the left column (right slot empty)
  });

  it("provides a human title for every returned card", () => {
    for (const section of availableDashboardSections(patientParent)) {
      expect(section.title.length).toBeGreaterThan(0);
    }
  });

  it("labels the thresholds section Alert Thresholds", () => {
    const section = availableDashboardSections(patientParent).find((s) => s.key === "thresholds");
    expect(section?.title).toBe("Alert Thresholds");
  });
});
