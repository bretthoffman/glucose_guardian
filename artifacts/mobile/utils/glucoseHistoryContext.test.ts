import { describe, expect, it } from "vitest";
import { downsampleReadingsForContext, formatReadingTimeLabel } from "./glucoseHistoryContext";

const NOW = new Date("2026-07-18T12:00:00Z").getTime();

function at(minutesAgo: number, glucose = 120) {
  return { glucose, timestamp: new Date(NOW - minutesAgo * 60_000).toISOString() };
}

describe("downsampleReadingsForContext", () => {
  it("keeps at most one reading per 20-minute slot (the latest) in chronological order", () => {
    const readings = [at(5, 100), at(10, 105), at(15, 110), at(25, 90), at(30, 95)];
    const out = downsampleReadingsForContext(readings, NOW);
    expect(out).toHaveLength(2);
    expect(out[0].glucose).toBe(90); // latest of the 25/30-min-ago slot
    expect(out[1].glucose).toBe(100); // latest of the 5/10/15-min-ago slot
    const times = out.map((r) => new Date(r.timestamp).getTime());
    expect(times[0]).toBeLessThan(times[1]);
  });

  it("drops readings outside the 24h window and invalid timestamps", () => {
    const readings = [at(25 * 60, 200), at(10, 100), { glucose: 1, timestamp: "junk" }];
    const out = downsampleReadingsForContext(readings, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].glucose).toBe(100);
  });

  it("caps a dense 5-minute feed at ~3 readings per hour", () => {
    const readings = Array.from({ length: 24 * 12 }, (_, i) => at(i * 5, 100 + (i % 40)));
    const out = downsampleReadingsForContext(readings, NOW);
    expect(out.length).toBeLessThanOrEqual(24 * 3);
    expect(out.length).toBeGreaterThanOrEqual(24 * 3 - 1);
  });
});

describe("formatReadingTimeLabel", () => {
  it("prefixes Yesterday only for prior-day readings", () => {
    // Same instant → always the same calendar day; 25h earlier → always crosses local midnight.
    const todayLabel = formatReadingTimeLabel(new Date(NOW).toISOString(), NOW);
    expect(todayLabel.startsWith("Yesterday")).toBe(false);
    const yesterdayLabel = formatReadingTimeLabel(new Date(NOW - 25 * 3_600_000).toISOString(), NOW);
    expect(yesterdayLabel.startsWith("Yesterday")).toBe(true);
  });
});
