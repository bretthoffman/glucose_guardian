import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { T, TYPE, withAlpha } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import { trendArrowCount, trendGaugeLabel, type TrendInfo } from "@/utils/trend";

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
  /** Canonical trend display from `getEffectiveTrend` / `mapDexcomTrend` / `trendFromDiff`. */
  trendInfo?: TrendInfo;
  lowThreshold?: number;
  highThreshold?: number;
  /** Oldest → newest; drives thin expanding ripple color + speed only. */
  recentReadings?: { glucose: number; timestamp: string }[];
  /** Small recency line under the trend pill, e.g. "Updated just now". */
  updatedLabel?: string;
}

// --- ORIGINAL status/trend/movement logic (unchanged: controls ring color + pulse behavior) ---

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
  rapidly_rising:  "Rising Fast",
  rising:          "Rising slowly",
  stable:          "Stable",
  falling:         "Falling slowly",
  rapidly_falling: "Dropping Fast",
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

/** Thin the SOLID ring's STROKE to 75% of its original thickness; the diameter stays full-size. */
const RING_THICKNESS_RATIO = 0.75;

export function GlucoseGauge({
  value,
  size = 180,
  trend,
  trendInfo,
  lowThreshold = 80,
  highThreshold = 180,
  recentReadings,
  updatedLabel,
}: Props) {
  const status = getGlucoseStatus(value, lowThreshold, highThreshold);
  const c = useThemeColors();

  const movementDep =
    recentReadings && recentReadings.length >= 2
      ? `${recentReadings[recentReadings.length - 2]!.timestamp}:${recentReadings[recentReadings.length - 2]!.glucose}|${recentReadings[recentReadings.length - 1]!.timestamp}:${recentReadings[recentReadings.length - 1]!.glucose}`
      : "";

  const movementVisuals = useMemo(() => {
    const rate = recentReadings && recentReadings.length >= 2 ? computeAbsRateMgPerMin(recentReadings) : null;
    return getMovementPulseVisuals(rate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementDep]);

  const pulseRingColor = movementVisuals.ringColor;
  const mainRingColor = status.color;

  // Full-size gauge: the solid ring diameter, inner disc, and ripple container are ALL `size`. Only
  // the solid ring's STROKE is reduced to 75% of its original thickness for a thinner, refined ring.
  // Ripple container (`size`) + ripple scale (1.55) are unchanged, so the outward pulse keeps its reach.
  const baseRingStroke = Math.round(size * 0.07); // original thickness (= 12 at size 172)
  const ringStroke = Math.round(baseRingStroke * RING_THICKNESS_RATIO); // 75% → 9 at size 172
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
  const trendLabel = trendInfo ? trendGaugeLabel(trendInfo) : trend ? TREND_LABEL[trend] : null;
  const arrows = trendInfo ? trendArrowCount(trendInfo) : 1;

  return (
    <View style={styles.outerRow}>
      {/* gauge area stays full `size` so ripple reach + trend alignment are unchanged */}
      <View style={[styles.gaugeArea, { width: size, height: size }]}>
        {/* Expanding ripple rings (full-size container, 1.55 reach). Visibility comes from
            color alpha × animated opacity (0.65 → 0): D9/88 puts the pulse at ~55% effective
            opacity at its brightest — size, speed, and fade curve unchanged. */}
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: pulseRingColor + "D9",
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
            borderColor: pulseRingColor + "88",
            transform: [{ scale: r2Scale }],
            opacity: r2Opacity,
          }}
        />

        {/* SOLID breathing ring — FULL diameter (= size); only the stroke is thinner (75%) */}
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

        {/* Inner content — restored full-size layout; NEW dark-clinical typography */}
        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            backgroundColor: withAlpha(status.color, 0.12),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[styles.value, TYPE.display, { color: c.textPrimary, fontSize: size * 0.27 }]}>
            {value}
          </Text>
          <Text style={[styles.unit, { color: c.textSecondary, fontSize: size * 0.09 }]}>mg/dL</Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: withAlpha(status.color, 0.14), borderColor: withAlpha(status.color, 0.4), marginTop: size * 0.04 },
            ]}
          >
            <Text style={[styles.badgeText, { color: status.color, fontSize: size * 0.08 }]}>{status.label}</Text>
          </View>
        </View>
      </View>

      {/* Trend column — centered cluster balancing the gauge ring. The pull-to-sync helper now lives
          in the page header (Home screen), so the trend content keeps its original centered position. */}
      {trend && trendColor && trendLabel && (
        <View style={styles.trendSide}>
          <View style={[styles.trendArrowRow, { transform: [{ rotate: TREND_ROTATE[trend] }] }]}>
            {Array.from({ length: arrows }).map((_, i) => (
              <Feather key={i} name="arrow-up" size={30} color={trendColor} />
            ))}
          </View>
          <Text style={[styles.trendCaption, { color: c.textSecondary }]}>Trend</Text>
          <View style={[styles.trendPill, { backgroundColor: withAlpha(trendColor, 0.14), borderColor: withAlpha(trendColor, 0.4) }]}>
            <Text style={[styles.trendPillText, { color: trendColor }]} numberOfLines={1}>
              {trendLabel}
            </Text>
          </View>
          {updatedLabel ? <Text style={[styles.updated, { color: c.textMuted }]}>{updatedLabel}</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  outerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  gaugeArea: { alignItems: "center", justifyContent: "center", position: "relative" },
  value: { color: "#fff" },
  unit: { fontWeight: T.font.medium, marginTop: 2 },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: { fontWeight: T.font.semibold },
  trendSide: { flex: 1, alignItems: "center", gap: 6, minWidth: 0 },
  trendArrowRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  trendCaption: { fontSize: 11, fontWeight: T.font.medium, marginTop: 2 },
  trendPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: "100%",
  },
  trendPillText: { fontSize: 12.5, fontWeight: T.font.semibold },
  updated: { fontSize: 11, fontWeight: T.font.regular, marginTop: 2, textAlign: "center" },
});
