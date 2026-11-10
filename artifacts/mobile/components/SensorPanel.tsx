/**
 * The Sensor pop-up (Dashboard → Sensor, a Sensor shortcut, or right after connecting Dexcom):
 * - the countdown card: days left, the 12-hour grace period (G7), warm-up, when it went on and ends,
 *   where it went on, sensors left in the box;
 * - New sensor / Change: type, when it went on, where, or scan the square code on the applicator or box
 *   to fill in the type and save the serial number, pairing code and expiration;
 * - Sensor stopped early: marks it and points to the maker's free replacement page.
 * Everything is shared with the circle (convex/sensor).
 */
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation } from "convex/react";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { AccentShade, CardShade } from "@/components/Shade";
import SensorScanner from "@/components/SensorScanner";
import { TimeButton, TimeWheel } from "@/components/TimeWheel";
import { useAuth } from "@/context/AuthContext";
import { useSensor } from "@/hooks/useSensor";
import { api } from "@/utils/convex-auth-client";
import { startOfLocalDay } from "@/utils/localDayBoundaries";
import { combineDayAndTime, formatTimeInputText, parseTimeInputText } from "@/utils/logTime";
import { LOW_SUPPLY, longLeft, SENSOR_GTINS, SENSOR_SITES, SENSOR_SPECS, type SensorKind, type SensorLabel } from "../../../convex/sensorLogic";

type Palette = (typeof Colors)["light"];
type View_ = "card" | "new" | "edit" | "ended";

const DEXCOM_KINDS: SensorKind[] = ["g7", "g7_15", "g6"];
const LIBRE_KINDS: SensorKind[] = ["libre14", "libre15"];
const REPLACEMENT = {
  dexcom: { label: "Dexcom replacement page", url: "https://www.dexcom.com/faqs/how-to-get-a-replacement-dexcom-g7-sensor" },
  libre: { label: "Abbott replacement page", url: "https://www.freestyle.abbott/en-us/support/sensor-support-request.html" },
};
const tz = () => -new Date().getTimezoneOffset();

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
/** "2027-10-31" → "Oct 31, 2027" (read as a calendar date, not shifted by time zone). */
function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function isPast(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, (d ?? 1) + 1).getTime() <= Date.now();
}

export default function SensorPanel({
  colors,
  onClose,
  startIn,
}: {
  colors: Palette;
  onClose?: () => void;
  /** "connect": right after connecting Dexcom, ask when this sensor went on. */
  startIn?: "connect";
}) {
  const { data, sensor, status, spec, args } = useSensor();
  const { cgmConnection } = useAuth();
  const [view, setView] = useState<View_>(startIn === "connect" ? "new" : "card");
  const endEarly = useMutation(api.sensor.endEarly);
  const setSupply = useMutation(api.sensor.setSupply);

  if (!args) return null;
  if (data === undefined) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 30 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Sensor</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>The sensor countdown opens during the hours your code works.</Text>
      </View>
    );
  }

  const brand: "dexcom" | "libre" =
    sensor ? SENSOR_SPECS[sensor.kind as SensorKind].brand : cgmConnection.type === "libre" ? "libre" : "dexcom";
  const kinds = brand === "libre" ? LIBRE_KINDS : DEXCOM_KINDS;

  if (view === "new" || view === "edit") {
    return (
      <SensorForm
        colors={colors}
        args={args}
        mode={view}
        connect={startIn === "connect" && view === "new"}
        kinds={kinds}
        initial={view === "edit" && sensor ? { kind: sensor.kind as SensorKind, startedAt: sensor.startedAt, site: sensor.site } : { kind: sensor?.kind as SensorKind | undefined, startedAt: null, site: null }}
        recentSites={data.recentSites}
        onDone={() => (startIn === "connect" ? onClose?.() : setView("card"))}
        onSkip={startIn === "connect" ? onClose : () => setView("card")}
      />
    );
  }

  const last = data.sensor;
  const endedEarly = view === "ended" || (last?.endedEarly && last.endedAt != null);
  const left = data.sensorsLeft;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      {endedEarly && last ? (
        <View style={{ gap: 10 }}>
          <Text style={[styles.kicker, { color: COLORS.danger }]}>SENSOR STOPPED EARLY</Text>
          <Text style={[styles.big, { color: colors.text }]}>Sorry about that.</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {brand === "dexcom" ? "Dexcom" : "Abbott"} usually replaces sensors that stop early, free.{" "}
            {last.serial ? "They'll ask for the serial number:" : "Have the sensor's serial number handy (it's on the box or in their app)."}
          </Text>
          {!!last.serial && (
            <View style={[styles.serialBox, { backgroundColor: colors.backgroundTertiary }]}>
              <Text style={[styles.label, { color: colors.textMuted }]}>SERIAL NUMBER</Text>
              <Text selectable style={[styles.serialText, { color: colors.text }]}>{last.serial}</Text>
              <Text style={[styles.hint, { color: colors.textMuted }]}>Press and hold to copy</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="link"
            onPress={() => void Linking.openURL(REPLACEMENT[brand].url)}
            style={({ pressed }) => [styles.secondaryBtn, { backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Feather name="external-link" size={15} color={COLORS.primaryLight} />
            <Text style={[styles.secondaryBtnText, { color: COLORS.primaryLight }]}>Open the {REPLACEMENT[brand].label}</Text>
          </Pressable>
        </View>
      ) : sensor && status && spec ? (
        <View style={{ gap: 10 }}>
          <Text
            style={[
              styles.kicker,
              { color: status.phase === "grace" || status.phase === "expired" ? COLORS.danger : status.phase === "lastDay" ? COLORS.warning : colors.textSecondary },
            ]}
          >
            {status.phase === "grace" ? "GRACE PERIOD" : status.phase === "lastDay" ? "SENSOR ENDS TODAY" : `${spec.label.toUpperCase()} SENSOR`}
          </Text>
          <Text style={[styles.big, { color: colors.text }]}>
            {status.phase === "warmup"
              ? `Warming up · about ${longLeft(status.msLeft)} left`
              : status.phase === "grace"
                ? `${longLeft(status.msLeft)} left to change it`
                : status.phase === "expired"
                  ? "Sensor ended"
                  : `${longLeft(status.msLeft)} left`}
          </Text>
          <View style={[styles.track, { backgroundColor: barColor(status.phase) + "33" }]}>
            <View style={[styles.fill, { width: `${Math.round((status.phase === "grace" ? 1 - status.msLeft / ((status.stopsAt - status.endsAt) || 1) : status.used) * 100)}%`, backgroundColor: barColor(status.phase) }]} />
          </View>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {status.phase === "grace"
              ? `The ${spec.days} days ended at ${fmtClock(status.endsAt)}. Readings keep coming until ${fmtClock(status.stopsAt)}, then the sensor stops.`
              : `Put on ${fmtDay(sensor.startedAt)}, ${fmtClock(sensor.startedAt)} · ends ${fmtDay(status.endsAt)}, ${fmtClock(status.endsAt)}${spec.graceHours ? ` · grace until ${fmtClock(status.stopsAt)}` : ""}`}
          </Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {sensor.source === "libre" ? "From your Libre account" : `Set by ${sensor.setByName}`}
            {sensor.site ? ` · ${sensor.site}` : ""}
          </Text>
          {(!!sensor.serial || !!sensor.pairingCode) && (
            <Text selectable style={[styles.hint, { color: colors.textMuted, marginTop: -6 }]}>
              {[sensor.serial ? `Serial ${sensor.serial}` : null, sensor.pairingCode ? `Pairing code ${sensor.pairingCode}` : null].filter(Boolean).join(" · ")}
            </Text>
          )}
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={[styles.title, { color: colors.text }]}>Sensor</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {brand === "libre"
              ? "Your Libre sensor's countdown shows up here by itself after the next sync."
              : "Tell the app when this sensor went on, and it counts down the days, the grace period, and reminds everyone the night before it ends."}
          </Text>
        </View>
      )}

      {data.canEdit && (
        <View style={styles.row2}>
          {sensor && !endedEarly && status?.phase !== "grace" && status?.phase !== "expired" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setView("edit")}
              style={({ pressed }) => [styles.secondaryBtn, { flex: 1, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Change</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setView("new")}
            style={({ pressed }) => [
              styles.primaryBtn,
              { flex: 1, backgroundColor: status?.phase === "grace" || status?.phase === "expired" ? COLORS.danger : COLORS.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            {!(status?.phase === "grace" || status?.phase === "expired") && <AccentShade radius={12} />}
            <Text style={styles.primaryBtnText}>{status?.phase === "grace" ? "I put on a new sensor" : sensor ? "New sensor" : "Set up sensor"}</Text>
          </Pressable>
        </View>
      )}

      {data.canEdit && sensor && !endedEarly && (
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await endEarly(args);
            setView("ended");
          }}
          hitSlop={6}
        >
          <Text style={[styles.link, { color: colors.textSecondary }]}>Sensor stopped early or fell off?</Text>
        </Pressable>
      )}

      <View style={[styles.supply, { borderTopColor: colors.border }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.supplyLabel, { color: colors.text }]}>Sensors left in the box</Text>
          <Text style={[styles.hint, { color: left != null && left <= LOW_SUPPLY ? COLORS.warning : colors.textMuted }]}>
            {left == null ? "Not counting yet" : left <= LOW_SUPPLY ? "Time to reorder" : "Counts down with each new sensor"}
          </Text>
        </View>
        {data.canEdit ? (
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="One fewer"
              disabled={left == null || left <= 0}
              onPress={() => void setSupply({ ...args, sensorsLeft: Math.max(0, (left ?? 0) - 1) })}
              style={[styles.stepBtn, { backgroundColor: colors.backgroundTertiary, opacity: left == null || left <= 0 ? 0.4 : 1 }]}
            >
              <Feather name="minus" size={16} color={colors.text} />
            </Pressable>
            <Text style={[styles.stepValue, { color: colors.text }]}>{left ?? "--"}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="One more"
              onPress={() => void setSupply({ ...args, sensorsLeft: (left ?? 0) + 1 })}
              style={[styles.stepBtn, { backgroundColor: colors.backgroundTertiary }]}
            >
              <Feather name="plus" size={16} color={colors.text} />
            </Pressable>
          </View>
        ) : (
          <Text style={[styles.stepValue, { color: colors.text }]}>{left ?? "--"}</Text>
        )}
      </View>
    </View>
  );
}

function barColor(phase: string): string {
  return phase === "grace" || phase === "expired" ? COLORS.danger : phase === "lastDay" ? COLORS.warning : COLORS.primaryLight;
}

function SensorForm({
  colors,
  args,
  mode,
  connect,
  kinds,
  initial,
  recentSites,
  onDone,
  onSkip,
}: {
  colors: Palette;
  args: { code?: string };
  mode: "new" | "edit";
  connect: boolean;
  kinds: SensorKind[];
  initial: { kind?: SensorKind; startedAt: number | null; site: string | null };
  recentSites: string[];
  onDone: () => void;
  onSkip?: () => void;
}) {
  const start = useMutation(api.sensor.start);
  const update = useMutation(api.sensor.update);
  const [kind, setKind] = useState<SensorKind>(initial.kind && kinds.includes(initial.kind) ? initial.kind : kinds[0]!);
  const now = Date.now();
  const initialMs = initial.startedAt ?? now;
  const [dayMs, setDayMs] = useState(() => startOfLocalDay(new Date(initialMs)).getTime());
  const [timeText, setTimeText] = useState(() => formatTimeInputText(new Date(initialMs)));
  const [timeOpen, setTimeOpen] = useState(false);
  const [site, setSite] = useState<string | null>(mode === "edit" ? initial.site : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [label, setLabel] = useState<SensorLabel | null>(null);
  /** The scanned code named a sensor type this list doesn't have (or none): they pick it below. */
  const [unknownType, setUnknownType] = useState(false);
  useEffect(() => setError(null), [kind, dayMs, timeText]);

  const onScanned = (l: SensorLabel) => {
    setScanOpen(false);
    setLabel(l);
    const k = l.gtin ? SENSOR_GTINS[l.gtin] : undefined;
    if (k && kinds.includes(k)) {
      setKind(k);
      setUnknownType(false);
    } else setUnknownType(true);
  };
  const labelFields = label
    ? {
        ...(label.gtin ? { gtin: label.gtin } : {}),
        ...(label.serial ? { serial: label.serial } : {}),
        ...(label.pairingCode ? { pairingCode: label.pairingCode } : {}),
        ...(label.expiresOn ? { expiresOn: label.expiresOn } : {}),
      }
    : {};

  const parsed = parseTimeInputText(timeText);
  const startedAt = parsed ? combineDayAndTime(new Date(dayMs), parsed.hours, parsed.minutes).getTime() : null;
  const today = startOfLocalDay(new Date()).getTime();
  const daysBack = Math.round((today - dayMs) / 86_400_000);
  const spec = SENSOR_SPECS[kind];
  const endsAt = startedAt != null ? startedAt + spec.days * 86_400_000 : null;
  const valid = startedAt != null && startedAt <= now + 5 * 60_000 && daysBack <= 16;

  const save = async () => {
    if (!valid || startedAt == null) return;
    setSaving(true);
    try {
      if (mode === "edit") await update({ ...args, kind, startedAt, site: site ?? "", tzOffsetMinutes: tz(), ...labelFields });
      else await start({ ...args, kind, startedAt, ...(site ? { site } : {}), tzOffsetMinutes: tz(), ...labelFields });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const chip = (on: boolean) => [styles.chip, { backgroundColor: on ? COLORS.primary + "2E" : colors.backgroundTertiary, borderColor: on ? COLORS.primaryLight : colors.border }];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={16} />
      <View style={{ gap: 4 }}>
        <Text style={[styles.title, { color: colors.text }]}>
          {connect ? "When did you put on this sensor?" : mode === "edit" ? "Change this sensor" : "New sensor"}
        </Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {connect ? "So the app can count down the days and remind everyone before it ends." : "Everyone in the care circle sees the same countdown."}
        </Text>
      </View>

      {label ? (
        <View style={[styles.scanned, { backgroundColor: COLORS.primary + "1A" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="check-circle" size={16} color={COLORS.primaryLight} />
            <Text style={[styles.scannedTitle, { color: colors.text, flex: 1 }]}>Sensor scanned</Text>
            <Pressable accessibilityRole="button" onPress={() => setScanOpen(true)} hitSlop={8}>
              <Text style={[styles.scanAgain, { color: COLORS.primaryLight }]}>Scan again</Text>
            </Pressable>
          </View>
          {!!label.serial && <Text selectable style={[styles.scannedLine, { color: colors.text }]}>Serial {label.serial}</Text>}
          {!!label.pairingCode && <Text style={[styles.scannedLine, { color: colors.text }]}>Pairing code {label.pairingCode}</Text>}
          {!!label.expiresOn && (
            <Text style={[styles.scannedLine, { color: isPast(label.expiresOn) ? COLORS.danger : colors.textSecondary }]}>
              {isPast(label.expiresOn) ? `Expired ${fmtDate(label.expiresOn)}. Don't use an expired sensor.` : `Use by ${fmtDate(label.expiresOn)}`}
            </Text>
          )}
          {unknownType && <Text style={[styles.hint, { color: colors.textSecondary }]}>Pick which sensor this is below.</Text>}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan the sensor's code"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setScanOpen(true);
          }}
          style={({ pressed }) => [styles.scanBtn, { borderColor: COLORS.primary + "55", backgroundColor: COLORS.primary + "12", opacity: pressed ? 0.8 : 1 }]}
        >
          <Feather name="camera" size={18} color={COLORS.primaryLight} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.scanTitle, { color: colors.text }]}>Scan the sensor</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Saves the serial number and pairing code (optional)</Text>
          </View>
          <Feather name="chevron-right" size={17} color={colors.textMuted} />
        </Pressable>
      )}

      <Text style={[styles.label, { color: colors.textSecondary }]}>WHICH SENSOR</Text>
      <View style={styles.wrap}>
        {kinds.map((k) => (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: kind === k }} onPress={() => setKind(k)} style={chip(kind === k)}>
            <Text style={[styles.chipTitle, { color: colors.text }]}>{SENSOR_SPECS[k].short}</Text>
            <Text style={[styles.chipSub, { color: colors.textSecondary }]}>
              {SENSOR_SPECS[k].days} days{SENSOR_SPECS[k].graceHours ? ` + ${SENSOR_SPECS[k].graceHours}h` : ""}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>PUT ON</Text>
      <View style={styles.dayRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Day before"
          disabled={daysBack >= 16}
          onPress={() => setDayMs(startOfLocalDay(new Date(dayMs - 12 * 3_600_000)).getTime())}
          style={[styles.stepBtn, { backgroundColor: colors.backgroundTertiary, opacity: daysBack >= 16 ? 0.4 : 1 }]}
        >
          <Feather name="chevron-left" size={17} color={colors.text} />
        </Pressable>
        <Text style={[styles.dayText, { color: colors.text }]}>
          {daysBack === 0 ? "Today" : daysBack === 1 ? "Yesterday" : fmtDay(dayMs)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Day after"
          disabled={daysBack <= 0}
          onPress={() => setDayMs(startOfLocalDay(new Date(dayMs + 36 * 3_600_000)).getTime())}
          style={[styles.stepBtn, { backgroundColor: colors.backgroundTertiary, opacity: daysBack <= 0 ? 0.4 : 1 }]}
        >
          <Feather name="chevron-right" size={17} color={colors.text} />
        </Pressable>
        <TimeButton value={timeText} open={timeOpen} onPress={() => setTimeOpen((o) => !o)} accessibilityLabel="Time it went on" colors={colors} />
      </View>
      {timeOpen && <TimeWheel value={timeText} onChange={setTimeText} onDone={() => setTimeOpen(false)} colors={colors} />}
      {endsAt != null && (
        <View style={[styles.preview, { backgroundColor: COLORS.primary + "1A" }]}>
          <Text style={[styles.previewText, { color: colors.text }]}>
            {startedAt != null && startedAt > now + 5 * 60_000
              ? "That time hasn't happened yet."
              : `Ends ${fmtDay(endsAt)} at ${fmtClock(endsAt)}${spec.graceHours ? `, then ${spec.graceHours} hours of grace` : ""}`}
          </Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.textSecondary }]}>WHERE (OPTIONAL)</Text>
      {recentSites.length > 0 && (
        <Text style={[styles.hint, { color: colors.textMuted, marginTop: -6 }]}>
          Last {recentSites.length === 1 ? "spot" : "spots"}: {recentSites.join(", ")}. Try somewhere different.
        </Text>
      )}
      <View style={styles.wrap}>
        {SENSOR_SITES.map((s) => (
          <Pressable key={s} accessibilityRole="radio" accessibilityState={{ selected: site === s }} onPress={() => setSite(site === s ? null : s)} style={[chip(site === s), styles.siteChip]}>
            <Text style={[styles.siteText, { color: recentSites[0] === s && site !== s ? colors.textMuted : colors.text }]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!valid || saving}
        onPress={() => void save()}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: valid ? COLORS.primary : colors.backgroundTertiary, opacity: pressed || saving ? 0.85 : 1 }]}
      >
        {valid && <AccentShade radius={12} />}
        <Text style={[styles.primaryBtnText, { color: valid ? "#fff" : colors.textMuted }]}>
          {saving ? "Saving..." : connect ? "Start countdown" : mode === "edit" ? "Save" : "Start new sensor"}
        </Text>
      </Pressable>
      {!!error && <Text style={[styles.hint, { color: COLORS.danger, textAlign: "center" }]}>{error}</Text>}
      {onSkip && (
        <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={6}>
          <Text style={[styles.link, { color: colors.textSecondary }]}>{connect ? "Not sure, skip for now" : "Cancel"}</Text>
        </Pressable>
      )}
      {/* Nested here (inside the pop-up's modal): iOS can't show two sibling modals at once. */}
      <SensorScanner visible={scanOpen} onClose={() => setScanOpen(false)} onScanned={onScanned} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  title: { fontSize: 19, fontWeight: "800" },
  kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  big: { fontSize: 22, fontWeight: "800" },
  sub: { fontSize: 13.5, lineHeight: 19 },
  hint: { fontSize: 12, lineHeight: 17 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  link: { fontSize: 13.5, fontWeight: "600", textAlign: "center", textDecorationLine: "underline" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  row2: { flexDirection: "row", gap: 10 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12, overflow: "hidden" },
  primaryBtnText: { color: "#fff", fontSize: 15.5, fontWeight: "700" },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 12 },
  secondaryBtnText: { fontSize: 15, fontWeight: "700" },
  supply: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  supplyLabel: { fontSize: 15, fontWeight: "700" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepValue: { minWidth: 24, textAlign: "center", fontSize: 18, fontWeight: "800" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 9, minHeight: 44, justifyContent: "center" },
  chipTitle: { fontSize: 15, fontWeight: "700" },
  chipSub: { fontSize: 12 },
  siteChip: { paddingVertical: 8, minHeight: 40 },
  siteText: { fontSize: 14, fontWeight: "600" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayText: { flex: 1, textAlign: "center", fontSize: 15.5, fontWeight: "700" },
  preview: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  previewText: { fontSize: 13.5, fontWeight: "600" },
  scanBtn: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11 },
  scanTitle: { fontSize: 15, fontWeight: "700" },
  scanned: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
  scannedTitle: { fontSize: 14.5, fontWeight: "700" },
  scanAgain: { fontSize: 13.5, fontWeight: "700" },
  scannedLine: { fontSize: 13.5, fontWeight: "600" },
  serialBox: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  serialText: { fontSize: 18, fontWeight: "800", letterSpacing: 0.6 },
});
