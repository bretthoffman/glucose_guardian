import React from "react";
import { Dimensions, StyleSheet, Text, View, useColorScheme } from "react-native";
import Colors, { COLORS } from "@/constants/colors";

interface Reading {
  glucose: number;
  timestamp: string;
}

interface Props {
  readings: Reading[];
  height?: number;
}

const SCREEN_WIDTH = Dimensions.get("window").width;

function getColor(value: number): string {
  if (value < 70) return COLORS.glucose.low;
  if (value < 80) return COLORS.glucose.lowRange;
  if (value <= 180) return COLORS.glucose.normal;
  if (value <= 250) return COLORS.glucose.high;
  return COLORS.glucose.veryHigh;
}

export function TrendChart({ readings, height = 120 }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;

  if (readings.length === 0) {
    return (
      <View style={[styles.empty, { height, backgroundColor: colors.backgroundTertiary }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          No readings yet
        </Text>
      </View>
    );
  }

  const values = readings.map((r) => r.glucose);
  const minVal = Math.max(0, Math.min(...values) - 20);
  const maxVal = Math.max(...values) + 20;
  const range = maxVal - minVal;

  const displayReadings = readings.slice(-20);
  const chartWidth = SCREEN_WIDTH - 80;
  const barWidth = Math.min(18, (chartWidth / displayReadings.length) - 4);

  return (
    <View style={[styles.container, { height }]}>
      <View style={[styles.chart, { height: height - 20 }]}>
        {displayReadings.map((r, i) => {
          const pct = range > 0 ? (r.glucose - minVal) / range : 0.5;
          const barH = Math.max(6, pct * (height - 40));
          const color = getColor(r.glucose);
          return (
            <View key={i} style={styles.barContainer}>
              <View
                style={[
                  styles.bar,
                  {
                    height: barH,
                    width: barWidth,
                    backgroundColor: color,
                    opacity: i === displayReadings.length - 1 ? 1 : 0.6,
                    borderRadius: barWidth / 2,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.labels}>
        <Text style={[styles.labelText, { color: colors.textMuted }]}>
          {displayReadings.length > 0
            ? new Date(displayReadings[0].timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </Text>
        <Text style={[styles.labelText, { color: colors.textMuted }]}>Now</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 3,
    paddingHorizontal: 4,
  },
  barContainer: {
    justifyContent: "flex-end",
  },
  bar: {},
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginTop: 4,
  },
  labelText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  empty: {
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
  },
});
