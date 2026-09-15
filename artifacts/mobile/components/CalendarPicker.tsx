/**
 * CalendarPicker — a small month calendar in a centered popup window, for jumping the Log page
 * straight to a date. Tapping a day selects it (the host closes the popup and switches the page).
 * Days after `maxDate` (today) are shown but disabled — there are no logs in the future.
 *
 * Pure React Native — no calendar dependency (Expo Go compatible). Same window language as every
 * other popup: dimmed backdrop, shaded window, tap-outside to close. Month arrows are control-styled
 * buttons; the selected day is the one accent (purple) element, like a selected segment.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import { AccentShade, CardShade, ControlShade } from "@/components/Shade";
import { monthGrid } from "@/utils/calendarGrid";

type Palette = (typeof Colors)["light"];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarPicker({
  visible,
  selected,
  maxDate,
  onSelect,
  onClose,
  colors,
}: {
  visible: boolean;
  selected: Date;
  /** Latest selectable day (default: today). */
  maxDate?: Date;
  onSelect: (day: Date) => void;
  onClose: () => void;
  colors: Palette;
}) {
  const today = useMemo(() => startOfDay(maxDate ?? new Date()), [maxDate]);
  const [view, setView] = useState({ year: selected.getFullYear(), month: selected.getMonth() });
  // Every open starts on the selected day's month, not wherever the last browse ended.
  useEffect(() => {
    if (visible) setView({ year: selected.getFullYear(), month: selected.getMonth() });
  }, [visible, selected]);

  const cells = useMemo(() => monthGrid(view.year, view.month), [view]);
  const canGoNext = view.year < today.getFullYear() || (view.year === today.getFullYear() && view.month < today.getMonth());
  const title = new Date(view.year, view.month, 1).toLocaleDateString([], { month: "long", year: "numeric" });

  const shift = (delta: number) => {
    Haptics.selectionAsync();
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the calendar" />
        <View style={[styles.window, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <View style={styles.header}>
            <Pressable
              style={[styles.monthBtn, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
              onPress={() => shift(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              hitSlop={6}
            >
              <ControlShade radius={10} />
              <Feather name="chevron-left" size={18} color={colors.text} />
            </Pressable>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            <Pressable
              style={[styles.monthBtn, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, opacity: canGoNext ? 1 : 0.3 }]}
              onPress={() => shift(1)}
              disabled={!canGoNext}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              hitSlop={6}
            >
              <ControlShade radius={10} />
              <Feather name="chevron-right" size={18} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={[styles.weekday, { color: colors.textMuted }]}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((d, i) => {
              if (!d) return <View key={`e${i}`} style={styles.cell} />;
              const isSelected = sameDay(d, selected);
              const isToday = sameDay(d, today);
              const future = d.getTime() > today.getTime();
              return (
                <Pressable
                  key={d.toISOString()}
                  style={styles.cell}
                  disabled={future}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelect(d);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: future }}
                  accessibilityLabel={d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                >
                  <View
                    style={[
                      styles.day,
                      isSelected && { backgroundColor: COLORS.primary },
                      !isSelected && isToday && { borderWidth: 1.5, borderColor: COLORS.primary },
                    ]}
                  >
                    {isSelected && <AccentShade radius={18} />}
                    <Text
                      style={[
                        styles.dayText,
                        { color: isSelected ? "#fff" : future ? colors.textMuted : colors.text },
                        future && { opacity: 0.45 },
                        (isSelected || isToday) && { fontWeight: "700" },
                      ]}
                    >
                      {d.getDate()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const CELL = 40;

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.55)" },
  window: { width: "100%", maxWidth: 360, borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "700" },
  monthBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontWeight: "600", paddingVertical: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, height: CELL, alignItems: "center", justifyContent: "center" },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 14, fontWeight: "500" },
});
