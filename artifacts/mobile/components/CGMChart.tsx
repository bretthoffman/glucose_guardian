import React, { useState } from "react";
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { COLORS } from "@/constants/colors";

const SCREEN_WIDTH = Dimensions.get("window").width;

export const Y_MIN = 40;
export const Y_MAX = 400;
const Y_RANGE = Y_MAX - Y_MIN;
const Y_LABELS = [400, 300, 250, 200, 180, 100, 70, 40];

export const LOW_THRESH = 70;
export const HIGH_THRESH = 180;

export type TimeRange = "3H" | "6H" | "12H" | "24H";
export const TIME_RANGES: TimeRange[] = ["3H", "6H", "12H", "24H"];
export const RANGE_MS: Record<TimeRange, number> = {
  "3H": 3 * 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "12H": 12 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
};

export interface CGMReading {
  glucose: number;
  timestamp: string;
}

export function glucoseColor(val: number, low = LOW_THRESH, high = HIGH_THRESH, urgentLow = 55): string {
  if (val < urgentLow) return COLORS.danger;
  if (val < low) return "#F97316";
  if (val <= high) return COLORS.success;
  if (val <= 300) return COLORS.warning;
  return COLORS.danger;
}

function yPct(glucose: number): number {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, glucose));
  return 1 - (clamped - Y_MIN) / Y_RANGE;
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

export function CGMChart({
  readings,
  targetGlucose = 120,
  chartHeight = 220,
  paddingHorizontal = 36,
  darkBg = "#0F172A",
  timeRange: controlledRange,
  onRangeChange,
  urgentLowThreshold = 55,
  lowThreshold = LOW_THRESH,
  highThreshold = HIGH_THRESH,
  urgentHighThreshold = 250,
}: CGMChartProps) {
  const isControlled = controlledRange !== undefined;
  const [internalRange, setInternalRange] = useState<TimeRange>("6H");
  const timeRange = isControlled ? controlledRange : internalRange;

  const CHART_INNER_H = chartHeight;
  const yAxisW = 38;
  const plotW = SCREEN_WIDTH - paddingHorizontal * 2 - yAxisW;

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

  const points = filtered.map((r) => ({
    x: Math.max(0, Math.min(plotW, ((new Date(r.timestamp).getTime() - windowStart) / windowMs) * plotW)),
    y: yPct(r.glucose) * CHART_INNER_H,
    glucose: r.glucose,
  }));

  const urgentLowLineY = yPct(urgentLowThreshold) * CHART_INNER_H;
  const lowLineY = yPct(lowThreshold) * CHART_INNER_H;
  const highLineY = yPct(highThreshold) * CHART_INNER_H;
  const urgentHighLineY = yPct(urgentHighThreshold) * CHART_INNER_H;
  const targetLineY = yPct(Math.max(lowThreshold, Math.min(highThreshold, targetGlucose))) * CHART_INNER_H;

  const midTime = new Date(windowStart + windowMs / 2).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startTime = new Date(windowStart).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <View style={styles.wrapper}>
      <View style={styles.rangeRow}>
        {TIME_RANGES.map((r) => (
          <Pressable
            key={r}
            style={[
              styles.rangeTab,
              { backgroundColor: timeRange === r ? "rgba(255,255,255,0.18)" : "transparent" },
            ]}
            onPress={() => handleRangePress(r)}
          >
            <Text style={[styles.rangeTabText, { color: timeRange === r ? "#fff" : "rgba(255,255,255,0.45)" }]}>
              {r}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.chartRow, { height: CHART_INNER_H }]}>
        <View style={[styles.plotArea, { width: plotW, height: CHART_INNER_H, backgroundColor: darkBg === "#0F172A" ? "#1a2540" : darkBg }]}>
          <View style={[styles.zoneLow, { height: CHART_INNER_H - lowLineY, bottom: 0 }]} />
          <View style={[styles.zoneTarget, { top: highLineY, height: lowLineY - highLineY }]} />
          <View style={[styles.zoneHigh, { height: highLineY }]} />

          <View style={[styles.threshLineDashed, { top: urgentLowLineY, borderColor: "#EF4444" }]} />
          <View style={[styles.threshLine, { top: lowLineY, backgroundColor: "#F97316CC" }]} />
          <View style={[styles.threshLine, { top: highLineY, backgroundColor: "#F59E0BAA" }]} />
          <View style={[styles.threshLineDashed, { top: urgentHighLineY, borderColor: "#EF4444" }]} />
          <View style={[styles.targetLine, { top: targetLineY }]} />

          {filtered.length === 0 ? (
            <View style={styles.emptyOverlay}>
              <Text style={styles.emptyText}>No readings in this window</Text>
            </View>
          ) : (
            <>
              {points.map((p, i) => {
                if (i >= points.length - 1) return null;
                const next = points[i + 1];
                const dx = next.x - p.x;
                const dy = next.y - p.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len < 0.5) return null;
                const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                const col = glucoseColor((p.glucose + next.glucose) / 2, lowThreshold, highThreshold, urgentLowThreshold);
                const midY = (p.y + next.y) / 2;
                return (
                  <React.Fragment key={`seg-${i}`}>
                    <View
                      style={[
                        styles.segmentGlow,
                        {
                          width: len + 4,
                          left: p.x - 2,
                          top: midY - 6,
                          backgroundColor: col + "38",
                          transform: [{ rotate: `${angle}deg` }],
                        },
                      ]}
                    />
                    <View
                      style={[
                        styles.segment,
                        {
                          width: len,
                          left: p.x,
                          top: midY - 2.5,
                          backgroundColor: col,
                          transform: [{ rotate: `${angle}deg` }],
                        },
                      ]}
                    />
                  </React.Fragment>
                );
              })}

              {points.map((p, i) => {
                const isLatest = i === points.length - 1;
                const stride = points.length > 72 ? 4 : points.length > 36 ? 3 : points.length > 18 ? 2 : 1;
                if (!isLatest && i % stride !== 0) return null;
                const col = glucoseColor(p.glucose, lowThreshold, highThreshold, urgentLowThreshold);
                const sz = isLatest ? 13 : 3;
                return (
                  <React.Fragment key={`dot-${i}`}>
                    {isLatest && (
                      <View
                        style={{
                          position: "absolute",
                          left: p.x - 10,
                          top: p.y - 10,
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: col + "30",
                        }}
                      />
                    )}
                    <View
                      style={{
                        position: "absolute",
                        left: p.x - sz / 2,
                        top: p.y - sz / 2,
                        width: sz,
                        height: sz,
                        borderRadius: sz / 2,
                        backgroundColor: col,
                        borderWidth: isLatest ? 2 : 0,
                        borderColor: isLatest ? "#fff" : undefined,
                      }}
                    />
                  </React.Fragment>
                );
              })}
            </>
          )}
        </View>

        <View style={[styles.yAxis, { width: yAxisW, height: CHART_INNER_H }]}>
          {Y_LABELS.map((v) => {
            const top = yPct(v) * CHART_INNER_H - 7;
            if (top < -8 || top > CHART_INNER_H - 6) return null;
            return (
              <Text key={v} style={[styles.yLabel, { top }]}>
                {v}
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

const styles = StyleSheet.create({
  wrapper: { width: "100%" },

  rangeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  rangeTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 50,
    alignItems: "center",
  },
  rangeTabText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  chartRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  plotArea: {
    position: "relative",
    borderRadius: 6,
    overflow: "hidden",
  },

  zoneLow: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(239,68,68,0.10)",
  },
  zoneTarget: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(34,197,94,0.07)",
  },
  zoneHigh: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: "rgba(245,158,11,0.07)",
  },

  threshLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
  },
  threshLineDashed: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: 1.5,
    borderStyle: "dashed",
  },
  targetLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: "rgba(99,102,241,0.60)",
  },

  segmentGlow: {
    position: "absolute",
    height: 12,
    borderRadius: 6,
    transformOrigin: "left center",
  },
  segment: {
    position: "absolute",
    height: 5,
    borderRadius: 2.5,
    transformOrigin: "left center",
  },

  emptyOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },

  yAxis: {
    position: "relative",
    marginLeft: 5,
  },
  yLabel: {
    position: "absolute",
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.35)",
    right: 0,
    textAlign: "right",
    width: 33,
  },

  xAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    paddingHorizontal: 2,
  },
  xLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.35)",
  },
});
