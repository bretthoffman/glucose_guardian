/**
 * Insulin Settings → Meal high heads-up: on/off and what counts as high (200, 250 or 300). Only the
 * family changes it; everyone else sees how it's set. It never changes the dose math.
 */
import { useMutation } from "convex/react";
import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useMealHigh } from "@/hooks/useMealHigh";
import { api } from "@/utils/convex-auth-client";
import { HIGH_CHOICES } from "../../../convex/mealHighLogic";

type Palette = (typeof Colors)["light"];

export default function MealHighSettings({ colors }: { colors: Palette }) {
  const auth = useAuth();
  const { args, data } = useMealHigh();
  const setPrefs = useMutation(api.mealHigh.setPrefs);
  if (!args || !data) return null;
  const name = auth.profile?.accountRole === "parent" ? auth.profile?.childName?.trim() : null;
  const can = data.canChange;
  const save = (p: { enabled?: boolean; high?: number }) => void setPrefs({ ...args, ...p }).catch(() => {});

  return (
    <View style={[styles.section, { borderTopColor: colors.separator }]}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.title, { color: colors.text }]}>Meal high heads-up</Text>
          <Text style={[styles.desc, { color: colors.textSecondary }]}>
            Warns in the calculator when a meal kept {name || "you"} high the last few times, even with extra insulin. It never changes the dose.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Meal high heads-up"
          value={data.enabled}
          disabled={!can}
          onValueChange={(on) => save({ enabled: on })}
          trackColor={{ true: COLORS.success, false: colors.backgroundTertiary }}
        />
      </View>
      {data.enabled && (
        <View style={{ gap: 8 }}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>COUNTS AS HIGH</Text>
          <View style={styles.chips}>
            {HIGH_CHOICES.map((h) => {
              const on = data.high === h;
              return (
                <Pressable
                  key={h}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: !can }}
                  disabled={!can}
                  onPress={() => save({ high: h })}
                  style={[
                    styles.chip,
                    { backgroundColor: on ? COLORS.primary + "2E" : colors.backgroundTertiary, borderColor: on ? COLORS.primaryLight : colors.border, opacity: !can && !on ? 0.5 : 1 },
                  ]}
                >
                  <Text style={[styles.chipText, { color: colors.text }]}>{h}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.desc, { color: colors.textMuted }]}>
            Still above this 3 to 4 hours after eating, after extra insulin{can ? "" : ". The family can change this."}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 14, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 15.5, fontWeight: "700" },
  desc: { fontSize: 12.5, lineHeight: 17 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 15, fontWeight: "700" },
});
