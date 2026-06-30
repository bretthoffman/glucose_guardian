/** Two-hour X-axis labels for the Dose Log historical calendar-day graph. */

export const CALENDAR_DAY_X_LABEL_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24] as const;

export type CalendarDayXLabelHour = (typeof CALENDAR_DAY_X_LABEL_HOURS)[number];

/** Numeric hour tick only — AM/PM appear on a separate meridiem row. */
export function formatCalendarDayHourNumeric(hour: number): string {
  if (hour === 0 || hour === 24 || hour === 12) return "12";
  if (hour < 12) return String(hour);
  return String(hour - 12);
}

/**
 * X position for a wall-clock hour label on a calendar-day chart.
 * Uses real elapsed ms from dayStart so DST days (23/25 h) align labels with clock time.
 */
export function calendarDayLabelX(
  hour: CalendarDayXLabelHour,
  dayStartMs: number,
  windowMs: number,
  plotW: number,
): number {
  if (hour === 24) return plotW;
  const labelDate = new Date(dayStartMs);
  labelDate.setHours(hour, 0, 0, 0);
  const ms = labelDate.getTime() - dayStartMs;
  return Math.max(0, Math.min(plotW, (ms / windowMs) * plotW));
}

export interface CalendarDayXLabelSpec {
  hour: CalendarDayXLabelHour;
  label: string;
  x: number;
}

export function buildCalendarDayXLabels(
  dayStartMs: number,
  windowMs: number,
  plotW: number,
): CalendarDayXLabelSpec[] {
  return CALENDAR_DAY_X_LABEL_HOURS.map((hour) => ({
    hour,
    label: formatCalendarDayHourNumeric(hour),
    x: calendarDayLabelX(hour, dayStartMs, windowMs, plotW),
  }));
}

export type CalendarDayLabelAlign = "left" | "center" | "right";

export interface CalendarDayNumericLabelLayout {
  left: number;
  width: number;
  textAlign: CalendarDayLabelAlign;
}

/** Edge-aware layout: midnight ticks anchor at plot edges; middle ticks stay centered. */
export function calendarDayNumericLabelLayout(
  hour: CalendarDayXLabelHour,
  x: number,
  plotW: number,
  labelWidth = 22,
): CalendarDayNumericLabelLayout {
  if (hour === 0) {
    return { left: 0, width: labelWidth, textAlign: "left" };
  }
  if (hour === 24) {
    return { left: plotW - labelWidth, width: labelWidth, textAlign: "right" };
  }
  return {
    left: Math.max(0, Math.min(plotW - labelWidth, x - labelWidth / 2)),
    width: labelWidth,
    textAlign: "center",
  };
}

export interface CalendarDayMeridiemSpec {
  amX: number;
  pmX: number;
}

/** AM centered at 25% of plot width; PM at 75% — first/second 12-hour spans. */
export function calendarDayMeridiemPositions(plotW: number): CalendarDayMeridiemSpec {
  return {
    amX: plotW * 0.25,
    pmX: plotW * 0.75,
  };
}

export function calendarDayMeridiemLabelLayout(
  centerX: number,
  plotW: number,
  labelWidth = 28,
): { left: number; width: number } {
  return {
    left: Math.max(0, Math.min(plotW - labelWidth, centerX - labelWidth / 2)),
    width: labelWidth,
  };
}
