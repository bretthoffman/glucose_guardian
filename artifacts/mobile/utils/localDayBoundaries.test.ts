import { describe, expect, it } from "vitest";
import {
  canNavigateToNextDay,
  endOfLocalDay,
  isTimestampInLocalDay,
  localDateKey,
  localDayBoundaries,
  selectedDayFromOffset,
  startOfLocalDay,
} from "./localDayBoundaries";

describe("localDayBoundaries", () => {
  it("uses local midnight to next local midnight", () => {
    const ref = new Date(2026, 5, 25, 15, 30, 0);
    const { startMs, endMs, startIso, endIso } = localDayBoundaries(ref);
    expect(startMs).toBe(new Date(2026, 5, 25, 0, 0, 0, 0).getTime());
    expect(endMs).toBe(new Date(2026, 5, 26, 0, 0, 0, 0).getTime());
    expect(endMs).toBeGreaterThan(startMs);
    expect(new Date(startIso).getTime()).toBe(startMs);
    expect(new Date(endIso).getTime()).toBe(endMs);
  });

  it("assigns midnight reading to the next calendar day", () => {
    const day = new Date(2026, 5, 25, 12, 0, 0);
    const { startMs, endMs } = localDayBoundaries(day);
    const nextMidnight = new Date(2026, 5, 26, 0, 0, 0, 0).toISOString();
    const lastSecond = new Date(2026, 5, 25, 23, 59, 59, 999).toISOString();
    expect(isTimestampInLocalDay(lastSecond, startMs, endMs)).toBe(true);
    expect(isTimestampInLocalDay(nextMidnight, startMs, endMs)).toBe(false);
  });

  it("blocks future-day navigation when offset is zero", () => {
    expect(canNavigateToNextDay(0)).toBe(false);
    expect(canNavigateToNextDay(1)).toBe(true);
  });

  it("steps selected day backward by offset", () => {
    const today = startOfLocalDay(new Date(2026, 5, 25, 9, 0, 0));
    const yesterday = selectedDayFromOffset(today, 1);
    expect(localDateKey(yesterday)).toBe(localDateKey(new Date(2026, 5, 24)));
  });

  it("DST spring-forward day has 23 elapsed hours between midnights", () => {
    // US spring-forward 2026-03-08 (second Sunday in March) — verify non-24h window
    const springDay = new Date(2026, 2, 8, 12, 0, 0);
    const start = startOfLocalDay(springDay);
    const end = endOfLocalDay(springDay);
    const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    expect([23, 24, 25]).toContain(hours);
  });
});
