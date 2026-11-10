/**
 * Glucose-screen shortcuts (pure, unit-tested). Each person picks buttons on Dashboard → Shortcuts;
 * they show under the reading on the Glucose screen and jump straight to that screen.
 *
 * Only shortcuts this person may use are offered or shown: the Dashboard ones follow the same gates as
 * the Dashboard rows (utils/dashboardSections), Logs follows the log grant, and so on. Nobody gets a
 * shortcut they didn't add: someone who has never set any sees none, and the Glucose screen looks as
 * it did (minus the old corner "Logs" button, removed for everyone; Logs lives on the Insulin tab).
 */
import type { DashboardSectionKey, DashboardSectionVisibility } from "./dashboardSections";

export type ShortcutIcon =
  | "list"
  | "droplet"
  | "camera"
  | "message-circle"
  | "clock"
  | "activity"
  | "key"
  | "repeat"
  | "share-2"
  | "bar-chart-2"
  | "settings"
  | "bell"
  | "users"
  | "plus-circle"
  | "user"
  | "help-circle"
  // MaterialCommunityIcons (Feather has no needle or blood drop); see shortcutIconFamily.
  | "needle"
  | "water-plus-outline";

const MCI_ICONS: ShortcutIcon[] = ["needle", "water-plus-outline"];
/** Which icon set draws this icon. */
export function shortcutIconFamily(icon: ShortcutIcon): "feather" | "mci" {
  return MCI_ICONS.includes(icon) ? "mci" : "feather";
}

export type ShortcutTarget =
  /** add: open the Log page for today with the Add menu open, or straight into one of its pop-ups. */
  | { kind: "insulin"; tab: "log" | "predict"; add?: "menu" | "insulin" | "stick" }
  | { kind: "settings" }
  | { kind: "help" }
  | { kind: "food" }
  | { kind: "chat"; open: "messages" | "history" }
  | { kind: "dashboard"; section: DashboardSectionKey };

export interface ShortcutDef {
  id: string;
  title: string;
  icon: ShortcutIcon;
  color: string;
  target: ShortcutTarget;
}

export const MAX_SHORTCUTS = 8;

/** Dashboard pop-ups that open right over the Glucose screen (components/ShortcutPanelSheets); the
 * rest still switch to the Dashboard and open there. */
export const OVER_GLUCOSE_SECTIONS = ["summary", "doctor", "careCircle", "handoff"] as const;
export type OverGlucoseSection = (typeof OVER_GLUCOSE_SECTIONS)[number];
export function overGlucoseSection(def: ShortcutDef): OverGlucoseSection | null {
  const t = def.target;
  if (t.kind !== "dashboard") return null;
  return (OVER_GLUCOSE_SECTIONS as readonly string[]).includes(t.section) ? (t.section as OverGlucoseSection) : null;
}
export const DEFAULT_SHORTCUTS: string[] = [];

/** Every shortcut, in the order the Add list shows them. */
export const SHORTCUTS: ShortcutDef[] = [
  { id: "addEntry", title: "Add Entry", icon: "plus-circle", color: "#5CB8FF", target: { kind: "insulin", tab: "log", add: "menu" } },
  { id: "logInsulin", title: "Log Insulin", icon: "needle", color: "#5CB8FF", target: { kind: "insulin", tab: "log", add: "insulin" } },
  { id: "fingerStick", title: "Finger Stick", icon: "water-plus-outline", color: "#FF8A80", target: { kind: "insulin", tab: "log", add: "stick" } },
  { id: "logs", title: "Logs", icon: "list", color: "#3B9BFF", target: { kind: "insulin", tab: "log" } },
  { id: "dose", title: "Dose Calculator", icon: "droplet", color: "#5CB8FF", target: { kind: "insulin", tab: "predict" } },
  { id: "food", title: "Log a Meal", icon: "camera", color: "#1FD18A", target: { kind: "food" } },
  { id: "messages", title: "Messages", icon: "message-circle", color: "#34D399", target: { kind: "chat", open: "messages" } },
  { id: "chatHistory", title: "Chat History", icon: "clock", color: "#60A5FA", target: { kind: "chat", open: "history" } },
  { id: "doctor", title: "Doctor Office", icon: "activity", color: "#7FA6FF", target: { kind: "dashboard", section: "doctor" } },
  { id: "doctorCode", title: "Doctor Code", icon: "key", color: "#6CC4FF", target: { kind: "dashboard", section: "doctorCode" } },
  { id: "handoff", title: "Handoff", icon: "repeat", color: "#B9A4FF", target: { kind: "dashboard", section: "handoff" } },
  { id: "careCircle", title: "Care Circle", icon: "share-2", color: "#1FD18A", target: { kind: "dashboard", section: "careCircle" } },
  { id: "a1c", title: "A1C", icon: "bar-chart-2", color: "#38BDF8", target: { kind: "dashboard", section: "summary" } },
  { id: "insulinSettings", title: "Insulin Settings", icon: "settings", color: "#2F80FF", target: { kind: "dashboard", section: "insulin" } },
  { id: "notifications", title: "Notifications", icon: "bell", color: "#FF8A80", target: { kind: "dashboard", section: "notifications" } },
  { id: "emergency", title: "Emergency Contacts", icon: "users", color: "#F06292", target: { kind: "dashboard", section: "emergency" } },
  { id: "settings", title: "Settings", icon: "user", color: "#9AA9C0", target: { kind: "settings" } },
  { id: "help", title: "Help", icon: "help-circle", color: "#FBBF24", target: { kind: "help" } },
];

export interface ShortcutAccess {
  doctorSession: boolean;
  /** The Logs page (insulin tab, Log view): own account, or a code with the log grant. */
  canOpenLogs: boolean;
  /** The dose calculator (insulin tab, Dose view). */
  canUseCalculator: boolean;
  /** Assistant chat and Messages (an access code needs the chat grant). */
  canChat: boolean;
  /** Chat history is saved for this person (accounts and access codes; not legacy codes). */
  hasChatHistory: boolean;
  /** The Dashboard rows this person sees. */
  dashboard: DashboardSectionVisibility;
}

const DASHBOARD_GATE: Partial<Record<DashboardSectionKey, keyof DashboardSectionVisibility>> = {
  doctor: "showDoctorCareTeam",
  doctorCode: "showDoctorCareTeam",
  handoff: "showHandoff",
  careCircle: "showAccessManagement",
  summary: "showPatientSections",
  insulin: "showPatientSections",
  notifications: "showNotifications",
  emergency: "showPatientSections",
};

export function canUseShortcut(def: ShortcutDef, a: ShortcutAccess): boolean {
  if (a.doctorSession) return false;
  const t = def.target;
  switch (t.kind) {
    case "insulin":
      return t.tab === "log" ? a.canOpenLogs : a.canUseCalculator;
    case "food":
    case "settings":
    case "help":
      return true;
    case "chat":
      return t.open === "messages" ? a.canChat : a.canChat && a.hasChatHistory;
    case "dashboard": {
      const gate = DASHBOARD_GATE[t.section];
      return !!gate && !!a.dashboard[gate];
    }
  }
}

/** Shortcuts this person may add, in catalog order. */
export function availableShortcuts(a: ShortcutAccess): ShortcutDef[] {
  return SHORTCUTS.filter((s) => canUseShortcut(s, a));
}

/**
 * What shows on the Glucose screen: the saved list in its order (null = never set → none),
 * keeping only shortcuts this person may use right now, at most MAX_SHORTCUTS.
 */
export function resolveShortcuts(saved: string[] | null | undefined, a: ShortcutAccess): ShortcutDef[] {
  const ids = saved ?? DEFAULT_SHORTCUTS;
  const allowed = new Map(availableShortcuts(a).map((s) => [s.id, s]));
  const out: ShortcutDef[] = [];
  for (const id of ids) {
    const s = allowed.get(id);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

/** Known, unique ids, at most MAX_SHORTCUTS, order kept. */
export function cleanIds(ids: string[]): string[] {
  const known = new Set(SHORTCUTS.map((s) => s.id));
  const out: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_SHORTCUTS) break;
  }
  return out;
}

/** Move one id up (-1) or down (+1) in the list. */
export function moveShortcut(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
