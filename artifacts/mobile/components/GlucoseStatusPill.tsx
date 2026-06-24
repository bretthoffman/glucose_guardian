import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { getEffectiveTrend } from "@/utils/trend";

/** Threshold coloring — matches Chat header glucose pill. */
export function glucosePillColor(g: number, low: number, high: number): string {
  if (g < 70 || g > 300) return COLORS.danger;
  if (g < low || g > high) return COLORS.warning;
  return COLORS.success;
}

/** Range label — matches Chat header glucose pill. */
export function glucosePillLabel(g: number, low: number, high: number): string {
  if (g < 70) return "Low";
  if (g < low) return "Below Range";
  if (g <= high) return "In Range";
  if (g <= 300) return "Above Range";
  return "High";
}

interface Props {
  style?: StyleProp<ViewStyle>;
}

/** Live current-glucose status window shared by Chat, Dose, and Food headers. */
export default function GlucoseStatusPill({ style }: Props) {
  const { history, latestReading } = useGlucose();
  const { alertPrefs } = useAuth();
  const trend = getEffectiveTrend(history);
  const glucose = latestReading?.glucose ?? null;
  const low = alertPrefs.lowThreshold;
  const high = alertPrefs.highThreshold;

  if (glucose == null) return null;

  const color = glucosePillColor(glucose, low, high);

  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: color + "18", borderColor: color + "40" },
        style,
      ]}
    >
      <Text style={[styles.value, { color }]}>
        {glucose} <Text style={styles.unit}>mg/dL</Text>
      </Text>
      <Text style={[styles.trend, { color }]}>{trend.arrow}</Text>
      <Text style={[styles.label, { color }]}>
        {glucosePillLabel(glucose, low, high)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    minWidth: 70,
  },
  value: { fontSize: 15, fontWeight: "700" },
  unit: { fontSize: 10, fontWeight: "400" },
  trend: { fontSize: 14, fontWeight: "700" },
  label: { fontSize: 10, fontWeight: "500" },
});
