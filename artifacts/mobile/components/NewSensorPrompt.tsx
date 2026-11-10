/**
 * "New sensor?" A Dexcom sensor change leaves a gap: readings stop, then come back 20+ minutes later
 * after the warm-up. When that happens near the end of a sensor (or with no countdown set up yet), this
 * asks once whether it was a new sensor; Yes starts the new countdown for the whole circle.
 * Libre doesn't need it (its sensor start comes in with the readings). Never stacks on another sheet.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useMutation } from "convex/react";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Colors, { COLORS } from "@/constants/colors";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { AccentShade, CardShade } from "@/components/Shade";
import { useWhatsNewBusy } from "@/components/WhatsNew";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useTheme } from "@/context/ThemeContext";
import { useSensor } from "@/hooks/useSensor";
import { api } from "@/utils/convex-auth-client";
import { holdSheet, sheetHeldByOther, useSheetHolder } from "@/utils/sheetLock";
import { newSensorGap, SENSOR_SPECS, startFromGap, type SensorKind } from "../../../convex/sensorLogic";

const ANSWERED = "@gg.sensorGap.answered:";
const NO_COUNTDOWN_DECLINED = "@gg.sensorGap.noCountdownDeclined";

export default function NewSensorPrompt() {
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { isLoading, profile, accessLock, cgmConnection } = useAuth();
  const { history } = useGlucose();
  const { data, args, now } = useSensor();
  const start = useMutation(api.sensor.start);
  const whatsNewBusy = useWhatsNewBusy();
  const holder = useSheetHolder();
  const [answered, setAnswered] = useState<Record<string, true>>({});
  const [declinedNoCountdown, setDeclinedNoCountdown] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NO_COUNTDOWN_DECLINED)
      .then((v) => setDeclinedNoCountdown(v === "1"))
      .catch(() => setDeclinedNoCountdown(false));
  }, []);

  const last = data?.sensor ?? null;
  const lastKind = last?.kind as SensorKind | undefined;
  const isLibre = lastKind ? SENSOR_SPECS[lastKind].brand === "libre" : cgmConnection.type === "libre";
  const kind: SensorKind = lastKind && SENSOR_SPECS[lastKind].brand === "dexcom" ? lastKind : "g7";

  const gap = useMemo(() => {
    if (!data?.canEdit || isLibre) return null;
    if (!last && declinedNoCountdown !== false) return null;
    const current = last && !last.endedAt ? { kind: last.kind as SensorKind, startedAt: last.startedAt } : last ? { kind, startedAt: last.endedAt! } : null;
    const ms = history.map((h) => new Date(h.timestamp).getTime());
    return newSensorGap(ms, current, now);
  }, [data?.canEdit, isLibre, last, declinedNoCountdown, history, now, kind]);

  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const key = gap ? `${ANSWERED}${gap.resumedAt}` : null;
  useEffect(() => {
    if (!key || answered[key] || checkedKey === key) return;
    AsyncStorage.getItem(key)
      .then((v) => {
        if (v) setAnswered((a) => ({ ...a, [key]: true }));
        setCheckedKey(key);
      })
      .catch(() => setCheckedKey(key));
  }, [key, answered, checkedKey]);

  const open =
    !!gap && !!key && checkedKey === key && !answered[key] && !isLoading && !accessLock && !!profile && !whatsNewBusy && (holder == null || holder === "sensor") && !sheetHeldByOther("sensor");
  useEffect(() => {
    holdSheet("sensor", open);
    return () => holdSheet("sensor", false);
  }, [open]);

  if (!gap || !key || !args) return null;
  const startedAt = startFromGap(kind, gap);
  const spec = SENSOR_SPECS[kind];
  const endsAt = startedAt + spec.days * 86_400_000;
  const minutes = Math.round((gap.resumedAt - gap.stoppedAt) / 60_000);
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  const answer = async (yes: boolean) => {
    setAnswered((a) => ({ ...a, [key]: true }));
    AsyncStorage.setItem(key, yes ? "yes" : "no").catch(() => {});
    if (!yes) {
      if (!last) {
        setDeclinedNoCountdown(true);
        AsyncStorage.setItem(NO_COUNTDOWN_DECLINED, "1").catch(() => {});
      }
      return;
    }
    setSaving(true);
    try {
      await start({ ...args, kind, startedAt, detected: true, tzOffsetMinutes: -new Date().getTimezoneOffset() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* they can still tap New sensor on the Dashboard */
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardSectionModal visible={open} onClose={() => void answer(false)} accessibilityLabel="New sensor">
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        <Text style={[styles.title, { color: colors.text }]}>New sensor?</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Readings stopped for {minutes} minutes and started again at {clock(gap.resumedAt)}. That usually means a new sensor warming up.
        </Text>
        <View style={[styles.box, { backgroundColor: colors.backgroundTertiary }]}>
          <Text style={[styles.label, { color: colors.textMuted }]}>IF YES</Text>
          <Text style={[styles.boxText, { color: colors.text }]}>
            New {spec.short} countdown: {spec.days} days, ends {day(endsAt)} at {clock(endsAt)}
          </Text>
        </View>
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void answer(false)}
            style={({ pressed }) => [styles.btn, { backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.btnText, { color: colors.text }]}>No, same sensor</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void answer(true)}
            style={({ pressed }) => [styles.btn, { backgroundColor: COLORS.primary, overflow: "hidden", opacity: pressed || saving ? 0.85 : 1 }]}
          >
            <AccentShade radius={13} />
            <Text style={[styles.btnText, { color: "#fff" }]}>Yes, new sensor</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: colors.textMuted }]}>Wrong type or time? Fix it any time on the Dashboard under Sensor.</Text>
      </View>
    </DashboardSectionModal>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  title: { fontSize: 21, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 21 },
  box: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  label: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.8 },
  boxText: { fontSize: 14.5, fontWeight: "600" },
  buttons: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, alignItems: "center", justifyContent: "center", height: 48, borderRadius: 13 },
  btnText: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 12, textAlign: "center" },
});
