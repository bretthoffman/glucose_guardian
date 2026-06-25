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

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    justifyContent: "space-between",
    gap: 12,
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
