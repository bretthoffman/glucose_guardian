import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, useColorScheme } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { GlucoseEntry } from "@/context/GlucoseContext";

interface Props {
  entry: GlucoseEntry;
}

function getGlucoseColor(value: number): string {
  if (value < 70) return COLORS.glucose.low;
  if (value < 80) return COLORS.glucose.lowRange;
  if (value <= 180) return COLORS.glucose.normal;
  if (value <= 250) return COLORS.glucose.high;
  return COLORS.glucose.veryHigh;
}

function getGlucoseLabel(value: number): string {
  if (value < 70) return "Low";
  if (value < 80) return "Below Range";
  if (value <= 180) return "In Range";
  if (value <= 250) return "Above Range";
  return "High";
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReadingCard({ entry }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const glucoseColor = getGlucoseColor(entry.glucose);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.left}>
        <View
          style={[
            styles.dot,
            { backgroundColor: glucoseColor },
          ]}
        />
        <View>
          <Text style={[styles.value, { color: glucoseColor }]}>
            {entry.glucose}
            <Text style={[styles.unit, { color: colors.textSecondary }]}>
              {" "}mg/dL
            </Text>
          </Text>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {getGlucoseLabel(entry.glucose)}
          </Text>
        </View>
      </View>
      <View style={styles.right}>
        {entry.anomaly.warning && (
          <View style={[styles.alertBadge, { backgroundColor: COLORS.dangerLight }]}>
            <Feather name="alert-triangle" size={12} color={COLORS.danger} />
          </View>
        )}
        <Text style={[styles.time, { color: colors.textMuted }]}>
          {formatTime(entry.timestamp)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  value: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  unit: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  alertBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  time: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
