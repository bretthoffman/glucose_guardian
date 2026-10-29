import { describe, expect, it } from "vitest";
import { buildCareNow, type CareHelper } from "./careNow";

// Thu Oct 29 2026, 10:00 AM in New York (UTC-4).
const NOW = Date.UTC(2026, 9, 29, 14, 0);
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ET = -240;
const schoolNurse: CareHelper = {
  name: "Holly (school nurse)",
  kind: "caregiver",
  access: { mode: "weekly", days: [1, 2, 3, 4, 5], startMinute: 6 * 60, endMinute: 14 * 60 + 30, tzOffsetMinutes: ET },
};
const brian = { userId: "u_brian" };

describe("who's with the child right now", () => {
  it("goes by whoever logged most recently", () => {
    const c = buildCareNow({
      logs: [
        { timestamp: ago(200), what: "a meal", authorName: "Brian", authorUserId: "u_brian" },
        { timestamp: ago(25), what: "insulin", authorName: "Holly (school nurse)", authorCode: "HOLLY001" },
      ],
      helpers: [schoolNurse],
      me: brian,
      nowMs: NOW,
    });
    expect(c.lastLog).toEqual({ by: "Holly (school nurse)", byYou: false, minutesAgo: 25, what: "insulin" });
  });

  it("knows when the person chatting made the last log (account or code)", () => {
    expect(
      buildCareNow({ logs: [{ timestamp: ago(5), what: "a meal", authorUserId: "u_brian", authorName: "Brian" }], helpers: [], me: brian, nowMs: NOW }).lastLog?.byYou,
    ).toBe(true);
    expect(
      buildCareNow({ logs: [{ timestamp: ago(5), what: "a meal", authorCode: "grandma1", authorName: "Grandma" }], helpers: [], me: { code: "GRANDMA1" }, nowMs: NOW }).lastLog?.byYou,
    ).toBe(true);
  });

  it("ignores logs older than 12 hours and future-dated ones", () => {
    const c = buildCareNow({
      logs: [
        { timestamp: ago(13 * 60), what: "a meal", authorName: "Grandma" },
        { timestamp: ago(-60), what: "a meal", authorName: "Typo" },
      ],
      helpers: [],
      me: brian,
      nowMs: NOW,
    });
    expect(c.lastLog).toBeUndefined();
  });

  it("lists helpers whose schedule is open now, with when it ends", () => {
    expect(buildCareNow({ logs: [], helpers: [schoolNurse], me: brian, nowMs: NOW }).scheduledNow).toEqual([
      { name: "Holly (school nurse)", until: "2:30 PM" },
    ]);
    // 4 PM: school's out.
    expect(buildCareNow({ logs: [], helpers: [schoolNurse], me: brian, nowMs: NOW + 6 * 3_600_000 }).scheduledNow).toEqual([]);
    // Saturday: no school.
    expect(buildCareNow({ logs: [], helpers: [schoolNurse], me: brian, nowMs: NOW + 2 * 86_400_000 }).scheduledNow).toEqual([]);
  });

  it("leaves out always-on codes and the child's own phone", () => {
    const helpers: CareHelper[] = [
      { name: "Grandma", access: { mode: "always" } },
      { name: "Bella's phone", kind: "child", access: { mode: "weekly", days: [4], startMinute: 0, endMinute: 1439, tzOffsetMinutes: ET } },
    ];
    expect(buildCareNow({ logs: [], helpers, me: brian, nowMs: NOW }).scheduledNow).toEqual([]);
  });
});
