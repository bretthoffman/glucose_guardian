import { describe, expect, it } from "vitest";
import { combineDayAndTime, parseTimeInputText } from "./logTime";

describe("parseTimeInputText", () => {
  it("parses 12-hour times with AM/PM in common shapes", () => {
    expect(parseTimeInputText("5:38 PM")).toEqual({ hours: 17, minutes: 38 });
    expect(parseTimeInputText("5:38pm")).toEqual({ hours: 17, minutes: 38 });
    expect(parseTimeInputText("5:38 p.m.")).toEqual({ hours: 17, minutes: 38 });
    expect(parseTimeInputText("11:05 am")).toEqual({ hours: 11, minutes: 5 });
    expect(parseTimeInputText("12:00 AM")).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeInputText("12:30 PM")).toEqual({ hours: 12, minutes: 30 });
    expect(parseTimeInputText("9 pm")).toEqual({ hours: 21, minutes: 0 });
  });

  it("parses 24-hour times", () => {
    expect(parseTimeInputText("17:38")).toEqual({ hours: 17, minutes: 38 });
    expect(parseTimeInputText("0:05")).toEqual({ hours: 0, minutes: 5 });
    expect(parseTimeInputText("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseTimeInputText("9")).toEqual({ hours: 9, minutes: 0 });
  });

  it("rejects invalid times", () => {
    expect(parseTimeInputText("")).toBeNull();
    expect(parseTimeInputText("25:00")).toBeNull();
    expect(parseTimeInputText("12:70")).toBeNull();
    expect(parseTimeInputText("13:00 PM")).toBeNull();
    expect(parseTimeInputText("0:30 AM")).toBeNull();
    expect(parseTimeInputText("abc")).toBeNull();
  });
});

describe("combineDayAndTime", () => {
  it("keeps the calendar day and applies the time of day", () => {
    const day = new Date(2026, 6, 9, 23, 59, 58, 999); // Jul 9 late evening
    const combined = combineDayAndTime(day, 5, 38);
    expect(combined.getFullYear()).toBe(2026);
    expect(combined.getMonth()).toBe(6);
    expect(combined.getDate()).toBe(9);
    expect(combined.getHours()).toBe(5);
    expect(combined.getMinutes()).toBe(38);
    expect(combined.getSeconds()).toBe(0);
  });
});
