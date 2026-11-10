import { describe, expect, it } from "vitest";
import { cleanPlan, planIsEmpty, planSteps, recapSendAt, recapWindow } from "./carePlanLogic";

describe("care plan text", () => {
  it("trims, caps and keeps a sensible recheck time", () => {
    const p = cleanPlan({ low: "  Give juice  ", high: "x".repeat(1200), supplies: "", notes: "\r\nPE Tuesdays", recheckMinutes: 15.4 });
    expect(p).toEqual({ low: "Give juice", high: "x".repeat(1000), supplies: "", notes: "PE Tuesdays", recheckMinutes: 15 });
    expect(cleanPlan({ low: "", high: "", supplies: "", notes: "", recheckMinutes: 2 }).recheckMinutes).toBeUndefined();
    expect(cleanPlan({ low: "", high: "", supplies: "", notes: "", recheckMinutes: 90 }).recheckMinutes).toBeUndefined();
    expect(planIsEmpty({ low: " ", high: "", supplies: "", notes: "" })).toBe(true);
  });

  it("splits what the family wrote into steps, dropping their own numbering", () => {
    expect(planSteps("1. Give 15g fast sugar\n2) Recheck in 15 minutes\n\n- Repeat if under 70")).toEqual([
      "Give 15g fast sugar",
      "Recheck in 15 minutes",
      "Repeat if under 70",
    ]);
    expect(planSteps("Water and a bathroom pass.")).toEqual(["Water and a bathroom pass."]);
  });
});

describe("recap window", () => {
  // Nov 9 2026, 1:00 PM in New York (UTC-5) = 18:00 UTC.
  const now = Date.UTC(2026, 10, 9, 18, 0);
  const ny = -300;

  it("uses the code's school hours, on the clock of whoever set them", () => {
    const w = recapWindow({ mode: "weekly", days: [1, 2, 3, 4, 5], startMinute: 7 * 60 + 45, endMinute: 14 * 60 + 50, tzOffsetMinutes: ny }, now, 0);
    expect(w.startMs).toBe(Date.UTC(2026, 10, 9, 12, 45));
    expect(w.endMs).toBe(Date.UTC(2026, 10, 9, 19, 50));
  });

  it("without school hours: 8:00 AM to 3:00 PM on the caregiver's phone", () => {
    const w = recapWindow({ mode: "always" }, now, ny);
    expect(w.startMs).toBe(Date.UTC(2026, 10, 9, 13, 0));
    expect(w.endMs).toBe(Date.UTC(2026, 10, 9, 20, 0));
  });

  it("late at night in New York is still the same local day", () => {
    const late = Date.UTC(2026, 10, 10, 3, 30); // 10:30 PM Nov 9 in New York
    expect(recapWindow({ mode: "always" }, late, ny).endMs).toBe(Date.UTC(2026, 10, 9, 20, 0));
  });

  it("goes out now when asked or when the hours already ended, otherwise at the end", () => {
    expect(recapSendAt({ endMs: now + 3_600_000 }, now, false)).toBe(now + 3_600_000);
    expect(recapSendAt({ endMs: now + 3_600_000 }, now, true)).toBe(now);
    expect(recapSendAt({ endMs: now - 1 }, now, false)).toBe(now);
  });
});
