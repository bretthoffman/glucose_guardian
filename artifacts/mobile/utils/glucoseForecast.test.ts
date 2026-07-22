import { describe, expect, it } from "vitest";
import {
  BASAL_PREDICTION_WINDOW,
  forecastGlucose,
  predictionHourTicks,
  predictionWindow,
  type GlucoseForecastInput,
  type PredictionWindowConfig,
} from "./glucoseForecast";

/** Local-time millis for a given hour/minute today (the axis math is all local-tz). */
function at(hour: number, minute: number): number {
  return new Date(2026, 6, 22, hour, minute, 0, 0).getTime();
}

const HOUR = 60 * 60 * 1000;
const visibleLabels = (ms: number, config?: PredictionWindowConfig) =>
  predictionHourTicks(ms, config).filter((t) => !t.hidden).map((t) => t.label);

// Bolus window: now-relative, 3h back / 1.5h forward, hide whole-hour ticks within 25 min of Now.
describe("prediction hour axis — bolus window (3h/1.5h, now-relative)", () => {
  it("ends exactly 1.5h past now and starts 3h before (never snaps to a whole hour)", () => {
    const now = at(16, 45);
    const w = predictionWindow(now);
    expect(w.rightMs).toBe(now + 1.5 * HOUR);
    expect(w.leftMs).toBe(now - 3 * HOUR);
  });

  it("spans exactly 4.5 hours with Now at a fixed 2/3 fraction", () => {
    const w = predictionWindow(at(16, 45));
    expect(w.spanMs).toBe(4.5 * HOUR);
    expect(w.nowFrac).toBeCloseTo(3 / 4.5, 5);
  });

  it("5:00pm — whole-hour ticks inside the window, 5pm hidden under Now", () => {
    expect(visibleLabels(at(17, 0))).toEqual(["2pm", "3pm", "4pm", "6pm"]);
  });

  it("4:45pm — 5pm hidden (15 min from Now); window still ends at 6:15 so 6pm shows", () => {
    expect(visibleLabels(at(16, 45))).toEqual(["2pm", "3pm", "4pm", "6pm"]);
  });
});

// Long-acting window: now-relative, 6h back / 4h forward, hide ticks within 35 min of Now.
describe("prediction hour axis — basal window (6h/4h, now-relative)", () => {
  const cfg = BASAL_PREDICTION_WINDOW;

  it("spans exactly 10 hours ending 4h past now", () => {
    const now = at(17, 0);
    const w = predictionWindow(now, cfg);
    expect(w.spanMs).toBe(10 * HOUR);
    expect(w.rightMs).toBe(now + 4 * HOUR);
  });

  it("5:00pm — hides the 5pm tick within 35 min of Now, keeps the far ends", () => {
    const vis = visibleLabels(at(17, 0), cfg);
    expect(vis).not.toContain("5pm");
    expect(vis).toContain("4pm");
    expect(vis).toContain("11am");
    expect(vis).toContain("9pm");
  });
});

describe("forecastGlucose", () => {
  const base: GlucoseForecastInput = {
    currentBG: 180,
    nowMs: at(12, 0),
    insulinLog: [],
    foodLog: [],
    newDoseUnits: 0,
    newCarbsGrams: 0,
    correctionFactor: 50,
    carbRatio: 15,
  };

  it("stays flat at currentBG with no active agents and no new dose/carbs", () => {
    const pts = forecastGlucose(base);
    expect(pts[0].bg).toBe(180);
    expect(pts[pts.length - 1].bg).toBe(180);
    expect(pts.every((p) => p.bg === 180)).toBe(true);
  });

  it("a taken dose lowers BG toward (currentBG − ISF·units) by the end of its 4h action", () => {
    const pts = forecastGlucose({ ...base, newDoseUnits: 2 }); // 2u × 50 = 100 mg/dL over 4h
    expect(pts[0].bg).toBe(180);
    const last = pts[pts.length - 1];
    expect(last.tMin).toBe(240);
    expect(last.bg).toBe(80); // 180 − 100
    // Monotonically non-increasing as the linear insulin action delivers.
    for (let i = 1; i < pts.length; i++) expect(pts[i].bg).toBeLessThanOrEqual(pts[i - 1].bg);
  });

  it("entered carbs raise BG (1 g ≈ ISF/carbRatio mg/dL)", () => {
    const pts = forecastGlucose({ ...base, newCarbsGrams: 15 }); // 15g × (50/15) = 50 over 3h
    const at3h = pts.find((p) => p.tMin === 180)!;
    expect(at3h.bg).toBe(230); // 180 + 50, fully absorbed at 3h
  });

  it("nets the still-to-act portion of already-active insulin into the projection", () => {
    const pts = forecastGlucose({
      ...base,
      // A 1u rapid dose (50 mg/dL total) taken 2h ago is halfway through its 4h linear action, so
      // only the remaining half (25 mg/dL) is still to be delivered over the forecast window.
      insulinLog: [{ id: "x", units: 1, timestamp: new Date(at(10, 0)).toISOString(), type: "bolus" } as never],
    });
    const last = pts[pts.length - 1];
    expect(last.bg).toBe(155); // 180 − 25
  });
});
