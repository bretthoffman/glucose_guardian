import { T } from "../constants/theme";

export const CHART_Y_MIN = 40;
export const CHART_Y_MAX = 400;
const Y_RANGE = CHART_Y_MAX - CHART_Y_MIN;

export type AxisLabelKind = "neutral" | "urgentHigh" | "high" | "target" | "low";

export interface AxisLabelSpec {
  value: number;
  color: string;
  kind: AxisLabelKind;
}

export interface PositionedAxisLabel extends AxisLabelSpec {
  top: number;
  /** True when vertical nudging was applied to avoid label overlap. */
  nudged: boolean;
}

const KIND_PRIORITY: Record<AxisLabelKind, number> = {
  urgentHigh: 5,
  low: 4,
  high: 3,
  target: 2,
  neutral: 1,
};

const LABEL_HEIGHT = 14;
const MIN_LABEL_GAP = 2;
export const AXIS_LABEL_MIN_SPACING = LABEL_HEIGHT + MIN_LABEL_GAP;

export function chartYPct(glucose: number): number {
  const clamped = Math.max(CHART_Y_MIN, Math.min(CHART_Y_MAX, glucose));
  return 1 - (clamped - CHART_Y_MIN) / Y_RANGE;
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

/** Build right-axis label specs from user thresholds and target glucose. */
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
    { value: CHART_Y_MAX, color: params.axisNeutralColor, kind: "neutral" },
    { value: params.urgentHighThreshold, color: T.color.coral, kind: "urgentHigh" },
    { value: params.highThreshold, color: T.color.emerald, kind: "high" },
    { value: target, color: T.color.violet, kind: "target" },
    { value: params.lowThreshold, color: T.color.coral, kind: "low" },
    { value: CHART_Y_MIN, color: params.axisNeutralColor, kind: "neutral" },
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

/**
 * Assign vertical label positions with a minimum spacing rule.
 * When configured values are very close, lower-priority labels are nudged (not hidden).
 * Underlying threshold/target lines are unchanged — only the numeric labels shift.
 */
export function resolveAxisLabelPositions(
  specs: AxisLabelSpec[],
  chartHeight: number,
): PositionedAxisLabel[] {
  const items = specs
    .map((spec) => {
      const idealTop = chartYPct(spec.value) * chartHeight - LABEL_HEIGHT / 2;
      return { ...spec, idealTop, top: idealTop, nudged: false };
    })
    .sort((a, b) => a.idealTop - b.idealTop);

  const nudgeLowerPriority = (fixed: (typeof items)[number], moving: (typeof items)[number]) => {
    const minTop = fixed.top + AXIS_LABEL_MIN_SPACING;
    if (moving.top < minTop) {
      moving.top = minTop;
      moving.nudged = true;
    }
  };

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (KIND_PRIORITY[cur.kind] > KIND_PRIORITY[prev.kind]) {
      nudgeLowerPriority(cur, prev);
    } else {
      nudgeLowerPriority(prev, cur);
    }
  }

  const maxTop = chartHeight - LABEL_HEIGHT;
  for (let i = items.length - 1; i >= 0; i--) {
    const cur = items[i];
    if (cur.top > maxTop) {
      cur.top = maxTop;
      cur.nudged = true;
    }
    if (i > 0) {
      const prev = items[i - 1];
      const maxPrevTop = cur.top - AXIS_LABEL_MIN_SPACING;
      if (prev.top > maxPrevTop) {
        if (KIND_PRIORITY[prev.kind] > KIND_PRIORITY[cur.kind]) {
          cur.top = prev.top + AXIS_LABEL_MIN_SPACING;
          cur.nudged = true;
        } else {
          prev.top = maxPrevTop;
          prev.nudged = true;
        }
      }
    }
  }

  return items.map(({ idealTop: _idealTop, ...rest }) => rest);
}
