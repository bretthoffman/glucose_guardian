import React from "react";
import { StyleSheet, Text, View, useColorScheme } from "react-native";
import { COLORS } from "@/constants/colors";
import Colors from "@/constants/colors";

interface Props {
  value: number;
  size?: number;
}

function getGlucoseStatus(value: number): {
  label: string;
  color: string;
  bg: string;
  emoji: null;
} {
  if (value < 70)
    return { label: "Low", color: COLORS.glucose.low, bg: COLORS.dangerLight, emoji: null };
  if (value < 80)
    return {
      label: "Below Range",
      color: COLORS.glucose.lowRange,
      bg: "#FFF7ED",
      emoji: null,
    };
  if (value <= 180)
    return {
      label: "In Range",
      color: COLORS.glucose.normal,
      bg: COLORS.successLight,
      emoji: null,
    };
  if (value <= 250)
    return {
      label: "Above Range",
      color: COLORS.glucose.high,
      bg: COLORS.warningLight,
      emoji: null,
    };
  return { label: "High", color: COLORS.glucose.veryHigh, bg: COLORS.dangerLight, emoji: null };
}

export function GlucoseGauge({ value, size = 180 }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const status = getGlucoseStatus(value);

  const ringSize = size;
  const ringStroke = size * 0.07;
  const innerSize = ringSize - ringStroke * 2;

  return (
    <View style={[styles.container, { width: ringSize, height: ringSize }]}>
      <View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: ringStroke,
            borderColor: status.color,
            backgroundColor: isDark
              ? `${status.color}22`
              : `${status.color}18`,
          },
        ]}
      >
        <View
          style={[
            styles.inner,
            { width: innerSize, height: innerSize, borderRadius: innerSize / 2 },
          ]}
        >
          <Text
            style={[
              styles.value,
              { color: status.color, fontSize: size * 0.27 },
            ]}
          >
            {value}
          </Text>
          <Text
            style={[
              styles.unit,
              { color: colors.textSecondary, fontSize: size * 0.09 },
            ]}
          >
            mg/dL
          </Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: status.bg, marginTop: size * 0.04 },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: status.color, fontSize: size * 0.085 },
              ]}
            >
              {status.label}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontFamily: "Inter_700Bold",
    lineHeight: undefined,
  },
  unit: {
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontFamily: "Inter_600SemiBold",
  },
});
