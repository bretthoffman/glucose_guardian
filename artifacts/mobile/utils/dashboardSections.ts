/**
 * Pure role → Dashboard-section visibility logic. No React/React Native imports so it is unit-testable
 * in the root vitest run. The Dashboard consumes BOTH helpers here so the compact section-card grid and
 * the inline section guards/popups can never drift out of sync with each other.
 *
 * The management sections each live behind a guard that exactly mirrors how they were gated when
 * they rendered inline:
 *  - Notifications / Glucose Alert Thresholds / Emergency Contacts / Insulin Settings → `showPatientSections`
 *    (`!isChildMode && !caregiverSession`). The inline analytics cards + Glucose Trend share this guard.
 *  - Doctor Office (doctor info + report + doctor code + access log) → `showDoctorCareTeam`
 *    (`!doctorSession && !isChildMode && !caregiverSession`; owner-only — hidden for the doctor's own
 *    session and any access-code / child-view session).
 *  - Care Circle → `showAccessManagement` (owner-only: `(isParent || isAdult)` and not child/caregiver/doctor).
 */
export type DashboardSectionKey =
  | "notifications"
  | "thresholds"
  | "emergency"
  | "insulin"
  | "doctor"
  | "careCircle";

export interface DashboardRoleFlags {
  isChildMode: boolean;
  caregiverSession: boolean;
  doctorSession: boolean;
  isParent: boolean;
  isAdult: boolean;
  /** A Caregiver (nurse) email account viewing a child — hides Doctor Office + Care Circle. */
  caregiverViewingChild?: boolean;
}

export interface DashboardSectionVisibility {
  /** Notifications, Thresholds, Emergency, Insulin (+ the inline analytics cards and Glucose Trend). */
  showPatientSections: boolean;
  showDoctorCareTeam: boolean;
  showAccessManagement: boolean;
}

export function dashboardSectionVisibility(role: DashboardRoleFlags): DashboardSectionVisibility {
  const showPatientSections = !role.isChildMode && !role.caregiverSession;
  const viewingChild = !!role.caregiverViewingChild;
  return {
    // Thresholds / Insulin / Emergency still SHOW for a nurse viewing a child (read-only inherited).
    showPatientSections,
    // Doctor & Care Team (incl. "Share Report with Doctor") is an owner-only section — hidden for the
    // doctor's own session, any access-code / child-view session, and a nurse viewing a child.
    showDoctorCareTeam: !role.doctorSession && !role.isChildMode && !role.caregiverSession && !viewingChild,
    showAccessManagement:
      (role.isParent || role.isAdult) && !role.isChildMode && !role.caregiverSession && !role.doctorSession && !viewingChild,
  };
}

export interface DashboardSectionDef {
  key: DashboardSectionKey;
  title: string;
}

/** Authoritative grid order: row1 Notifications/Thresholds, row2 Emergency/Insulin, row3 Doctor Office/Care Circle. */
const ALL_SECTIONS: { key: DashboardSectionKey; title: string; gate: keyof DashboardSectionVisibility }[] = [
  { key: "notifications", title: "Notifications", gate: "showPatientSections" },
  { key: "thresholds", title: "Alert Thresholds", gate: "showPatientSections" },
  { key: "emergency", title: "Emergency Contacts", gate: "showPatientSections" },
  { key: "insulin", title: "Insulin Settings", gate: "showPatientSections" },
  { key: "doctor", title: "Doctor Office", gate: "showDoctorCareTeam" },
  { key: "careCircle", title: "Care Circle", gate: "showAccessManagement" },
];

/** The section cards to render for a role, in authoritative order (omitting unavailable sections). */
export function availableDashboardSections(role: DashboardRoleFlags): DashboardSectionDef[] {
  const vis = dashboardSectionVisibility(role);
  return ALL_SECTIONS.filter((s) => vis[s.gate]).map(({ key, title }) => ({ key, title }));
}
