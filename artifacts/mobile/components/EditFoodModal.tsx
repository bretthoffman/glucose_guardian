/**
 * The Food page's pencil: a small "name + carbs" editor, used for both tabs.
 *  - Favorites: changes the saved food (what it starts from next time). Never touches a log.
 *  - Recent: fixes that log entry's name and carbs (the caller also recalculates the insulin recorded
 *    with it). Time and insulin are edited on the Log page, which the note says.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { AccentShade, CardShade } from "@/components/Shade";
import { formatCarbs } from "@/utils/quickFoods";
import { capFirst } from "@/utils/capitalize";

export default function EditFoodModal({
  title,
  initialName,
  initialCarbs,
  notes,
  colors,
  onSave,
  onClose,
}: {
  title: string;
  initialName: string;
  initialCarbs?: number;
  /** Short lines under the fields (e.g. "Also updates this food in Favorites…"). */
  notes?: string[];
  colors: (typeof Colors)["light"];
  onSave: (name: string, carbs: number) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [carbsText, setCarbsText] = useState(initialCarbs != null ? formatCarbs(initialCarbs) : "");
  const parsed = parseFloat(carbsText);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 999 && name.trim().length > 0;

  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel={title}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.label, { color: colors.textMuted }]}>Food</Text>
        <TextInput
          autoCapitalize="sentences"
          style={[styles.input, styles.nameInput, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
          value={name}
          onChangeText={(t) => setName(capFirst(t))}
          placeholder="Food name"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Food name"
          maxLength={120}
        />
        <Text style={[styles.label, { color: colors.textMuted }]}>Carbs (g)</Text>
        <TextInput
          style={[styles.input, styles.carbsInput, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: COLORS.primary }]}
          value={carbsText}
          onChangeText={(t) => setCarbsText(t.replace(/[^0-9.]/g, ""))}
          keyboardType="decimal-pad"
          selectTextOnFocus
          autoFocus
          accessibilityLabel="Carbs in grams"
        />
        {notes?.map((n) => (
          <View key={n} style={[styles.note, { backgroundColor: COLORS.primary + "18" }]}>
            <Feather name="info" size={13} color={COLORS.primaryLight} />
            <Text style={[styles.noteText, { color: colors.textSecondary }]}>{n}</Text>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          disabled={!valid}
          onPress={() => {
            if (!valid) return;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onSave(name.trim(), Math.round(parsed * 10) / 10);
            onClose();
          }}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: valid ? COLORS.primary : colors.backgroundTertiary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          {valid && <AccentShade radius={14} />}
          <Text style={[styles.saveText, { color: valid ? "#fff" : colors.textMuted }]}>Save</Text>
        </Pressable>
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  title: { fontSize: 20, fontWeight: "800", marginBottom: 6 },
  label: { fontSize: 12, fontWeight: "600", marginTop: 6 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  nameInput: { fontSize: 15, fontWeight: "600" },
  carbsInput: { fontSize: 18, fontWeight: "700" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, padding: 10, marginTop: 6 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  saveBtn: { marginTop: 12, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  saveText: { fontSize: 17, fontWeight: "700" },
});
