import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { T, withAlpha, type ThemeColors } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import { GlucoseEntry } from "@/context/GlucoseContext";

interface Props {
  entry: GlucoseEntry;
  /** Last row in the card → no bottom separator. */
  last?: boolean;
}

/** Clinical color for a value. Boundaries unchanged from the previous ReadingCard — only hexes differ. */
function getGlucoseColor(value: number): string {
  if (value < 70) return T.color.coral;
  if (value < 80) return T.color.amber;
  if (value <= 180) return T.color.emerald;
  if (value <= 250) return T.color.amber;
  return T.color.coral;
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

export function ReadingCard({ entry, last }: Props) {
  const c = useThemeColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const color = getGlucoseColor(entry.glucose);

  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.value, { color: c.textPrimary }]}>
        {entry.glucose}
        <Text style={[styles.unit, { color: c.textMuted }]}> mg/dL</Text>
      </Text>
      <Text style={[styles.label, { color }]}>{getGlucoseLabel(entry.glucose)}</Text>
      {entry.anomaly.warning && (
        <View style={[styles.alertBadge, { backgroundColor: withAlpha(T.color.coral, 0.16) }]}>
          <Feather name="alert-triangle" size={11} color={T.color.coral} />
        </View>
      )}
      <Text style={[styles.time, { color: c.textSecondary }]}>{formatTime(entry.timestamp)}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  value: { fontSize: 16, fontWeight: T.font.bold },
  unit: { fontSize: 12, fontWeight: T.font.regular },
  label: { flex: 1, fontSize: 12.5, fontWeight: T.font.medium },
  alertBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  time: { fontSize: 12.5, fontWeight: T.font.medium, marginLeft: "auto" },
});
