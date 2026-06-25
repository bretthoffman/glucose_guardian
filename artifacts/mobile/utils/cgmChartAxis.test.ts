import { describe, expect, it } from "vitest";
import { T } from "../constants/theme";
import {
  CHART_AXIS_LABEL_HEIGHT,
  NEUTRAL_GRID_100_VALUE,
  NEUTRAL_GRID_200_VALUE,
  buildAxisLabelSpecs,
  chartLabelTopForValue,
  chartValueToY,
  chartYPct,
  clampTargetGlucose,
  DOT_MODE_READING_RADIUS,
  DOT_MODE_READING_RADIUS_BASE,
  DOT_MODE_READING_STROKE,
  DOT_MODE_READING_STROKE_BASE,
  formatGlucoseAxisLabel,
  resolveAxisLabelPositions,
  shouldShowNeutral100Label,
  shouldShowNeutral200Label,
} from "./cgmChartAxis";
import {
  DEFAULT_GRAPH_DISPLAY_MODE,
  parseGraphDisplayMode,
} from "./cgmChartDisplayMode";

const neutral = "#888888";
const base = {
  urgentHighThreshold: 250,
  highThreshold: 180,
  targetGlucose: 150,
  lowThreshold: 70,
  axisNeutralColor: neutral,
};

function gridLabel(specs: ReturnType<typeof buildAxisLabelSpecs>, value: number) {
  return specs.find((s) => s.kind === "neutral_grid" && s.value === value);
}

describe("parseGraphDisplayMode", () => {
  it("defaults to line when unset or invalid", () => {
    expect(DEFAULT_GRAPH_DISPLAY_MODE).toBe("line");
    expect(parseGraphDisplayMode(null)).toBe("line");
    expect(parseGraphDisplayMode("dots")).toBe("dots");
  });
});

describe("buildAxisLabelSpecs — dynamic labels", () => {
  it("assigns threshold and target colors", () => {
    const specs = buildAxisLabelSpecs(base);
    expect(specs.find((s) => s.kind === "urgentHigh")).toMatchObject({ value: 250, color: T.color.coral });
    expect(specs.find((s) => s.kind === "high")).toMatchObject({ value: 180, color: T.color.emerald });
    expect(specs.find((s) => s.kind === "target")).toMatchObject({ value: 150, color: T.color.violet });
    expect(specs.find((s) => s.kind === "low")).toMatchObject({ value: 70, color: T.color.coral });
  });

  it("clamps target glucose to the configured low/high band", () => {
    expect(clampTargetGlucose(60, 70, 180)).toBe(70);
    expect(clampTargetGlucose(200, 70, 180)).toBe(180);
  });

  it("formats glucose labels as rounded integers", () => {
    expect(formatGlucoseAxisLabel(124.6)).toBe("125");
  });
});

describe("fixed gray 400/300/40 labels", () => {
  it("always includes 400, 300, and 40 grid labels", () => {
    const specs = buildAxisLabelSpecs(base);
    expect(gridLabel(specs, 400)).toBeDefined();
    expect(gridLabel(specs, 300)).toBeDefined();
    expect(gridLabel(specs, 40)).toBeDefined();
  });
});

describe("gray 200-label visibility", () => {
  it("shows when high threshold is below 179", () => {
    expect(shouldShowNeutral200Label(178)).toBe(true);
    expect(gridLabel(buildAxisLabelSpecs({ ...base, highThreshold: 178 }), 200)).toBeDefined();
  });

  it("hides when high threshold is between 179 and 221 inclusive", () => {
    for (const high of [179, 200, 221]) {
      expect(shouldShowNeutral200Label(high)).toBe(false);
      expect(gridLabel(buildAxisLabelSpecs({ ...base, highThreshold: high }), 200)).toBeUndefined();
      expect(specsIncludeHigh(buildAxisLabelSpecs({ ...base, highThreshold: high }), high)).toBe(true);
    }
  });

  it("shows when high threshold is above 221", () => {
    expect(shouldShowNeutral200Label(222)).toBe(true);
    expect(gridLabel(buildAxisLabelSpecs({ ...base, highThreshold: 222 }), 200)).toBeDefined();
  });
});

describe("gray 100-label visibility", () => {
  it("hides when target is 130 or below", () => {
    for (const target of [100, 120, 130]) {
      expect(shouldShowNeutral100Label(target)).toBe(false);
      expect(gridLabel(buildAxisLabelSpecs({ ...base, targetGlucose: target }), 100)).toBeUndefined();
    }
  });

  it("shows when target is 131 or greater", () => {
    expect(shouldShowNeutral100Label(131)).toBe(true);
    expect(shouldShowNeutral100Label(150)).toBe(true);
    expect(gridLabel(buildAxisLabelSpecs({ ...base, targetGlucose: 131 }), 100)).toBeDefined();
    expect(gridLabel(buildAxisLabelSpecs({ ...base, targetGlucose: 150 }), 100)).toBeDefined();
  });
});

function specsIncludeHigh(specs: ReturnType<typeof buildAxisLabelSpecs>, high: number) {
  return specs.some((s) => s.kind === "high" && s.value === high);
}

describe("chartValueToY", () => {
  const H = 264;

  it("maps glucose values into plot coordinates", () => {
    expect(chartValueToY(120, H)).toBe(chartYPct(120) * H);
    expect(chartValueToY(100, H)).toBe(chartYPct(100) * H);
  });

  it("centers axis labels on the same Y as horizontal lines", () => {
    for (const value of [40, 100, 200, 300, 400]) {
      const lineY = chartValueToY(value, H);
      const labelTop = chartLabelTopForValue(value, H);
      expect(labelTop + CHART_AXIS_LABEL_HEIGHT / 2).toBeCloseTo(lineY, 5);
    }
  });
});

describe("resolveAxisLabelPositions", () => {
  const H = 264;

  it("pins fixed grid labels on their grid-line coordinates", () => {
    const specs = buildAxisLabelSpecs(base);
    const positioned = resolveAxisLabelPositions(specs, H);
    for (const value of [40, 100, 200, 300, 400] as const) {
      const label = positioned.find((l) => l.kind === "neutral_grid" && l.value === value);
      if (!label) continue;
      expect(label.nudged).toBe(false);
      expect(label.top).toBe(chartLabelTopForValue(value, H));
      expect(label.top + CHART_AXIS_LABEL_HEIGHT / 2).toBeCloseTo(chartValueToY(value, H), 5);
    }
  });

  it("pins the target label on the target line", () => {
    const specs = buildAxisLabelSpecs({ ...base, targetGlucose: 120 });
    const target = resolveAxisLabelPositions(specs, H).find((l) => l.kind === "target");
    expect(target).toBeDefined();
    expect(target!.nudged).toBe(false);
    expect(target!.top + CHART_AXIS_LABEL_HEIGHT / 2).toBeCloseTo(chartValueToY(120, H), 5);
  });

  it("pins dynamic threshold labels on their lines", () => {
    const specs = buildAxisLabelSpecs(base);
    const positioned = resolveAxisLabelPositions(specs, H);
    for (const kind of ["urgentHigh", "high", "low"] as const) {
      const label = positioned.find((l) => l.kind === kind);
      expect(label).toBeDefined();
      expect(label!.top + CHART_AXIS_LABEL_HEIGHT / 2).toBeCloseTo(chartValueToY(label!.value, H), 5);
    }
  });
});

describe("dot mode marker sizing", () => {
  it("scales ordinary reading dots to 60% of the prior radius", () => {
    expect(DOT_MODE_READING_RADIUS).toBeCloseTo(DOT_MODE_READING_RADIUS_BASE * 0.6, 5);
    expect(DOT_MODE_READING_STROKE).toBeCloseTo(DOT_MODE_READING_STROKE_BASE * 0.6, 5);
  });
});
