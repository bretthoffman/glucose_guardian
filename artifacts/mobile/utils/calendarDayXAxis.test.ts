import { describe, expect, it } from "vitest";
import {
  CALENDAR_DAY_X_LABEL_HOURS,
  buildCalendarDayXLabels,
  calendarDayMeridiemPositions,
  calendarDayNumericLabelLayout,
  formatCalendarDayHourNumeric,
} from "./calendarDayXAxis";

describe("calendarDayXAxis", () => {
  it("formats numeric two-hour ticks without AM/PM suffixes", () => {
    expect(formatCalendarDayHourNumeric(0)).toBe("12");
    expect(formatCalendarDayHourNumeric(2)).toBe("2");
    expect(formatCalendarDayHourNumeric(10)).toBe("10");
    expect(formatCalendarDayHourNumeric(12)).toBe("12");
    expect(formatCalendarDayHourNumeric(14)).toBe("2");
    expect(formatCalendarDayHourNumeric(22)).toBe("10");
    expect(formatCalendarDayHourNumeric(24)).toBe("12");
    expect(CALENDAR_DAY_X_LABEL_HOURS).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  });

  it("places first and last numeric labels at plot edges", () => {
    const dayStart = new Date(2026, 5, 25, 0, 0, 0, 0).getTime();
    const windowMs = 24 * 60 * 60 * 1000;
    const plotW = 300;
    const labels = buildCalendarDayXLabels(dayStart, windowMs, plotW);
    expect(labels.map((l) => l.label)).toEqual([
      "12", "2", "4", "6", "8", "10", "12", "2", "4", "6", "8", "10", "12",
    ]);
    expect(labels[0].x).toBe(0);
    expect(labels[labels.length - 1].x).toBe(plotW);
  });

  it("centers AM and PM at 25% and 75% of plot width", () => {
    const plotW = 320;
    const { amX, pmX } = calendarDayMeridiemPositions(plotW);
    expect(amX).toBe(80);
    expect(pmX).toBe(240);
  });

  it("anchors first and last 12 labels at plot edges with edge text alignment", () => {
    const plotW = 300;
    const first = calendarDayNumericLabelLayout(0, 0, plotW);
    const last = calendarDayNumericLabelLayout(24, plotW, plotW);
    const middle = calendarDayNumericLabelLayout(12, plotW / 2, plotW);

    expect(first).toEqual({ left: 0, width: 22, textAlign: "left" });
    expect(last).toEqual({ left: plotW - 22, width: 22, textAlign: "right" });
    expect(middle.textAlign).toBe("center");
    expect(middle.left).toBe(plotW / 2 - 11);
  });
});
