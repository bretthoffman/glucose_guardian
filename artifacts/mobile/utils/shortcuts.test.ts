import { describe, expect, it } from "vitest";
import { dashboardSectionVisibility } from "./dashboardSections";
import { SHORTCUTS, availableShortcuts, cleanIds, moveShortcut, overGlucoseSection, resolveShortcuts, shortcutIconFamily, type ShortcutAccess } from "./shortcuts";

const parent = { isChildMode: false, caregiverSession: false, doctorSession: false, isParent: true, isAdult: false };
const guardian: ShortcutAccess = {
  doctorSession: false,
  canOpenLogs: true,
  canUseCalculator: true,
  canChat: true,
  hasChatHistory: true,
  dashboard: dashboardSectionVisibility(parent),
};
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("shortcuts", () => {
  it("Log Insulin and Finger Stick go straight to their pop-ups; Add Entry opens the menu", () => {
    const t = (id: string) => SHORTCUTS.find((s) => s.id === id)!.target;
    expect(t("addEntry")).toEqual({ kind: "insulin", tab: "log", add: "menu" });
    expect(t("logInsulin")).toEqual({ kind: "insulin", tab: "log", add: "insulin" });
    expect(t("fingerStick")).toEqual({ kind: "insulin", tab: "log", add: "stick" });
    expect(shortcutIconFamily("needle")).toBe("mci");
    expect(shortcutIconFamily("list")).toBe("feather");
  });

  it("A1C, Doctor Office, Care Circle, Handoff, Care Plan and Day Recap open over the Glucose screen", () => {
    const over = SHORTCUTS.filter((s) => overGlucoseSection(s)).map((s) => s.id);
    expect(over).toEqual(["sensor", "carePlan", "dayRecap", "doctor", "handoff", "careCircle", "a1c"]);
  });

  it("a guardian can add every shortcut", () => {
    expect(ids(availableShortcuts(guardian))).toEqual([
      "addEntry", "logInsulin", "fingerStick", "treatedLow", "sensor", "carePlan", "logs", "dose", "food", "messages", "chatHistory", "doctor", "doctorCode", "handoff",
      "careCircle", "a1c", "insulinSettings", "notifications", "emergency", "settings", "help",
    ]);
  });

  it("the school nurse only gets what her code allows", () => {
    const nurse: ShortcutAccess = {
      ...guardian,
      canUseCalculator: false,
      dashboard: dashboardSectionVisibility({ ...parent, caregiverSession: true, isChildMode: true, careCode: true }),
    };
    expect(ids(availableShortcuts(nurse))).toEqual([
      "addEntry", "logInsulin", "fingerStick", "treatedLow", "sensor", "carePlan", "dayRecap", "logs", "food", "messages", "chatHistory", "notifications", "settings", "help",
    ]);
    // Without the chat grant: no Messages or chat history.
    expect(ids(availableShortcuts({ ...nurse, canChat: false }))).toEqual([
      "addEntry", "logInsulin", "fingerStick", "treatedLow", "sensor", "carePlan", "dayRecap", "logs", "food", "notifications", "settings", "help",
    ]);
    // Without the log grant: none of the logging shortcuts.
    const noLog = ids(availableShortcuts({ ...nurse, canOpenLogs: false }));
    for (const id of ["addEntry", "logInsulin", "fingerStick", "treatedLow", "logs"]) expect(noLog).not.toContain(id);
  });

  it("a personal account has no Handoff; the doctor gets none at all", () => {
    const adult = { ...guardian, dashboard: dashboardSectionVisibility({ ...parent, isParent: false, isAdult: true }) };
    expect(ids(availableShortcuts(adult))).not.toContain("handoff");
    expect(availableShortcuts({ ...guardian, doctorSession: true })).toEqual([]);
  });

  it("nobody gets a shortcut they didn't add", () => {
    expect(ids(resolveShortcuts(null, guardian))).toEqual([]);
    expect(ids(resolveShortcuts([], guardian))).toEqual([]);
  });

  it("keeps the saved order, drops ones this person can't use, and caps at 8", () => {
    expect(ids(resolveShortcuts(["doctor", "nope", "logs", "doctor"], guardian))).toEqual(["doctor", "logs"]);
    expect(ids(resolveShortcuts(["logs", "doctor"], { ...guardian, canOpenLogs: false }))).toEqual(["doctor"]);
    const all = ids(availableShortcuts(guardian));
    expect(resolveShortcuts(all, guardian).length).toBe(8);
  });

  it("cleans a saved list: unknown and repeated ids go", () => {
    expect(cleanIds(["logs", "logs", "made-up", "doctor"])).toEqual(["logs", "doctor"]);
  });

  it("moves a shortcut up or down", () => {
    expect(moveShortcut(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveShortcut(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });
});
