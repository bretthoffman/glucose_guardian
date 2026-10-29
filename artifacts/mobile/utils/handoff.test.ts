import { describe, expect, it } from "vitest";
import { buildHandoffSummary, firstName, shouldShowHandoff, type HandoffLog } from "./handoff";

// Local times so the greeting doesn't depend on the test machine's zone.
const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (ms: number) => {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
};

const readings = [
  { glucose: 88, timestamp: iso(at(3, 50)) },
  { glucose: 64, timestamp: iso(at(4, 10)) },
  { glucose: 72, timestamp: iso(at(4, 25)) },
  { glucose: 93, timestamp: iso(at(4, 40)) },
  { glucose: 132, timestamp: iso(at(8, 0)) },
];
const logs: HandoffLog[] = [
  { timestamp: iso(at(7, 5)), kind: "meal", title: "Waffles · 45g carbs", authorName: "Brian", byYou: false },
  { timestamp: iso(at(7, 10)), kind: "insulin", title: "Humalog 3 units", authorName: "Brian", byYou: false },
];

describe("handoff sheet contents", () => {
  it("greets the school nurse with the child's morning, newest first, and the overnight low", () => {
    const s = buildHandoffSummary({
      kind: "caregiver", viewerName: "Holly (school nurse)", childName: "Bella", nowMs: at(8, 5),
      readings, logs, current: { glucose: 132, trend: "Steady" }, iob: { units: 1.83, remainingMin: 155 }, fmtTime: fmt,
    });
    expect(s.heading).toBe("Good morning, Holly. Here's Bella's morning.");
    expect(s.items.map((i) => i.title)).toEqual(["Humalog 3 units", "Waffles · 45g carbs", "Low, 64"]);
    expect(s.items[0]!.sub).toBe("7:10 AM · Brian");
    expect(s.items[2]!.sub).toBe("4:10 AM · back to 93 by 4:40 AM");
    expect(s.active).toEqual({ units: 1.8, wearsOffAt: at(8, 5) + 155 * 60_000 });
    expect(s.now).toEqual({ glucose: 132, trend: "Steady" });
  });

  it("for a parent back from work: only what others logged since they last looked, plus highs and time in range", () => {
    const afternoon = [
      ...[150, 190, 214, 262, 230, 175, 160, 140].map((g, i) => ({ glucose: g, timestamp: iso(at(12, 0) + i * 20 * 60_000) })),
    ];
    const s = buildHandoffSummary({
      kind: "family", viewerName: "Brian", childName: "Bella", nowMs: at(15, 10), sinceMs: at(7, 20),
      readings: afternoon,
      logs: [
        { timestamp: iso(at(11, 40)), kind: "meal", title: "Lunch · 38g carbs", authorName: "Holly (school nurse)", byYou: false },
        { timestamp: iso(at(7, 10)), kind: "insulin", title: "Humalog 3 units", authorName: "Brian", byYou: true },
      ],
      fmtTime: fmt,
    });
    expect(s.heading).toBe("While you were away");
    expect(s.timeLabel).toBe("3:10 PM");
    expect(s.sinceLine).toBe("Since you last opened the app at 7:20 AM");
    expect(s.items.map((i) => i.title)).toEqual(["Lunch · 38g carbs", "Highest 262"]);
    expect(s.items[0]!.sub).toBe("11:40 AM · Holly");
    expect(s.items[1]!.sub).toBe("1:00 PM · back under 180 by 1:40 PM");
    expect(s.inRangePct).toBe(50);
  });

  it("leaves out insulin that has worn off, and keeps names short", () => {
    const s = buildHandoffSummary({ kind: "caregiver", viewerName: "Grandma", childName: "Bella", nowMs: at(18, 0), readings: [], logs: [], iob: { units: 0.01, remainingMin: 2 }, fmtTime: fmt });
    expect(s.active).toBeNull();
    expect(s.heading).toBe("Good evening, Grandma. Here's Bella's evening.");
    expect(firstName("Andrea (backup nurse)")).toBe("Andrea");
  });
});

describe("when the sheet pops up", () => {
  const base = { nowMs: at(8, 5), todayKey: "2026-10-29", lastShownDay: null, lastShownMs: null, lastOpenMs: null, othersLoggedSinceLastOpen: false, hasContent: true, noteCreatedAt: null };

  it("a caregiver sees it once a day, and again only for a newer note", () => {
    expect(shouldShowHandoff({ ...base, kind: "caregiver" })).toBe(true);
    expect(shouldShowHandoff({ ...base, kind: "caregiver", lastShownDay: "2026-10-29", lastShownMs: at(8, 5) })).toBe(false);
    expect(shouldShowHandoff({ ...base, kind: "caregiver", lastShownDay: "2026-10-29", lastShownMs: at(8, 5), noteCreatedAt: at(9, 0) })).toBe(true);
    expect(shouldShowHandoff({ ...base, kind: "caregiver", hasContent: false })).toBe(false);
  });

  it("a parent sees it after being away 90+ minutes while someone else logged", () => {
    const fam = { ...base, kind: "family" as const, nowMs: at(15, 10) };
    expect(shouldShowHandoff({ ...fam, lastOpenMs: at(7, 20), othersLoggedSinceLastOpen: true })).toBe(true);
    expect(shouldShowHandoff({ ...fam, lastOpenMs: at(14, 30), othersLoggedSinceLastOpen: true })).toBe(false);
    expect(shouldShowHandoff({ ...fam, lastOpenMs: at(7, 20), othersLoggedSinceLastOpen: false })).toBe(false);
    expect(shouldShowHandoff({ ...fam, lastOpenMs: null, othersLoggedSinceLastOpen: true })).toBe(false);
    expect(shouldShowHandoff({ ...fam, lastOpenMs: at(14, 30), noteCreatedAt: at(14, 50) })).toBe(true);
  });
});
