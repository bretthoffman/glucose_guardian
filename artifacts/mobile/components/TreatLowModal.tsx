/**
 * "Treated a Low": log what was given for a low (glucose tabs, juice, something else) and start the
 * recheck timer. It logs as a meal named "Low treated: ..." with its carbs (so carbs still working and
 * every log show it, with the usual byline), and no insulin. The recheck time and the reminder line come
 * from the family's Care Plan (15 minutes if they didn't set one). Caregivers confirm before it saves.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "convex/react";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { AccentShade } from "@/components/Shade";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import { useCarePlanArgs } from "@/hooks/useCareCode";
import { cancelScheduledNotification, scheduleRecheckReminder } from "@/services/notifications";
import { api } from "@/utils/convex-auth-client";
import { getRecheckTimer, setRecheckTimer } from "@/utils/recheckTimer";
import { LOW_TREATMENT_PREFIX } from "@/utils/lowTreatment";
import { DEFAULT_RECHECK_MINUTES, planSteps } from "../../../convex/carePlanLogic";

type Choice = "tabs" | "juice" | "other";
const PRESETS: Record<Exclude<Choice, "other">, { label: string; carbs: number }> = {
  tabs: { label: "4 glucose tabs", carbs: 16 },
  juice: { label: "Juice box (4 oz)", carbs: 15 },
};
/** A reading older than this isn't "right now". */
const FRESH_MS = 20 * 60_000;

export default function TreatLowModal({
  visible,
  onClose,
  colors,
}: {
  visible: boolean;
  onClose: () => void;
  colors: (typeof Colors)["light"];
}) {
  const { addFoodLogEntry, profile } = useAuth();
  const { latestReading } = useGlucose();
  const confirmLog = useCareLogConfirm();
  const planArgs = useCarePlanArgs();
  const plan = useQuery(api.carePlan.get, planArgs ?? "skip");
  const [choice, setChoice] = useState<Choice>("tabs");
  const [otherName, setOtherName] = useState("");
  const [otherCarbs, setOtherCarbs] = useState("");

  useEffect(() => {
    if (!visible) return;
    setChoice("tabs");
    setOtherName("");
    setOtherCarbs("");
  }, [visible]);

  const childName = plan?.childName && plan.childName !== "your child" ? plan.childName : profile?.childName?.trim() || "your child";
  const minutes = plan?.recheckMinutes ?? DEFAULT_RECHECK_MINUTES;
  const firstSteps = plan?.plan?.low ? planSteps(plan.plan.low).slice(0, 2).join(" ") : "";
  const readingMs = latestReading ? new Date(latestReading.timestamp).getTime() : NaN;
  const now = latestReading && Number.isFinite(readingMs) && Date.now() - readingMs <= FRESH_MS ? Math.round(latestReading.glucose) : null;

  const otherCarbsNum = Number(otherCarbs);
  const picked =
    choice === "other"
      ? otherName.trim() && Number.isFinite(otherCarbsNum) && otherCarbsNum > 0 && otherCarbsNum <= 100
        ? { label: otherName.trim(), carbs: Math.round(otherCarbsNum) }
        : null
      : PRESETS[choice];

  const submit = () => {
    if (!picked) return;
    confirmLog(() => {
      const startedAt = Date.now();
      addFoodLogEntry({
        timestamp: new Date(startedAt).toISOString(),
        // The prefix keeps it out of the dose calculator (utils/lowTreatment).
        foodName: `${LOW_TREATMENT_PREFIX}${picked.label}`,
        estimatedCarbs: picked.carbs,
        insulinUnits: 0,
        confidence: "high",
        fromPhoto: false,
      });
      void (async () => {
        await cancelScheduledNotification(getRecheckTimer()?.notificationId);
        const endsAt = startedAt + minutes * 60_000;
        const notificationId = await scheduleRecheckReminder({ at: endsAt, childName, minutes });
        await setRecheckTimer({ startedAt, endsAt, minutes, childName, treatment: picked.label, notificationId });
      })();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    });
  };

  const Option = ({ id, title, sub }: { id: Choice; title: string; sub: string }) => {
    const on = choice === id;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        onPress={() => {
          Haptics.selectionAsync();
          setChoice(id);
        }}
        style={[
          styles.option,
          { borderColor: on ? COLORS.primary : colors.border, backgroundColor: on ? COLORS.primary + "22" : colors.backgroundTertiary },
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.optionTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.optionSub, { color: colors.textSecondary }]}>{sub}</Text>
        </View>
        {on && <MaterialCommunityIcons name="check" size={20} color={COLORS.primary} />}
      </Pressable>
    );
  };

  return (
    <DashboardSectionModal visible={visible} onClose={onClose} accessibilityLabel="Treated a low">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ gap: 3 }}>
          <Text style={[styles.title, { color: colors.text }]}>Treated a Low</Text>
          {now != null && (
            <Text style={[styles.sub, { color: colors.textSecondary }]}>
              {childName} is {now} mg/dL right now
            </Text>
          )}
        </View>
        {!!firstSteps && (
          <View style={[styles.planBox, { borderColor: COLORS.danger + "66", backgroundColor: COLORS.danger + "18" }]}>
            <Text style={[styles.planText, { color: colors.text }]}>
              From {childName}'s plan: {firstSteps}
            </Text>
          </View>
        )}
        <Text style={[styles.label, { color: colors.textSecondary }]}>WHAT DID YOU GIVE?</Text>
        <View style={{ gap: 8 }}>
          <Option id="tabs" title={PRESETS.tabs.label} sub={`${PRESETS.tabs.carbs}g carbs`} />
          <Option id="juice" title={PRESETS.juice.label} sub={`${PRESETS.juice.carbs}g carbs`} />
          <Option id="other" title="Something else" sub="Type what and how many carbs" />
        </View>
        {choice === "other" && (
          <View style={styles.otherRow}>
            <TextInput
              value={otherName}
              onChangeText={setOtherName}
              placeholder="What (e.g. Skittles)"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { flex: 1, color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
              maxLength={40}
              accessibilityLabel="What was given"
            />
            <TextInput
              value={otherCarbs}
              onChangeText={(t) => setOtherCarbs(t.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="Carbs"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              style={[styles.input, { width: 88, color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
              accessibilityLabel="Grams of carbs"
            />
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!picked}
          onPress={submit}
          style={({ pressed }) => [styles.submit, { backgroundColor: picked ? COLORS.primary : colors.backgroundTertiary, opacity: pressed ? 0.85 : 1 }]}
        >
          {!!picked && <AccentShade radius={14} />}
          <MaterialCommunityIcons name="timer-outline" size={18} color={picked ? "#fff" : colors.textMuted} />
          <Text style={[styles.submitText, { color: picked ? "#fff" : colors.textMuted }]}>Log and start {minutes}-min timer</Text>
        </Pressable>
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 13 },
  planBox: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  planText: { fontSize: 13.5, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, minHeight: 52 },
  optionTitle: { fontSize: 15.5, fontWeight: "700" },
  optionSub: { fontSize: 13 },
  otherRow: { flexDirection: "row", gap: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  submit: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 14, overflow: "hidden" },
  submitText: { fontSize: 16, fontWeight: "700" },
});
