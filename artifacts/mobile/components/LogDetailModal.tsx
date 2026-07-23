/**
 * LogDetailModal — tap a food/insulin entry on the Log page to view it, then Edit it in place or
 * Delete it. Edit/Delete route through AuthContext (→ the shared Convex bucket), so a change reaches
 * every co-guardian + access-code viewer and updates/removes the entry from the shared dose math.
 * An edit stamps the entry `edited: true` (shown as "Edited" on the row).
 */
import React, { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import { withAlpha } from "@/constants/theme";
import { useAuth, type FoodLogEntry, type InsulinLogEntry } from "@/context/AuthContext";
import { INSULIN_TYPE_LABEL, findInsulinByChipLabel } from "@/constants/insulin";
import { formatDoseAmount } from "@/utils/doseOverride";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";
import { startOfLocalDay } from "@/utils/localDayBoundaries";
import { useTheme } from "@/context/ThemeContext";

export type SelectedLog =
  | { kind: "food"; data: FoodLogEntry }
  | { kind: "insulin"; data: InsulinLogEntry };

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function LogDetailModal({
  entry,
  colors,
  canEdit,
  onClose,
}: {
  entry: SelectedLog;
  colors: (typeof Colors)["light"];
  canEdit: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const { deleteFoodLogEntry, deleteInsulinLogEntry, editFoodLogEntry, editInsulinLogEntry } = useAuth();

  const [editing, setEditing] = useState(false);
  // Edit-field text (initialised on entering edit mode).
  const [foodName, setFoodName] = useState("");
  const [carbs, setCarbs] = useState("");
  const [units, setUnits] = useState("");
  const [note, setNote] = useState("");
  const [timeText, setTimeText] = useState("");

  const isFood = entry.kind === "food";
  const accent = isFood ? COLORS.accent : COLORS.primary;

  const startEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (entry.kind === "food") {
      setFoodName(entry.data.foodName);
      setCarbs(String(entry.data.estimatedCarbs));
      setUnits(String(entry.data.insulinUnits));
    } else {
      setUnits(formatDoseAmount(entry.data.units));
      setNote(entry.data.note ?? "");
    }
    setTimeText(formatTimeInputText(new Date(entry.data.timestamp)));
    setEditing(true);
  };

  const cancelEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(false); // discard — nothing was applied
  };

  const saveEdit = () => {
    const parsedTime = parseTimeInputText(timeText);
    const newTimestamp =
      parsedTime != null
        ? combineDayAndTime(startOfLocalDay(new Date(entry.data.timestamp)), parsedTime.hours, parsedTime.minutes).toISOString()
        : undefined;
    if (entry.kind === "food") {
      const c = parseFloat(carbs);
      const u = parseFloat(units);
      editFoodLogEntry(entry.data.id, {
        foodName: foodName.trim() || entry.data.foodName,
        ...(Number.isFinite(c) ? { estimatedCarbs: Math.max(0, c) } : {}),
        ...(Number.isFinite(u) ? { insulinUnits: Math.max(0, u) } : {}),
        ...(newTimestamp ? { timestamp: newTimestamp } : {}),
      });
    } else {
      const u = parseFloat(units);
      editInsulinLogEntry(entry.data.id, {
        ...(Number.isFinite(u) ? { units: Math.max(0, u) } : {}),
        note: note.trim(),
        ...(newTimestamp ? { timestamp: newTimestamp } : {}),
      });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const confirmDelete = () => {
    Alert.alert(
      "Delete this log?",
      "This removes it for everyone who can see it and stops it counting toward dose calculations. This can't be undone.",
      [
        { text: "No", style: "cancel" },
        {
          text: "Yes, delete",
          style: "destructive",
          onPress: () => {
            if (entry.kind === "food") deleteFoodLogEntry(entry.data.id);
            else deleteInsulinLogEntry(entry.data.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onClose();
          },
        },
      ],
    );
  };

  const insulinName =
    entry.kind === "insulin"
      ? (entry.data.insulinType ? findInsulinByChipLabel(entry.data.insulinType) : undefined)?.name ??
        entry.data.insulinType?.split(" · ")[0] ??
        entry.data.type
      : "";
  const insulinTypeLabel =
    entry.kind === "insulin" && entry.data.insulinType
      ? INSULIN_TYPE_LABEL[findInsulinByChipLabel(entry.data.insulinType)?.type ?? "rapid"]
      : "";

  const fieldStyle = [styles.fieldInput, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: colors.border }];

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          {
            backgroundColor: scheme === "dark" ? "rgba(0,0,0,0.62)" : "rgba(15,25,45,0.38)",
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 96,
          },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close log details" />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: withAlpha(accent, 0.4) }]}>
          {/* Top row: Edit / Delete (or Save Edit / Cancel while editing) + close */}
          <View style={styles.topRow}>
            {canEdit ? (
              <View style={styles.topActions}>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.topBtn, { backgroundColor: COLORS.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                  onPress={editing ? saveEdit : startEdit}
                >
                  <Feather name={editing ? "check" : "edit-2"} size={13} color={COLORS.primary} />
                  <Text style={[styles.topBtnText, { color: COLORS.primary }]}>{editing ? "Save Edit" : "Edit"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.topBtn, { backgroundColor: COLORS.danger + "18", opacity: pressed ? 0.7 : 1 }]}
                  onPress={editing ? cancelEdit : confirmDelete}
                >
                  <Feather name={editing ? "x" : "trash-2"} size={13} color={COLORS.danger} />
                  <Text style={[styles.topBtnText, { color: COLORS.danger }]}>{editing ? "Cancel" : "Delete"}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={[styles.closeBtn, { backgroundColor: withAlpha(colors.textMuted, 0.2) }]}
              accessibilityRole="button"
              accessibilityLabel="Close log details"
            >
              <Feather name="x" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          {/* Body */}
          <View style={styles.body}>
            <View style={[styles.iconBubble, { backgroundColor: accent + "18" }]}>
              <Text style={{ fontSize: 22 }}>{isFood ? "🍽️" : "💉"}</Text>
            </View>

            {editing ? (
              <View style={styles.editFields}>
                {entry.kind === "food" ? (
                  <>
                    <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Food</Text>
                    <TextInput style={fieldStyle} value={foodName} onChangeText={setFoodName} placeholder="Food name" placeholderTextColor={colors.textMuted} />
                    <View style={styles.fieldRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Carbs (g)</Text>
                        <TextInput style={fieldStyle} value={carbs} onChangeText={(t) => setCarbs(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Insulin (u)</Text>
                        <TextInput style={fieldStyle} value={units} onChangeText={(t) => setUnits(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Units</Text>
                    <TextInput style={fieldStyle} value={units} onChangeText={(t) => setUnits(t.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
                    <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Note</Text>
                    <TextInput style={fieldStyle} value={note} onChangeText={setNote} placeholder="Optional note" placeholderTextColor={colors.textMuted} />
                  </>
                )}
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>Time</Text>
                <TextInput style={fieldStyle} value={timeText} onChangeText={setTimeText} placeholder="9:51 AM" placeholderTextColor={colors.textMuted} autoCapitalize="characters" />
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text }]}>
                  {entry.kind === "food"
                    ? entry.data.foodName
                    : `${formatDoseAmount(entry.data.units)}u · ${insulinName}`}
                </Text>
                <Text style={[styles.detail, { color: colors.textSecondary }]}>
                  {entry.kind === "food"
                    ? `${entry.data.estimatedCarbs}g carbs · ${entry.data.insulinUnits}u`
                    : [insulinTypeLabel, entry.data.recommendedUnits != null ? `Rec ${formatDoseAmount(entry.data.recommendedUnits)}u` : null, entry.data.note]
                        .filter(Boolean)
                        .join(" · ")}
                </Text>
                <Text style={[styles.detail, { color: colors.textMuted }]}>
                  {fmtTime(entry.data.timestamp)}
                  {entry.data.authorName ? ` · by ${entry.data.authorName}` : ""}
                  {entry.data.edited ? "  " : ""}
                  {entry.data.edited ? <Text style={styles.editedText}>Edited</Text> : null}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 14 },
  card: { width: "100%", maxWidth: 480, alignSelf: "center", borderRadius: 16, borderWidth: 1, padding: 16, gap: 14, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 12 } },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  topActions: { flexDirection: "row", gap: 8, flex: 1 },
  topBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  topBtnText: { fontSize: 13, fontWeight: "700" },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  body: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconBubble: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 3 },
  detail: { fontSize: 13, fontWeight: "400", marginTop: 2 },
  editedText: { fontStyle: "italic", fontWeight: "500" },
  editFields: { flex: 1, gap: 4 },
  fieldRow: { flexDirection: "row", gap: 10 },
  fieldLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6, marginBottom: 3 },
  fieldInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, fontWeight: "500" },
});
