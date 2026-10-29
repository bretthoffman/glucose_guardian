import { describe, expect, it } from "vitest";
import { buildLiveCgmSection, buildSystemPrompt } from "./chat";

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
