import { describe, expect, it } from "vitest";
import { T } from "../constants/theme";
import {
  AXIS_LABEL_MIN_SPACING,
  buildAxisLabelSpecs,
  clampTargetGlucose,
  formatGlucoseAxisLabel,
  resolveAxisLabelPositions,
} from "./cgmChartAxis";
import {
  DEFAULT_GRAPH_DISPLAY_MODE,
  parseGraphDisplayMode,
} from "./cgmChartDisplayMode";

const neutral = "#888888";

describe("parseGraphDisplayMode", () => {
  it("defaults to line when unset or invalid", () => {
    expect(DEFAULT_GRAPH_DISPLAY_MODE).toBe("line");
    expect(parseGraphDisplayMode(null)).toBe("line");
    expect(parseGraphDisplayMode(undefined)).toBe("line");
    expect(parseGraphDisplayMode("")).toBe("line");
    expect(parseGraphDisplayMode("line")).toBe("line");
    expect(parseGraphDisplayMode("scatter")).toBe("line");
  });

  it("restores dots mode from storage", () => {
    expect(parseGraphDisplayMode("dots")).toBe("dots");
  });
});

describe("buildAxisLabelSpecs", () => {
  const base = {
    urgentHighThreshold: 250,
    highThreshold: 180,
    targetGlucose: 125,
    lowThreshold: 70,
    axisNeutralColor: neutral,
  };

  it("assigns red to upper and lower alert thresholds", () => {
    const specs = buildAxisLabelSpecs(base);
    expect(specs.find((s) => s.kind === "urgentHigh")).toMatchObject({
      value: 250,
      color: T.color.coral,
    });
    expect(specs.find((s) => s.kind === "low")).toMatchObject({
      value: 70,
      color: T.color.coral,
    });
  });

  it("assigns green to the in-range upper threshold", () => {
    const specs = buildAxisLabelSpecs(base);
    expect(specs.find((s) => s.kind === "high")).toMatchObject({
      value: 180,
      color: T.color.emerald,
    });
  });

  it("assigns purple to the configured target glucose", () => {
    const specs = buildAxisLabelSpecs({ ...base, targetGlucose: 132 });
    expect(specs.find((s) => s.kind === "target")).toMatchObject({
      value: 132,
      color: T.color.violet,
    });
  });

  it("updates when target glucose changes", () => {
    const first = buildAxisLabelSpecs({ ...base, targetGlucose: 110 });
    const second = buildAxisLabelSpecs({ ...base, targetGlucose: 140 });
    expect(first.find((s) => s.kind === "target")?.value).toBe(110);
    expect(second.find((s) => s.kind === "target")?.value).toBe(140);
  });

  it("clamps target glucose to the configured low/high band", () => {
    expect(clampTargetGlucose(60, 70, 180)).toBe(70);
    expect(clampTargetGlucose(200, 70, 180)).toBe(180);
  });

  it("formats glucose labels as rounded integers", () => {
    expect(formatGlucoseAxisLabel(124.6)).toBe("125");
  });
});

describe("resolveAxisLabelPositions", () => {
  it("keeps threshold labels vertically separated", () => {
    const specs = buildAxisLabelSpecs({
      urgentHighThreshold: 250,
      highThreshold: 180,
      targetGlucose: 125,
      lowThreshold: 70,
      axisNeutralColor: neutral,
    });
    const positioned = resolveAxisLabelPositions(specs, 264);
    const thresholds = positioned.filter((l) => l.kind !== "neutral");
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i].top - thresholds[i - 1].top).toBeGreaterThanOrEqual(AXIS_LABEL_MIN_SPACING - 0.01);
    }
  });

  it("nudges colliding labels instead of hiding them", () => {
    const specs = buildAxisLabelSpecs({
      urgentHighThreshold: 250,
      highThreshold: 180,
      targetGlucose: 178,
      lowThreshold: 70,
      axisNeutralColor: neutral,
    });
    const positioned = resolveAxisLabelPositions(specs, 264);
    const high = positioned.find((l) => l.kind === "high");
    const target = positioned.find((l) => l.kind === "target");
    expect(high).toBeDefined();
    expect(target).toBeDefined();
    expect(high!.value).toBe(180);
    expect(target!.value).toBe(178);
    expect(Math.abs(high!.top - target!.top)).toBeGreaterThanOrEqual(AXIS_LABEL_MIN_SPACING - 0.01);
    expect(high!.nudged || target!.nudged).toBe(true);
  });
});
