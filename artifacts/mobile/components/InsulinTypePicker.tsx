import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import {
  INSULIN_TYPE_LABEL,
  insulinChipLabel,
  isBolusInsulin,
  type InsulinOption,
} from "@/constants/insulin";

/**
 * Single-select list of the insulins the user has configured on their account
 * (profile.insulinTypes). Selection is identified by the same chip label stored on the profile.
 */
export default function InsulinTypePicker({
  options,
  selectedLabel,
  onSelect,
  colors,
}: {
  options: InsulinOption[];
  selectedLabel: string | null;
  onSelect: (label: string) => void;
  colors: (typeof Colors)["light"];
}) {
  if (options.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: colors.textMuted }]}>
        No insulin types set on this account yet. Add the insulin you use from Dashboard →
        Treatment → Insulin Used.
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {options.map((opt) => {
        const label = insulinChipLabel(opt);
        const selected = label === selectedLabel;
        const actingColor = isBolusInsulin(opt.type) ? COLORS.primary : COLORS.accent;
        return (
          <Pressable
            key={label}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: selected ? COLORS.primary + "14" : colors.backgroundTertiary,
                borderColor: selected ? COLORS.primary : colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onSelect(label);
            }}
          >
            <View
              style={[
                styles.radio,
                { borderColor: selected ? COLORS.primary : colors.textMuted },
              ]}
            >
              {selected && <View style={[styles.radioDot, { backgroundColor: COLORS.primary }]} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: selected ? COLORS.primary : colors.text }]}>
                {opt.name}
              </Text>
              <Text style={[styles.sub, { color: colors.textMuted }]}>
                {opt.concentration} · {opt.genericName}
              </Text>
            </View>
            <View style={[styles.actingTag, { backgroundColor: actingColor + "1C" }]}>
              <Text style={[styles.actingTagText, { color: actingColor }]}>
                {INSULIN_TYPE_LABEL[opt.type]}
              </Text>
            </View>
            {selected && <Feather name="check" size={15} color={COLORS.primary} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  name: { fontSize: 14, fontWeight: "600" },
  sub: { fontSize: 11, fontWeight: "400", marginTop: 1 },
  actingTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  actingTagText: { fontSize: 10, fontWeight: "700" },
  emptyText: { fontSize: 13, fontWeight: "400", lineHeight: 19, textAlign: "center", paddingVertical: 10 },
});
