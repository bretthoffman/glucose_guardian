/**
 * QuickLookupManager — the "See All" window for the Food page's Quick Lookup list: every saved
 * quick food (not just the first 8), scrollable, with two ways to manage it:
 *  - swipe a row LEFT to reveal a red Delete button;
 *  - press-and-drag a row's ≡ handle to move it up or down. The first QUICK_LOOKUP_VISIBLE rows are
 *    the ones the Food page shows, so dragging a food above that line puts it on the page.
 * Tapping a row looks that food up (same as the page's rows) and closes the window.
 *
 * Built on react-native-gesture-handler's Swipeable (already in the binary) and a PanResponder for
 * the drag — no animation library required. Rows are a fixed height so the drag math is exact.
 */
import React, { useMemo, useRef, useState } from "react";
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { withAlpha } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";
import { moveQuickFood, QUICK_LOOKUP_VISIBLE, type QuickFood } from "@/utils/quickFoods";
import { AccentShade, CardShade } from "@/components/Shade";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";

const ROW_H = 52;

export default function QuickLookupManager({
  visible,
  onClose,
  onPick,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  /** Look this food up (the caller closes the window). */
  onPick: (name: string) => void;
  colors: (typeof Colors)["light"];
}) {
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const { quickFoods, removeQuickFood, reorderQuickFoods } = useAuth();

  // Drag state: which row is lifted, where it currently hovers, and its live offset.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragging = dragFrom !== null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[
          styles.backdrop,
          {
            backgroundColor: scheme === "dark" ? "rgba(0,0,0,0.62)" : "rgba(15,25,45,0.38)",
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close quick lookup" />
        <View style={[styles.window, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: colors.text }]}>Quick Lookup</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                {quickFoods.length} saved · the first {QUICK_LOOKUP_VISIBLE} show on the Food page. Swipe left to delete, drag ≡ to reorder.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={[styles.closeBtn, { backgroundColor: withAlpha(colors.textMuted, 0.2) }]}
              accessibilityRole="button"
              accessibilityLabel="Close quick lookup"
            >
              <Feather name="x" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          {quickFoods.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>
              Nothing saved yet. Look a food up on the Food page and tap the bookmark to add it here.
            </Text>
          ) : (
            <ScrollView
              style={{ maxHeight: windowH * 0.62 }}
              scrollEnabled={!dragging}
              showsVerticalScrollIndicator
              {...NO_AUTO_CONTENT_INSETS}
            >
              <View style={[styles.list, { borderColor: colors.border }]}>
                {quickFoods.map((food, index) => (
                  <ManagedRow
                    key={food.name}
                    food={food}
                    index={index}
                    count={quickFoods.length}
                    colors={colors}
                    dragFrom={dragFrom}
                    dragOver={dragOver}
                    dragY={dragY}
                    onPick={() => onPick(food.name)}
                    onDelete={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      removeQuickFood(food.name);
                    }}
                    onDragStart={() => {
                      Haptics.selectionAsync();
                      dragY.setValue(0);
                      setDragFrom(index);
                      setDragOver(index);
                    }}
                    onDragMove={(dy) => {
                      dragY.setValue(dy);
                      const over = Math.max(0, Math.min(quickFoods.length - 1, Math.round((index * ROW_H + dy) / ROW_H)));
                      setDragOver((prev) => (prev === over ? prev : over));
                    }}
                    onDragEnd={(dy) => {
                      const to = Math.max(0, Math.min(quickFoods.length - 1, Math.round((index * ROW_H + dy) / ROW_H)));
                      if (to !== index) {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        reorderQuickFoods(moveQuickFood(quickFoods, index, to));
                      }
                      dragY.setValue(0);
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ManagedRow({
  food,
  index,
  count,
  colors,
  dragFrom,
  dragOver,
  dragY,
  onPick,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  food: QuickFood;
  index: number;
  count: number;
  colors: (typeof Colors)["light"];
  dragFrom: number | null;
  dragOver: number | null;
  dragY: Animated.Value;
  onPick: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragMove: (dy: number) => void;
  onDragEnd: (dy: number) => void;
}) {
  const isDragged = dragFrom === index;
  // Rows between the lifted row's origin and its hover slot step aside by one row height.
  let shift = 0;
  if (dragFrom !== null && dragOver !== null && !isDragged) {
    if (dragFrom < index && index <= dragOver) shift = -ROW_H;
    else if (dragOver <= index && index < dragFrom) shift = ROW_H;
  }
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => onDragStart(),
        onPanResponderMove: (_e, g) => onDragMove(g.dy),
        onPanResponderRelease: (_e, g) => onDragEnd(g.dy),
        onPanResponderTerminate: (_e, g) => onDragEnd(g.dy),
        onPanResponderTerminationRequest: () => false,
      }),
    [onDragStart, onDragMove, onDragEnd],
  );
  const last = index === count - 1;
  const pageEdge = index === QUICK_LOOKUP_VISIBLE - 1 && count > QUICK_LOOKUP_VISIBLE;

  return (
    <Animated.View
      style={[
        styles.rowOuter,
        { transform: [{ translateY: isDragged ? dragY : shift }], zIndex: isDragged ? 10 : 0 },
        isDragged && { shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
      ]}
    >
      <Swipeable
        friction={2}
        rightThreshold={40}
        overshootRight={false}
        renderRightActions={() => (
          <Pressable
            onPress={onDelete}
            style={[styles.deleteBtn, { backgroundColor: COLORS.danger }]}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${food.name}`}
          >
            <AccentShade color={COLORS.danger} radius={0} />
            <Feather name="trash-2" size={16} color="#fff" />
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        )}
      >
        <View
          style={[
            styles.row,
            { backgroundColor: colors.card },
            !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            // The line under the last row the Food page shows.
            pageEdge && { borderBottomWidth: 2, borderBottomColor: withAlpha(COLORS.primary, 0.45) },
          ]}
        >
          <Pressable style={styles.rowBody} onPress={onPick} accessibilityRole="button" accessibilityLabel={`Look up ${food.name}`}>
            <Text style={[styles.rowIndex, { color: index < QUICK_LOOKUP_VISIBLE ? COLORS.primary : colors.textMuted }]}>{index + 1}</Text>
            <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
              {food.name}
            </Text>
            <Text style={[styles.rowCarbs, { color: colors.textSecondary }]}>{food.carbs != null ? `${food.carbs} g` : "—"}</Text>
          </Pressable>
          <View style={styles.handle} {...pan.panHandlers} accessibilityLabel={`Drag to reorder ${food.name}`}>
            <Feather name="menu" size={18} color={colors.textMuted} />
          </View>
        </View>
      </Swipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  window: { width: "100%", maxWidth: 540, alignSelf: "center", borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { fontSize: 17, fontWeight: "700" },
  hint: { fontSize: 12, fontWeight: "400", marginTop: 3, lineHeight: 16 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 13, lineHeight: 18, paddingVertical: 8 },
  list: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  rowOuter: { height: ROW_H },
  row: { height: ROW_H, flexDirection: "row", alignItems: "center" },
  rowBody: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, paddingRight: 6, height: "100%" },
  rowIndex: { width: 18, fontSize: 11, fontWeight: "700", textAlign: "right" },
  rowName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600" },
  rowCarbs: { fontSize: 12.5, fontWeight: "600", flexShrink: 0 },
  handle: { width: 44, height: "100%", alignItems: "center", justifyContent: "center" },
  deleteBtn: { width: 88, height: "100%", alignItems: "center", justifyContent: "center", gap: 3 },
  deleteText: { color: "#fff", fontSize: 11, fontWeight: "700" },
});
