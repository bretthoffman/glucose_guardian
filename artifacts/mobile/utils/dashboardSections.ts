/**
 * Pure role → Dashboard-section visibility logic. No React/React Native imports so it is unit-testable
 * in the root vitest run. The Dashboard consumes BOTH helpers here so the compact section-card grid and
 * the inline section guards/popups can never drift out of sync with each other.
 *
 * The six management sections each live behind a guard that exactly mirrors how they were gated when
 * they rendered inline:
 *  - Notifications / Glucose Alert Thresholds / Emergency Contacts / Insulin Settings → `showPatientSections`
 *    (`!isChildMode && !caregiverSession`). The inline analytics cards + Glucose Trend share this guard.
 *  - Doctor & Care Team → `showDoctorCareTeam` (`!doctorSession`).
 *  - Access Management → `showAccessManagement` (`(isParent || isAdult)` and not child/caregiver/doctor).
 */
export type DashboardSectionKey =
  | "notifications"
  | "thresholds"
  | "emergency"
  | "insulin"
  | "doctor"
  | "access"
  | "careCircle";

export interface DashboardRoleFlags {
  isChildMode: boolean;
  caregiverSession: boolean;
  doctorSession: boolean;
  isParent: boolean;
  isAdult: boolean;
}

export interface DashboardSectionVisibility {
  /** Notifications, Thresholds, Emergency, Insulin (+ the inline analytics cards and Glucose Trend). */
  showPatientSections: boolean;
  showDoctorCareTeam: boolean;
  showAccessManagement: boolean;
}

export function dashboardSectionVisibility(role: DashboardRoleFlags): DashboardSectionVisibility {
  const showPatientSections = !role.isChildMode && !role.caregiverSession;
  return {
    showPatientSections,
    showDoctorCareTeam: !role.doctorSession,
    showAccessManagement:
      (role.isParent || role.isAdult) && !role.isChildMode && !role.caregiverSession && !role.doctorSession,
  };
}

export interface DashboardSectionDef {
  key: DashboardSectionKey;
  title: string;
}

/** Authoritative grid order: row1 Notifications/Thresholds, row2 Emergency/Insulin, row3 Doctor/Access, row4 Care Circle. */
const ALL_SECTIONS: { key: DashboardSectionKey; title: string; gate: keyof DashboardSectionVisibility }[] = [
  { key: "notifications", title: "Notifications", gate: "showPatientSections" },
  { key: "thresholds", title: "Alert Thresholds", gate: "showPatientSections" },
  { key: "emergency", title: "Emergency Contacts", gate: "showPatientSections" },
  { key: "insulin", title: "Insulin Settings", gate: "showPatientSections" },
  { key: "doctor", title: "Doctor & Care Team", gate: "showDoctorCareTeam" },
  { key: "access", title: "Access Management", gate: "showAccessManagement" },
  { key: "careCircle", title: "Care Circle", gate: "showAccessManagement" },
];

/** The section cards to render for a role, in authoritative order (omitting unavailable sections). */
export function availableDashboardSections(role: DashboardRoleFlags): DashboardSectionDef[] {
  const vis = dashboardSectionVisibility(role);
  return ALL_SECTIONS.filter((s) => vis[s.gate]).map(({ key, title }) => ({ key, title }));
}
