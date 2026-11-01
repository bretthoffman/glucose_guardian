import { describe, expect, it } from "vitest";
import { dashboardSectionVisibility } from "./dashboardSections";
import { availableShortcuts, cleanIds, moveShortcut, resolveShortcuts, type ShortcutAccess } from "./shortcuts";

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
  it("a guardian can add every shortcut", () => {
    expect(ids(availableShortcuts(guardian))).toEqual([
      "addEntry", "logs", "dose", "food", "messages", "chatHistory", "doctor", "doctorCode", "handoff",
      "careCircle", "a1c", "insulinSettings", "notifications", "emergency", "settings", "help",
    ]);
  });

  it("the school nurse only gets what her code allows", () => {
    const nurse: ShortcutAccess = {
      ...guardian,
      canUseCalculator: false,
      dashboard: dashboardSectionVisibility({ ...parent, caregiverSession: true, isChildMode: true }),
    };
    expect(ids(availableShortcuts(nurse))).toEqual(["addEntry", "logs", "food", "messages", "chatHistory", "notifications", "settings", "help"]);
    // Without the chat grant: no Messages or chat history.
    expect(ids(availableShortcuts({ ...nurse, canChat: false }))).toEqual(["addEntry", "logs", "food", "notifications", "settings", "help"]);
    // Without the log grant: no Add Entry or Logs.
    expect(ids(availableShortcuts({ ...nurse, canOpenLogs: false }))).not.toContain("addEntry");
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
