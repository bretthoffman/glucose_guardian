import { describe, expect, it } from "vitest";
import {
  MAX_MARKER_ZOOM_SCALE,
  MIN_ZOOM_SPAN_MS,
  markerZoomScale,
  pinchZoomWindow,
  zoomFactor,
} from "./chartPinchZoom";

const HOUR = 60 * 60 * 1000;
const DAY_START = new Date(2026, 6, 20, 0, 0, 0, 0).getTime();
const DAY = { startMs: DAY_START, endMs: DAY_START + 24 * HOUR };
const PLOT_W = 300;

function pinch(over: Partial<Parameters<typeof pinchZoomWindow>[0]>) {
  return pinchZoomWindow({
    day: DAY,
    startWindow: DAY,
    plotW: PLOT_W,
    focalX0: PLOT_W / 2,
    focalX: PLOT_W / 2,
    dist0: 100,
    dist: 100,
    ...over,
  });
}

describe("pinchZoomWindow", () => {
  it("spreading fingers zooms in around the pinch point", () => {
    // 2× spread from the full day → a 12-hour window centered on noon.
    const w = pinch({ dist: 200 });
    expect(w).not.toBeNull();
    expect(w!.endMs - w!.startMs).toBe(12 * HOUR);
    expect(w!.startMs).toBe(DAY_START + 6 * HOUR);
  });

  it("keeps the time under the fingers pinned while zooming", () => {
    // Pinch centered at 25% of the plot (6 AM) — 6 AM stays at 25% after a 2× zoom.
    const w = pinch({ focalX0: PLOT_W * 0.25, focalX: PLOT_W * 0.25, dist: 200 })!;
    const span = w.endMs - w.startMs;
    expect(span).toBe(12 * HOUR);
    expect(w.startMs + span * 0.25).toBe(DAY_START + 6 * HOUR);
  });

  it("never zooms in past the minimum span", () => {
    const w = pinch({ dist: 100_000 })!;
    expect(w.endMs - w.startMs).toBe(MIN_ZOOM_SPAN_MS);
  });

  it("the full day is the maximum zoom-out — shrinking past it returns the null full view", () => {
    expect(pinch({ dist: 40 })).toBeNull();
    const zoomed = { startMs: DAY_START + 6 * HOUR, endMs: DAY_START + 12 * HOUR };
    expect(pinch({ startWindow: zoomed, dist: 10 })).toBeNull();
  });

  it("clamps the window inside the day at both edges", () => {
    // Zooming toward the very start of the day cannot scroll before midnight…
    const early = pinch({ focalX0: 0, focalX: PLOT_W, dist: 200 })!;
    expect(early.startMs).toBe(DAY.startMs);
    // …and toward the end cannot pass the day's end.
    const late = pinch({ focalX0: PLOT_W, focalX: 0, dist: 200 })!;
    expect(late.endMs).toBe(DAY.endMs);
  });

  it("two-finger drag (unchanged distance) pans a zoomed window", () => {
    const zoomed = { startMs: DAY_START + 8 * HOUR, endMs: DAY_START + 14 * HOUR };
    // Fingers slide left by half the plot → the view shifts half a window later in the day.
    const w = pinch({ startWindow: zoomed, focalX0: PLOT_W / 2, focalX: 0 })!;
    expect(w.endMs - w.startMs).toBe(6 * HOUR);
    expect(w.startMs).toBe(zoomed.startMs + 3 * HOUR);
  });

  it("ignores degenerate geometry", () => {
    expect(pinch({ dist0: 0 })).toBeNull();
    expect(pinch({ plotW: 0 })).toBeNull();
  });
});

describe("zoom-derived marker scaling", () => {
  it("zoomFactor is 1 for the full view and daySpan/span when zoomed", () => {
    expect(zoomFactor(DAY, null)).toBe(1);
    expect(zoomFactor(DAY, { startMs: DAY_START, endMs: DAY_START + 6 * HOUR })).toBe(4);
  });

  it("marker icons grow with the square root of zoom, capped", () => {
    expect(markerZoomScale(1)).toBe(1);
    expect(markerZoomScale(4)).toBe(2);
    expect(markerZoomScale(24)).toBe(MAX_MARKER_ZOOM_SCALE);
  });
});
