/**
 * Log pop-ups that open over the Glucose screen from the shortcuts, so closing one leaves you on the
 * Glucose screen (no trip to the Log page):
 * - Log Insulin → the Log Insulin pop-up
 * - Finger Stick → the Finger Stick pop-up
 * - Treated a Low → log what was given and start the recheck timer (TreatLowModal)
 * - Add Entry → a small menu (Insulin Log, Food Log, Finger Stick, Treated a Low), then that pop-up
 *
 * They're the same pop-ups as on the Log page (caregiver confirmation and the stacking check
 * included), logging to today.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import LogFingerStickModal from "@/components/LogFingerStickModal";
import LogFoodModal from "@/components/LogFoodModal";
import LogInsulinModal from "@/components/LogInsulinModal";
import TreatLowModal from "@/components/TreatLowModal";
import { CardShade } from "@/components/Shade";
import { DOSE_INSULIN_TYPE_STORAGE_KEY } from "@/constants/storage-keys";
import { defaultInsulinChipLabel, findInsulinByChipLabel, type InsulinOption } from "@/constants/insulin";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { startOfLocalDay } from "@/utils/localDayBoundaries";

export type QuickLogKind = "menu" | "insulin" | "stick" | "low";
type Sheet = QuickLogKind | "food" | null;

/** iOS can't present a pop-up while another is still sliding away. */
const SWAP_DELAY_MS = Platform.OS === "ios" ? 380 : 0;

export default function QuickLogSheets({ request }: { request: { kind: QuickLogKind; nonce: number } | null }) {
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { profile } = useAuth();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [day, setDay] = useState(() => startOfLocalDay(new Date()));
  const [calcLabel, setCalcLabel] = useState<string | null>(null);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (swapTimer.current) clearTimeout(swapTimer.current);
  }, []);

  // Each tap opens a fresh pop-up for today.
  useEffect(() => {
    if (!request) return;
    setDay(startOfLocalDay(new Date()));
    setSheet(request.kind);
    // The insulin picked on the calculator is the default, as on the Log page.
    if (request.kind !== "stick") {
      AsyncStorage.getItem(DOSE_INSULIN_TYPE_STORAGE_KEY)
        .then((v) => setCalcLabel(v))
        .catch(() => {});
    }
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const insulinOptions = useMemo<InsulinOption[]>(
    () => (profile?.insulinTypes ?? []).map(findInsulinByChipLabel).filter((o): o is InsulinOption => o != null),
    [profile?.insulinTypes],
  );
  const configured = profile?.insulinTypes ?? [];
  const defaultLabel = calcLabel && configured.includes(calcLabel) ? calcLabel : defaultInsulinChipLabel(configured);

  const close = () => setSheet(null);
  const pick = (next: Exclude<Sheet, null | "menu">) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSheet(null);
    if (swapTimer.current) clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => setSheet(next), SWAP_DELAY_MS);
  };
  const logged = () => {
    setSheet(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <>
      <DashboardSectionModal visible={sheet === "menu"} onClose={close} accessibilityLabel="Add entry">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <Text style={[styles.title, { color: colors.text }]}>Add Entry</Text>
          <View style={[styles.list, { borderColor: colors.border }]}>
            <MenuRow icon="needle" color={COLORS.primary} label="Insulin Log" onPress={() => pick("insulin")} colors={colors} />
            <MenuRow icon="silverware-fork-knife" color={COLORS.accent} label="Food Log" onPress={() => pick("food")} colors={colors} />
            <MenuRow icon="water-plus-outline" color={COLORS.primary} label="Finger Stick" onPress={() => pick("stick")} colors={colors} />
            <MenuRow icon="timer-outline" color={COLORS.danger} label="Treated a Low" onPress={() => pick("low")} colors={colors} last />
          </View>
        </View>
      </DashboardSectionModal>

      <LogInsulinModal
        visible={sheet === "insulin"}
        onClose={close}
        day={day}
        insulinOptions={insulinOptions}
        selectedInsulinLabel={defaultLabel}
        colors={colors}
        onLogged={close}
      />
      <TreatLowModal visible={sheet === "low"} onClose={close} colors={colors} />
      <LogFoodModal visible={sheet === "food"} onClose={close} selectedDay={day} colors={colors} onLogged={logged} />
      {/* Stays open after logging to show how the meter compared with the CGM; Done closes it. */}
      <LogFingerStickModal visible={sheet === "stick"} onClose={close} selectedDay={day} colors={colors} />
    </>
  );
}

function MenuRow({
  icon,
  color,
  label,
  onPress,
  colors,
  last,
}: {
  icon: "needle" | "silverware-fork-knife" | "water-plus-outline" | "timer-outline";
  color: string;
  label: string;
  onPress: () => void;
  colors: (typeof Colors)["light"];
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={color} />
      <Text style={[styles.rowText, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: "700" },
  list: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, minHeight: 52 },
  rowText: { fontSize: 15, fontWeight: "600" },
});
