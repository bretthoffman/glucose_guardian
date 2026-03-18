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
  lowThreshold?: number;
  highThreshold?: number;
}

function getGlucoseStatus(value: number, lowThreshold = 80, highThreshold = 180): {
  label: string;
  color: string;
  bg: string;
} {
  if (value < 70)
    return { label: "Low", color: COLORS.glucose.low, bg: COLORS.dangerLight };
  if (value < lowThreshold)
    return { label: "Below Range", color: COLORS.glucose.lowRange, bg: "#FFF7ED" };
  if (value <= highThreshold)
    return { label: "In Range", color: COLORS.glucose.normal, bg: COLORS.successLight };
  if (value <= 300)
    return { label: "Above Range", color: COLORS.glucose.high, bg: COLORS.warningLight };
  return { label: "High", color: COLORS.glucose.veryHigh, bg: COLORS.dangerLight };
}

const TREND_ROTATE: Record<GlucoseTrend, string> = {
  rapidly_rising:  "0deg",
  rising:          "45deg",
  stable:          "90deg",
  falling:         "135deg",
  rapidly_falling: "180deg",
};

const TREND_LABEL: Record<GlucoseTrend, string> = {
  rapidly_rising:  "Rising",
  rising:          "Rising slowly",
  stable:          "Stable",
  falling:         "Falling slowly",
  rapidly_falling: "Falling",
};

function getTrendColor(trend: GlucoseTrend, glucoseStatusColor: string): string {
  if (trend === "rapidly_rising" || trend === "rapidly_falling") return COLORS.danger;
  if (trend === "rising" || trend === "falling") return COLORS.warning;
  return glucoseStatusColor;
}

function getPulseConfig(trend: GlucoseTrend | undefined) {
  if (trend === "rapidly_rising" || trend === "rapidly_falling") {
    return { toScale: 1.06, ringDuration: 340, rippleDuration: 900 };
  }
  if (trend === "rising" || trend === "falling") {
    return { toScale: 1.035, ringDuration: 650, rippleDuration: 1300 };
  }
  return { toScale: 1.018, ringDuration: 1400, rippleDuration: 2200 };
}

export function GlucoseGauge({ value, size = 180, trend, lowThreshold = 80, highThreshold = 180 }: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const status = getGlucoseStatus(value, lowThreshold, highThreshold);

  const ringStroke = Math.round(size * 0.07);
  const innerSize = size - ringStroke * 2;

  const ringPulse  = useRef(new Animated.Value(1)).current;
  const r1Scale    = useRef(new Animated.Value(1)).current;
  const r1Opacity  = useRef(new Animated.Value(0.65)).current;
  const r2Scale    = useRef(new Animated.Value(1)).current;
  const r2Opacity  = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    const { toScale, ringDuration, rippleDuration } = getPulseConfig(trend);

    ringPulse.setValue(1);
    r1Scale.setValue(1);
    r1Opacity.setValue(0.65);
    r2Scale.setValue(1);
    r2Opacity.setValue(0.65);

    const ringAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: toScale,
          duration: ringDuration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: ringDuration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const ripple1 = Animated.loop(
      Animated.parallel([
        Animated.timing(r1Scale, {
          toValue: 1.55,
          duration: rippleDuration,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(r1Opacity, {
          toValue: 0,
          duration: rippleDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    ringAnim.start();
    ripple1.start();

    const t = setTimeout(() => {
      r2Scale.setValue(1);
      r2Opacity.setValue(0.65);
      const ripple2 = Animated.loop(
        Animated.parallel([
          Animated.timing(r2Scale, {
            toValue: 1.55,
            duration: rippleDuration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(r2Opacity, {
            toValue: 0,
            duration: rippleDuration,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      );
      ripple2.start();
      return () => ripple2.stop();
    }, rippleDuration / 2);

    return () => {
      ringAnim.stop();
      ripple1.stop();
      clearTimeout(t);
    };
  }, [trend]);

  const trendColor = trend ? getTrendColor(trend, status.color) : null;

  return (
    <View style={styles.outerRow}>
      <View style={[styles.gaugeArea, { width: size, height: size }]}>
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: status.color + "55",
            transform: [{ scale: r1Scale }],
            opacity: r1Opacity,
          }}
        />
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: status.color + "35",
            transform: [{ scale: r2Scale }],
            opacity: r2Opacity,
          }}
        />

        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: ringStroke,
            borderColor: status.color,
            backgroundColor: "transparent",
            transform: [{ scale: ringPulse }],
          }}
        />

        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            backgroundColor: isDark ? `${status.color}22` : `${status.color}18`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
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
      </View>

      {trend && trendColor && (
        <View style={styles.trendSide}>
          <View style={[styles.arrowWrap, { transform: [{ rotate: TREND_ROTATE[trend] }] }]}>
            <Text style={[styles.arrowText, { color: trendColor }]}>↑</Text>
          </View>
          <View style={[styles.trendLabelPill, { backgroundColor: trendColor + "1A", borderColor: trendColor + "40" }]}>
            <Text style={[styles.trendLabelText, { color: trendColor }]}>
              {TREND_LABEL[trend]}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  gaugeArea: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
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
  trendSide: {
    alignItems: "center",
    gap: 8,
    minWidth: 80,
  },
  arrowWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: {
    fontSize: 38,
    fontFamily: "Inter_700Bold",
    lineHeight: 42,
  },
  trendLabelPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
  },
  trendLabelText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
});
