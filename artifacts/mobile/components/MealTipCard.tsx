/**
 * A gentle tip under a food result, from this person's own history: when the last few times they
 * had a meal like this ran high, suggest an easy protein to add (one tap puts it on the meal with
 * its carbs). At most one tip a day; who sees it follows the family's Meal tips setting.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { fetchGlucoseRange, type GlucoseIdentity } from "@/utils/glucoseRangeFetch";
import { TIP_WINDOW_MIN, canSeeMealTips, mealTip, similarPastMeals, tipAllowedToday, type MealTip, type ProteinIdea } from "@/utils/mealTips";
import { toLocalIsoDate } from "@/utils/labs";

type Palette = (typeof Colors)["light"];
const LAST_TIP_KEY = "@glucose_guardian_meal_tip_day";

export default function MealTipCard({
  foodName,
  proteinGrams,
  colors,
  onAdd,
}: {
  foodName: string;
  proteinGrams?: number;
  colors: Palette;
  /** Adds the idea to the meal (name + carbs). Omit once the meal is logged. */
  onAdd?: (idea: ProteinIdea) => void;
}) {
  const auth = useAuth();
  const [tip, setTip] = useState<MealTip | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const visible = canSeeMealTips({
    isChildMode: auth.isChildMode,
    isCaregiver: !!auth.caregiverSession || auth.isCaregiverAccount || !!auth.nurseViewCode,
    mealTipsCaregivers: auth.profile?.mealTipsCaregivers,
    mealTipsChildMode: auth.profile?.mealTipsChildMode,
  });
  const name = auth.profile?.accountRole === "parent" ? auth.profile?.childName?.trim() : undefined;

  useEffect(() => {
    setTip(null);
    setAdded([]);
    if (!visible || !foodName.trim() || auth.doctorSession) return;
    let cancelled = false;
    (async () => {
      const today = toLocalIsoDate(new Date());
      let last: string | null = null;
      try {
        last = await AsyncStorage.getItem(LAST_TIP_KEY);
      } catch {
        /* treat as not shown */
      }
      if (!tipAllowedToday(last, today)) return;
      const past = similarPastMeals(foodName, auth.foodLog ?? [], Date.now());
      if (past.length < 2) return;
      const identity: GlucoseIdentity = {
        isSignedIn: auth.isSignedIn,
        convexUserId: auth.account?.convexUserId,
        passwordHash: auth.account?.passwordHash,
        caregiverSession: !!auth.caregiverSession,
        caregiverCloudCode: auth.caregiverCloudCode,
        caregiverCodeKind: auth.caregiverCodeKind,
        nurseViewCode: auth.nurseViewCode,
        viewingPatientId: auth.viewingPatientId,
      };
      const readings = (
        await Promise.all(
          past.map((m) => {
            const t = Date.parse(m.timestamp);
            return fetchGlucoseRange(identity, t, t + TIP_WINDOW_MIN * 60_000).catch(() => []);
          }),
        )
      ).flat();
      if (cancelled) return;
      const found = mealTip({ foodName, proteinGrams, pastMeals: past, readings, name });
      if (!found) return;
      setTip(found);
      try {
        await AsyncStorage.setItem(LAST_TIP_KEY, today);
      } catch {
        /* the once-a-day limit is a convenience */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodName, visible]);

  if (!tip) return null;
  return (
    <View style={[styles.card, { borderColor: COLORS.success + "59", backgroundColor: COLORS.success + "14" }]}>
      <View style={styles.head}>
        <Feather name="sun" size={15} color={COLORS.success} />
        <Text style={[styles.label, { color: COLORS.success }]}>A TIP FROM {name ? `${name.toUpperCase()}'S` : "YOUR"} PATTERN</Text>
      </View>
      <Text style={[styles.text, { color: colors.text }]}>{tip.text}</Text>
      {onAdd && (
        <View style={styles.row}>
          {tip.ideas.map((idea) => {
            const done = added.includes(idea.name);
            return (
              <Pressable
                key={idea.name}
                accessibilityRole="button"
                accessibilityLabel={`Add ${idea.name}, ${idea.carbs} grams of carbs`}
                disabled={done}
                onPress={() => {
                  onAdd(idea);
                  setAdded((a) => [...a, idea.name]);
                }}
                style={[styles.chip, { borderColor: COLORS.success + "80", opacity: done ? 0.5 : 1 }]}
              >
                <Text style={[styles.chipText, { color: colors.text }]}>{done ? "Added " : "+ "}{idea.name}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={[styles.foot, { color: colors.textMuted }]}>Ideas, not rules. Up to one tip a day.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8, marginTop: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  text: { fontSize: 14.5, lineHeight: 21 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 99, borderWidth: 1, justifyContent: "center" },
  chipText: { fontSize: 14, fontWeight: "600" },
  foot: { fontSize: 12 },
});
