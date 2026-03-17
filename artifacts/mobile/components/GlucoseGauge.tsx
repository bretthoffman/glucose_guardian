import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View, useColorScheme } from "react-native";
import { COLORS } from "@/constants/colors";
import Colors from "@/constants/colors";

export type GlucoseTrend =
  | "rapidly_rising"
  | "rising"
  | "stable"
  | "falling"
  | "rapidly_falling";

interface Props {
  value: number;
  size?: number;
  trend?: GlucoseTrend;
}

function getGlucoseStatus(value: number): {
  label: string;
  color: string;
  bg: string;
} {
  if (value < 70)
    return { label: "Low", color: COLORS.glucose.low, bg: COLORS.dangerLight };
  if (value < 80)
    return { label: "Below Range", color: COLORS.glucose.lowRange, bg: "#FFF7ED" };
  if (value <= 180)
    return { label: "In Range", color: COLORS.glucose.normal, bg: COLORS.successLight };
  if (value <= 250)
    return { label: "Above Range", color: COLORS.glucose.high, bg: COLORS.warningLight };
  return { label: "High", color: COLORS.glucose.veryHigh, bg: COLORS.dangerLight };
}

const TREND_CONFIG: Record<GlucoseTrend, { arrow: string; rotate: string; color: string; label: string }> = {
  rapidly_rising: { arrow: "↑", rotate: "0deg",   color: COLORS.danger,  label: "Rising fast" },
  rising:         { arrow: "↑", rotate: "45deg",  color: COLORS.warning, label: "Rising" },
  stable:         { arrow: "↑", rotate: "90deg",  color: COLORS.success, label: "Stable" },
  falling:        { arrow: "↑", rotate: "135deg", color: COLORS.warning, label: "Falling" },
  rapidly_falling:{ arrow: "↑", rotate: "180deg", color: COLORS.danger,  label: "Falling fast" },
};

function getPulseConfig(trend: GlucoseTrend | undefined) {
  if (trend === "rapidly_rising" || trend === "rapidly_falling") {
    return { toScale: 1.055, duration: 380 };
  }
  if (trend === "rising" || trend === "falling") {
    return { toScale: 1.03, duration: 700 };
  }
  return { toScale: 1.015, duration: 1400 };
}

export function GlucoseGauge({ value, size = 180, trend }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const status = getGlucoseStatus(value);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const { toScale, duration } = getPulseConfig(trend);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: toScale,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [trend]);

  const ringSize = size;
  const ringStroke = size * 0.07;
  const innerSize = ringSize - ringStroke * 2;

  const trendInfo = trend ? TREND_CONFIG[trend] : null;
  const isAlarm = trend === "rapidly_rising" || trend === "rapidly_falling";

  const outerGlowSize = ringSize + 16;

  return (
    <View style={[styles.wrapper, { width: outerGlowSize, height: outerGlowSize }]}>
      {isAlarm && (
        <Animated.View
          style={[
            styles.alarmGlow,
            {
              width: outerGlowSize,
              height: outerGlowSize,
              borderRadius: outerGlowSize / 2,
              borderColor: status.color + "55",
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
      )}

      <Animated.View
        style={[
          styles.ringWrap,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: ringStroke,
            borderColor: status.color,
            backgroundColor: isDark ? `${status.color}22` : `${status.color}18`,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        <View style={[styles.inner, { width: innerSize, height: innerSize, borderRadius: innerSize / 2 }]}>
          <Text style={[styles.value, { color: status.color, fontSize: size * 0.27 }]}>
            {value}
          </Text>
          <Text style={[styles.unit, { color: colors.textSecondary, fontSize: size * 0.09 }]}>
            mg/dL
          </Text>
          <View style={[styles.badge, { backgroundColor: status.bg, marginTop: size * 0.04 }]}>
            <Text style={[styles.badgeText, { color: status.color, fontSize: size * 0.085 }]}>
              {status.label}
            </Text>
          </View>
        </View>
      </Animated.View>

      {trendInfo && (
        <View
          style={[
            styles.trendBadge,
            {
              backgroundColor: trendInfo.color + "22",
              borderColor: trendInfo.color + "55",
              right: 0,
              top: outerGlowSize / 2 - 16,
            },
          ]}
        >
          <Text
            style={[
              styles.trendArrow,
              {
                color: trendInfo.color,
                fontSize: size * 0.14,
                transform: [{ rotate: trendInfo.rotate }],
              },
            ]}
          >
            {trendInfo.arrow}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  alarmGlow: {
    position: "absolute",
    borderWidth: 3,
  },
  ringWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  inner: {
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    fontFamily: "Inter_700Bold",
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
  trendBadge: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  trendArrow: {
    fontFamily: "Inter_700Bold",
    lineHeight: undefined,
  },
});
