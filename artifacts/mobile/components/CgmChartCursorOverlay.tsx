import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { T, glucoseTone, withAlpha, type ThemeColors } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import {
  CGM_CHART_CURSOR_TOOLTIP_HEIGHT,
  CGM_CHART_CURSOR_TOOLTIP_WIDTH,
  chartCursorTooltipLeft,
  chartCursorTooltipTop,
  formatChartCursorGlucose,
  formatChartCursorTime,
  type ChartPlotPoint,
} from "@/utils/cgmChartCursor";

interface Props {
  point: ChartPlotPoint;
  plotW: number;
  plotH: number;
  lowThreshold: number;
  highThreshold: number;
  urgentHighThreshold: number;
}

export function CgmChartCursorOverlay({
  point,
  plotW,
  plotH,
  lowThreshold,
  highThreshold,
  urgentHighThreshold,
}: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const color = glucoseTone(point.glucose, lowThreshold, highThreshold, urgentHighThreshold);
  const tooltipTop = chartCursorTooltipTop(plotH);
  const tooltipLeft = chartCursorTooltipLeft(point.x, plotW);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={plotW} height={plotH} style={StyleSheet.absoluteFill}>
        <Line
          x1={point.x}
          y1={0}
          x2={point.x}
          y2={plotH}
          stroke={c.textMuted}
          strokeWidth={1}
          opacity={0.85}
        />
        <Circle cx={point.x} cy={point.y} r={7} fill={withAlpha(color, 0.2)} />
        <Circle cx={point.x} cy={point.y} r={4.5} fill={c.pointCenter} stroke={color} strokeWidth={2} />
      </Svg>
      <View
        style={[
          styles.tooltip,
          {
            top: tooltipTop,
            left: tooltipLeft,
            width: CGM_CHART_CURSOR_TOOLTIP_WIDTH,
            backgroundColor: c.card,
            borderColor: c.border,
          },
        ]}
      >
        <Text style={[styles.value, { color: c.textPrimary }]} numberOfLines={1}>
          {formatChartCursorGlucose(point.glucose)}
        </Text>
        <Text style={[styles.time, { color: c.textSecondary }]} numberOfLines={1}>
          {formatChartCursorTime(point.timestamp)}
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    tooltip: {
      position: "absolute",
      minHeight: CGM_CHART_CURSOR_TOOLTIP_HEIGHT,
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 6,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    value: { fontSize: 13, fontWeight: T.font.bold },
    time: { fontSize: 11, fontWeight: T.font.medium, marginTop: 2 },
  });
