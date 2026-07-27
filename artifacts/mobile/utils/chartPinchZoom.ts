/**
 * Pinch-zoom window math for the Log page's calendar-day glucose graph. Pure so the clamping
 * rules are unit-testable: the full day is the MAXIMUM zoom-out (you can never see more than the
 * day), zooming in bottoms out at MIN_ZOOM_SPAN_MS, and the time under the pinch centroid stays
 * pinned under the fingers while both zooming and (two-finger) panning.
 */

export interface ZoomWindow {
  startMs: number;
  endMs: number;
}

/** Tightest allowed view — one hour of the day. */
export const MIN_ZOOM_SPAN_MS = 60 * 60 * 1000;

/** On-graph log icons grow with zoom, capped so a deep zoom stays tidy. */
export const MAX_MARKER_ZOOM_SCALE = 2.2;

/** How much of the day is visible: 1 at the default view, 24 fully zoomed into one hour. */
export function zoomFactor(day: ZoomWindow, window: ZoomWindow | null): number {
  if (!window) return 1;
  const daySpan = day.endMs - day.startMs;
  const span = window.endMs - window.startMs;
  if (daySpan <= 0 || span <= 0) return 1;
  return Math.max(1, daySpan / span);
}

/** Marker icons scale with the square root of the zoom so growth feels gradual. */
export function markerZoomScale(zoom: number): number {
  return Math.min(MAX_MARKER_ZOOM_SCALE, Math.sqrt(Math.max(1, zoom)));
}

/**
 * The zoomed window for the current pinch frame, computed against the gesture-start baseline
 * (window, centroid x, finger distance). Returns null when the result is the full-day view —
 * callers treat null as "no zoom", which is also the zoom-out limit.
 */
export function pinchZoomWindow(params: {
  day: ZoomWindow;
  /** Window when the pinch began (the full day if it started un-zoomed). */
  startWindow: ZoomWindow;
  plotW: number;
  /** Pinch centroid x at gesture start / now, in plot coordinates. */
  focalX0: number;
  focalX: number;
  /** Distance between the two fingers at gesture start / now. */
  dist0: number;
  dist: number;
}): ZoomWindow | null {
  const { day, startWindow, plotW, focalX0, focalX, dist0, dist } = params;
  const daySpan = day.endMs - day.startMs;
  if (daySpan <= 0 || plotW <= 0 || dist0 <= 0 || dist <= 0) return null;

  const span0 = Math.max(1, startWindow.endMs - startWindow.startMs);
  const scale = dist / dist0;
  const newSpan = Math.min(daySpan, Math.max(MIN_ZOOM_SPAN_MS, span0 / scale));

  // The day-time that sat under the fingers at gesture start stays under them now.
  const focalT = startWindow.startMs + (focalX0 / plotW) * span0;
  let newStart = focalT - (focalX / plotW) * newSpan;
  newStart = Math.max(day.startMs, Math.min(day.endMs - newSpan, newStart));

  // Fully zoomed back out (within half a minute) → snap to the canonical full-day view.
  if (newSpan >= daySpan - 30_000) return null;
  return { startMs: newStart, endMs: newStart + newSpan };
}
