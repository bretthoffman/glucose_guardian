/**
 * Surface — the cohesive clinical card used across the app.
 *
 * VISUAL ONLY. Theme-aware fill + subtle border + a restrained internal top-edge highlight, with a
 * softer shadow in light mode. Geometry is identical in both themes (only structural color/contrast
 * changes). Semantic content colors are decided by callers, not here.
 */
import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { T, withAlpha } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";

interface SurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Slightly different fill for nested/elevated emphasis. */
  elevated?: boolean;
  /** Inner padding (defaults to 16). Pass 0 for edge-to-edge content (e.g. the chart). */
  padding?: number;
  radius?: number;
}

export function Surface({ children, style, elevated, padding = T.space.lg, radius = T.radius.card }: SurfaceProps) {
  const { scheme, colors: c } = useTheme();
  const isDark = scheme === "dark";
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: elevated ? c.cardElevated : c.card,
          borderColor: c.border,
          borderRadius: radius,
          padding,
          shadowColor: "#000",
          shadowOpacity: isDark ? 0.35 : 0.08,
          shadowRadius: isDark ? 18 : 12,
          shadowOffset: { width: 0, height: isDark ? 10 : 6 },
        },
        style,
      ]}
    >
      {/* Subtle top-edge highlight — reads as a soft internal light source, not a glow. */}
      <LinearGradient
        colors={[isDark ? withAlpha("#BED2F0", 0.16) : withAlpha("#FFFFFF", 0.55), "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        style={[styles.topHighlight, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: "hidden",
    elevation: 4,
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
  },
});
