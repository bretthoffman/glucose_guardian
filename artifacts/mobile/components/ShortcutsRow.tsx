/**
 * "My Shortcuts" on the Glucose screen: the buttons this person picked on Dashboard → Shortcuts. Shows
 * nothing at all until they add one, so the screen looks as it always did. Set up only on the Dashboard.
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { withAlpha } from "@/constants/theme";
import { openShortcut, useShortcuts } from "@/hooks/useShortcuts";

export default function ShortcutsRow({
  padH,
  anchorRef,
}: {
  /** Side padding, matching the card it sits in. */
  padH: number;
  anchorRef?: (node: View | null) => void;
}) {
  const { colors: c } = useTheme();
  const { shortcuts } = useShortcuts();
  if (shortcuts.length === 0) return null;
  return (
    <View ref={anchorRef} collapsable={false} style={[styles.wrap, { paddingHorizontal: padH }]}>
      <Text style={[styles.heading, { color: c.textSecondary }]} accessibilityRole="header">
        MY SHORTCUTS
      </Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              openShortcut(s);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open ${s.title}`}
            style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={[styles.icon, { backgroundColor: withAlpha(s.color, 0.18) }]}>
              <Feather name={s.icon} size={17} color={s.color} />
            </View>
            <Text
              style={[styles.label, { color: c.textSecondary }]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.3}
            >
              {s.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingBottom: 12 },
  heading: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 6 },
  tile: {
    // Four to a row (a fifth starts a second row); small round icon, short label, no box.
    width: "25%",
    minHeight: 44,
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 11, fontWeight: "600", textAlign: "center", lineHeight: 13 },
});
