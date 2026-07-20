/**
 * DashboardSectionCard — a compact, title-only card used in the Dashboard's 2-column section grid.
 * Tapping it opens the matching section in a centered popup (the card owns no section logic itself).
 * Visual-only; theme-aware via the same legacy `colors` palette the Dashboard's other cards use.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors, { COLORS } from "@/constants/colors";

interface Props {
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  colors: (typeof Colors)["light"];
}

export function DashboardSectionCard({ title, icon, onPress, colors }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: COLORS.primary + "16" }]}>
          <Feather name={icon} size={16} color={COLORS.primary} />
        </View>
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      </View>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * Invisible same-size filler for the empty slot in an odd last row (e.g. a lone Care Circle card).
 * It MUST reuse the card's exact `styles.card` box: an empty flex spacer (`{ flex: 1 }`) does NOT
 * split the row evenly against a content-bearing `flex: 1` card, so the lone card renders wider than
 * the paired cards. Sharing the same box makes the two flex siblings symmetric → identical widths.
 */
export function DashboardSectionCardGhost() {
  return (
    <View
      style={[styles.card, { backgroundColor: "transparent", borderColor: "transparent" }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    // Fixed (not min) height so every card — including a lone one in an odd last row — is identical.
    height: 96,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    justifyContent: "space-between",
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
});
