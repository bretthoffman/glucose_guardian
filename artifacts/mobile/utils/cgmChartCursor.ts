import { chartValueToY } from "./cgmChartAxis";

export const CGM_CHART_LONG_PRESS_MS = 350;
export const CGM_CHART_TAP_MAX_MS = 250;
export const CGM_CHART_TAP_MAX_MOVE_PX = 12;
export const CGM_CHART_SCROLL_CANCEL_DY = 14;
export const CGM_CHART_CURSOR_TOOLTIP_WIDTH = 124;
export const CGM_CHART_CURSOR_TOOLTIP_HEIGHT = 40;

export interface ChartPlotPoint {
  x: number;
  y: number;
  glucose: number;
  timestamp: string;
}

export function buildChartPlotPoints(
  readings: { glucose: number; timestamp: string }[],
  windowStart: number,
  windowMs: number,
  plotW: number,
  plotY: (glucose: number) => number,
): ChartPlotPoint[] {
  return readings
    .filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= windowStart && t < windowStart + windowMs;
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((r) => ({
      x: Math.max(0, Math.min(plotW, ((new Date(r.timestamp).getTime() - windowStart) / windowMs) * plotW)),
      y: plotY(r.glucose),
      glucose: r.glucose,
      timestamp: r.timestamp,
    }));
}

/** Binary-search nearest reading index by plot X (points must be sorted by x). */
export function nearestReadingIndex(sortedXs: number[], touchX: number): number {
  if (sortedXs.length === 0) return -1;
  if (sortedXs.length === 1) return 0;

  let lo = 0;
  let hi = sortedXs.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sortedXs[mid] < touchX) lo = mid + 1;
    else hi = mid;
  }

  if (lo === 0) return 0;
  if (lo >= sortedXs.length) return sortedXs.length - 1;
  const prev = lo - 1;
  return touchX - sortedXs[prev] <= sortedXs[lo] - touchX ? prev : lo;
}

export function chartCursorTooltipTop(chartHeight: number): number {
  const mid300_400 = chartValueToY(350, chartHeight);
  return Math.max(6, mid300_400 - CGM_CHART_CURSOR_TOOLTIP_HEIGHT / 2);
}

export function chartCursorTooltipLeft(
  cursorX: number,
  plotW: number,
  tooltipWidth = CGM_CHART_CURSOR_TOOLTIP_WIDTH,
): number {
  const half = tooltipWidth / 2;
  let left = cursorX - half;
  left = Math.max(4, left);
  left = Math.min(plotW - tooltipWidth - 4, left);
  return left;
}

export function formatChartCursorGlucose(glucose: number): string {
  return `${Math.round(glucose)} mg/dL`;
}

export function formatChartCursorTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function isQuickTapGesture(
  durationMs: number,
  dx: number,
  dy: number,
  maxDurationMs = CGM_CHART_TAP_MAX_MS,
  maxMovePx = CGM_CHART_TAP_MAX_MOVE_PX,
): boolean {
  return durationMs < maxDurationMs && Math.hypot(dx, dy) < maxMovePx;
}

export function shouldCancelLongPressForScroll(
  dy: number,
  threshold = CGM_CHART_SCROLL_CANCEL_DY,
): boolean {
  return Math.abs(dy) > threshold;
}
