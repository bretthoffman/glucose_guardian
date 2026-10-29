import { describe, expect, it } from "vitest";
import { buildCareNowSection, buildLiveCgmSection, buildSystemPrompt, dayPart, localTimeOfDay } from "./chat";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** The 4am situation from the screenshots: treated a low, now 77 and steady. */
const ctx = {
  childName: "Bella",
  parentName: "Brian",
  accountRole: "parent" as const,
  speaker: { kind: "guardian" as const, name: "Brian" },
  ageYears: 4,
  diabetesType: "type1",
  currentGlucose: 77,
  trendArrow: "→",
  trendLabel: "stable",
  targetRange: { low: 70, high: 180 },
  carbRatio: 15,
  targetGlucose: 120,
  correctionFactor: 60,
  recentReadings: [
    { glucose: 68, timestamp: ago(30) },
    { glucose: 64, timestamp: ago(25) },
    { glucose: 66, timestamp: ago(20) },
    { glucose: 70, timestamp: ago(15) },
    { glucose: 74, timestamp: ago(10) },
    { glucose: 76, timestamp: ago(5) },
    { glucose: 77, timestamp: ago(1) },
  ],
};

describe("chat live CGM context", () => {
  it("shows the latest reading, the recent readings, and the change since the low point", () => {
    const s = buildLiveCgmSection(ctx, "Bella's");
    expect(s).toContain("LIVE CGM");
    expect(s).toContain("Latest reading: 77 mg/dL");
    expect(s).toContain("68 (30m ago) → 64 (25m ago)");
    expect(s).toContain("Lowest was 64 (25m ago); up 13 since then");
    expect(s).not.toContain("minutes old");
  });

  it("flags readings that stopped arriving", () => {
    const s = buildLiveCgmSection({ ...ctx, recentReadings: [{ glucose: 90, timestamp: ago(40) }] }, "Bella's");
    expect(s).toContain("40 minutes old");
  });

  it("is empty without readings, so the prompt falls back to asking for a sync", () => {
    expect(buildLiveCgmSection({ ...ctx, recentReadings: [] }, "Bella's")).toBe("");
  });

  it("tells the assistant it can see the numbers and must be specific", () => {
    const p = buildSystemPrompt(ctx);
    expect(p).toContain("YOU CAN SEE THE NUMBERS");
    expect(p).toContain("never ask for the current number or arrow");
    expect(p).toContain("BE SPECIFIC, NEVER GENERIC");
    // Caregiver and friend, not a pamphlet.
    expect(p).toContain("Part caregiver, part friend");
    expect(p).toContain("Sound like a real person");
    expect(p).toContain("Lowest was 64");
    // Safety rules are unchanged.
    expect(p).toContain("For falling glucose: never suggest insulin");
    expect(p).toContain("If glucose is critically low (<55)");
  });
});

describe("chat time of day", () => {
  it("uses the phone's clock when the app sends it", () => {
    const t = localTimeOfDay({ ...ctx, localTime: "4:27 AM", localWeekday: "Thursday", localHour: 4 });
    expect(t).toEqual({ hour: 4, label: "4:27 AM", weekday: "Thursday", exact: true });
    expect(dayPart(4)).toBe("overnight");
  });

  it("falls back to the newest same-day history label for older apps", () => {
    const t = localTimeOfDay({ ...ctx, readingsHistory: [{ glucose: 80, time: "Yesterday 11:40 PM" }, { glucose: 77, time: "4:20 AM" }] });
    expect(t).toMatchObject({ hour: 4, exact: false });
    expect(localTimeOfDay({ ...ctx, readingsHistory: [{ glucose: 80, time: "16:40" }] })?.hour).toBe(16);
    expect(localTimeOfDay({ ...ctx, readingsHistory: [] })).toBeNull();
  });

  it("splits the day the way families live it", () => {
    expect([23, 2, 5, 6, 8, 9, 16, 17, 21].map(dayPart)).toEqual([
      "overnight", "overnight", "overnight", "morning", "morning", "daytime", "daytime", "evening", "evening",
    ]);
  });

  it("at 4am tells the assistant they're tired, she's asleep, and to say when it's okay to rest", () => {
    const p = buildSystemPrompt({ ...ctx, localTime: "4:27 AM", localWeekday: "Thursday", localHour: 4 });
    expect(p).toContain("TIME OF DAY: it's 4:27 AM on Thursday");
    expect(p).toContain("probably asleep");
    expect(p).toContain("okay to go back to sleep");
    expect(p).toContain("MATCH THE MESSAGE");
  });
});

describe("chat knows who's with the child", () => {
  const holly = { by: "Holly (school nurse)", byYou: false, what: "insulin" };

  it("a recent log by the nurse: 'I see she's with Holly right now'", () => {
    const s = buildCareNowSection({ ...ctx, careNow: { lastLog: { ...holly, minutesAgo: 25 }, scheduledNow: [{ name: "Holly (school nurse)", until: "2:30 PM" }] } }, "Bella", true);
    expect(s).toContain("Holly (school nurse) logged insulin 25 minutes ago");
    expect(s).toContain("most likely with Holly (school nurse)");
    expect(s).toContain("I see Bella's with Holly right now");
    expect(s).toContain("until 2:30 PM");
  });

  it("an older log by grandma: ask once, lightly", () => {
    const s = buildCareNowSection({ ...ctx, careNow: { lastLog: { by: "Grandma", byYou: false, what: "a meal", minutesAgo: 95 } } }, "Bella", true);
    expect(s).toContain("Is Bella still with Grandma?");
    expect(s).toContain("never ask again in the same conversation");
  });

  it("grandma chatting herself: talk to her, never ask who Bella is with", () => {
    const s = buildCareNowSection({ ...ctx, careNow: { lastLog: { by: "Grandma", byYou: true, what: "a meal", minutesAgo: 10 } } }, "Bella", false);
    expect(s).toContain("The person typing is the one with Bella");
    expect(s).not.toContain("still with");
  });

  it("nobody logged lately but school is in: probably with the nurse", () => {
    const s = buildCareNowSection({ ...ctx, careNow: { scheduledNow: [{ name: "Holly (school nurse)", until: "2:30 PM" }] } }, "Bella", true);
    expect(s).toContain("probably with them");
  });

  it("says nothing when there's nothing to go on, and rides in the prompt otherwise", () => {
    expect(buildCareNowSection({ ...ctx, careNow: { scheduledNow: [] } }, "Bella", true)).toBe("");
    const p = buildSystemPrompt({ ...ctx, careNow: { lastLog: { ...holly, minutesAgo: 25 } } });
    expect(p).toContain("WHO'S WITH BELLA");
  });
});
