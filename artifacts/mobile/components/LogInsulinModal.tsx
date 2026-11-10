/**
 * The Log Insulin pop-up: pick the insulin, the time and the units, then Log. Used on the Log page
 * (for the day being viewed) and over the Glucose screen from the Log Insulin / Add Entry shortcuts
 * (today). Caregiver sessions confirm before anything is written (useCareLogConfirm), and a fast-acting
 * dose within 2 hours of another gets the stacking check first (useStackingGuard).
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import InsulinTypePicker from "@/components/InsulinTypePicker";
import { AccentShade } from "@/components/Shade";
import { TimeButton, TimeWheel } from "@/components/TimeWheel";
import { useStackingGuard } from "@/components/StackingWarningModal";
import { insulinChipLabel, type InsulinOption } from "@/constants/insulin";
import { useAuth } from "@/context/AuthContext";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import { filterDoseInputText, finalizeManualDoseInput } from "@/utils/doseOverride";
import { findRecentFastActing, isFastActingEntry, STACKING_WINDOW_MS } from "@/utils/insulinStacking";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";

export default function LogInsulinModal({
  visible,
  onClose,
  day,
  insulinOptions,
  selectedInsulinLabel,
  colors,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  /** The day the dose is logged to (shown, locked). */
  day: Date;
  /** The account's configured insulins. */
  insulinOptions: InsulinOption[];
  /** The insulin picked on the calculator, used as the default when it's one of the options. */
  selectedInsulinLabel?: string | null;
  colors: (typeof Colors)["light"];
  /** After a dose is logged. The caller closes the pop-up. */
  onLogged: () => void;
}) {
  const { insulinLog, logInsulinDose } = useAuth();
  const confirmLog = useCareLogConfirm();
  const { askStacking, stackingModal } = useStackingGuard();
  const [logUnitsText, setLogUnitsText] = useState("");
  const [logTimeText, setLogTimeText] = useState("");
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const [logPendingLabel, setLogPendingLabel] = useState<string | null>(null);

  const parsedLogUnits = finalizeManualDoseInput(logUnitsText);
  const parsedLogTime = parseTimeInputText(logTimeText);
  const canLog =
    parsedLogUnits != null &&
    parsedLogUnits > 0 &&
    parsedLogTime != null &&
    (insulinOptions.length === 0 || logPendingLabel != null);

  /** The entry logs to `day`; the pop-up shows that date, locked. */
  const logDateLabel = day.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // Fresh form every time it opens: the usual insulin, no units, the time now.
  useEffect(() => {
    if (!visible) return;
    const optionLabels = insulinOptions.map(insulinChipLabel);
    const defaultLabel =
      selectedInsulinLabel && optionLabels.includes(selectedInsulinLabel)
        ? selectedInsulinLabel
        : optionLabels[0] ?? null;
    setLogPendingLabel(defaultLabel);
    setLogUnitsText("");
    setLogTimeText(formatTimeInputText(new Date()));
    setLogTimeOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleLogInsulin = () => {
    if (parsedLogUnits == null || parsedLogUnits <= 0 || parsedLogTime == null) return;
    const entryTimestamp = combineDayAndTime(day, parsedLogTime.hours, parsedLogTime.minutes).toISOString();
    // Caregiver sessions confirm before writing into the patient's profile; everyone else commits now.
    const proceed = () => confirmLog(() => {
      logInsulinDose({
        timestamp: entryTimestamp,
        units: parsedLogUnits,
        type: "manual",
        ...(logPendingLabel ? { insulinType: logPendingLabel } : {}),
      });
      onLogged();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
    // ── Insulin-stacking guard. Only for a dose being recorded as happening NOW-ish — a backdated
    // entry (yesterday's missed log) can't stack with anything current. Entries whose selected
    // insulin is fast-acting (or unlabeled — warn-side) check for another fast-acting dose from
    // anyone in the circle in the last 2 hours; see utils/insulinStacking. ──
    const entryIsNowish = Math.abs(Date.now() - new Date(entryTimestamp).getTime()) <= STACKING_WINDOW_MS;
    const entryIsFast = isFastActingEntry({ type: "manual", ...(logPendingLabel ? { insulinType: logPendingLabel } : {}) });
    const recent = entryIsNowish && entryIsFast ? findRecentFastActing(insulinLog ?? []) : null;
    askStacking(recent, insulinLog ?? [], proceed);
  };

  return (
    <DashboardSectionModal
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Log insulin"
    >
      <View style={[styles.logModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.logModalTitle, { color: colors.text }]}>Log Insulin</Text>
        <Text style={[styles.logModalSub, { color: colors.textSecondary }]}>
          Record a dose for the day shown below. It appears in the log immediately.
        </Text>
        <InsulinTypePicker
          options={insulinOptions}
          selectedLabel={logPendingLabel}
          onSelect={setLogPendingLabel}
          colors={colors}
        />
        <View style={[styles.logWhenSection, { borderTopColor: colors.border }]}>
          <View style={styles.logWhenRow}>
            <Text style={[styles.logUnitsLabel, { color: colors.textSecondary }]}>Date</Text>
            <View style={styles.logDateValueWrap}>
              <Feather name="calendar" size={13} color={colors.textMuted} />
              <Text style={[styles.logDateValue, { color: colors.text }]}>{logDateLabel}</Text>
            </View>
          </View>
          <View style={styles.logWhenRow}>
            <Text style={[styles.logUnitsLabel, { color: colors.textSecondary }]}>Time</Text>
            <TimeButton
              value={logTimeText}
              open={logTimeOpen}
              onPress={() => setLogTimeOpen((o) => !o)}
              accessibilityLabel="Time the dose was taken"
              colors={colors}
            />
          </View>
          {logTimeOpen && (
            <TimeWheel value={logTimeText} onChange={setLogTimeText} onDone={() => setLogTimeOpen(false)} colors={colors} />
          )}
          {!parsedLogTime && (
            <Text style={[styles.logTimeError, { color: COLORS.danger }]}>
              Enter a time like 5:38 PM or 17:38
            </Text>
          )}
        </View>
        <View style={[styles.logUnitsRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.logUnitsLabel, { color: colors.textSecondary }]}>Insulin taken</Text>
          {/* Same look as the Suggested Dose badge on the Insulin page: purple outline, soft purple fill,
              dark number, muted "units". */}
          <View style={styles.logUnitsBadge}>
            <TextInput
              value={logUnitsText}
              onChangeText={(t) => setLogUnitsText(filterDoseInputText(t))}
              keyboardType="decimal-pad"
              returnKeyType="done"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={[styles.logUnitsInput, { color: colors.text }]}
              maxLength={8}
              accessibilityLabel="Insulin units taken"
            />
            <Text style={[styles.logUnitsUnit, { color: colors.textMuted }]}>units</Text>
          </View>
        </View>
        <View style={styles.logModalFooter}>
          <Pressable
            accessibilityRole="button"
            disabled={!canLog}
            style={({ pressed }) => [
              styles.logSubmitBtn,
              {
                backgroundColor: canLog ? COLORS.primary : colors.backgroundTertiary,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={handleLogInsulin}
          >
            {canLog && <AccentShade radius={10} />}
            <Feather name="check" size={14} color={canLog ? "#fff" : colors.textMuted} />
            <Text style={[styles.logSubmitBtnText, { color: canLog ? "#fff" : colors.textMuted }]}>Log</Text>
          </Pressable>
        </View>
      </View>
      {/* Above this popup, so it shows on top of it. */}
      {stackingModal}
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  logModalCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  logModalTitle: { fontSize: 18, fontWeight: "700" },
  logModalSub: { fontSize: 12, fontWeight: "400", lineHeight: 17, marginTop: -6 },
  logWhenSection: { borderTopWidth: 1, paddingTop: 12, marginTop: 2, gap: 10 },
  logWhenRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  logDateValueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  logDateValue: { fontSize: 14, fontWeight: "600" },
  logTimeInput: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: "600",
    minWidth: 110,
    textAlign: "center",
  },
  logTimeError: { fontSize: 11, fontWeight: "500", textAlign: "right" },
  logUnitsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 2,
  },
  logUnitsLabel: { fontSize: 13, fontWeight: "600" },
  // Mirrors `doseTotalBadge` / `doseTotalInput` / `doseTotalUnit` in DoseCalculatorBits.
  logUnitsBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + "26",
    paddingHorizontal: 18,
    paddingVertical: 5,
    borderRadius: 14,
    minWidth: 88,
    justifyContent: "center",
  },
  logUnitsInput: {
    fontSize: 22,
    fontWeight: "700",
    minWidth: 52,
    textAlign: "center",
    padding: 0,
    margin: 0,
  },
  logUnitsUnit: { fontSize: 13, fontWeight: "600" },
  logModalFooter: { flexDirection: "row", justifyContent: "flex-end" },
  logSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 10,
  },
  logSubmitBtnText: { fontSize: 14, fontWeight: "700" },
});
