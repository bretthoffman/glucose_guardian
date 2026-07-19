import { describe, expect, it } from "vitest";
import {
  availableDaysFromOldest,
  mergeWindowStats,
  statsFromEntries,
  windowChunks,
} from "./a1cRange";

const NOW = new Date("2026-07-18T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

describe("windowChunks", () => {
  it("covers the whole range contiguously in ≤15-day chunks", () => {
    const chunks = windowChunks(90, NOW);
    expect(chunks).toHaveLength(6);
    expect(chunks[0].startTimestamp).toBe(new Date(NOW - 90 * DAY).toISOString());
    expect(chunks[chunks.length - 1].endTimestamp).toBe(new Date(NOW).toISOString());
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startTimestamp).toBe(chunks[i - 1].endTimestamp);
    }
  });

  it("uses a single chunk for short ranges", () => {
    expect(windowChunks(3, NOW)).toHaveLength(1);
    expect(windowChunks(14, NOW)).toHaveLength(1);
    expect(windowChunks(30, NOW)).toHaveLength(2);
  });
});

describe("mergeWindowStats", () => {
  it("sums counts and keeps the earliest oldestTimestamp", () => {
    const merged = mergeWindowStats([
      { count: 10, sum: 1500, lowCount: 1, highCount: 2, oldestTimestamp: "2026-07-10T00:00:00.000Z" },
      { count: 5, sum: 900, lowCount: 0, highCount: 3, oldestTimestamp: "2026-07-01T00:00:00.000Z" },
      { count: 0, sum: 0, lowCount: 0, highCount: 0, oldestTimestamp: null },
    ]);
    expect(merged).toEqual({
      count: 15,
      sum: 2400,
      lowCount: 1,
      highCount: 5,
      oldestTimestamp: "2026-07-01T00:00:00.000Z",
    });
  });
});

describe("statsFromEntries", () => {
  it("matches the backend aggregation semantics", () => {
    const stats = statsFromEntries(
      [
        { glucose: 65, timestamp: "2026-07-18T01:00:00.000Z" },
        { glucose: 120, timestamp: "2026-07-18T02:00:00.000Z" },
        { glucose: 200, timestamp: "2026-07-17T23:00:00.000Z" },
      ],
      70,
      180,
    );
    expect(stats.count).toBe(3);
    expect(stats.sum).toBe(385);
    expect(stats.lowCount).toBe(1);
    expect(stats.highCount).toBe(1);
    expect(stats.oldestTimestamp).toBe("2026-07-17T23:00:00.000Z");
  });
});

describe("availableDaysFromOldest", () => {
  it("reports partial coverage from the oldest reading", () => {
    const oldest = new Date(NOW - 29 * DAY).toISOString();
    expect(availableDaysFromOldest(oldest, NOW, 30)).toBe(29);
    expect(availableDaysFromOldest(oldest, NOW, 90)).toBe(29);
  });

  it("caps at the requested range when coverage is full", () => {
    const oldest = new Date(NOW - 45 * DAY).toISOString();
    expect(availableDaysFromOldest(oldest, NOW, 30)).toBe(30);
  });

  it("handles missing data and same-day readings", () => {
    expect(availableDaysFromOldest(null, NOW, 30)).toBe(0);
    expect(availableDaysFromOldest(new Date(NOW - 3600_000).toISOString(), NOW, 30)).toBe(1);
  });
});
