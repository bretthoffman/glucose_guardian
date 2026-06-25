import { T } from "../constants/theme";

export const CHART_Y_MIN = 40;
export const CHART_Y_MAX = 400;
const Y_RANGE = CHART_Y_MAX - CHART_Y_MIN;

/** Fixed gray right-axis grid labels (mg/dL). Grid lines always render; labels use visibility rules. */
export const FIXED_GRID_LABEL_VALUES = [400, 300, 200, 100, 40] as const;
export const NEUTRAL_GRID_100_VALUE = 100;
export const NEUTRAL_GRID_200_VALUE = 200;

/** Gray 100 label visible only when target glucose is 131 or greater. */
export const NEUTRAL_100_SHOW_TARGET_MIN = 131;

/** Gray 200 label hidden when high threshold is between 179 and 221 inclusive. */
export const NEUTRAL_200_HIDE_HIGH_MIN = 179;
export const NEUTRAL_200_HIDE_HIGH_MAX = 221;

/** Dot-mode ordinary reading marker size (60% of the original 3.5 radius). */
export const DOT_MODE_READING_RADIUS_BASE = 3.5;
export const DOT_MODE_READING_RADIUS = DOT_MODE_READING_RADIUS_BASE * 0.6;
export const DOT_MODE_READING_STROKE_BASE = 1;
export const DOT_MODE_READING_STROKE = DOT_MODE_READING_STROKE_BASE * 0.6;

export type AxisLabelKind = "neutral_grid" | "urgentHigh" | "high" | "target" | "low";

export interface AxisLabelSpec {
  value: number;
  color: string;
  kind: AxisLabelKind;
}

export interface PositionedAxisLabel extends AxisLabelSpec {
  top: number;
  /** Always false — labels are pinned to their glucose line coordinates. */
  nudged: boolean;
}

const KIND_PRIORITY: Record<AxisLabelKind, number> = {
  urgentHigh: 5,
  low: 4,
  high: 3,
  target: 2,
  neutral_grid: 1,
};

export const CHART_AXIS_LABEL_HEIGHT = 14;

/** Top offset for a right-axis label vertically centered on the glucose line. */
export function chartLabelTopForValue(
  glucose: number,
  chartHeight: number,
  labelHeight: number = CHART_AXIS_LABEL_HEIGHT,
): number {
  return chartValueToY(glucose, chartHeight) - labelHeight / 2;
}

export function shouldShowNeutral100Label(targetGlucose: number): boolean {
  return targetGlucose >= NEUTRAL_100_SHOW_TARGET_MIN;
}

export function shouldShowNeutral200Label(highThreshold: number): boolean {
  return highThreshold < NEUTRAL_200_HIDE_HIGH_MIN || highThreshold > NEUTRAL_200_HIDE_HIGH_MAX;
}

export function chartYPct(glucose: number): number {
  const clamped = Math.max(CHART_Y_MIN, Math.min(CHART_Y_MAX, glucose));
  return 1 - (clamped - CHART_Y_MIN) / Y_RANGE;
}

/** Canonical glucose value → plot-area Y (same coordinate space as SVG horizontal lines). */
export function chartValueToY(glucose: number, chartHeight: number): number {
  return chartYPct(glucose) * chartHeight;
}

export function formatGlucoseAxisLabel(value: number): string {
  return String(Math.round(value));
}

export function clampTargetGlucose(
  targetGlucose: number,
  lowThreshold: number,
  highThreshold: number,
): number {
  return Math.max(lowThreshold, Math.min(highThreshold, targetGlucose));
}

function fixedGridLabelSpecs(axisNeutralColor: string, params: {
  targetGlucose: number;
  highThreshold: number;
}): AxisLabelSpec[] {
  const specs: AxisLabelSpec[] = [
    { value: 400, color: axisNeutralColor, kind: "neutral_grid" },
    { value: 300, color: axisNeutralColor, kind: "neutral_grid" },
  ];
  if (shouldShowNeutral200Label(params.highThreshold)) {
    specs.push({ value: NEUTRAL_GRID_200_VALUE, color: axisNeutralColor, kind: "neutral_grid" });
  }
  if (shouldShowNeutral100Label(params.targetGlucose)) {
    specs.push({ value: NEUTRAL_GRID_100_VALUE, color: axisNeutralColor, kind: "neutral_grid" });
  }
  specs.push({ value: 40, color: axisNeutralColor, kind: "neutral_grid" });
  return specs;
}

/** Build right-axis label specs from fixed grid ticks and user thresholds. */
export function buildAxisLabelSpecs(params: {
  urgentHighThreshold: number;
  highThreshold: number;
  targetGlucose: number;
  lowThreshold: number;
  axisNeutralColor: string;
}): AxisLabelSpec[] {
  const target = clampTargetGlucose(
    params.targetGlucose,
    params.lowThreshold,
    params.highThreshold,
  );

  const raw: AxisLabelSpec[] = [
    ...fixedGridLabelSpecs(params.axisNeutralColor, {
      targetGlucose: params.targetGlucose,
      highThreshold: params.highThreshold,
    }),
    { value: params.urgentHighThreshold, color: T.color.coral, kind: "urgentHigh" },
    { value: params.highThreshold, color: T.color.emerald, kind: "high" },
    { value: target, color: T.color.violet, kind: "target" },
    { value: params.lowThreshold, color: T.color.coral, kind: "low" },
  ];

  const byValue = new Map<number, AxisLabelSpec>();
  for (const spec of raw) {
    const existing = byValue.get(spec.value);
    if (!existing || KIND_PRIORITY[spec.kind] > KIND_PRIORITY[existing.kind]) {
      byValue.set(spec.value, spec);
    }
  }

  return [...byValue.values()].sort((a, b) => b.value - a.value);
}

/** Pin every label to the canonical glucose line — no collision offsets. */
export function resolveAxisLabelPositions(
  specs: AxisLabelSpec[],
  chartHeight: number,
): PositionedAxisLabel[] {
  return specs.map((spec) => ({
    ...spec,
    top: chartLabelTopForValue(spec.value, chartHeight),
    nudged: false,
  }));
}
