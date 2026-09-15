import React, { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { mixHex, withAlpha } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import { COLORS } from "@/constants/colors";

/**
 * A vertical pseudo-gradient: `steps` flat bands whose colors run from `from` (top) to `to`
 * (bottom). It exists because the shipped binary has NO gradient-capable native module, and adding
 * one can't ship over the air — while a stack of Views ships anywhere. The shading this app wants is
 * deliberately slight (a few units per channel across a whole screen), so with 8–16 bands each step
 * moves a channel by ~1 and the banding is imperceptible. Absolutely positioned, never touchable:
 * drop it in as the FIRST child of a container and everything after it paints on top.
 */
export function Shade({
  from,
  to,
  steps = 12,
  radius = 0,
  style,
}: {
  from: string;
  to: string;
  steps?: number;
  /** Clips the bands to a rounded rect so the HOST needs no `overflow: hidden` (which would clip its shadow). */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const bands = useMemo(
    () => Array.from({ length: steps }, (_, i) => mixHex(from, to, steps === 1 ? 0 : i / (steps - 1))),
    [from, to, steps],
  );
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }, style]}>
      {bands.map((color, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}

/**
 * Full-screen background shade. Starts at exactly the screen color at the top — so header strips
 * painted `screen` stay seamless — and lightens toward the bottom. Hosts keep their own opaque
 * screen background underneath, so nothing changes if this ever fails to render.
 */
export function ScreenShade() {
  const c = useThemeColors();
  return <Shade from={c.screen} to={c.screenBottom} steps={16} />;
}

/**
 * Window/card shade: lighter at the top, deeper at the bottom. Pass the card's own border radius;
 * the bands inset themselves by the 1px border so they never bleed past it.
 */
/**
 * Control shade — toggle tracks and secondary (non-accent) buttons. Same idea as CardShade at a
 * smaller scale and a lighter base: the control becomes its own small lit surface instead of a flat
 * fill, and because it covers the whole padding box the host's own backgroundColor no longer matters.
 */
export function ControlShade({ radius, style }: { radius: number; style?: StyleProp<ViewStyle> }) {
  const c = useThemeColors();
  return <Shade from={c.controlTop} to={c.controlBottom} steps={6} radius={Math.max(0, radius - 1)} style={style} />;
}

/**
 * Tint shade — the card shade's ramp (brighter at the top, easing to the base at the bottom) for the
 * translucent COLORED pills and chips: the green Dexcom chip, the reading pill in tab headers, LIVE
 * tags, the gauge's status and trend pills. Bands of the pill's OWN color at an alpha that fades from
 * `from` at the top to `to` at the bottom, over the host's flat tint — so the pill shades the same way
 * the windows do, in its own color, and still composes over whatever it sits on. It takes the color
 * as a prop so a pill that changes with the reading (green → amber → coral) shades in the color it
 * currently is. Only 6-digit hex colors are shaded; anything else renders nothing, never a wrong tint.
 */
export function TintShade({
  color,
  radius,
  from,
  to,
  amount = 0.04,
  dilute = 0.25,
  steps = 8,
}: {
  color: string;
  radius: number;
  /**
   * Legacy one-way ramp: the pill's own color at alpha `from` at the top easing to `to` at the bottom,
   * all ABOVE the host's tint. Only for the few hosts that want a strong ramp (the gauge's inner
   * disc). Give both, or neither.
   */
  from?: number;
  to?: number;
  /**
   * Default CENTERED ramp — the host's own tint is the MIDDLE of the gradient, not its floor. The top
   * half adds a little more of the color (up to `amount`), the bottom half thins the tint back toward
   * the surface it sits on (up to `dilute` of the card neutral). Gentle on purpose: the old floor-based
   * ramp made the top of a tinted pill more than twice as saturated as its bottom.
   */
  amount?: number;
  dilute?: number;
  steps?: number;
}) {
  const c = useThemeColors();
  const bands = useMemo(() => {
    const t = (i: number) => (steps === 1 ? 0 : i / (steps - 1));
    if (from != null && to != null) {
      return Array.from({ length: steps }, (_, i) => withAlpha(color, from + (to - from) * t(i)));
    }
    return Array.from({ length: steps }, (_, i) => {
      const x = t(i);
      return x < 0.5
        ? withAlpha(color, amount * (1 - 2 * x)) // above the middle: a touch more color
        : withAlpha(c.card, dilute * (2 * x - 1)); // below: a touch less, toward the neutral
    });
  }, [color, from, to, amount, dilute, steps, c.card]);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: Math.max(0, radius - 1), overflow: "hidden" }]}>
      {bands.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
    </View>
  );
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
    <Shade from={mixHex(color, "#FFFFFF", 0.14)} to={mixHex(color, "#000000", 0.14)} steps={6} radius={Math.max(0, radius - 1)} style={style} />
  ) : null;
}

/**
 * Header-strip band: cardTop at the top settling to cardElevated. Shared by the tab page headers and
 * the Messages window's title bar so a header reads the same wherever it appears — and so the strip's
 * soft bottom edge against the darker page is what separates it, with no divider line.
 */
export function HeaderShade() {
  const c = useThemeColors();
  return <Shade from={c.cardTop} to={c.cardElevated} steps={8} />;
}

export function CardShade({ radius }: { radius: number }) {
  const c = useThemeColors();
  return <Shade from={c.cardTop} to={c.cardBottom} steps={8} radius={Math.max(0, radius - 1)} />;
}
