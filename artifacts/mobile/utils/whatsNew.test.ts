import { describe, expect, it } from "vitest";
import { RELEASE_NOTES } from "../constants/releaseNotes";
import { formatNoteDate, whatsNewAction } from "./whatsNew";

const notes = [
  { id: "2026-11-02", date: "2026-11-02" },
  { id: "2026-10-19", date: "2026-10-19" },
];

describe("whatsNewAction", () => {
  it("shows the newest note to a device that saw an older one", () => {
    expect(whatsNewAction(notes, "2026-10-19", true)).toBe("show");
    expect(whatsNewAction(notes, "2026-10-19", false)).toBe("show");
  });
  it("does nothing once the newest note was seen", () => {
    expect(whatsNewAction(notes, "2026-11-02", true)).toBe("none");
  });
  it("existing users updating into the feature see it; brand-new installs are recorded silently", () => {
    expect(whatsNewAction(notes, null, true)).toBe("show");
    expect(whatsNewAction(notes, null, false)).toBe("markSeen");
  });
  it("never shows old notes after a rollback", () => {
    expect(whatsNewAction(notes, "2026-12-01", true)).toBe("none");
  });
  it("no notes, nothing to do", () => {
    expect(whatsNewAction([], null, true)).toBe("none");
  });
});

describe("formatNoteDate", () => {
  const now = new Date(2026, 9, 19);
  it("short date this year, with year otherwise", () => {
    expect(formatNoteDate("2026-10-19", now)).toBe("Oct 19");
    expect(formatNoteDate("2025-01-05", now)).toBe("Jan 5, 2025");
  });
  it("leaves unexpected text alone", () => {
    expect(formatNoteDate("soon", now)).toBe("soon");
  });
});

describe("RELEASE_NOTES", () => {
  it("ids are unique, dates valid, newest first, every entry has items", () => {
    const ids = RELEASE_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of RELEASE_NOTES) {
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.items.length).toBeGreaterThan(0);
    }
    const dates = RELEASE_NOTES.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
