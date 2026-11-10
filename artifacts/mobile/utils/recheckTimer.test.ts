import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } }));

import { DONE_LINGER_MS, timeLeftLabel, timerIsLive, timerProgress, type RecheckTimer } from "./recheckTimer";

const t: RecheckTimer = { startedAt: 0, endsAt: 15 * 60_000, minutes: 15, childName: "Jake", treatment: "4 glucose tabs", notificationId: null };

describe("recheck timer", () => {
  it("counts down in minutes and seconds, then says it's time", () => {
    expect(timeLeftLabel(t, 0)).toBe("15:00");
    expect(timeLeftLabel(t, 3 * 60_000 + 36_000)).toBe("11:24");
    expect(timeLeftLabel(t, 15 * 60_000 - 400)).toBe("0:01");
    expect(timeLeftLabel(t, 15 * 60_000)).toBeNull();
  });

  it("shows progress and stays up a while after time's up", () => {
    expect(timerProgress(t, 7.5 * 60_000)).toBe(0.5);
    expect(timerProgress(t, 99 * 60_000)).toBe(1);
    expect(timerIsLive(t, t.endsAt + DONE_LINGER_MS - 1)).toBe(true);
    expect(timerIsLive(t, t.endsAt + DONE_LINGER_MS)).toBe(false);
    expect(timerIsLive(null, 0)).toBe(false);
  });
});
