import { describe, expect, it } from "vitest";
import { chatDayKey, chatDayLabel, dateFromDayKey } from "./chatHistory";

describe("chat history days", () => {
  const now = new Date(2026, 9, 29, 4, 30); // Thu Oct 29 2026, 4:30 AM local

  it("keys messages by the phone's local day", () => {
    expect(chatDayKey(now)).toBe("2026-10-29");
    expect(chatDayKey(new Date(2026, 9, 28, 23, 59))).toBe("2026-10-28");
  });

  it("labels days the way people talk about them", () => {
    expect(chatDayLabel("2026-10-29", now)).toBe("Today");
    expect(chatDayLabel("2026-10-28", now)).toBe("Yesterday");
    expect(chatDayLabel("2026-10-27", now)).toBe("Tue, Oct 27");
    expect(chatDayLabel("2025-12-31", now)).toBe("Wed, Dec 31, 2025");
    expect(chatDayLabel("2026-11-01", new Date(2026, 10, 2, 0, 10))).toBe("Yesterday"); // across month + DST
  });

  it("turns a day key back into that local day", () => {
    const d = dateFromDayKey("2026-03-08");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 8]);
  });
});
