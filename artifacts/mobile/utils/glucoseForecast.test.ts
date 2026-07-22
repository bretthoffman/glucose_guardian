import { describe, expect, it } from "vitest";
import {
  anchorHourMs,
  forecastGlucose,
  predictionHourTicks,
  predictionWindow,
  type GlucoseForecastInput,
} from "./glucoseForecast";

/** Local-time millis for a given hour/minute today (the axis math is all local-tz). */
function at(hour: number, minute: number): number {
  return new Date(2026, 6, 22, hour, minute, 0, 0).getTime();
}

const visibleLabels = (ms: number) =>
  predictionHourTicks(ms).filter((t) => !t.hidden).map((t) => t.label);

describe("prediction hour axis (25-min rounding rule)", () => {
  it("6:18pm — drops the 6pm tick (within 25 min before Now)", () => {
    expect(visibleLabels(at(18, 18))).toEqual([
      "12pm", "1pm", "2pm", "3pm", "4pm", "5pm", "7pm", "8pm", "9pm", "10pm",
    ]);
  });

  it("6:30pm — keeps both 6pm and 7pm (exactly 30 min, outside the 25-min window)", () => {
    expect(visibleLabels(at(18, 30))).toEqual([
      "12pm", "1pm", "2pm", "3pm", "4pm", "5pm", "6pm", "7pm", "8pm", "9pm", "10pm",
    ]);
  });

  it("6:36pm — anchor rounds up to 7pm; drops the 7pm tick, window shifts to 1pm–11pm", () => {
    expect(visibleLabels(at(18, 36))).toEqual([
      "1pm", "2pm", "3pm", "4pm", "5pm", "6pm", "8pm", "9pm", "10pm", "11pm",
    ]);
  });

  it("anchors to the nearest hour with :30 rounding down", () => {
    expect(anchorHourMs(at(18, 18))).toBe(at(18, 0));
    expect(anchorHourMs(at(18, 30))).toBe(at(18, 0));
    expect(anchorHourMs(at(18, 36))).toBe(at(19, 0));
  });

  it("puts Now near 60% and spans exactly 10 hours", () => {
    const w = predictionWindow(at(18, 18));
    expect(w.spanMs).toBe(10 * 60 * 60 * 1000);
    expect(w.nowFrac).toBeCloseTo((6 * 60 + 18) / 600, 5); // 6h18m into a 10h span
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
