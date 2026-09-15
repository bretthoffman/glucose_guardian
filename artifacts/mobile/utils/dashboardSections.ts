/**
 * Pure role → Dashboard-section visibility logic. No React/React Native imports so it is unit-testable
 * in the root vitest run. The Dashboard consumes the helpers here so the grouped settings list and the
 * section popups' guards can never drift out of sync with each other.
 *
 * Every row below used to be either a card in a 2-column grid or an inline card further down the
 * page. They are now ROWS in titled groups (the grouped-list layout), and each row opens the very
 * same content it always did — the gates are unchanged, only the surface is:
 *  - Notifications / Glucose Alert Thresholds / Emergency Contacts / Insulin Settings / Glucose Summary
 *    → `showPatientSections` (`!isChildMode && !caregiverSession`). Notifications alone is wider — see
 *    `showNotifications`.
 *  - Activity Log → `showActivityLog`: the old inline card's exact condition — there are entries, and
 *    this is not guardian-device child mode.
 *  - Download Patient Logs → `showDownloadLogs`: the doctor's own session only (was an inline card).
 *  - Doctor Office + Doctor Code (one popup, now split in two) → `showDoctorCareTeam`
 *    (`!doctorSession && !isChildMode && !caregiverSession`; owner-only — hidden for the doctor's own
 *    session and any access-code / child-view session).
 *  - Care Circle → `showAccessManagement` (owner-only: `(isParent || isAdult)` and not child/caregiver/doctor).
 *  - Child View Mode → `showChildView`: the union of the two old inline cards ("Enable" when off,
 *    "Turn Off" when on), now one row with a switch.
 */
export type DashboardSectionKey =
  | "summary"
  | "activity"
  | "insulin"
  | "downloadLogs"
  | "notifications"
  | "thresholds"
  | "emergency"
  | "doctor"
  | "doctorCode"
  | "careCircle"
  | "childView";

export interface DashboardRoleFlags {
  isChildMode: boolean;
  caregiverSession: boolean;
  doctorSession: boolean;
  isParent: boolean;
  isAdult: boolean;
  /** A Caregiver (nurse) email account viewing a child — hides Doctor Office + Care Circle. */
  caregiverViewingChild?: boolean;
  /** Any food or insulin entries at all — the Activity Log row only exists when there is a log. */
  hasLogEntries?: boolean;
}

export interface DashboardSectionVisibility {
  /** Glucose Summary, Thresholds, Emergency, Insulin. */
  showPatientSections: boolean;
  /**
   * Notifications alone is ALSO available to kid/caregiver ACCESS-CODE sessions: every device sets
   * its own alert preferences (glucose alerts + per-device push toggles) — only the Emergency Text
   * Alerts toggle inside renders locked to the owner's setting. Hidden only in guardian-device
   * child mode.
   *
   * NOTE the subtlety this got wrong once: `isChildMode` is true for EVERY access-code session
   * (it's `childModeEnabled || caregiverSession`), so a bare `!isChildMode` hid this section from
   * exactly the sessions it is meant to include. It must key off guardian-device child mode only.
   */
  showNotifications: boolean;
  showDoctorCareTeam: boolean;
  showAccessManagement: boolean;
  /** The Activity Log (Manage Logs) row: entries exist and this is not guardian-device child mode. */
  showActivityLog: boolean;
  /** Download Patient Logs: the doctor's own session. */
  showDownloadLogs: boolean;
  /**
   * Child View Mode switch. Off → only a parent account outside any code session, and not a nurse
   * viewing a child (they never could enable it). On → shown to that same parent so it can be turned
   * off again while everything else is hidden.
   */
  showChildView: boolean;
}

export function dashboardSectionVisibility(role: DashboardRoleFlags): DashboardSectionVisibility {
  const showPatientSections = !role.isChildMode && !role.caregiverSession;
  const viewingChild = !!role.caregiverViewingChild;
  const guardianDeviceChildMode = role.isChildMode && !role.caregiverSession;
  return {
    // Thresholds / Insulin / Emergency still SHOW for a nurse viewing a child (read-only inherited).
    showPatientSections,
    // Guardian-device child mode hides it; access-code sessions (kid AND caregiver codes) keep it,
    // because each device owns its own alert prefs.
    showNotifications: !guardianDeviceChildMode,
    // Doctor & Care Team (incl. "Share Report with Doctor") is an owner-only section — hidden for the
    // doctor's own session, any access-code / child-view session, and a nurse viewing a child.
    showDoctorCareTeam: !role.doctorSession && !role.isChildMode && !role.caregiverSession && !viewingChild,
    showAccessManagement:
      (role.isParent || role.isAdult) && !role.isChildMode && !role.caregiverSession && !role.doctorSession && !viewingChild,
    showActivityLog: !!role.hasLogEntries && !guardianDeviceChildMode,
    showDownloadLogs: role.doctorSession,
    showChildView: role.isParent && !role.caregiverSession && (role.isChildMode || !viewingChild),
  };
}

export interface DashboardSectionDef {
  key: DashboardSectionKey;
  title: string;
}

export interface DashboardGroupDef {
  title: string;
  rows: DashboardSectionDef[];
}

type Entry = { key: DashboardSectionKey; title: string; gate: keyof DashboardSectionVisibility };

/** Authoritative order: groups top to bottom, rows top to bottom within each. */
const GROUPS: { title: string; rows: Entry[] }[] = [
  {
    title: "Glucose & Dosing",
    rows: [
      { key: "insulin", title: "Insulin Settings", gate: "showPatientSections" },
      { key: "activity", title: "Activity Log", gate: "showActivityLog" },
      { key: "summary", title: "A1C", gate: "showPatientSections" },
      { key: "downloadLogs", title: "Download Patient Logs", gate: "showDownloadLogs" },
    ],
  },
  {
    title: "Alerts & Notifications",
    rows: [
      { key: "notifications", title: "Notifications", gate: "showNotifications" },
      { key: "thresholds", title: "Alert Thresholds", gate: "showPatientSections" },
      { key: "emergency", title: "Emergency Contacts", gate: "showPatientSections" },
    ],
  },
  {
    title: "Care Team",
    rows: [
      { key: "careCircle", title: "Care Circle", gate: "showAccessManagement" },
      { key: "doctor", title: "Doctor Office", gate: "showDoctorCareTeam" },
      { key: "doctorCode", title: "Doctor Code", gate: "showDoctorCareTeam" },
    ],
  },
  {
    title: "Child Safety",
    rows: [{ key: "childView", title: "Child View Mode", gate: "showChildView" }],
  },
];

/** The groups to render for a role, in authoritative order; groups with no visible row are dropped. */
export function dashboardGroups(role: DashboardRoleFlags): DashboardGroupDef[] {
  const vis = dashboardSectionVisibility(role);
  return GROUPS.map((g) => ({
    title: g.title,
    rows: g.rows.filter((r) => vis[r.gate]).map(({ key, title }) => ({ key, title })),
  })).filter((g) => g.rows.length > 0);
}

/** Every visible row for a role as one flat list, in on-screen order. */
export function availableDashboardSections(role: DashboardRoleFlags): DashboardSectionDef[] {
  return dashboardGroups(role).flatMap((g) => g.rows);
}
