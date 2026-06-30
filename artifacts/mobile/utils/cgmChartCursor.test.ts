import { describe, expect, it } from "vitest";
import { chartValueToY } from "./cgmChartAxis";
import {
  CGM_CHART_LONG_PRESS_MS,
  CGM_CHART_TAP_MAX_MS,
  CGM_CHART_TAP_MAX_MOVE_PX,
  buildChartPlotPoints,
  chartCursorTooltipLeft,
  chartCursorTooltipTop,
  formatChartCursorGlucose,
  formatChartCursorTime,
  isQuickTapGesture,
  nearestReadingIndex,
  shouldCancelLongPressForScroll,
} from "./cgmChartCursor";

const plotH = 220;
const plotY = (g: number) => chartValueToY(g, plotH);
const plotW = 300;
const windowStart = Date.parse("2026-06-25T00:00:00");
const windowMs = 24 * 60 * 60 * 1000;

function reading(hour: number, minute: number, glucose: number) {
  const d = new Date(windowStart);
  d.setHours(hour, minute, 0, 0);
  return { glucose, timestamp: d.toISOString() };
}

describe("nearestReadingIndex", () => {
  const xs = [10, 50, 90, 130, 170];

  it("selects nearest reading by X", () => {
    expect(nearestReadingIndex(xs, 48)).toBe(1);
    expect(nearestReadingIndex(xs, 52)).toBe(1);
    expect(nearestReadingIndex(xs, 74)).toBe(2);
  });

  it("snaps to actual reading X positions (first and last)", () => {
    expect(nearestReadingIndex(xs, 0)).toBe(0);
    expect(nearestReadingIndex(xs, 200)).toBe(4);
  });

  it("never returns interpolated indices", () => {
    expect(nearestReadingIndex(xs, 65)).toBe(1);
    expect(nearestReadingIndex(xs, 71)).toBe(2);
  });

  it("handles one-reading dataset", () => {
    expect(nearestReadingIndex([100], 0)).toBe(0);
    expect(nearestReadingIndex([100], 250)).toBe(0);
  });

  it("handles empty dataset", () => {
    expect(nearestReadingIndex([], 50)).toBe(-1);
  });

  it("dragging left moves to earlier readings", () => {
    expect(nearestReadingIndex(xs, 160)).toBe(4);
    expect(nearestReadingIndex(xs, 125)).toBe(3);
    expect(nearestReadingIndex(xs, 70)).toBe(1);
    expect(nearestReadingIndex(xs, 20)).toBe(0);
  });

  it("dragging right moves to later readings", () => {
    expect(nearestReadingIndex(xs, 20)).toBe(0);
    expect(nearestReadingIndex(xs, 70)).toBe(1);
    expect(nearestReadingIndex(xs, 125)).toBe(3);
  });
});

describe("buildChartPlotPoints", () => {
  const readings = [
    reading(8, 0, 120),
    reading(12, 30, 167),
    reading(18, 15, 140),
  ];

  it("includes only readings inside the window", () => {
    const narrowStart = Date.parse("2026-06-25T11:00:00");
    const narrowMs = 3 * 60 * 60 * 1000;
    const pts = buildChartPlotPoints(readings, narrowStart, narrowMs, plotW, plotY);
    expect(pts).toHaveLength(1);
    expect(pts[0].glucose).toBe(167);
  });

  it("maps glucose and timestamp from stored readings", () => {
    const pts = buildChartPlotPoints(readings, windowStart, windowMs, plotW, plotY);
    expect(pts[1].glucose).toBe(167);
    expect(pts[1].timestamp).toBe(readings[1].timestamp);
    expect(pts[1].y).toBe(plotY(167));
  });

  it("sorts by timestamp ascending", () => {
    const shuffled = [readings[2], readings[0], readings[1]];
    const pts = buildChartPlotPoints(shuffled, windowStart, windowMs, plotW, plotY);
    expect(pts.map((p) => p.glucose)).toEqual([120, 167, 140]);
  });
});

describe("gesture classification helpers", () => {
  it("quick tap is short with little movement", () => {
    expect(isQuickTapGesture(100, 2, 1)).toBe(true);
    expect(isQuickTapGesture(CGM_CHART_TAP_MAX_MS - 1, 5, 5)).toBe(true);
  });

  it("quick tap does not include long press durations", () => {
    expect(isQuickTapGesture(CGM_CHART_LONG_PRESS_MS, 0, 0)).toBe(false);
  });

  it("long press threshold is intentional", () => {
    expect(CGM_CHART_LONG_PRESS_MS).toBe(350);
  });

  it("large movement is not a quick tap", () => {
    expect(isQuickTapGesture(100, CGM_CHART_TAP_MAX_MOVE_PX, 0)).toBe(false);
  });

  it("vertical scroll intent cancels long press", () => {
    expect(shouldCancelLongPressForScroll(20)).toBe(true);
    expect(shouldCancelLongPressForScroll(5)).toBe(false);
  });
});

describe("tooltip layout", () => {
  it("places readout near top between 300 and 400 grid levels", () => {
    const top = chartCursorTooltipTop(plotH);
    const y300 = plotY(300);
    const y400 = plotY(400);
    expect(top).toBeGreaterThanOrEqual(6);
    expect(top + 40).toBeLessThan(y300);
    expect(top).toBeGreaterThan(y400);
  });

  it("centers readout near cursor in the middle", () => {
    const left = chartCursorTooltipLeft(150, plotW);
    expect(left).toBeGreaterThan(0);
    expect(left + 124).toBeLessThanOrEqual(plotW);
  });

  it("shifts readout right near left edge", () => {
    expect(chartCursorTooltipLeft(10, plotW)).toBe(4);
  });

  it("shifts readout left near right edge", () => {
    expect(chartCursorTooltipLeft(290, plotW)).toBe(plotW - 124 - 4);
  });
});

describe("readout formatting", () => {
  it("formats glucose with mg/dL unit", () => {
    expect(formatChartCursorGlucose(167)).toBe("167 mg/dL");
  });

  it("formats exact reading time from timestamp", () => {
    const ts = reading(14, 15, 100).timestamp;
    const formatted = formatChartCursorTime(ts);
    expect(formatted).toMatch(/\d/);
    expect(formatted.length).toBeGreaterThan(3);
  });
});

describe("today future area nearest reading", () => {
  it("snaps to latest actual reading when touch is in future empty area", () => {
    const todayReadings = [reading(8, 0, 110), reading(10, 30, 130)];
    const pts = buildChartPlotPoints(todayReadings, windowStart, windowMs, plotW, plotY);
    const xs = pts.map((p) => p.x);
    const futureTouchX = plotW - 5;
    const idx = nearestReadingIndex(xs, futureTouchX);
    expect(idx).toBe(pts.length - 1);
    expect(pts[idx].glucose).toBe(130);
  });
});
