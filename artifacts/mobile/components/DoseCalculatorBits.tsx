/**
 * Shared building blocks for the dose calculator UI — used by the Insulin screen's main
 * calculator and the Food screen's meal-insulin popup. Moved verbatim from insulin.tsx.
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import type { DoseWarning } from "@/utils/dose";
import {
  doseAmountsEqual,
  formatDoseAmount,
  formatSuggestedDoseLine,
} from "@/utils/doseOverride";

export function DoseWarningsList({ warnings }: { warnings: DoseWarning[] }) {
  return (
    <>
      {warnings.map((w, i) => {
        // Cautions (warning/danger) render amber with a ⚠ triangle; neutral FYIs (info) stay
        // purple with an ⓘ circle. No message is red anymore.
        const isInfo = w.level === "info";
        const color = isInfo ? COLORS.primary : "#F59E0B";
        return (
          <View
            key={i}
            style={[styles.doseWarning, { backgroundColor: color + (isInfo ? "14" : "18"), borderColor: color }]}
          >
            <Feather name={isInfo ? "info" : "alert-triangle"} size={13} color={color} />
            <Text style={[styles.doseWarningText, { color }]}>{w.message}</Text>
          </View>
        );
      })}
    </>
  );
}

export function DoseRow({
  label, sub, value, unit, colors, signed = false, dimmed = false,
}: {
  label: string; sub: string; value: number; unit: string;
  colors: (typeof Colors)["light"]; signed?: boolean; dimmed?: boolean;
}) {
  const display = signed
    ? value > 0 ? `+${value}` : `${value}`
    : `${value}`;
  const color = dimmed
    ? colors.textMuted
    : value > 0 && signed ? COLORS.warning
    : value < 0 && signed ? COLORS.success
    : colors.text;
  return (
    <View style={styles.doseRowItem}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.doseRowLabel, { color: colors.text, opacity: dimmed ? 0.45 : 1 }]}>{label}</Text>
        <Text style={[styles.doseRowSub, { color: colors.textMuted }]}>{sub}</Text>
      </View>
      <Text style={[styles.doseRowValue, { color, opacity: dimmed ? 0.45 : 1 }]}>{display} {unit}</Text>
    </View>
  );
}

export function EditableDoseTotalBadge({
  effectiveDose,
  systemRecommendedDose,
  manualOverrideActive,
  editing,
  editText,
  inputRef,
  colors,
  onStartEdit,
  onChangeEditText,
  onCompleteEdit,
}: {
  effectiveDose: number;
  systemRecommendedDose: number;
  manualOverrideActive: boolean;
  editing: boolean;
  editText: string;
  inputRef: React.RefObject<TextInput | null>;
  colors: (typeof Colors)["light"];
  onStartEdit: () => void;
  onChangeEditText: (text: string) => void;
  onCompleteEdit: () => void;
}) {
  const showSuggestedDose =
    manualOverrideActive &&
    !editing &&
    !doseAmountsEqual(effectiveDose, systemRecommendedDose);

  return (
    <View style={styles.doseTotalBadgeWrap}>
      {manualOverrideActive && !editing ? (
        <Text style={styles.manualDoseTag}>Manual</Text>
      ) : null}
      <Pressable
        onPress={onStartEdit}
        disabled={editing}
        style={styles.doseTotalBadge}
        accessibilityRole="button"
        accessibilityLabel="Edit insulin dose amount"
      >
        {editing ? (
          <>
            <TextInput
              ref={inputRef}
              value={editText}
              onChangeText={onChangeEditText}
              onBlur={onCompleteEdit}
              onSubmitEditing={onCompleteEdit}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              style={styles.doseTotalInput}
              maxLength={8}
            />
            <Text style={styles.doseTotalUnit}>units</Text>
          </>
        ) : (
          <>
            <Text style={styles.doseTotalValue}>{formatDoseAmount(effectiveDose)}</Text>
            <Text style={styles.doseTotalUnit}>units</Text>
          </>
        )}
      </Pressable>
      {showSuggestedDose ? (
        <Text style={[styles.suggestedDoseLine, { color: colors.textMuted }]}>
          {formatSuggestedDoseLine(systemRecommendedDose)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  doseWarning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  doseWarningText: { flex: 1, fontSize: 12, fontWeight: "500", lineHeight: 17 },

  doseRowItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  doseRowLabel: { fontSize: 14, fontWeight: "600" },
  doseRowSub: { fontSize: 11, fontWeight: "400", marginTop: 1 },
  doseRowValue: { fontSize: 16, fontWeight: "700" },

  doseTotalBadgeWrap: { alignItems: "center", position: "relative" },
  manualDoseTag: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.65)",
    marginBottom: 4,
  },
  doseTotalBadge: { flexDirection: "row", alignItems: "baseline", gap: 4, backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 5, borderRadius: 14, minWidth: 88, justifyContent: "center" },
  doseTotalValue: { fontSize: 22, fontWeight: "700", color: "#fff" },
  doseTotalInput: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    minWidth: 52,
    textAlign: "center",
    padding: 0,
    margin: 0,
  },
  doseTotalUnit: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.8)" },
  suggestedDoseLine: { fontSize: 11, fontWeight: "400", marginTop: 4, textAlign: "center" },
});
