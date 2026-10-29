import { describe, expect, it } from "vitest";
import { HELP_EFFECTS, HELP_PAGE_FOR_PATH, HELP_SCRIPTS } from "./helpScripts";

describe("help walkthrough scripts", () => {
  it("covers every tab page, the Dashboard included", () => {
    expect(Object.keys(HELP_SCRIPTS).sort()).toEqual(["chat", "dashboard", "food", "home", "insulin"]);
    expect(HELP_PAGE_FOR_PATH["/dashboard"]).toBe("dashboard");
  });

  it("explains what recent updates added", () => {
    const all = Object.values(HELP_SCRIPTS).flat().map((s) => s.text).join(" ");
    for (const phrase of ["FreeStyle Libre", "spin", "lab results", "pen or a vial", "meal tips", "photo a parent picks"]) {
      expect(all).toContain(phrase);
    }
    expect(all).not.toMatch(/\u2014/); // no em dashes in app wording
  });

  it("every step is complete and ids are globally unique", () => {
    const ids = new Set<string>();
    for (const [page, steps] of Object.entries(HELP_SCRIPTS)) {
      expect(steps.length).toBeGreaterThanOrEqual(4);
      for (const s of steps) {
        expect(s.id.startsWith(`${page}.`)).toBe(true);
        expect(s.anchor.length).toBeGreaterThan(0);
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.text.length).toBeGreaterThan(20);
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
      }
    }
  });

  it("only known effects are used", () => {
    for (const steps of Object.values(HELP_SCRIPTS))
      for (const s of steps) for (const e of s.effects ?? []) expect(HELP_EFFECTS).toContain(e);
  });

  it("the insulin Log-tab steps all carry the tab effect, and Dose steps never do", () => {
    for (const s of HELP_SCRIPTS.insulin) {
      const isLog = s.id.startsWith("insulin.log.");
      expect((s.effects ?? []).includes("insulin.logTab")).toBe(isLog);
    }
  });
});
