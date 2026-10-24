/**
 * Pick the insulins a family uses, and whether each is a pen or a vial (onboarding and Dashboard →
 * Insulin Settings). A Pen / Vial switch at the top; the list under it shows only the insulins sold
 * in that form. The same insulin can be on in both (a Humalog pen at school, a vial at home).
 *
 * Saves all three profile lists together (insulinTypes / insulinPens / insulinVials); the rules are
 * in utils/insulinForms.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import {
  INSULIN_OPTIONS,
  INSULIN_TYPE_LABEL,
  insulinChipLabel,
  insulinPack,
  type InsulinForm,
  type InsulinOption,
} from "@/constants/insulin";
import { ControlShade, TintShade } from "@/components/Shade";
import { isTaken, suppliesTaken, toggleInsulinForm, type InsulinChoice } from "@/utils/insulinForms";
import { insulinName } from "@/utils/pens";

type Palette = (typeof Colors)["light"];

const GROUPS: InsulinOption["type"][] = ["rapid", "long", "ultra-long", "regular", "intermediate", "premixed"];

export default function InsulinChooser({
  value,
  onChange,
  onTurnedOn,
  colors,
  readOnly = false,
  shaded = false,
  chipBackground,
}: {
  value: InsulinChoice;
  onChange: (next: { insulinTypes: string[]; insulinPens: string[]; insulinVials: string[] }) => void;
  /** Called after an insulin is switched ON in a form (e.g. to ask when it was opened). */
  onTurnedOn?: (label: string, form: InsulinForm) => void;
  colors: Palette;
  /** Members and nurses see the owner's list but can't change it. */
  readOnly?: boolean;
  /** Dashboard chips use the app's shading; onboarding uses flat chips. */
  shaded?: boolean;
  chipBackground?: string;
}) {
  const supplies = suppliesTaken(value);
  const [form, setForm] = useState<InsulinForm>(() =>
    supplies.length > 0 && supplies.every((s) => s.form === "vial") ? "vial" : "pen",
  );

  const pick = (f: InsulinForm) => {
    if (f === form) return;
    Haptics.selectionAsync();
    setForm(f);
  };

  return (
    <View style={{ gap: 12 }}>
      <View
        style={[styles.segment, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}
        accessibilityRole="tablist"
      >
        {(["pen", "vial"] as const).map((f) => {
          const on = form === f;
          return (
            <Pressable
              key={f}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => pick(f)}
              style={[styles.segBtn, on && { backgroundColor: COLORS.primary }]}
            >
              <Text style={[styles.segText, { color: on ? "#fff" : colors.textSecondary }]}>{f === "pen" ? "Pen" : "Vial"}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {form === "pen"
          ? "Prefilled pens you dial up and inject. Only insulins sold as a pen are listed."
          : "Bottles you draw up with a syringe. Only insulins sold as a vial are listed."}{" "}
        Pick every one your doctor prescribed. Use both? Pick it under Pen and Vial.
      </Text>

      {GROUPS.map((groupType) => {
        // Only insulins really sold in this form; a discontinued one shows only if it's already picked.
        const groupOptions = INSULIN_OPTIONS.filter(
          (o) => o.type === groupType && insulinPack(o, form) && (!o.discontinued || isTaken(value, insulinChipLabel(o), form)),
        );
        if (groupOptions.length === 0) return null;
        return (
          <View key={groupType} style={styles.group}>
            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>{INSULIN_TYPE_LABEL[groupType].toUpperCase()}</Text>
            <View style={styles.chipsRow}>
              {groupOptions.map((opt) => {
                const label = insulinChipLabel(opt);
                const selected = isTaken(value, label, form);
                const device = insulinPack(opt, form)?.device ?? "";
                return (
                  <Pressable
                    key={opt.name}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected, disabled: readOnly }}
                    accessibilityLabel={`${opt.name} ${form}`}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: selected ? COLORS.accent + "18" : chipBackground ?? colors.backgroundTertiary,
                        borderColor: selected ? COLORS.accent : colors.border,
                        opacity: pressed && !readOnly ? 0.7 : 1,
                      },
                    ]}
                    onPress={() => {
                      if (readOnly) return;
                      onChange(toggleInsulinForm(value, label, form));
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      if (!selected) onTurnedOn?.(label, form);
                    }}
                  >
                    {shaded && (selected ? <TintShade color={COLORS.accent} radius={12} /> : <ControlShade radius={12} />)}
                    {selected && <Feather name="check" size={12} color={COLORS.accent} />}
                    <View>
                      <Text style={[styles.chipName, { color: selected ? COLORS.accent : colors.text }]}>{opt.name}</Text>
                      <Text style={[styles.chipConc, { color: selected ? COLORS.accent + "99" : colors.textMuted }]}>
                        {device} · {opt.concentration}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      <View style={[styles.summary, { borderTopColor: colors.separator ?? colors.border }]}>
        <Text style={[styles.groupLabel, { color: colors.textMuted }]}>YOUR INSULIN</Text>
        {supplies.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textMuted }]}>Nothing picked yet</Text>
        ) : (
          <View style={styles.chipsRow}>
            {supplies.map((s) => (
              <View key={`${s.label}|${s.form}`} style={[styles.tag, { backgroundColor: COLORS.primary + "1F" }]}>
                <Text style={[styles.tagText, { color: colors.text }]}>
                  {insulinName(s.label)} <Text style={{ color: colors.textSecondary, fontWeight: "500" }}>{s.form}</Text>
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, gap: 3 },
  segBtn: { flex: 1, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14.5, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 17 },
  group: { gap: 6 },
  groupLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.8 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  chipName: { fontSize: 13, fontWeight: "600" },
  chipConc: { fontSize: 10, fontWeight: "400" },
  summary: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 6 },
  empty: { fontSize: 12, fontStyle: "italic" },
  tag: { borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { fontSize: 12.5, fontWeight: "700" },
});
