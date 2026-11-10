/**
 * Meal high heads-up in the calculator: when this meal kept the person high the last few times, even
 * after extra insulin (convex/mealHighLogic), say so and that it may need a higher dose up front.
 * It NEVER shows a number and never changes the dose. Hidden while below target, dropping, or with
 * insulin still working. "See what happened" opens the past times right here.
 *
 * `compact` is the one-line reminder on the food screen, pointing to the calculator.
 */
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useMealHigh } from "@/hooks/useMealHigh";
import { headsUpBody, headsUpTitle, patternFor, showHeadsUpNow, type MealEvent } from "../../../convex/mealHighLogic";

type Palette = (typeof Colors)["light"];

const day = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const units = (u: number) => `${Math.round(u * 100) / 100}u`;

function eventLine(e: MealEvent): string {
  const start = e.startBg != null ? `${e.startBg}, gave ${units(e.mealUnits)}` : `Gave ${units(e.mealUnits)}`;
  const peak = `${e.peak} at ${clock(e.peakAt)}`;
  const extra = e.extra.length ? `${units(e.extra.reduce((s, x) => s + x.units, 0))} more` : "no extra insulin";
  return `${start} → ${peak} → ${extra} → ${e.outcome === "stayedHigh" ? "still" : "then"} ${e.laterBg} at ${clock(e.laterAt)}`;
}

export default function MealHighNote({
  foodName,
  colors,
  bg,
  target,
  falling,
  activeUnits,
  compact,
  anchorRef,
}: {
  /** Help Mode spotlight anchor; attached only while the note is showing. */
  anchorRef?: (node: View | null) => void;
  foodName: string;
  colors: Palette;
  bg?: number | null;
  target?: number;
  falling?: boolean;
  activeUnits?: number;
  compact?: boolean;
}) {
  const auth = useAuth();
  const { data } = useMealHigh();
  const [open, setOpen] = useState(false);
  if (auth.doctorSession || !data?.enabled) return null;
  const pattern = patternFor(foodName, data.patterns);
  if (!pattern) return null;
  if (!compact && !showHeadsUpNow({ bg: bg ?? null, target: target ?? 0, falling: !!falling, activeUnits: activeUnits ?? 0 })) return null;
  const name = auth.profile?.accountRole === "parent" ? auth.profile?.childName?.trim() || null : null;
  const title = headsUpTitle(foodName, name);

  if (compact) {
    return (
      <View ref={anchorRef} style={[styles.compact, { backgroundColor: COLORS.warning + "14", borderColor: COLORS.warning + "66" }]}>
        <Feather name="trending-up" size={17} color={COLORS.warning} />
        <Text style={[styles.compactText, { color: colors.text }]}>
          {title.replace(", even with extra insulin", "")}. Check the heads-up in the calculator before dosing.
        </Text>
      </View>
    );
  }

  return (
    <View ref={anchorRef} style={[styles.card, { backgroundColor: COLORS.warning + "1F", borderColor: COLORS.warning + "73" }]}>
      <View style={styles.titleRow}>
        <Feather name="trending-up" size={19} color={COLORS.warning} style={{ marginTop: 1 }} />
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      </View>
      <Text style={[styles.body, { color: colors.text }]}>{headsUpBody(pattern, data.high, name)}</Text>
      {open && (
        <View style={{ gap: 8 }}>
          {pattern.events.map((e) => (
            <View key={e.at} style={[styles.event, { backgroundColor: colors.backgroundTertiary }]}>
              <View style={styles.eventHead}>
                <Text style={[styles.eventDay, { color: colors.text }]}>{day(e.at)}, {clock(e.at)}</Text>
                <Text style={[styles.eventMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                  {e.foodName} · {e.carbs}g
                </Text>
              </View>
              <Text style={[styles.eventLine, { color: colors.text }]}>{eventLine(e)}</Text>
              {e.outcome !== "stayedHigh" && <Text style={[styles.eventOk, { color: COLORS.success }]}>Came back down</Text>}
            </View>
          ))}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            A higher dose up front, or giving it earlier before eating, may help. Ask the doctor how much. They can see this in their portal.
          </Text>
        </View>
      )}
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} hitSlop={8}>
          <Text style={[styles.link, { color: COLORS.warning }]}>{open ? "Hide" : "See what happened"}</Text>
        </Pressable>
        <Text style={[styles.hint, { color: colors.textMuted }]}>The dose below doesn't change</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, gap: 8, marginTop: 10 },
  titleRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  title: { flex: 1, fontSize: 15, fontWeight: "800", lineHeight: 20 },
  body: { fontSize: 13.5, lineHeight: 19 },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 2 },
  link: { fontSize: 13.5, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 17 },
  event: { borderRadius: 12, padding: 10, gap: 4 },
  eventHead: { gap: 1 },
  eventDay: { fontSize: 13.5, fontWeight: "700" },
  eventMeta: { fontSize: 12, flexShrink: 1 },
  eventLine: { fontSize: 13, lineHeight: 19 },
  eventOk: { fontSize: 12, fontWeight: "700" },
  compact: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginTop: 10 },
  compactText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
});
