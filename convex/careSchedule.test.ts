import { describe, expect, it } from "vitest";
import { careAccessAllowed, evaluateCareAccess } from "./careSchedule";

// Wednesday 2026-07-15 12:00:00 UTC.
const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const HOUR = 3_600_000;

describe("evaluateCareAccess — always / disabled", () => {
  it("always is ok; disabled is blocked", () => {
    expect(evaluateCareAccess({ mode: "always" }, NOW).state).toBe("ok");
    expect(evaluateCareAccess({ mode: "disabled" }, NOW).state).toBe("disabled");
  });
});

describe("evaluateCareAccess — one-time window", () => {
  const access = { mode: "window", startMs: NOW + HOUR, endMs: NOW + 3 * HOUR } as const;

  it("is blocked before, open during, and inert after the window", () => {
    const before = evaluateCareAccess(access, NOW);
    expect(before.state).toBe("before_window");
    expect(before.nextStartMs).toBe(NOW + HOUR);
    expect(evaluateCareAccess(access, NOW + 2 * HOUR).state).toBe("ok");
    expect(evaluateCareAccess(access, NOW + 4 * HOUR).state).toBe("outside_window");
  });
});

describe("evaluateCareAccess — weekly schedule (school hours)", () => {
  // Mon–Fri 8:00–15:30 in UTC-0 for test simplicity.
  const school = {
    mode: "weekly",
    days: [1, 2, 3, 4, 5],
    startMinute: 8 * 60,
    endMinute: 15 * 60 + 30,
    tzOffsetMinutes: 0,
  } as const;

  it("is open during school hours on a school day", () => {
    expect(careAccessAllowed(school, NOW)).toBe(true); // Wed 12:00
  });

  it("closes outside hours and reports the next opening", () => {
    const evening = Date.UTC(2026, 6, 15, 18, 0, 0); // Wed 18:00
    const evaluation = evaluateCareAccess(school, evening);
    expect(evaluation.state).toBe("outside_window");
    expect(evaluation.nextStartMs).toBe(Date.UTC(2026, 6, 16, 8, 0, 0)); // Thu 8:00
  });

  it("closes on weekends and reopens Monday", () => {
    const saturdayNoon = Date.UTC(2026, 6, 18, 12, 0, 0);
    const evaluation = evaluateCareAccess(school, saturdayNoon);
    expect(evaluation.state).toBe("outside_window");
    expect(evaluation.nextStartMs).toBe(Date.UTC(2026, 6, 20, 8, 0, 0)); // Mon 8:00
  });

  it("reports today's later window before it opens", () => {
    const earlyMorning = Date.UTC(2026, 6, 15, 6, 0, 0); // Wed 6:00
    const evaluation = evaluateCareAccess(school, earlyMorning);
    expect(evaluation.state).toBe("outside_window");
    expect(evaluation.nextStartMs).toBe(Date.UTC(2026, 6, 15, 8, 0, 0));
  });

  it("respects the setter's timezone offset", () => {
    // Same schedule set from UTC-7 (e.g. Pacific): 8:00 local = 15:00 UTC.
    const pacific = { ...school, tzOffsetMinutes: -7 * 60 };
    expect(careAccessAllowed(pacific, Date.UTC(2026, 6, 15, 14, 0, 0))).toBe(false); // 7:00 local
    expect(careAccessAllowed(pacific, Date.UTC(2026, 6, 15, 16, 0, 0))).toBe(true); // 9:00 local
  });

  it("treats an empty day list as disabled", () => {
    expect(evaluateCareAccess({ ...school, days: [] }, NOW).state).toBe("disabled");
  });
});
