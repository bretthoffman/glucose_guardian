import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
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
import LogFoodModal from "@/components/LogFoodModal";
import { AccentShade, CardShade, ControlShade } from "@/components/Shade";
import CalendarPicker from "@/components/CalendarPicker";
import LogDetailModal, { type SelectedLog } from "@/components/LogDetailModal";
import { canEditExistingLogs } from "@/utils/logEditPermission";
import type { ChartEventMarker } from "@/utils/chartEventMarkers";
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
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import {
  doseAmountsEqual,
  filterDoseInputText,
  finalizeManualDoseInput,
  formatDoseAmount,
} from "@/utils/doseOverride";
import { filterFoodLogsForDay, filterInsulinLogsForDay } from "@/utils/logDayEntries";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";
import { startOfLocalDay } from "@/utils/localDayBoundaries";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";

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
  onLogAdded,
}: {
  colors: (typeof Colors)["light"];
  /** @deprecated Daily-only Log mode; prop retained for caregiver call sites. */
  restrictToDay?: boolean;
  /** The account's configured insulins — options for the Log Insulin popup. */
  insulinOptions?: InsulinOption[];
  /** Calculator's current insulin selection; used as the popup default. */
  selectedInsulinLabel?: string | null;
  /** Fired after any entry (dose or meal) is logged from here — drives the header "+1" fly-away. */
  onLogAdded?: () => void;
}) {
  const [dayOffset, setDayOffset] = useState(0);
  /** True while the chart's touch-hold reading cursor is engaged — freezes page scroll. */
  const [chartCursorActive, setChartCursorActive] = useState(false);

  const { targetGlucose, cgmSyncSuccessTick } = useGlucose();
  const { foodLog, insulinLog, logInsulinDose, alertPrefs, account, caregiverSession, caregiverCloudCode, accessCodeRole, accessCodePermissions, profile } = useAuth();

  // Edit/delete rights — see utils/logEditPermission for the rule and why the "Add logs" grant is
  // the gate for both caregiver identities. Guardians, co-guardians and child codes always may.
  const canEditLogs = canEditExistingLogs({
    isCaregiverAccount: profile?.accountRole === "caregiver",
    caregiverSession,
    accessCodeRole,
    canAddLogs: !!accessCodePermissions?.log,
  });
  const confirmLog = useCareLogConfirm();
  const myUserId = account?.convexUserId ?? null;
  // An access-code session is accountless, so the CODE is this device's only identity for attribution.
  const myCode = caregiverCloudCode ?? null;

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

  // ── Log Food popup — same green-until-sync rules ──
  const [foodModalVisible, setFoodModalVisible] = useState(false);
  const [foodLoggedAtTick, setFoodLoggedAtTick] = useState<number | null>(null);
  const foodBtnGreen = foodLoggedAtTick !== null && foodLoggedAtTick === cgmSyncSuccessTick;

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
    // Caregiver sessions confirm before writing into the patient's profile; everyone else commits now.
    confirmLog(() => {
      logInsulinDose({
        timestamp: combineDayAndTime(selectedDay, parsedLogTime.hours, parsedLogTime.minutes).toISOString(),
        units: parsedLogUnits,
        type: "manual",
        ...(logPendingLabel ? { insulinType: logPendingLabel } : {}),
      });
      setLogModalVisible(false);
      setLogLoggedAtTick(cgmSyncSuccessTick);
      onLogAdded?.();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartCursorActive}
        {...NO_AUTO_CONTENT_INSETS}
      >
        <DayView
          day={selectedDay}
          dayOffset={dayOffset}
          onPrev={() => setDayOffset((p) => p + 1)}
          onNext={() => setDayOffset((p) => Math.max(0, p - 1))}
          onPickDate={(d) => {
            // Whole local days between today and the picked day; never into the future.
            const picked = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            setDayOffset(Math.max(0, Math.round((today.getTime() - picked.getTime()) / 86_400_000)));
          }}
          colors={colors}
          targetGlucose={targetGlucose}
          alertPrefs={alertPrefs}
          foodLog={foodLog}
          insulinLog={insulinLog}
          myUserId={myUserId}
          myCode={myCode}
          canEditLogs={canEditLogs}
          onCursorActiveChange={setChartCursorActive}
          onAddInsulin={openLogModal}
          onAddFood={() => {
            setFoodModalVisible(true);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          addJustLogged={logBtnGreen || foodBtnGreen}
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
              {canLog && <AccentShade radius={10} />}
              <Feather name="check" size={14} color={canLog ? "#fff" : colors.textMuted} />
              <Text style={[styles.logSubmitBtnText, { color: canLog ? "#fff" : colors.textMuted }]}>Log</Text>
            </Pressable>
          </View>
        </View>
      </DashboardSectionModal>

      {/* ── Log Food popup — text-only meal lookup logging to the viewed day ── */}
      <LogFoodModal
        visible={foodModalVisible}
        onClose={() => setFoodModalVisible(false)}
        selectedDay={selectedDay}
        colors={colors}
        onLogged={() => {
          setFoodModalVisible(false);
          setFoodLoggedAtTick(cgmSyncSuccessTick);
          onLogAdded?.();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
      />
    </View>
  );
}

function DayView({
  day,
  dayOffset,
  onPrev,
  onNext,
  onPickDate,
  colors,
  targetGlucose,
  alertPrefs,
  foodLog,
  insulinLog,
  myUserId,
  myCode,
  canEditLogs,
  onCursorActiveChange,
  onAddInsulin,
  onAddFood,
  addJustLogged,
}: {
  day: Date;
  dayOffset: number;
  onPrev: () => void;
  onNext: () => void;
  /** A date chosen on the calendar — the page switches to it at once. */
  onPickDate: (day: Date) => void;
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
  myUserId: string | null;
  myCode: string | null;
  /** False for caregiver viewers — hides the detail popup's Edit/Delete controls. */
  canEditLogs: boolean;
  onCursorActiveChange?: (active: boolean) => void;
  /** Open the Log Insulin / Log Food popups (each logs to the day being viewed). */
  onAddInsulin: () => void;
  onAddFood: () => void;
  /** True right after an entry was added, until the next successful CGM sync — the button reads "Added". */
  addJustLogged: boolean;
}) {
  const isToday = dayOffset === 0;
  const label = isToday ? "Today" : dayOffset === 1 ? "Yesterday" : fmtDateFull(day);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<SelectedLog | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

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

  /**
   * Food and insulin merged into ONE list, NEWEST FIRST — the most recent log is what someone opens
   * this page to see, so scrolling to the bottom of a busy day to find it was backwards. Deliberately
   * a separate ordering rather than flipping the day filters: their chronological contract also feeds
   * `dayMarkers` below, and a "logs for this day" helper returning reverse-chronological would be a
   * surprising thing for the next caller to inherit.
   */
  const dayEvents = useMemo<DayEvent[]>(
    () =>
      [
        ...dayFood.map((f) => ({ kind: "food" as const, ts: new Date(f.timestamp).getTime(), data: f })),
        ...dayInsulin.map((i) => ({ kind: "insulin" as const, ts: new Date(i.timestamp).getTime(), data: i })),
      ].sort((a, b) => b.ts - a.ts),
    [dayFood, dayInsulin],
  );

  /** This day's logs as baseline markers for the graph — insulin first (it wins the on-line spot).
   *  Each marker carries its log's id so tapping the icon opens the same detail popup as the row. */
  const dayMarkers = useMemo<ChartEventMarker[]>(
    () => [
      ...dayInsulin.map((i) => ({ timestamp: i.timestamp, kind: "insulin" as const, id: i.id })),
      ...dayFood.map((f) => ({ timestamp: f.timestamp, kind: "food" as const, id: f.id })),
    ],
    [dayInsulin, dayFood],
  );

  const openMarkerLog = (marker: { kind: "insulin" | "food"; id?: string }) => {
    if (!marker.id) return;
    if (marker.kind === "insulin") {
      const hit = dayInsulin.find((i) => i.id === marker.id);
      if (hit) setSelectedLog({ kind: "insulin", data: hit });
    } else {
      const hit = dayFood.find((f) => f.id === marker.id);
      if (hit) setSelectedLog({ kind: "food", data: hit });
    }
  };

  return (
    <View style={{ gap: 16 }}>
      {addMenuOpen && (
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
          onPress={() => setAddMenuOpen(false)}
          accessibilityLabel="Close the add menu"
        />
      )}
      {/* Calendar shortcut — its own row above the day arrows, centered over the day label.
          Control-styled (not purple): it is a way to move, not a primary action. */}
      <View style={styles.calendarRow}>
        <Pressable
          style={({ pressed }) => [
            styles.calendarBtn,
            { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setCalendarOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Pick a date"
          hitSlop={6}
        >
          <ControlShade radius={10} />
          <Feather name="calendar" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
      <CalendarPicker
        visible={calendarOpen}
        selected={day}
        onSelect={(d) => {
          setCalendarOpen(false);
          onPickDate(d);
        }}
        onClose={() => setCalendarOpen(false)}
        colors={colors}
      />
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
            eventMarkers={dayMarkers}
            onEventMarkerPress={openMarkerLog}
            enablePinchZoom
            // The page scroll pads 16; the digits end 8 from the PAGE edge and the plot takes the rest.
            hostPaddingRight={16}
          />
        )}
      </View>

      {/* ── Event Log: the day's food AND insulin entries as one newest-first list (see dayEvents).
          The header carries the "Add Entry" control that replaced the two buttons that used to sit at
          the top of the page; it drops a small two-item menu below itself. ── */}
      {/* The date IS the section's title ("Today, Sep 15, 2026") — sized as a heading, not a banner —
          sitting on one line with the Add Entry button. No "Event Log" wordmark above it. */}
      <View style={styles.eventHeader}>
        <Text style={[styles.eventDate, { color: colors.textSecondary }]} numberOfLines={1}>
          {fmtEventDate(day, dayOffset)}
        </Text>
        <View style={styles.addWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add an entry"
            accessibilityState={{ expanded: addMenuOpen }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setAddMenuOpen((o) => !o);
            }}
            style={({ pressed }) => [
              styles.addBtn,
              addJustLogged
                ? { backgroundColor: COLORS.success + "26", borderColor: COLORS.success }
                : { backgroundColor: COLORS.primary + "26", borderColor: COLORS.primary },
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name={addJustLogged ? "check" : "plus"} size={15} color={colors.text} />
            <Text style={[styles.addBtnText, { color: colors.text }]}>{addJustLogged ? "Added" : "Add Entry"}</Text>
          </Pressable>
          {addMenuOpen && (
            <View style={[styles.addMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <CardShade radius={12} />
              <Pressable
                accessibilityRole="menuitem"
                style={({ pressed }) => [styles.addMenuItem, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  setAddMenuOpen(false);
                  onAddInsulin();
                }}
              >
                <MaterialCommunityIcons name="needle" size={18} color={COLORS.primary} />
                <Text style={[styles.addMenuText, { color: colors.text }]}>Insulin Log</Text>
              </Pressable>
              <Pressable
                accessibilityRole="menuitem"
                style={({ pressed }) => [styles.addMenuItem, { borderBottomWidth: 0, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  setAddMenuOpen(false);
                  onAddFood();
                }}
              >
                <MaterialCommunityIcons name="silverware-fork-knife" size={18} color={COLORS.accent} />
                <Text style={[styles.addMenuText, { color: colors.text }]}>Food Log</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {dayEvents.length === 0 ? (
        <Text style={[styles.logEmptyText, { color: colors.textMuted }]}>No entries logged for this day.</Text>
      ) : (
        <View style={[styles.eventList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          {dayEvents.map((ev, i) => (
            <EventRow
              key={ev.data.id}
              event={ev}
              last={i === dayEvents.length - 1}
              colors={colors}
              myUserId={myUserId}
              myCode={myCode}
              onPress={() =>
                setSelectedLog(ev.kind === "food" ? { kind: "food", data: ev.data } : { kind: "insulin", data: ev.data })
              }
            />
          ))}
        </View>
      )}

      {selectedLog && (
        <LogDetailModal
          key={selectedLog.data.id}
          entry={selectedLog}
          colors={colors}
          canEdit={canEditLogs}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </View>
  );
}

/**
 * "· by Mom" / "· by you" — omitted for legacy device-local entries with no author.
 *
 * Two ways to be the author, because there are two kinds of identity:
 *  - an ACCOUNT matches on `authorUserId`;
 *  - an ACCESS-CODE session has no account at all, so it matches on the code that wrote the entry.
 * Without the second check a caregiver/kid device could never recognise its own entries: every screen
 * fell back to the code's LABEL, so a code labelled "me" made the caregiver's log and the guardian's
 * log read identically ("· by me") and looked like attribution was broken. The guardian still sees the
 * label — which is the point — while the writing device now sees "by you".
 */
function authorByline(
  entry: { authorUserId?: string; authorCode?: string; authorName?: string },
  myUserId: string | null,
  myCode: string | null,
): string {
  if (!entry.authorName) return "";
  if (entry.authorUserId && myUserId && entry.authorUserId === myUserId) return " · by you";
  if (entry.authorCode && myCode && entry.authorCode.toUpperCase() === myCode.toUpperCase()) {
    return " · by you";
  }
  return ` · by ${entry.authorName}`;
}

type DayEvent =
  | { kind: "food"; ts: number; data: FoodLogEntry }
  | { kind: "insulin"; ts: number; data: InsulinLogEntry };

/** "Today, Sep 14, 2026" / "Yesterday, Sep 13, 2026" / "Sat, Sep 12, 2026" — under the Event Log title. */
function fmtEventDate(d: Date, dayOffset: number): string {
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const lead = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Yesterday" : d.toLocaleDateString([], { weekday: "short" });
  return `${lead}, ${date}`;
}

/**
 * One Event Log row: time · icon · title/subtitle · chevron. The time left the title line for its own
 * column; everything else about the entry reads on the sub line, so the description ("… · by X") is
 * never squeezed by a right-hand value. `right` is kept for a kind that wants one; neither does today.
 */
function EventRow({
  event,
  last,
  colors,
  myUserId,
  myCode,
  onPress,
}: {
  event: DayEvent;
  last: boolean;
  colors: (typeof Colors)["light"];
  myUserId: string | null;
  myCode: string | null;
  onPress: () => void;
}) {
  const isFood = event.kind === "food";
  let title: string;
  let sub: string;
  let right: string | null = null;
  let adjusted = false;
  let edited = false;
  if (event.kind === "food") {
    const f = event.data;
    title = f.foodName;
    // A food entry is about the food: its carbs, and who logged it. The dose the calculator paired
    // with it is an insulin fact, not a food fact — it lives in the detail popup, not on this line.
    sub = `${f.estimatedCarbs} g carbs${authorByline(f, myUserId, myCode)}`;
    edited = !!f.edited;
  } else {
    const ins = event.data;
    const opt = ins.insulinType ? findInsulinByChipLabel(ins.insulinType) : undefined;
    const insulinName = opt?.name ?? ins.insulinType?.split(" · ")[0];
    adjusted = ins.recommendedUnits != null && !doseAmountsEqual(ins.units, ins.recommendedUnits);
    const parts: string[] = [`${formatDoseAmount(ins.units)}u · ${insulinName ?? ins.type}`];
    if (opt) parts.push(INSULIN_TYPE_LABEL[opt.type]);
    if (ins.recommendedUnits != null) parts.push(`Rec ${formatDoseAmount(ins.recommendedUnits)}u`);
    if (ins.note) parts.push(ins.note);
    const byline = authorByline(ins, myUserId, myCode).replace(/^ · /, "");
    if (byline) parts.push(byline);
    title = "Insulin";
    sub = parts.join(" · ");
    edited = !!ins.edited;
  }
  const accent = isFood ? COLORS.accent : COLORS.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.eventRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.eventTime, { color: colors.textSecondary }]}>{fmtTime(event.data.timestamp)}</Text>
      <View style={[styles.eventIcon, { backgroundColor: accent + "22" }]}>
        <MaterialCommunityIcons name={isFood ? "silverware-fork-knife" : "needle"} size={17} color={accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.eventTitleRow}>
          <Text style={[styles.eventRowTitle, { color: colors.text }]} numberOfLines={1}>{title}</Text>
          {adjusted && (
            <View style={[styles.adjustedTag, { backgroundColor: COLORS.warning + "20" }]}>
              <Text style={[styles.adjustedTagText, { color: COLORS.warning }]}>ADJUSTED</Text>
            </View>
          )}
          {edited && <Text style={[styles.entryEdited, { color: colors.textMuted }]}>Edited</Text>}
        </View>
        <Text style={[styles.eventSub, { color: colors.textSecondary }]} numberOfLines={1}>{sub}</Text>
      </View>
      {right ? <Text style={[styles.eventRight, { color: colors.textSecondary }]}>{right}</Text> : null}
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /** Bottom padding clears the floating tab bar so a full day of logs can scroll into view. */
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 140 },

  // Centered, directly above the day label between the arrows.
  calendarRow: { flexDirection: "row", justifyContent: "center", marginBottom: -6 },
  calendarBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
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
  logEmptyText: {
    fontSize: 14,
    fontWeight: "400",
    marginBottom: T.space.sm,
  },

  // Time on the top row — same smaller/faded look it used to have on the bottom sub-line.
  entryEdited: { fontSize: 11, fontWeight: "400", fontStyle: "italic", flexShrink: 0 },
  emptySub: { fontSize: 14, fontWeight: "400", textAlign: "center", lineHeight: 20 },
  adjustedTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  adjustedTagText: { fontSize: 8.5, fontWeight: "700", letterSpacing: 0.6 },


  /** Event Log header + the Add Entry dropdown. zIndex keeps the open menu above the rows AND the
      tap-to-close layer underneath it. */
  eventHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: T.space.md, zIndex: 10 },
  /** Stand-in section title: a heading weight at a size between the row text and a page title. */
  eventDate: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: "600" },
  addWrap: { position: "relative", zIndex: 10 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5 },
  addBtnText: { fontSize: 14, fontWeight: "700" },
  addMenu: {
    position: "absolute", top: 46, right: 0, minWidth: 176,
    borderRadius: 12, borderWidth: 1, overflow: "hidden", zIndex: 20, elevation: 12,
  },
  addMenuItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  addMenuText: { fontSize: 14, fontWeight: "600" },
  /** The merged list: one bordered window, rows divided by hairlines (see EventRow). */
  eventList: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  // Tight rows: 8pt above and below, so a row is barely taller than its 36pt icon disc. With the
  // smaller text the old 13pt was reading as a band of empty space at the top and bottom of each log.
  eventRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 12 },
  // Row text is one step smaller across the board (time/title/sub/right/tags) — the rows read as a
  // list, not as a stack of headlines. The time column narrows with its font so nothing else moves.
  eventTime: { width: 58, fontSize: 11.5, fontWeight: "500" },
  eventIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  eventTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eventRowTitle: { fontSize: 13.5, fontWeight: "600", flexShrink: 1 },
  eventSub: { fontSize: 11.5, fontWeight: "400", marginTop: 2 },
  eventRight: { fontSize: 11.5, fontWeight: "500", flexShrink: 0 },

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
