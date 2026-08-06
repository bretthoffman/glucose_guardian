import { describe, expect, it } from "vitest";
import { applyPermissionChange, normalizeCarePermissions } from "./carePermissions";

const base = {
  viewReadings: true, viewLogs: true, log: true, useCalculator: true, chat: true,
};

describe("applyPermissionChange — log depends on viewLogs", () => {
  it("turning View logs OFF also turns Add logs off", () => {
    const next = applyPermissionChange(base, "viewLogs", false);
    expect(next.viewLogs).toBe(false);
    expect(next.log).toBe(false);
  });

  it("turning Add logs ON also turns View logs on", () => {
    const next = applyPermissionChange({ ...base, viewLogs: false, log: false }, "log", true);
    expect(next.log).toBe(true);
    expect(next.viewLogs).toBe(true);
  });

  it("View logs can be ON while Add logs stays OFF (read-only is a real grant)", () => {
    const next = applyPermissionChange({ ...base, viewLogs: false, log: false }, "viewLogs", true);
    expect(next.viewLogs).toBe(true);
    expect(next.log).toBe(false);
  });

  it("turning Add logs OFF leaves View logs alone", () => {
    const next = applyPermissionChange(base, "log", false);
    expect(next.log).toBe(false);
    expect(next.viewLogs).toBe(true);
  });

  it("never produces the impossible combination", () => {
    const keys = ["viewReadings", "viewLogs", "log", "useCalculator", "chat"] as const;
    for (const k of keys) {
      for (const on of [true, false]) {
        for (const start of [base, { ...base, viewLogs: false, log: false }, { ...base, log: false }]) {
          const next = applyPermissionChange(start, k, on);
          expect(next.log && !next.viewLogs).toBe(false);
        }
      }
    }
  });

  it("leaves unrelated permissions untouched", () => {
    const next = applyPermissionChange(base, "chat", false);
    expect(next).toEqual({ ...base, chat: false });
  });
});

describe("normalizeCarePermissions", () => {
  it("repairs a legacy grant that has Add logs without View logs", () => {
    expect(normalizeCarePermissions({ ...base, viewLogs: false, log: true }))
      .toEqual({ ...base, viewLogs: false, log: false });
  });

  it("drops log rather than granting viewLogs — never widens what can be SEEN", () => {
    const fixed = normalizeCarePermissions({ ...base, viewLogs: false, log: true });
    expect(fixed.viewLogs).toBe(false);
  });

  it("passes a valid set through unchanged", () => {
    expect(normalizeCarePermissions(base)).toEqual(base);
    const readOnly = { ...base, log: false };
    expect(normalizeCarePermissions(readOnly)).toEqual(readOnly);
  });
});
