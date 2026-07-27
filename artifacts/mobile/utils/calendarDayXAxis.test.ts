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

describe("zoomed-window ticks (Log-page pinch zoom)", () => {
  const HOUR = 60 * 60 * 1000;
  const dayStart = new Date(2026, 5, 25, 0, 0, 0, 0).getTime();

  it("picks tighter steps for tighter spans", async () => {
    const { pickZoomTickStepMs } = await import("./calendarDayXAxis");
    expect(pickZoomTickStepMs(1 * HOUR)).toBe(15 * 60 * 1000);
    expect(pickZoomTickStepMs(2 * HOUR)).toBe(30 * 60 * 1000);
    expect(pickZoomTickStepMs(5 * HOUR)).toBe(HOUR);
    expect(pickZoomTickStepMs(10 * HOUR)).toBe(2 * HOUR);
    expect(pickZoomTickStepMs(20 * HOUR)).toBe(4 * HOUR);
  });

  it("aligns ticks to clean local clock times inside the window", async () => {
    const { buildZoomedDayXLabels } = await import("./calendarDayXAxis");
    // 9:07 AM – 12:07 PM (3h) → 30-min ticks starting at 9:30.
    const windowStart = dayStart + 9 * HOUR + 7 * 60 * 1000;
    const labels = buildZoomedDayXLabels(windowStart, 3 * HOUR, dayStart, 300);
    expect(labels[0].timeMs).toBe(dayStart + 9.5 * HOUR);
    expect(labels.length).toBe(6); // 9:30, 10, 10:30, 11, 11:30, 12
    expect(labels[0].label).toBe(
      new Date(labels[0].timeMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    );
    // x maps linearly across the zoomed window.
    expect(labels[0].x).toBeCloseTo(((9.5 * HOUR - (9 * HOUR + 7 * 60 * 1000)) / (3 * HOUR)) * 300, 5);
  });

  it("hour-step labels drop the minutes", async () => {
    const { buildZoomedDayXLabels } = await import("./calendarDayXAxis");
    const labels = buildZoomedDayXLabels(dayStart + 8 * HOUR, 5 * HOUR, dayStart, 300);
    expect(labels[0].timeMs).toBe(dayStart + 8 * HOUR);
    expect(labels[0].label).toBe(
      new Date(labels[0].timeMs).toLocaleTimeString([], { hour: "numeric" }),
    );
  });

  it("clamps zoomed label layout inside the plot", async () => {
    const { zoomedDayLabelLayout } = await import("./calendarDayXAxis");
    expect(zoomedDayLabelLayout(0, 300, 52).left).toBe(0);
    expect(zoomedDayLabelLayout(300, 300, 52).left).toBe(248);
    expect(zoomedDayLabelLayout(150, 300, 52).left).toBe(124);
  });
});
