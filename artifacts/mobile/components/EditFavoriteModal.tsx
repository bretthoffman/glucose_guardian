/**
 * Edit a Favorite's saved carbs (the Food page's pencil on the Favorites tab). The saved number is
 * what the food starts from the next time it is tapped. Changes the shared Quick Lookup list only —
 * never a log entry.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { AccentShade, CardShade } from "@/components/Shade";
import { formatCarbs, type QuickFood } from "@/utils/quickFoods";

export default function EditFavoriteModal({
  food,
  colors,
  onSave,
  onClose,
}: {
  food: QuickFood;
  colors: (typeof Colors)["light"];
  onSave: (carbs: number) => void;
  onClose: () => void;
}) {
  const [carbsText, setCarbsText] = useState(food.carbs != null ? formatCarbs(food.carbs) : "");
  const parsed = parseFloat(carbsText);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 999;

  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel="Edit favorite">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <Text style={[styles.title, { color: colors.text }]}>Edit favorite</Text>
        <Text style={[styles.label, { color: colors.textMuted }]}>Food</Text>
        <Text style={[styles.name, { color: colors.text }]}>{food.name}</Text>
        <Text style={[styles.label, { color: colors.textMuted }]}>Carbs (g)</Text>
        <TextInput
          style={[styles.input, { color: colors.text, backgroundColor: colors.backgroundTertiary, borderColor: COLORS.primary }]}
          value={carbsText}
          onChangeText={(t) => setCarbsText(t.replace(/[^0-9.]/g, ""))}
          keyboardType="decimal-pad"
          selectTextOnFocus
          autoFocus
          accessibilityLabel="Carbs in grams"
        />
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          This is the number it starts from next time you tap it. Past logs don't change.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={!valid}
          onPress={() => {
            if (!valid) return;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onSave(Math.round(parsed * 10) / 10);
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
  name: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 18, fontWeight: "700" },
  hint: { fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  saveBtn: { marginTop: 12, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  saveText: { fontSize: 17, fontWeight: "700" },
});
