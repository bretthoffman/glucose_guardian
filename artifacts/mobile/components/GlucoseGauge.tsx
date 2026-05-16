import React, { useEffect, useMemo, useRef } from "react";
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
  /** Oldest → newest; drives thin expanding ripple color + speed only. */
  recentReadings?: { glucose: number; timestamp: string }[];
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

/** mg/dL per minute from the two newest points (absolute change / elapsed minutes). */
function computeAbsRateMgPerMin(readings: { glucose: number; timestamp: string }[]): number | null {
  if (readings.length < 2) return null;
  const prev = readings[readings.length - 2]!;
  const last = readings[readings.length - 1]!;
  const t0 = new Date(prev.timestamp).getTime();
  const t1 = new Date(last.timestamp).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  const dtMin = Math.max((t1 - t0) / 60_000, 0.5);
  return Math.abs(last.glucose - prev.glucose) / dtMin;
}

/** Below = slow (green); between = moderate (amber); at or above = fast (red). */
const MOVEMENT_SLOW_MAX = 0.75;
const MOVEMENT_MODERATE_MAX = 2.0;

function getMovementPulseVisuals(rate: number | null): { ringColor: string; rippleDuration: number } {
  if (rate == null || rate < MOVEMENT_SLOW_MAX) {
    return { ringColor: COLORS.glucose.normal, rippleDuration: 2600 };
  }
  if (rate < MOVEMENT_MODERATE_MAX) {
    return { ringColor: COLORS.warning, rippleDuration: 2150 };
  }
  return { ringColor: COLORS.danger, rippleDuration: 850 };
}

/** Thick ring “breathing” scale/timing — glucose range colors the stroke, not movement. */
const MAIN_RING_PULSE_TO = 1.015;
const MAIN_RING_PULSE_MS = 1750;

export function GlucoseGauge({
  value,
  size = 180,
  trend,
  lowThreshold = 80,
  highThreshold = 180,
  recentReadings,
}: Props) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const status = getGlucoseStatus(value, lowThreshold, highThreshold);

  const movementDep =
    recentReadings && recentReadings.length >= 2
      ? `${recentReadings[recentReadings.length - 2]!.timestamp}:${recentReadings[recentReadings.length - 2]!.glucose}|${recentReadings[recentReadings.length - 1]!.timestamp}:${recentReadings[recentReadings.length - 1]!.glucose}`
      : "";

  const movementVisuals = useMemo(() => {
    const rate = recentReadings && recentReadings.length >= 2 ? computeAbsRateMgPerMin(recentReadings) : null;
    return getMovementPulseVisuals(rate);
  }, [movementDep]);

  const pulseRingColor = movementVisuals.ringColor;
  const mainRingColor = status.color;

  const ringStroke = Math.round(size * 0.07);
  const innerSize = size - ringStroke * 2;

  const ringPulse  = useRef(new Animated.Value(1)).current;
  const r1Scale    = useRef(new Animated.Value(1)).current;
  const r1Opacity  = useRef(new Animated.Value(0.65)).current;
  const r2Scale    = useRef(new Animated.Value(1)).current;
  const r2Opacity  = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    const { rippleDuration } = movementVisuals;

    ringPulse.setValue(1);
    r1Scale.setValue(1);
    r1Opacity.setValue(0.65);
    r2Scale.setValue(1);
    r2Opacity.setValue(0.65);

    const ringAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(ringPulse, {
          toValue: MAIN_RING_PULSE_TO,
          duration: MAIN_RING_PULSE_MS,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ringPulse, {
          toValue: 1,
          duration: MAIN_RING_PULSE_MS,
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
  }, [movementVisuals]);

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
            borderColor: pulseRingColor + "55",
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
            borderColor: pulseRingColor + "35",
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
            borderColor: mainRingColor,
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
