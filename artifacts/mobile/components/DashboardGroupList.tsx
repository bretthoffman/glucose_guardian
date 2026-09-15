/**
 * DashboardGroup + DashboardRow — the Dashboard's grouped settings list (the "Settings" mockup):
 * a titled window per group, and inside it one row per section — icon tile · title · chevron —
 * divided by inset hairlines. A row is navigation only: tapping it opens the section's existing popup
 * (the row owns no section logic). A row may carry its own trailing control instead of a chevron
 * (`right`), e.g. the Child View Mode switch. No description lines under titles, by design.
 * Visual-only; theme-aware via the same legacy `colors` palette the Dashboard's other cards use.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { withAlpha } from "@/constants/theme";
import { CardShade } from "@/components/Shade";

type Palette = (typeof Colors)["light"];

export function DashboardGroup({ title, colors, children }: { title: string; colors: Palette; children: React.ReactNode }) {
  return (
    <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={[styles.groupHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.groupTitle, { color: colors.text }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

interface RowProps {
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  /** The row's own hue: the icon takes it, and its tile is a soft wash of it. */
  color: string;
  colors: Palette;
  /** Opens the section. Omit for a row whose `right` control is the whole interaction. */
  onPress?: () => void;
  /** Trailing control (a Switch, say) in place of the chevron. */
  right?: React.ReactNode;
  last?: boolean;
}

export function DashboardRow({ title, icon, color, colors, onPress, right, last }: RowProps) {
  const body = (
    <>
      <View style={[styles.iconTile, { backgroundColor: withAlpha(color, 0.18) }]}>
        <Feather name={icon} size={19} color={color} />
      </View>
      <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <Feather name="chevron-right" size={19} color={colors.textMuted} />}
      {/* Inset hairline: starts where the title starts, like the mockup — the tiles stay uncut. */}
      {!last && <View style={[styles.separator, { backgroundColor: colors.border }]} />}
    </>
  );
  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const ROW_PAD_H = 16;
const TILE = 40;
const GAP = 14;

const styles = StyleSheet.create({
  group: { borderRadius: 16, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  groupHeader: { paddingHorizontal: ROW_PAD_H, paddingTop: 14, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  groupTitle: { fontSize: 17, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: GAP, paddingHorizontal: ROW_PAD_H, paddingVertical: 11 },
  iconTile: { width: TILE, height: TILE, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: "600" },
  separator: { position: "absolute", left: ROW_PAD_H + TILE + GAP, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
