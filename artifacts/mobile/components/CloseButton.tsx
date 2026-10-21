import React from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/context/ThemeContext";

/**
 * The one close (X) button for every popup, sheet and card that can be dismissed. A SOLID, outlined
 * circle with a full-contrast X, so it reads on any backdrop: white with a navy X in light mode,
 * a raised slate circle with a white X in dark mode. (A faint grey X on a translucent chip all but
 * disappeared over the dimmed light-mode backdrop.)
 */
export function CloseButton({
  onPress,
  accessibilityLabel = "Close",
  size = 36,
  hitSlop = 12,
  haptic = true,
  style,
}: {
  onPress: () => void;
  accessibilityLabel?: string;
  /** Circle diameter. The X scales with it. */
  size?: number;
  hitSlop?: number;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { scheme } = useTheme();
  const dark = scheme !== "light";
  return (
    <Pressable
      onPress={() => {
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: dark ? "#26375A" : "#FFFFFF",
          borderWidth: 1,
          borderColor: dark ? "rgba(255,255,255,0.22)" : "rgba(14,26,43,0.16)",
          shadowColor: "#000",
          shadowOpacity: dark ? 0.35 : 0.14,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Feather name="x" size={Math.round(size * 0.55)} color={dark ? "#FFFFFF" : "#0E1A2B"} />
    </Pressable>
  );
}
