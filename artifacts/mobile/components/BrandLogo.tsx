import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, type ImageStyle, type StyleProp } from "react-native";

import { useTheme } from "@/context/ThemeContext";

const MARK = require("../assets/images/brand/mark.png");
const LOCKUP_DARK = require("../assets/images/brand/lockup-dark.png");
const LOCKUP_LIGHT = require("../assets/images/brand/lockup-light.png");
/** lockup-*.png is 600 × 581. */
const LOCKUP_RATIO = 581 / 600;

/** The drop on its own (no words). Works on light and dark backgrounds. */
export function BrandMark({ size, style }: { size: number; style?: StyleProp<ImageStyle> }) {
  return (
    <Image
      source={MARK}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

/**
 * The drop with "GLUCOSE GUARDIAN" under it. White lettering on dark screens, navy on light ones.
 * Pass `dark` to force a version (e.g. a screen that is always dark).
 */
export function BrandLockup({ width, dark, style }: { width: number; dark?: boolean; style?: StyleProp<ImageStyle> }) {
  const { scheme } = useTheme();
  const isDark = dark ?? scheme !== "light";
  return (
    <Image
      source={isDark ? LOCKUP_DARK : LOCKUP_LIGHT}
      style={[{ width, height: Math.round(width * LOCKUP_RATIO) }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="Glucose Guardian"
      accessibilityIgnoresInvertColors
    />
  );
}

/** The drop, breathing gently: shown while the app signs in after the splash screen. */
export function BrandLoading({ size = 140 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading Glucose Guardian"
      style={{
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
      }}
    >
      <BrandMark size={size} />
    </Animated.View>
  );
}
