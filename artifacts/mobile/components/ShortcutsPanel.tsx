/**
 * Dashboard → Shortcuts: pick the buttons on your own Glucose screen. Remove (red), add (green), and
 * move up or down to change the order. Up to MAX_SHORTCUTS. Saved per person (hooks/useShortcuts).
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { withAlpha } from "@/constants/theme";
import { CardShade } from "@/components/Shade";
import { useShortcuts } from "@/hooks/useShortcuts";
import { MAX_SHORTCUTS, moveShortcut, type ShortcutDef } from "@/utils/shortcuts";

type Palette = (typeof Colors)["light"];

export default function ShortcutsPanel({ colors }: { colors: Palette }) {
  const { shortcuts, available, setIds } = useShortcuts();
  const ids = shortcuts.map((s) => s.id);
  const full = ids.length >= MAX_SHORTCUTS;
  const toAdd = available.filter((s) => !ids.includes(s.id));

  const tap = () => Haptics.selectionAsync();
  const remove = (id: string) => {
    tap();
    setIds(ids.filter((x) => x !== id));
  };
  const add = (id: string) => {
    if (full) return;
    tap();
    setIds([...ids, id]);
  };
  const move = (id: string, dir: -1 | 1) => {
    tap();
    setIds(moveShortcut(ids, id, dir));
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={styles.headerRow}>
        <View style={[styles.headerIcon, { backgroundColor: withAlpha("#5CB8FF", 0.18) }]}>
          <Feather name="grid" size={20} color="#5CB8FF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Shortcuts</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Pick the buttons on your Glucose screen, up to {MAX_SHORTCUTS}. Only you see your shortcuts.
          </Text>
        </View>
      </View>

      <Text style={[styles.section, { color: colors.textMuted }]}>ON YOUR GLUCOSE SCREEN</Text>
      {shortcuts.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>None yet. Tap the green plus below to add one.</Text>
      ) : (
        <View style={[styles.list, { borderColor: colors.border }]}>
          {shortcuts.map((s, i) => (
            <Row key={s.id} s={s} colors={colors} first={i === 0}>
              <Pressable
                onPress={() => remove(s.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${s.title}`}
                hitSlop={8}
                style={[styles.circleBtn, { backgroundColor: COLORS.danger }]}
              >
                <Feather name="minus" size={16} color="#fff" />
              </Pressable>
              <ShortcutIcon s={s} />
              <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                {s.title}
              </Text>
              <Pressable
                onPress={() => move(s.id, -1)}
                disabled={i === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move ${s.title} up`}
                hitSlop={6}
                style={[styles.arrowBtn, { opacity: i === 0 ? 0.25 : 1 }]}
              >
                <Feather name="chevron-up" size={20} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => move(s.id, 1)}
                disabled={i === shortcuts.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move ${s.title} down`}
                hitSlop={6}
                style={[styles.arrowBtn, { opacity: i === shortcuts.length - 1 ? 0.25 : 1 }]}
              >
                <Feather name="chevron-down" size={20} color={colors.textSecondary} />
              </Pressable>
            </Row>
          ))}
        </View>
      )}

      {toAdd.length > 0 && (
        <>
          <Text style={[styles.section, { color: colors.textMuted }]}>ADD A SHORTCUT</Text>
          {full && (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              You can have up to {MAX_SHORTCUTS}. Remove one to add another.
            </Text>
          )}
          <View style={[styles.list, { borderColor: colors.border, opacity: full ? 0.45 : 1 }]}>
            {toAdd.map((s, i) => (
              <Row key={s.id} s={s} colors={colors} first={i === 0}>
                <Pressable
                  onPress={() => add(s.id)}
                  disabled={full}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${s.title}`}
                  hitSlop={8}
                  style={[styles.circleBtn, { backgroundColor: COLORS.success }]}
                >
                  <Feather name="plus" size={16} color="#06231A" />
                </Pressable>
                <ShortcutIcon s={s} />
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                  {s.title}
                </Text>
              </Row>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function Row({ s: _s, colors, first, children }: { s: ShortcutDef; colors: Palette; first: boolean; children: React.ReactNode }) {
  return (
    <View
      style={[
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      {children}
    </View>
  );
}

function ShortcutIcon({ s }: { s: ShortcutDef }) {
  return (
    <View style={[styles.icon, { backgroundColor: withAlpha(s.color, 0.18) }]}>
      <Feather name={s.icon} size={16} color={s.color} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 4 },
  empty: { fontSize: 14, lineHeight: 19 },
  list: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 52 },
  circleBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  arrowBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
