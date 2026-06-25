import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
} from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { COLORS } from "@/constants/colors";
import { GLUCOSE_GRAPH_DISPLAY_MODE_STORAGE_KEY } from "@/constants/storage-keys";
import { T, glucoseTone, withAlpha, type ThemeColors } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import {
  buildAxisLabelSpecs,
  chartValueToY,
  clampTargetGlucose,
  DOT_MODE_READING_RADIUS,
  DOT_MODE_READING_STROKE,
  formatGlucoseAxisLabel,
  resolveAxisLabelPositions,
} from "@/utils/cgmChartAxis";
import {
  DEFAULT_GRAPH_DISPLAY_MODE,
  parseGraphDisplayMode,
  type GraphDisplayMode,
} from "@/utils/cgmChartDisplayMode";

const SCREEN_WIDTH = Dimensions.get("window").width;

export const Y_MIN = 40;
export const Y_MAX = 400;

export const LOW_THRESH = 70;
export const HIGH_THRESH = 180;

const Y_LABELS = [400, 300, 250, 200, 180, 100, 70, 40];

export type TimeRange = "3H" | "6H" | "12H" | "24H";
export const TIME_RANGES: TimeRange[] = ["3H", "6H", "12H", "24H"];
export const RANGE_MS: Record<TimeRange, number> = {
  "3H": 3 * 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "12H": 12 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
};

/** Dexcom-style CGM is ~5 min per point; beyond this delta we treat time as discontinuous and skip the line segment. */
const CHART_LINE_GAP_BREAK_MS = 20 * 60 * 1000;

export interface CGMReading {
  glucose: number;
  timestamp: string;
}

/**
 * Shared glucose→color helper. UNCHANGED hex values: the Dose screen (`app/(tabs)/insulin.tsx`)
 * imports this for its own inline chart, so its colors must stay identical. The redesigned chart
 * below uses the clinical `glucoseTone` palette instead — this remains for external callers.
 */
export function glucoseColor(val: number, low = LOW_THRESH, high = HIGH_THRESH, urgentLow = 55): string {
  if (val < urgentLow) return COLORS.danger;
  if (val < low) return "#F97316";
  if (val <= high) return COLORS.success;
  if (val <= 300) return COLORS.warning;
  return COLORS.danger;
}

interface CGMChartProps {
  readings: CGMReading[];
  targetGlucose?: number;
  chartHeight?: number;
  paddingHorizontal?: number;
  darkBg?: string;
  timeRange?: TimeRange;
  onRangeChange?: (range: TimeRange) => void;
  urgentLowThreshold?: number;
  lowThreshold?: number;
  highThreshold?: number;
  urgentHighThreshold?: number;
}

type Pt = { x: number; y: number; glucose: number };

export function CGMChart({
  readings,
  targetGlucose = 120,
  chartHeight = 220,
  paddingHorizontal = 36,
  darkBg,
  timeRange: controlledRange,
  onRangeChange,
  urgentLowThreshold = 55,
  lowThreshold = LOW_THRESH,
  highThreshold = HIGH_THRESH,
  urgentHighThreshold = 250,
}: CGMChartProps) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const isControlled = controlledRange !== undefined;
  const [internalRange, setInternalRange] = useState<TimeRange>("6H");
  const [displayMode, setDisplayMode] = useState<GraphDisplayMode>(DEFAULT_GRAPH_DISPLAY_MODE);
  const timeRange = isControlled ? controlledRange : internalRange;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(GLUCOSE_GRAPH_DISPLAY_MODE_STORAGE_KEY);
        if (!cancelled) setDisplayMode(parseGraphDisplayMode(raw));
      } catch {
        // Keep the line default when storage is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDisplayMode = useCallback(() => {
    setDisplayMode((prev) => {
      const next: GraphDisplayMode = prev === "line" ? "dots" : "line";
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      AsyncStorage.setItem(GLUCOSE_GRAPH_DISPLAY_MODE_STORAGE_KEY, next).catch(() => {
        // Keep the in-session choice when persistence fails.
      });
      return next;
    });
  }, []);

  const H = chartHeight;
  const yAxisW = 40;
  const plotW = Math.max(60, SCREEN_WIDTH - paddingHorizontal * 2 - yAxisW);
  const plotY = (glucose: number) => chartValueToY(glucose, H);

  const now = Date.now();
  const windowMs = RANGE_MS[timeRange];
  const windowStart = now - windowMs;

  const filtered = readings
    .filter((r) => new Date(r.timestamp).getTime() >= windowStart)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  function handleRangePress(r: TimeRange) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isControlled) {
      onRangeChange?.(r);
    } else {
      setInternalRange(r);
      onRangeChange?.(r);
    }
  }

  const points: Pt[] = filtered.map((r) => ({
    x: Math.max(0, Math.min(plotW, ((new Date(r.timestamp).getTime() - windowStart) / windowMs) * plotW)),
    y: plotY(r.glucose),
    glucose: r.glucose,
  }));

  const gapAfterIndex: boolean[] = filtered.map((r, i) => {
    if (i >= filtered.length - 1) return false;
    const dt = new Date(filtered[i + 1].timestamp).getTime() - new Date(r.timestamp).getTime();
    return dt > CHART_LINE_GAP_BREAK_MS;
  });

  const urgentLowLineY = plotY(urgentLowThreshold);
  const lowLineY = plotY(lowThreshold);
  const highLineY = plotY(highThreshold);
  const urgentHighLineY = plotY(urgentHighThreshold);
  const clampedTargetGlucose = clampTargetGlucose(targetGlucose, lowThreshold, highThreshold);
  const targetLineY = plotY(clampedTargetGlucose);

  function xLabel(msFromStart: number): string {
    const hoursAgo = Math.round((windowMs - msFromStart) / (60 * 60 * 1000));
    if (hoursAgo === 0) return "Now";
    if (windowMs >= RANGE_MS["12H"]) return `${hoursAgo}h ago`;
    return new Date(windowStart + msFromStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const startTime = xLabel(0);
  const midTime = xLabel(windowMs / 2);

  // Split into contiguous runs (gap breaks), preserving the discontinuity logic above.
  const runs: Pt[][] = [];
  {
    let cur: Pt[] = [];
    for (let i = 0; i < points.length; i++) {
      cur.push(points[i]);
      if (gapAfterIndex[i]) {
        runs.push(cur);
        cur = [];
      }
    }
    if (cur.length) runs.push(cur);
  }

  // Within a run, group adjacent segments by clinical color into joined polylines (rounded joins).
  function colorRuns(run: Pt[]): { color: string; d: string }[] {
    if (run.length < 2) return [];
    // Four-state by the ACCOUNT's thresholds: <low coral, in-range emerald, high<urgentHigh amber, >=urgentHigh coral.
    const tone = (a: Pt, b: Pt) => glucoseTone((a.glucose + b.glucose) / 2, lowThreshold, highThreshold, urgentHighThreshold);
    const out: { color: string; pts: Pt[] }[] = [];
    let cur = { color: tone(run[0], run[1]), pts: [run[0], run[1]] };
    for (let i = 1; i < run.length - 1; i++) {
      const c = tone(run[i], run[i + 1]);
      if (c === cur.color) {
        cur.pts.push(run[i + 1]);
      } else {
        out.push(cur);
        cur = { color: c, pts: [run[i], run[i + 1]] };
      }
    }
    out.push(cur);
    return out.map((r) => ({ color: r.color, d: r.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") }));
  }

  // Deviation band polygon: along the trend line, then back along the midline. Filled twice — clipped
  // to above/below the midline — so it is emerald above target and coral below, never a full area fill.
  function bandPath(run: Pt[]): string | null {
    if (run.length < 2) return null;
    let d = `M ${run[0].x.toFixed(1)} ${run[0].y.toFixed(1)}`;
    for (let i = 1; i < run.length; i++) d += ` L ${run[i].x.toFixed(1)} ${run[i].y.toFixed(1)}`;
    d += ` L ${run[run.length - 1].x.toFixed(1)} ${targetLineY.toFixed(1)}`;
    d += ` L ${run[0].x.toFixed(1)} ${targetLineY.toFixed(1)} Z`;
    return d;
  }

  const tMid = Math.max(0.001, Math.min(0.999, targetLineY / H));
  const last = points[points.length - 1];
  const lastColor = last ? glucoseTone(last.glucose, lowThreshold, highThreshold, urgentHighThreshold) : T.color.emerald;

  const axisLabelSpecs = useMemo(
    () =>
      buildAxisLabelSpecs({
        urgentHighThreshold,
        highThreshold,
        targetGlucose,
        lowThreshold,
        axisNeutralColor: c.axis,
      }),
    [urgentHighThreshold, highThreshold, targetGlucose, lowThreshold, c.axis],
  );

  const axisLabels = useMemo(
    () => resolveAxisLabelPositions(axisLabelSpecs, H),
    [axisLabelSpecs, H],
  );

  const inView = (y: number) => y >= -0.5 && y <= H + 0.5;

  return (
    <View style={styles.wrapper}>
      <View style={styles.topRow}>
        <View style={styles.segment}>
          {TIME_RANGES.map((r) => {
            const active = timeRange === r;
            return (
              <Pressable
                key={r}
                style={[styles.segTab, active && styles.segTabActive]}
                onPress={() => handleRangePress(r)}
                hitSlop={6}
              >
                <Text style={[styles.segText, { color: active ? c.chartControlActiveText : c.textMuted }]}>{r}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.unitLabel}>mg/dL</Text>
      </View>

      <View style={[styles.chartRow, { height: H }]}>
        <Pressable
          style={{ width: plotW, height: H }}
          onPress={toggleDisplayMode}
          accessibilityRole="button"
          accessibilityLabel="Glucose graph display"
          accessibilityHint={
            displayMode === "line"
              ? "Double tap to show glucose readings as individual dots"
              : "Double tap to connect glucose readings with a line"
          }
        >
          <Svg width={plotW} height={H}>
            <Defs>
              <SvgLinearGradient id="devUp" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={T.color.emerald} stopOpacity={0.3} />
                <Stop offset={tMid} stopColor={T.color.emerald} stopOpacity={0.04} />
                <Stop offset="1" stopColor={T.color.emerald} stopOpacity={0.04} />
              </SvgLinearGradient>
              <SvgLinearGradient id="devDown" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={T.color.coral} stopOpacity={0.04} />
                <Stop offset={tMid} stopColor={T.color.coral} stopOpacity={0.04} />
                <Stop offset="1" stopColor={T.color.coral} stopOpacity={0.3} />
              </SvgLinearGradient>
              <ClipPath id="aboveMid">
                <Rect x="0" y="0" width={plotW} height={Math.max(0, targetLineY)} />
              </ClipPath>
              <ClipPath id="belowMid">
                <Rect x="0" y={Math.max(0, targetLineY)} width={plotW} height={Math.max(0, H - targetLineY)} />
              </ClipPath>
            </Defs>

            {/* faint horizontal grid */}
            {Y_LABELS.map((v) => {
              const y = plotY(v);
              if (!inView(y)) return null;
              return <Line key={`g-${v}`} x1={0} y1={y} x2={plotW} y2={y} stroke={c.grid} strokeWidth={1} />;
            })}

            {/* deviation shading — clipped to each side of the midline */}
            <G clipPath="url(#aboveMid)">
              {runs.map((run, i) => {
                const d = bandPath(run);
                return d ? <Path key={`bu-${i}`} d={d} fill="url(#devUp)" /> : null;
              })}
            </G>
            <G clipPath="url(#belowMid)">
              {runs.map((run, i) => {
                const d = bandPath(run);
                return d ? <Path key={`bd-${i}`} d={d} fill="url(#devDown)" /> : null;
              })}
            </G>

            {/* threshold references (restrained) */}
            {inView(urgentHighLineY) && (
              <Line x1={0} y1={urgentHighLineY} x2={plotW} y2={urgentHighLineY} stroke={T.color.coral} strokeWidth={1} strokeDasharray="5 6" opacity={0.7} />
            )}
            {inView(highLineY) && (
              <Line x1={0} y1={highLineY} x2={plotW} y2={highLineY} stroke={T.color.emerald} strokeWidth={1} strokeDasharray="5 6" opacity={0.55} />
            )}
            {inView(lowLineY) && (
              <Line x1={0} y1={lowLineY} x2={plotW} y2={lowLineY} stroke={T.color.coral} strokeWidth={1} strokeDasharray="4 7" opacity={0.4} />
            )}
            {/* optimal midline — solid violet-blue */}
            {inView(targetLineY) && (
              <Line x1={0} y1={targetLineY} x2={plotW} y2={targetLineY} stroke={T.color.violet} strokeWidth={1.5} opacity={0.9} />
            )}

            {displayMode === "line" &&
              runs.map((run, ri) =>
                colorRuns(run).map((cr, ci) => (
                  <Polyline
                    key={`l-${ri}-${ci}`}
                    points={cr.d}
                    fill="none"
                    stroke={cr.color}
                    strokeWidth={2.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )),
              )}

            {displayMode === "dots" &&
              points.map((p, i) => {
                if (i === points.length - 1) return null;
                const dotColor = glucoseTone(p.glucose, lowThreshold, highThreshold, urgentHighThreshold);
                return (
                  <Circle
                    key={`d-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={DOT_MODE_READING_RADIUS}
                    fill={dotColor}
                    stroke={withAlpha(dotColor, 0.55)}
                    strokeWidth={DOT_MODE_READING_STROKE}
                  />
                );
              })}

            {/* single emphasized current point */}
            {last && (
              <>
                <Circle cx={last.x} cy={last.y} r={9} fill={withAlpha(lastColor, 0.18)} />
                <Circle cx={last.x} cy={last.y} r={5} fill={c.pointCenter} stroke={lastColor} strokeWidth={2.5} />
              </>
            )}
          </Svg>

          {filtered.length === 0 && (
            <View style={styles.emptyOverlay} pointerEvents="none">
              <Text style={styles.emptyText}>No readings in this window</Text>
            </View>
          )}
        </Pressable>

        {/* y-axis on the right, matching the reference */}
        <View style={[styles.yAxis, { width: yAxisW, height: H }]}>
          {axisLabels.map((label) => {
            if (label.top < -8 || label.top > H - 6) return null;
            return (
              <Text
                key={`${label.kind}-${label.value}`}
                style={[styles.yLabel, { top: label.top, color: label.color }]}
              >
                {formatGlucoseAxisLabel(label.value)}
              </Text>
            );
          })}
        </View>
      </View>

      <View style={[styles.xAxis, { width: plotW }]}>
        <Text style={styles.xLabel}>{startTime}</Text>
        <Text style={styles.xLabel}>{midTime}</Text>
        <Text style={styles.xLabel}>Now</Text>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrapper: { width: "100%" },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.chartControlTrack,
    borderRadius: T.radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: c.border,
  },
  segTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: T.radius.pill - 4,
    minWidth: 46,
    alignItems: "center",
  },
  segTabActive: {
    backgroundColor: c.chartControlActive,
  },
  segText: { fontSize: 12.5, fontWeight: T.font.semibold, letterSpacing: 0.2 },
  unitLabel: { fontSize: 11, fontWeight: T.font.medium, color: c.textMuted },

  chartRow: { flexDirection: "row", alignItems: "flex-start" },

  emptyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { color: c.textMuted, fontSize: 13, fontWeight: T.font.regular },

  yAxis: { position: "relative", marginLeft: 6 },
  yLabel: {
    position: "absolute",
    fontSize: 9.5,
    fontWeight: T.font.medium,
    right: 0,
    textAlign: "right",
    width: 34,
  },

  xAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 2,
  },
  xLabel: { fontSize: 10.5, fontWeight: T.font.regular, color: c.textMuted },
});
