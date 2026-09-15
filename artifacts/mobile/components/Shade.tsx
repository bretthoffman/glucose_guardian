import React, { useId, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { mixHex } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import { COLORS } from "@/constants/colors";

/**
 * Shading primitives — every window, control, pill and accent button in the app shades through one
 * of these. Each is a REAL vertical gradient, drawn natively by react-native-svg (a linear gradient
 * filling a rect), so the transition is continuous: no bands, no steps, no seams.
 *
 * Why SVG and not a gradient view: react-native-svg is already in the shipped binary (the glucose
 * chart draws with it), so a true gradient ships over the air to every install, today. A dedicated
 * gradient native module would need a new binary on every device before any update could use it.
 *
 * Shape: the gradient is clipped by its own wrapper View (rounded to `radius`, `overflow: hidden`),
 * so the HOST never needs `overflow: hidden` — which would clip a host's shadow, and on iOS clips a
 * bordered view's children to a plain rectangle. Per-corner overrides (a chat bubble's tail) go in
 * `style`. Always absolutely positioned and never touchable: drop one in as the FIRST child of a
 * container and everything after it paints on top.
 */

type GradientStop = { offset: number; color: string; opacity?: number };

function Gradient({ stops, radius = 0, style }: { stops: GradientStop[]; radius?: number; style?: StyleProp<ViewStyle> }) {
  // Gradient ids are looked up by string inside the SVG; make each instance's unique on the screen.
  const id = "g" + useId().replace(/[^a-zA-Z0-9]/g, "");
  // The wrapper's measured size drives the SVG explicitly. Percentage lengths ("100%") were resolved
  // against a stale/short canvas on some hosts (a button whose width follows its text, e.g. the
  // insulin selector) and the gradient stopped short of the trailing edge. With the real numbers the
  // canvas re-renders on every size change. Until the first measurement, a unit viewBox stretched to
  // the view fills it without any percentage math.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        const w = Math.ceil(width), h = Math.ceil(height);
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      }}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width={size ? size.w : undefined}
        height={size ? size.h : undefined}
        viewBox={size ? `0 0 ${size.w} ${size.h}` : "0 0 1 1"}
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={size ? size.w : 1} height={size ? size.h : 1} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A plain two-color vertical gradient: `from` at the top blending continuously into `to` at the bottom. */
export function Shade({
  from,
  to,
  radius = 0,
  style,
}: {
  from: string;
  to: string;
  /** Clips the gradient to a rounded rect so the HOST needs no `overflow: hidden`. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <Gradient stops={[{ offset: 0, color: from }, { offset: 1, color: to }]} radius={radius} style={style} />;
}

/**
 * Full-screen background shade. Starts at exactly the screen color at the top — so header strips
 * painted `screen` stay seamless — and lightens toward the bottom. Hosts keep their own opaque
 * screen background underneath, so nothing changes if this ever fails to render.
 */
export function ScreenShade() {
  const c = useThemeColors();
  return <Shade from={c.screen} to={c.screenBottom} />;
}

/**
 * Control shade — toggle tracks and secondary (non-accent) buttons. Same idea as CardShade at a
 * smaller scale and a lighter base: the control becomes its own small lit surface instead of a flat
 * fill, and because it covers the whole padding box the host's own backgroundColor no longer matters.
 */
export function ControlShade({ radius, style }: { radius: number; style?: StyleProp<ViewStyle> }) {
  const c = useThemeColors();
  return <Shade from={c.controlTop} to={c.controlBottom} radius={Math.max(0, radius - 1)} style={style} />;
}

/**
 * Tint shade — for the translucent COLORED pills, chips and notices: the green Dexcom chip, the
 * reading pill in tab headers, LIVE tags, the gauge's status and trend pills, the dose warnings. It
 * composes OVER the host's own flat tint, in the pill's own color, so a pill that changes with the
 * reading (green → amber → coral) shades in the color it currently is. Only 6-digit hex colors are
 * shaded; anything else renders nothing, never a wrong tint.
 */
export function TintShade({
  color,
  radius,
  from,
  to,
  amount = 0.04,
  dilute = 0.25,
}: {
  color: string;
  radius: number;
  /**
   * Legacy one-way ramp: the pill's own color at alpha `from` at the top easing to `to` at the bottom,
   * all ABOVE the host's tint. Give both, or neither.
   */
  from?: number;
  to?: number;
  /**
   * Default CENTERED ramp — the host's own tint is the MIDDLE of the gradient, not its floor. The top
   * half adds a little more of the color (up to `amount`), the bottom half thins the tint back toward
   * the surface it sits on (up to `dilute` of the card neutral). Gentle on purpose: a floor-based ramp
   * made the top of a tinted pill more than twice as saturated as its bottom.
   */
  amount?: number;
  dilute?: number;
}) {
  const c = useThemeColors();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const stops: GradientStop[] =
    from != null && to != null
      ? [
          { offset: 0, color, opacity: from },
          { offset: 1, color, opacity: to },
        ]
      : [
          { offset: 0, color, opacity: amount }, // above the middle: a touch more color…
          { offset: 0.5, color, opacity: 0 }, // …fading to nothing at the middle
          { offset: 0.5, color: c.card, opacity: 0 }, // then the neutral fades in…
          { offset: 1, color: c.card, opacity: dilute }, // …thinning the tint toward the surface below
        ];
  return <Gradient stops={stops} radius={Math.max(0, radius - 1)} />;
}

/**
 * Accent shade — SOLID accent buttons and selected states (Predict, "I Just Took This Dose", Take
 * Photo, the selected tab of a toggle…). An opaque ramp of the fill color itself, lighter at the top
 * and deeper at the bottom, so the button reads as a lit surface like the windows and pills. Takes
 * the color as a prop so a button whose fill changes (green once a dose is logged) shades in the
 * color it currently is. Non-hex colors render nothing rather than a wrong ramp.
 */
export function AccentShade({ color = COLORS.primary, radius, style }: { color?: string; radius: number; style?: StyleProp<ViewStyle> }) {
  const ok = /^#[0-9a-fA-F]{6}$/.test(color);
  return ok ? (
    <Shade from={mixHex(color, "#FFFFFF", 0.14)} to={mixHex(color, "#000000", 0.14)} radius={Math.max(0, radius - 1)} style={style} />
  ) : null;
}

/**
 * Header-strip band: cardTop at the top settling to cardElevated. Shared by the tab page headers and
 * the Messages window's title bar so a header reads the same wherever it appears — and so the strip's
 * soft bottom edge against the darker page is what separates it, with no divider line.
 */
export function HeaderShade() {
  const c = useThemeColors();
  return <Shade from={c.cardTop} to={c.cardElevated} />;
}

/** Window/card shade: lighter at the top, deeper at the bottom. Pass the card's own border radius. */
export function CardShade({ radius }: { radius: number }) {
  const c = useThemeColors();
  return <Shade from={c.cardTop} to={c.cardBottom} radius={Math.max(0, radius - 1)} />;
}
