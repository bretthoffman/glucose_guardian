/**
 * Log Finger Stick — record a blood-glucose meter reading for the day being viewed, then show how it
 * compares with the CGM reading from the same moment. Opened from the Log page's Add Entry menu and
 * from the dose calculator's "Verify with a finger stick" warning.
 *
 * Informational only: a finger stick never changes dose math or the CGM. Writes go through
 * AuthContext.logFingerStick (→ the shared Care Circle bucket), and caregiver sessions confirm first,
 * like every other log-creating path.
 */
import React, { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { AccentShade } from "@/components/Shade";
import { TimeButton, TimeWheel } from "@/components/TimeWheel";
import { useAuth, type FingerStickEntry, type FingerStickReason } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";
import {
  FINGER_STICK_REASONS,
  compareFingerStick,
  comparisonSentence,
  isTrendMovingFast,
  matchCgmReading,
  parseMeterInput,
  reasonLabel,
  type CgmMatch,
  type CgmPoint,
} from "@/utils/fingerStick";
import { capFirst } from "@/utils/capitalize";

export interface LoggedFingerStick {
  glucose: number;
  timestamp: string;
  cgm: CgmMatch | null;
}

export default function LogFingerStickModal({
  visible,
  onClose,
  selectedDay,
  dayReadings = [],
  colors,
  onLogged,
  initialReason = null,
}: {
  visible: boolean;
  onClose: () => void;
  /** The entry logs to this day (shown locked, like Log Insulin). */
  selectedDay: Date;
  /** CGM readings for that day (from the Log page); recent history is also searched. */
  dayReadings?: CgmPoint[];
  colors: (typeof Colors)["light"];
  onLogged?: () => void;
  /** Reason chip preselected when the form opens (e.g. "before_dosing" from the dose calculator). */
  initialReason?: FingerStickReason | null;
}) {
  const { logFingerStick } = useAuth();
  const { history } = useGlucose();
  const confirmLog = useCareLogConfirm();

  const [meterText, setMeterText] = useState("");
  const [timeText, setTimeText] = useState(() => formatTimeInputText(new Date()));
  const [timeOpen, setTimeOpen] = useState(false);
  const [reason, setReason] = useState<FingerStickReason | null>(initialReason);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<LoggedFingerStick | null>(null);

  // Fresh form every time it opens (time prefilled with now).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setMeterText("");
      setTimeText(formatTimeInputText(new Date()));
      setTimeOpen(false);
      setReason(initialReason);
      setNote("");
      setResult(null);
    }
  }

  const meter = parseMeterInput(meterText);
  const parsedTime = parseTimeInputText(timeText);
  const entryMs = parsedTime ? combineDayAndTime(selectedDay, parsedTime.hours, parsedTime.minutes).getTime() : null;
  const isFuture = entryMs != null && entryMs > Date.now() + 60_000;
  const canLog = meter != null && entryMs != null && !isFuture;

  // History carries Dexcom's trend; the day's readings cover backdated entries.
  const cgm = useMemo(() => {
    if (entryMs == null) return null;
    return matchCgmReading(history, entryMs) ?? matchCgmReading(dayReadings, entryMs);
  }, [history, dayReadings, entryMs]);

  const dateLabel = selectedDay.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  const handleLog = () => {
    if (!canLog || meter == null || entryMs == null) return;
    const timestamp = new Date(entryMs).toISOString();
    confirmLog(() => {
      logFingerStick({
        timestamp,
        glucose: meter,
        ...(cgm ? { cgmGlucose: cgm.glucose, cgmTimestamp: cgm.timestamp } : {}),
        ...(cgm?.trend ? { cgmTrend: cgm.trend } : {}),
        ...(reason ? { reason } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setResult({ glucose: meter, timestamp, cgm });
      onLogged?.();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  };

  return (
    <DashboardSectionModal visible={visible} onClose={onClose} accessibilityLabel="Log finger stick">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {result ? (
          <FingerStickResult result={result} colors={colors} onDone={onClose} />
        ) : (
          <>
            <View style={styles.titleRow}>
              <View style={[styles.titleIcon, { backgroundColor: COLORS.primary + "22" }]}>
                <MaterialCommunityIcons name="water-plus-outline" size={18} color={COLORS.primary} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>Log Finger Stick</Text>
            </View>
            <Text style={[styles.sub, { color: colors.textSecondary }]}>
              Enter the number from your meter. We’ll compare it with Dexcom at the same moment.
            </Text>

            <View style={[styles.row, styles.section, { borderTopColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Meter reading</Text>
              <View style={styles.meterBadge}>
                <TextInput
                  value={meterText}
                  onChangeText={(t) => setMeterText(t.replace(/[^0-9]/g, "").slice(0, 3))}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.meterInput, { color: colors.text }]}
                  maxLength={3}
                  accessibilityLabel="Meter reading in milligrams per deciliter"
                />
                <Text style={[styles.unit, { color: colors.textMuted }]}>mg/dL</Text>
              </View>
            </View>
            {meterText !== "" && meter == null && (
              <Text style={[styles.error, { color: COLORS.danger }]}>Enter a reading between 20 and 600 mg/dL</Text>
            )}

            <View style={[styles.whenSection, { borderTopColor: colors.border }]}>
              <View style={styles.row}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Date</Text>
                <View style={styles.dateWrap}>
                  <Feather name="calendar" size={13} color={colors.textMuted} />
                  <Text style={[styles.dateValue, { color: colors.text }]}>{dateLabel}</Text>
                </View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Time</Text>
                <TimeButton value={timeText} open={timeOpen} onPress={() => setTimeOpen((o) => !o)} accessibilityLabel="Time of the finger stick" colors={colors} />
              </View>
              {timeOpen && <TimeWheel value={timeText} onChange={setTimeText} onDone={() => setTimeOpen(false)} colors={colors} />}
              {!parsedTime && (
                <Text style={[styles.error, { color: COLORS.danger }]}>Enter a time like 5:38 PM or 17:38</Text>
              )}
              {isFuture && <Text style={[styles.error, { color: COLORS.danger }]}>That time hasn’t happened yet</Text>}
              <View style={[styles.cgmRow, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <MaterialCommunityIcons name="water" size={16} color={COLORS.primary} />
                <Text style={[styles.cgmLabel, { color: colors.textSecondary }]} numberOfLines={1}>
                  {cgm ? `CGM at ${new Date(cgm.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "CGM at this time"}
                </Text>
                <Text style={[styles.cgmValue, { color: colors.text }]}>
                  {cgm ? `${Math.round(cgm.glucose)} mg/dL` : "No reading"}
                </Text>
              </View>
            </View>

            <View style={[styles.section, { borderTopColor: colors.border, gap: 10 }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Why did you check? <Text style={{ color: colors.textMuted, fontWeight: "400" }}>(optional)</Text>
              </Text>
              <View style={styles.chips}>
                {FINGER_STICK_REASONS.map((r) => {
                  const on = reason === r.key;
                  return (
                    <Pressable
                      key={r.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setReason(on ? null : r.key);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        on
                          ? { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                          : { backgroundColor: colors.backgroundTertiary, borderColor: colors.border },
                        { opacity: pressed ? 0.8 : 1 },
                      ]}
                    >
                      {on && <AccentShade radius={999} />}
                      <Text style={[styles.chipText, { color: on ? "#fff" : colors.textSecondary }]}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                autoCapitalize="sentences"
                value={note}
                onChangeText={(raw) => { const t = capFirst(raw); return setNote(t.slice(0, 200)); }}
                placeholder="Note (optional), e.g. washed hands first"
                placeholderTextColor={colors.textMuted}
                style={[styles.noteInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
                accessibilityLabel="Note"
              />
            </View>

            <View style={styles.footer}>
              <Pressable
                accessibilityRole="button"
                disabled={!canLog}
                onPress={handleLog}
                style={({ pressed }) => [
                  styles.submit,
                  { backgroundColor: canLog ? COLORS.primary : colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                {canLog && <AccentShade radius={10} />}
                <Feather name="check" size={14} color={canLog ? "#fff" : colors.textMuted} />
                <Text style={[styles.submitText, { color: canLog ? "#fff" : colors.textMuted }]}>Log</Text>
              </Pressable>
            </View>
            <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
              Glucose Guardian provides estimates only and does not replace medical advice. Always follow your doctor’s instructions.
            </Text>
          </>
        )}
      </View>
    </DashboardSectionModal>
  );
}

/**
 * Tap a finger stick on the Log page (row or graph marker) to see its comparison again, with Delete
 * for anyone allowed to change logs. Deleting from a caregiver session confirms first.
 */
export function FingerStickDetailModal({
  entry,
  colors,
  canEdit,
  byline,
  onClose,
}: {
  entry: FingerStickEntry;
  colors: (typeof Colors)["light"];
  canEdit: boolean;
  /** "by you" / "by Mom" — already resolved by the Log page. */
  byline: string;
  onClose: () => void;
}) {
  const { deleteFingerStickEntry } = useAuth();
  const confirmLog = useCareLogConfirm();
  const when = new Date(entry.timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const reason = reasonLabel(entry.reason);
  const subtitle = [when, byline, reason].filter(Boolean).join(" · ");
  const cgm = entry.cgmGlucose != null
    ? { glucose: entry.cgmGlucose, timestamp: entry.cgmTimestamp ?? entry.timestamp, ...(entry.cgmTrend ? { trend: entry.cgmTrend } : {}) }
    : null;
  const confirmDelete = () => {
    Alert.alert("Delete this finger stick?", "It’s removed for everyone in the care circle.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          confirmLog(() => {
            deleteFingerStickEntry(entry.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onClose();
          }),
      },
    ]);
  };
  return (
    <DashboardSectionModal visible onClose={onClose} accessibilityLabel="Finger stick details">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <FingerStickResult
          result={{ glucose: entry.glucose, timestamp: entry.timestamp, cgm }}
          colors={colors}
          onDone={onClose}
          title="Finger stick"
          subtitle={subtitle}
          footer={
            <>
              {entry.note ? <Text style={[styles.body, { color: colors.text }]}>“{entry.note}”</Text> : null}
              {canEdit && (
                <Pressable
                  accessibilityRole="button"
                  onPress={confirmDelete}
                  style={({ pressed }) => [styles.deleteBtn, { borderColor: COLORS.danger + "80", opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="trash-2" size={14} color={COLORS.danger} />
                  <Text style={[styles.deleteText, { color: COLORS.danger }]}>Delete</Text>
                </Pressable>
              )}
            </>
          }
        />
      </View>
    </DashboardSectionModal>
  );
}

/** The comparison shown right after logging (and reused by the finger-stick detail popup). */
export function FingerStickResult({
  result,
  colors,
  onDone,
  doneLabel = "Done",
  title = "Finger stick logged",
  subtitle,
  footer,
}: {
  result: LoggedFingerStick;
  colors: (typeof Colors)["light"];
  onDone: () => void;
  doneLabel?: string;
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
}) {
  const cmp = result.cgm ? compareFingerStick(result.glucose, result.cgm.glucose) : null;
  const close = cmp?.verdict === "close";
  const tone = close ? COLORS.success : COLORS.warning;
  const fast = isTrendMovingFast(result.cgm?.trend);
  const when = new Date(result.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.titleRow}>
        <View style={[styles.titleIcon, { backgroundColor: COLORS.primary }]}>
          <AccentShade radius={15} />
          <Feather name="check" size={16} color="#fff" />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      </View>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>{subtitle ?? `At ${when}`}</Text>

      <View style={styles.valueRow}>
        <View style={[styles.valueBox, { backgroundColor: COLORS.primary + "1F", borderColor: COLORS.primary + "8C" }]}>
          <Text style={[styles.valueKicker, { color: COLORS.primaryLight }]}>FINGER STICK</Text>
          <Text style={[styles.value, { color: colors.text }]}>{result.glucose}</Text>
          <Text style={[styles.valueSub, { color: colors.textSecondary }]}>mg/dL · blood</Text>
        </View>
        <View style={[styles.valueBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
          <Text style={[styles.valueKicker, { color: colors.textSecondary }]}>DEXCOM</Text>
          <Text style={[styles.value, { color: colors.text }]}>{result.cgm ? Math.round(result.cgm.glucose) : "—"}</Text>
          <Text style={[styles.valueSub, { color: colors.textSecondary }]}>{result.cgm ? "mg/dL · sensor" : "no reading then"}</Text>
        </View>
      </View>

      {cmp ? (
        <View style={[styles.verdict, { backgroundColor: tone + "1A", borderColor: tone + "73" }]}>
          <Feather name={close ? "check-circle" : "alert-triangle"} size={20} color={tone} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.verdictTitle, { color: tone }]}>{close ? "Close match" : "Noticeable difference"}</Text>
            <Text style={[styles.verdictSub, { color: colors.text }]}>{comparisonSentence(cmp)}</Text>
          </View>
        </View>
      ) : (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          There’s no Dexcom reading within 10 minutes of this time, so there’s nothing to compare it with.
        </Text>
      )}

      {cmp && fast && (
        <Text style={[styles.body, { color: colors.text }]}>
          Glucose was changing quickly. Dexcom reads fluid under the skin, which runs about 5–15 minutes behind blood, so some gap is expected.
        </Text>
      )}
      {cmp && (
        <Text style={[styles.small, { color: colors.textSecondary }]}>
          A close match is within 15 mg/dL when under 100, or within 15% at 100 and above.
        </Text>
      )}

      {footer}
      <Pressable
        accessibilityRole="button"
        onPress={onDone}
        style={({ pressed }) => [styles.doneBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <AccentShade radius={12} />
        <Text style={styles.doneText}>{doneLabel}</Text>
      </Pressable>
      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
        Logging a finger stick doesn’t change your Dexcom. If readings are often far apart, follow Dexcom’s instructions or talk to your care team.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 12, fontWeight: "400", lineHeight: 17, marginTop: -4 },
  section: { borderTopWidth: 1, paddingTop: 12 },
  whenSection: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  label: { fontSize: 13, fontWeight: "600" },
  meterBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + "26",
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 14,
    minWidth: 120,
    justifyContent: "center",
  },
  meterInput: { fontSize: 24, fontWeight: "700", minWidth: 56, textAlign: "center", padding: 0, margin: 0 },
  unit: { fontSize: 13, fontWeight: "600" },
  error: { fontSize: 11, fontWeight: "500", textAlign: "right" },
  dateWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  dateValue: { fontSize: 14, fontWeight: "600" },
  timeInput: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: "600",
    minWidth: 110,
    textAlign: "center",
  },
  cgmRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  cgmLabel: { flex: 1, fontSize: 13, fontWeight: "500" },
  cgmValue: { fontSize: 14, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12.5, fontWeight: "600" },
  noteInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  footer: { flexDirection: "row", justifyContent: "flex-end" },
  submit: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  submitText: { fontSize: 14, fontWeight: "700" },
  disclaimer: { fontSize: 11, lineHeight: 15, textAlign: "center" },
  valueRow: { flexDirection: "row", gap: 10 },
  valueBox: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12, gap: 2 },
  valueKicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.7 },
  value: { fontSize: 32, fontWeight: "800", letterSpacing: -0.5 },
  valueSub: { fontSize: 11.5 },
  verdict: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12 },
  verdictTitle: { fontSize: 15, fontWeight: "700" },
  verdictSub: { fontSize: 13, marginTop: 2 },
  body: { fontSize: 13, lineHeight: 19 },
  small: { fontSize: 11.5, lineHeight: 16 },
  doneBtn: { alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 12, overflow: "hidden" },
  doneText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  deleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 12, paddingVertical: 10 },
  deleteText: { fontSize: 14, fontWeight: "700" },
});
