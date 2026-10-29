import { describe, expect, it } from "vitest";
import { parseTimeInputText } from "./logTime";
import { fromWheel, timeButtonLabel, toWheel, wheelFromText, wheelIndexAt, wheelText } from "./timeWheel";

describe("time wheel", () => {
  it("converts the 24-hour clock to wheel columns at the edges", () => {
    expect(toWheel(0, 0)).toEqual({ hour: 12, minute: 0, period: "AM" });
    expect(toWheel(11, 59)).toEqual({ hour: 11, minute: 59, period: "AM" });
    expect(toWheel(12, 0)).toEqual({ hour: 12, minute: 0, period: "PM" });
    expect(toWheel(17, 38)).toEqual({ hour: 5, minute: 38, period: "PM" });
    expect(toWheel(23, 5)).toEqual({ hour: 11, minute: 5, period: "PM" });
  });

  it("round-trips every minute of the day", () => {
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) {
      expect(fromWheel(toWheel(h, m))).toEqual({ hours: h, minutes: m });
    }
  });

  it("writes text the log screens already parse back to the same time", () => {
    for (let h = 0; h < 24; h++) {
      const text = wheelText(toWheel(h, 7));
      expect(parseTimeInputText(text)).toEqual({ hours: h, minutes: 7 });
    }
    expect(wheelText({ hour: 8, minute: 30, period: "AM" })).toBe("8:30 AM");
  });

  it("reads existing text, including 24-hour text, and falls back to now when unreadable", () => {
    expect(wheelFromText("17:38")).toEqual({ hour: 5, minute: 38, period: "PM" });
    expect(wheelFromText("9 pm")).toEqual({ hour: 9, minute: 0, period: "PM" });
    const at = new Date(2026, 9, 29, 6, 45);
    expect(wheelFromText("", at)).toEqual({ hour: 6, minute: 45, period: "AM" });
    expect(wheelFromText("nonsense", at)).toEqual({ hour: 6, minute: 45, period: "AM" });
    expect(timeButtonLabel("17:38", at)).toBe("5:38 PM");
  });

  it("snaps a scroll offset to the nearest row inside the column", () => {
    expect(wheelIndexAt(0, 40, 12)).toBe(0);
    expect(wheelIndexAt(59, 40, 12)).toBe(1);
    expect(wheelIndexAt(61, 40, 12)).toBe(2);
    expect(wheelIndexAt(-30, 40, 12)).toBe(0);
    expect(wheelIndexAt(9999, 40, 12)).toBe(11);
  });
});
