import { describe, expect, it } from "vitest";
import {
  availableDashboardSections,
  dashboardGroups,
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
      showNotifications: true,
      showDoctorCareTeam: true,
      showAccessManagement: true,
      showActivityLog: false, // no entries yet
      showDownloadLogs: false,
      showChildView: true,
    });
  });

  it("hides patient sections, access, and Doctor & Care Team in a read-only caregiver session", () => {
    const vis = dashboardSectionVisibility({ ...patientParent, caregiverSession: true });
    expect(vis.showPatientSections).toBe(false);
    expect(vis.showAccessManagement).toBe(false);
    expect(vis.showDoctorCareTeam).toBe(false);
  });

  it("in doctor mode keeps patient sections but hides Doctor & Care Team and Access Management", () => {
    const vis = dashboardSectionVisibility({ ...patientParent, doctorSession: true });
    expect(vis.showPatientSections).toBe(true);
    expect(vis.showDoctorCareTeam).toBe(false);
    expect(vis.showAccessManagement).toBe(false);
  });

  it("hides patient sections and Doctor & Care Team in child view", () => {
    const vis = dashboardSectionVisibility({ ...patientParent, isChildMode: true });
    expect(vis.showPatientSections).toBe(false);
    expect(vis.showDoctorCareTeam).toBe(false);
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

  it("hides Doctor Office + Care Circle but keeps patient sections when a nurse views a child", () => {
    // A nurse viewing a child looks like a parent (viewed profile has no role) but must not see the
    // owner-only Doctor Office / Care Circle sections — they view thresholds/insulin/emergency read-only.
    const vis = dashboardSectionVisibility({ ...patientParent, caregiverViewingChild: true });
    expect(vis.showPatientSections).toBe(true);
    expect(vis.showDoctorCareTeam).toBe(false);
    expect(vis.showAccessManagement).toBe(false);
    expect(keys({ ...patientParent, caregiverViewingChild: true })).toEqual([
      "insulin",
      "summary",
      "notifications",
      "thresholds",
      "emergency",
    ]);
    // …and a nurse never could enable Child View, so the switch is not offered either.
    expect(vis.showChildView).toBe(false);
  });

  it("offers the Activity Log row only once there are entries, and never in guardian-device child mode", () => {
    expect(dashboardSectionVisibility(patientParent).showActivityLog).toBe(false);
    expect(dashboardSectionVisibility({ ...patientParent, hasLogEntries: true }).showActivityLog).toBe(true);
    expect(
      dashboardSectionVisibility({ ...patientParent, hasLogEntries: true, isChildMode: true }).showActivityLog,
    ).toBe(false);
    // An access-code session with entries keeps it (the old inline card's exact rule).
    expect(
      dashboardSectionVisibility({ ...patientParent, hasLogEntries: true, isChildMode: true, caregiverSession: true })
        .showActivityLog,
    ).toBe(true);
  });

  it("keeps the Child View switch for the parent while child mode is ON, so it can be turned off", () => {
    expect(dashboardSectionVisibility({ ...patientParent, isChildMode: true }).showChildView).toBe(true);
    expect(dashboardSectionVisibility({ ...patientParent, caregiverSession: true }).showChildView).toBe(false);
    expect(dashboardSectionVisibility({ ...patientParent, isParent: false, isAdult: true }).showChildView).toBe(false);
  });
});

describe("availableDashboardSections", () => {
  it("returns every row in on-screen order for a regular patient", () => {
    expect(keys(patientParent)).toEqual([
      "insulin",
      "summary",
      "notifications",
      "thresholds",
      "emergency",
      "careCircle",
      "doctor",
      "doctorCode",
      "childView",
    ]);
  });

  it("slots the Activity Log between Insulin Settings and Glucose Summary once there are entries", () => {
    expect(keys({ ...patientParent, hasLogEntries: true }).slice(0, 3)).toEqual(["insulin", "activity", "summary"]);
  });

  it("returns only Notifications in a caregiver session (device-own alert prefs; emergency locked inside)", () => {
    expect(keys({ ...patientParent, caregiverSession: true })).toEqual(["notifications"]);
  });

  it("leaves only the Child View switch in child view (so it can be turned off)", () => {
    expect(keys({ ...patientParent, isChildMode: true })).toEqual(["childView"]);
  });

  it("in doctor mode adds Download Patient Logs and drops Doctor Office / Doctor Code / Care Circle", () => {
    expect(keys({ ...patientParent, doctorSession: true })).toEqual([
      "insulin",
      "summary",
      "downloadLogs",
      "notifications",
      "thresholds",
      "emergency",
      "childView",
    ]);
  });

  it("omits Care Circle and the Child View switch for a non-owner patient", () => {
    expect(keys({ ...patientParent, isParent: false, isAdult: false })).toEqual([
      "insulin",
      "summary",
      "notifications",
      "thresholds",
      "emergency",
      "doctor",
      "doctorCode",
    ]);
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

  it("labels the doctor section Doctor Office", () => {
    const section = availableDashboardSections(patientParent).find((s) => s.key === "doctor");
    expect(section?.title).toBe("Doctor Office");
  });
});

describe("dashboardGroups", () => {
  it("renders four titled groups for a regular patient, in order", () => {
    expect(dashboardGroups(patientParent).map((g) => g.title)).toEqual([
      "Glucose & Dosing",
      "Alerts & Notifications",
      "Care Team",
      "Child Safety",
    ]);
  });

  it("drops a group entirely when none of its rows apply", () => {
    // A caregiver code session sees only Notifications — so only its group survives.
    const groups = dashboardGroups({ ...patientParent, caregiverSession: true });
    expect(groups.map((g) => g.title)).toEqual(["Alerts & Notifications"]);
    expect(groups[0]!.rows.map((r) => r.key)).toEqual(["notifications"]);
  });

  it("never emits an empty group", () => {
    const roles: DashboardRoleFlags[] = [
      patientParent,
      { ...patientParent, isChildMode: true },
      { ...patientParent, doctorSession: true },
      { ...patientParent, caregiverSession: true, isChildMode: true },
      { ...patientParent, isParent: false, isAdult: false },
    ];
    for (const role of roles) for (const g of dashboardGroups(role)) expect(g.rows.length).toBeGreaterThan(0);
  });
});

describe("Notifications visibility across identities (each device owns its own alert prefs)", () => {
  // `isChildMode` is TRUE for every access-code session (childModeEnabled || caregiverSession), so
  // a bare `!isChildMode` guard hid Notifications from the very sessions it's meant to include.
  const base = { doctorSession: false, isParent: true, isAdult: false } as const;

  it("SHOWS for a caregiver access-code session (isChildMode true because of the code)", () => {
    const vis = dashboardSectionVisibility({ ...base, isChildMode: true, caregiverSession: true });
    expect(vis.showNotifications).toBe(true);
    // …while the owner-only management sections stay hidden for them.
    expect(vis.showPatientSections).toBe(false);
    expect(vis.showAccessManagement).toBe(false);
  });

  it("SHOWS for a kid access-code session", () => {
    expect(
      dashboardSectionVisibility({ ...base, isChildMode: true, caregiverSession: true, isParent: false })
        .showNotifications,
    ).toBe(true);
  });

  it("HIDES only for guardian-device child mode (no access code involved)", () => {
    expect(
      dashboardSectionVisibility({ ...base, isChildMode: true, caregiverSession: false }).showNotifications,
    ).toBe(false);
  });

  it("SHOWS for a normal guardian and for a doctor session", () => {
    expect(dashboardSectionVisibility({ ...base, isChildMode: false, caregiverSession: false }).showNotifications).toBe(true);
    expect(
      dashboardSectionVisibility({ ...base, isChildMode: false, caregiverSession: false, doctorSession: true })
        .showNotifications,
    ).toBe(true);
  });
});
