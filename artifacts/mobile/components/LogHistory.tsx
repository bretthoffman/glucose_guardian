import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { T } from "@/constants/theme";
import { CGMChart } from "@/components/CGMChart";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import InsulinTypePicker from "@/components/InsulinTypePicker";
import {
  INSULIN_TYPE_LABEL,
  findInsulinByChipLabel,
  insulinChipLabel,
  type InsulinOption,
} from "@/constants/insulin";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import type { FoodLogEntry, InsulinLogEntry } from "@/context/AuthContext";
import { useDayGlucoseReadings } from "@/hooks/useDayGlucoseReadings";
import {
  doseAmountsEqual,
  filterDoseInputText,
  finalizeManualDoseInput,
  formatDoseAmount,
} from "@/utils/doseOverride";
import { filterFoodLogsForDay, filterInsulinLogsForDay } from "@/utils/logDayEntries";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";
import { startOfLocalDay } from "@/utils/localDayBoundaries";

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDateFull(d: Date) {
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Dose Log — daily historical glucose graph and day-scoped food/insulin lists. */
export default function LogHistory({
  colors,
  restrictToDay: _restrictToDay = false,
  insulinOptions = [],
  selectedInsulinLabel = null,
  onInsulinLogged,
}: {
  colors: (typeof Colors)["light"];
  /** @deprecated Daily-only Log mode; prop retained for caregiver call sites. */
  restrictToDay?: boolean;
  /** The account's configured insulins — options for the Log Insulin popup. */
  insulinOptions?: InsulinOption[];
  /** Calculator's current insulin selection; used as the popup default. */
  selectedInsulinLabel?: string | null;
  /** Fired after a dose is logged from here — drives the header "+1" fly-away. */
  onInsulinLogged?: () => void;
}) {
  const [dayOffset, setDayOffset] = useState(0);
  /** True while the chart's touch-hold reading cursor is engaged — freezes page scroll. */
  const [chartCursorActive, setChartCursorActive] = useState(false);

  const { targetGlucose, cgmSyncSuccessTick } = useGlucose();
  const { foodLog, insulinLog, logInsulinDose, alertPrefs } = useAuth();

  const today = useMemo(() => startOfLocalDay(new Date()), []);

  const selectedDay = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - dayOffset);
    return d;
  }, [today, dayOffset]);

  // ── Log Insulin popup — button stays green until the next successful CGM sync ──
  const [logModalVisible, setLogModalVisible] = useState(false);
  const [logUnitsText, setLogUnitsText] = useState("");
  const [logTimeText, setLogTimeText] = useState("");
  const [logPendingLabel, setLogPendingLabel] = useState<string | null>(null);
  const [logLoggedAtTick, setLogLoggedAtTick] = useState<number | null>(null);
  const logBtnGreen = logLoggedAtTick !== null && logLoggedAtTick === cgmSyncSuccessTick;

  const parsedLogUnits = finalizeManualDoseInput(logUnitsText);
  const parsedLogTime = parseTimeInputText(logTimeText);
  const canLog =
    parsedLogUnits != null &&
    parsedLogUnits > 0 &&
    parsedLogTime != null &&
    (insulinOptions.length === 0 || logPendingLabel != null);

  /** The entry logs to the day being viewed — the popup shows that date, locked. */
  const logDateLabel = selectedDay.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const openLogModal = () => {
    const optionLabels = insulinOptions.map(insulinChipLabel);
    const defaultLabel =
      selectedInsulinLabel && optionLabels.includes(selectedInsulinLabel)
        ? selectedInsulinLabel
        : optionLabels[0] ?? null;
    setLogPendingLabel(defaultLabel);
    setLogUnitsText("");
    setLogTimeText(formatTimeInputText(new Date()));
    setLogModalVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleLogInsulin = () => {
    if (parsedLogUnits == null || parsedLogUnits <= 0 || parsedLogTime == null) return;
    logInsulinDose({
      timestamp: combineDayAndTime(selectedDay, parsedLogTime.hours, parsedLogTime.minutes).toISOString(),
      units: parsedLogUnits,
      type: "manual",
      ...(logPendingLabel ? { insulinType: logPendingLabel } : {}),
    });
    setLogModalVisible(false);
    setLogLoggedAtTick(cgmSyncSuccessTick);
    onInsulinLogged?.();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartCursorActive}
      >
        <View style={styles.logInsulinRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log insulin"
            style={({ pressed }) => [
              styles.logInsulinBtn,
              {
                backgroundColor: logBtnGreen ? COLORS.success : COLORS.primary,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={openLogModal}
          >
            <Feather name={logBtnGreen ? "check" : "plus"} size={12} color="#fff" />
            <Text style={styles.logInsulinBtnText}>Log Insulin</Text>
          </Pressable>
        </View>
        <DayView
          day={selectedDay}
          dayOffset={dayOffset}
          onPrev={() => setDayOffset((p) => p + 1)}
          onNext={() => setDayOffset((p) => Math.max(0, p - 1))}
          colors={colors}
          targetGlucose={targetGlucose}
          alertPrefs={alertPrefs}
          foodLog={foodLog}
          insulinLog={insulinLog}
          onCursorActiveChange={setChartCursorActive}
        />
      </ScrollView>

      {/* ── Combined insulin-type + units popup ── */}
      <DashboardSectionModal
        visible={logModalVisible}
        onClose={() => setLogModalVisible(false)}
        accessibilityLabel="Log insulin"
      >
        <View style={[styles.logModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.logModalTitle, { color: colors.text }]}>Log Insulin</Text>
          <Text style={[styles.logModalSub, { color: colors.textSecondary }]}>
            Record a dose for the day shown below — it appears in the log immediately.
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
              <TextInput
                value={logTimeText}
                onChangeText={setLogTimeText}
                style={[
                  styles.logTimeInput,
                  {
                    backgroundColor: colors.backgroundTertiary,
                    color: colors.text,
                    borderColor: parsedLogTime ? colors.border : COLORS.danger,
                  },
                ]}
                placeholder="5:38 PM"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="Time the dose was taken"
              />
            </View>
            {!parsedLogTime && (
              <Text style={[styles.logTimeError, { color: COLORS.danger }]}>
                Enter a time like 5:38 PM or 17:38
              </Text>
            )}
          </View>
          <View style={[styles.logUnitsRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.logUnitsLabel, { color: colors.textSecondary }]}>Insulin taken</Text>
            <View style={styles.logUnitsBadge}>
              <TextInput
                value={logUnitsText}
                onChangeText={(t) => setLogUnitsText(filterDoseInputText(t))}
                keyboardType="decimal-pad"
                returnKeyType="done"
                placeholder="0"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={styles.logUnitsInput}
                maxLength={8}
                accessibilityLabel="Insulin units taken"
              />
              <Text style={styles.logUnitsUnit}>units</Text>
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
              <Feather name="check" size={14} color={canLog ? "#fff" : colors.textMuted} />
              <Text style={[styles.logSubmitBtnText, { color: canLog ? "#fff" : colors.textMuted }]}>Log</Text>
            </Pressable>
          </View>
        </View>
      </DashboardSectionModal>
    </View>
  );
}

function DayView({
  day,
  dayOffset,
  onPrev,
  onNext,
  colors,
  targetGlucose,
  alertPrefs,
  foodLog,
  insulinLog,
  onCursorActiveChange,
}: {
  day: Date;
  dayOffset: number;
  onPrev: () => void;
  onNext: () => void;
  colors: (typeof Colors)["light"];
  targetGlucose: number;
  alertPrefs: {
    urgentLowThreshold: number;
    lowThreshold: number;
    highThreshold: number;
    urgentHighThreshold: number;
  };
  foodLog: FoodLogEntry[];
  insulinLog: InsulinLogEntry[];
  onCursorActiveChange?: (active: boolean) => void;
}) {
  const isToday = dayOffset === 0;
  const label = isToday ? "Today" : dayOffset === 1 ? "Yesterday" : fmtDateFull(day);

  const { readings, status, bounds, retry } = useDayGlucoseReadings({
    enabled: true,
    dayOffset,
    selectedDay: day,
  });

  const dayFood = useMemo(
    () => filterFoodLogsForDay(foodLog, bounds.startMs, bounds.endMs),
    [foodLog, bounds.startMs, bounds.endMs],
  );

  const dayInsulin = useMemo(
    () => filterInsulinLogsForDay(insulinLog, bounds.startMs, bounds.endMs),
    [insulinLog, bounds.startMs, bounds.endMs],
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.dayNav}>
        <Pressable style={styles.navBtn} onPress={onPrev}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={[styles.dayLabel, { color: colors.text }]}>{label}</Text>
        <Pressable style={[styles.navBtn, { opacity: isToday ? 0.3 : 1 }]} onPress={onNext} disabled={isToday}>
          <Feather name="chevron-right" size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.graphSection}>
        {status === "loading" ? (
          <View style={[styles.graphLoading, { borderColor: colors.border }]}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : status === "error" ? (
          <View style={[styles.graphLoading, { borderColor: colors.border }]}>
            <Text style={[styles.emptySub, { color: colors.textSecondary, marginBottom: 8 }]}>
              Could not load glucose for this day.
            </Text>
            <Pressable onPress={retry} style={[styles.retryBtn, { borderColor: COLORS.primary }]}>
              <Text style={{ color: COLORS.primary, fontWeight: "600" }}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <CGMChart
            readings={readings}
            targetGlucose={targetGlucose}
            chartHeight={240}
            paddingHorizontal={20}
            urgentLowThreshold={alertPrefs.urgentLowThreshold}
            lowThreshold={alertPrefs.lowThreshold}
            highThreshold={alertPrefs.highThreshold}
            urgentHighThreshold={alertPrefs.urgentHighThreshold}
            calendarDayWindow={{ startMs: bounds.startMs, endMs: bounds.endMs }}
            showRangeSelector={false}
            onCursorActiveChange={onCursorActiveChange}
          />
        )}
      </View>

      <Text style={[styles.logSectionTitle, { color: colors.text }]}>Food Log</Text>
      {dayFood.length === 0 ? (
        <Text style={[styles.logEmptyText, { color: colors.textMuted }]}>No food logged for this day.</Text>
      ) : (
        dayFood.map((food) => (
          <FoodLogRow key={food.id} food={food} colors={colors} />
        ))
      )}

      <Text style={[styles.logSectionTitle, { color: colors.text, marginTop: T.space.sm }]}>Insulin Log</Text>
      {dayInsulin.length === 0 ? (
        <Text style={[styles.logEmptyText, { color: colors.textMuted }]}>No insulin logged for this day.</Text>
      ) : (
        dayInsulin.map((insulin) => (
          <InsulinLogRow key={insulin.id} insulin={insulin} colors={colors} />
        ))
      )}
    </View>
  );
}

function FoodLogRow({ food, colors }: { food: FoodLogEntry; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: COLORS.accent + "40" }]}>
      <View style={[styles.entryIcon, { backgroundColor: COLORS.accent + "18" }]}>
        <Text style={{ fontSize: 16 }}>🍽️</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.entryTitle, { color: colors.text }]} numberOfLines={1}>
          {food.foodName}
        </Text>
        <Text style={[styles.entrySub, { color: colors.textSecondary }]}>
          {food.estimatedCarbs}g carbs · {food.insulinUnits}u · {fmtTime(food.timestamp)}
        </Text>
      </View>
    </View>
  );
}

function InsulinLogRow({ insulin, colors }: { insulin: InsulinLogEntry; colors: (typeof Colors)["light"] }) {
  const opt = insulin.insulinType ? findInsulinByChipLabel(insulin.insulinType) : undefined;
  const insulinName = opt?.name ?? insulin.insulinType?.split(" · ")[0];
  const doseAdjusted =
    insulin.recommendedUnits != null && !doseAmountsEqual(insulin.units, insulin.recommendedUnits);

  const subParts: string[] = [];
  if (opt) subParts.push(INSULIN_TYPE_LABEL[opt.type]);
  if (insulin.recommendedUnits != null) {
    subParts.push(`Recommended ${formatDoseAmount(insulin.recommendedUnits)}u`);
  }
  if (insulin.note) subParts.push(insulin.note);
  subParts.push(fmtTime(insulin.timestamp));

  return (
    <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: COLORS.primary + "40" }]}>
      <View style={[styles.entryIcon, { backgroundColor: COLORS.primary + "18" }]}>
        <Text style={{ fontSize: 16 }}>💉</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.entryTitleRow}>
          <Text style={[styles.entryTitle, { color: colors.text }]} numberOfLines={1}>
            {formatDoseAmount(insulin.units)}u · {insulinName ?? insulin.type}
          </Text>
          {doseAdjusted && (
            <View style={[styles.adjustedTag, { backgroundColor: COLORS.warning + "20" }]}>
              <Text style={[styles.adjustedTagText, { color: COLORS.warning }]}>ADJUSTED</Text>
            </View>
          )}
        </View>
        <Text style={[styles.entrySub, { color: colors.textSecondary }]} numberOfLines={1}>
          {subParts.join(" · ")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Bottom padding clears the floating tab bar so a full day of logs can scroll into view. */
  scroll: { padding: 16, paddingBottom: 140 },

  dayNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { padding: 8 },
  dayLabel: { fontSize: 18, fontWeight: "700" },

  graphSection: { marginTop: 4 },
  graphLoading: {
    height: 240,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  logSectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: T.space.md,
    marginBottom: T.space.sm,
  },
  logEmptyText: {
    fontSize: 14,
    fontWeight: "400",
    marginBottom: T.space.sm,
  },

  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  entryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  entryTitle: { fontSize: 14, fontWeight: "600" },
  entryTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  entrySub: { fontSize: 12, fontWeight: "400", marginTop: 1 },
  emptySub: { fontSize: 14, fontWeight: "400", textAlign: "center", lineHeight: 20 },
  adjustedTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  adjustedTagText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },

  logInsulinRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 },
  logInsulinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  logInsulinBtnText: { fontSize: 12, fontWeight: "700", color: "#fff" },

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
  logUnitsBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    minWidth: 88,
    justifyContent: "center",
  },
  logUnitsInput: {
    fontSize: 26,
    fontWeight: "700",
    color: "#fff",
    minWidth: 44,
    textAlign: "center",
    padding: 0,
    margin: 0,
  },
  logUnitsUnit: { fontSize: 13, fontWeight: "600", color: "rgba(255,255,255,0.8)" },
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
