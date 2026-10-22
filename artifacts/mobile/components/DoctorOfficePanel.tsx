/**
 * Dashboard → Doctor Office: the Visit Summary PDF. Pick a range, see a preview of the numbers, tap
 * Download PDF, and the phone's share menu opens with the file (Save to Files, Mail, Messages,
 * AirDrop, print). No doctor info is collected or needed. The math and layout live in
 * utils/visitSummary and utils/visitSummaryHtml. Read-only: nothing here writes logs or touches
 * dose settings.
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { BrandShade } from "@/components/Shade";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { fetchGlucoseRange, identityKey, mergeReadings, type GlucoseIdentity } from "@/utils/glucoseRangeFetch";
import { buildVisitSummary, DAY_MS, glucoseStats, inWindow, lowEpisodes, type SummaryReading } from "@/utils/visitSummary";
import { buildVisitSummaryHtml, EVERY_MEAL_MAX_DAYS, visitSummaryFileName } from "@/utils/visitSummaryHtml";

type Palette = typeof Colors.dark;
const RANGES = [7, 14, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];
/** Photos are embedded small; this many keeps the PDF a reasonable size to email. */
const MAX_PHOTOS = 60;

export default function DoctorOfficePanel({ colors }: { colors: Palette }) {
  const auth = useAuth();
  const { profile, foodLog, insulinLog, fingerStickLog, ageYears } = auth;
  const { history, carbRatio, correctionFactor, targetGlucose } = useGlucose();
  const patientName = profile?.childName?.trim() || "Patient";

  // ── Readings for the report. Fetched once per identity, extended backward when a longer range
  // is picked; live history tops up the last few minutes. ──
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
  const idKey = identityKey(identity);
  const [range, setRange] = useState<RangeDays>(14);
  const [fetched, setFetched] = useState<{ key: string; fromMs: number; readings: SummaryReading[] } | null>(null);
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const inflight = useRef<Promise<SummaryReading[] | null> | null>(null);
  const endMs = useMemo(() => {
    // Through the end of today, so the window is whole local days ending today.
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }, []);

  const ensureReadings = useCallback(
    async (days: number): Promise<SummaryReading[] | null> => {
      const needFrom = endMs - days * DAY_MS;
      const have = fetched && fetched.key === idKey ? fetched : null;
      if (have && have.fromMs <= needFrom) return have.readings;
      if (inflight.current) await inflight.current;
      const toMs = have ? have.fromMs : endMs;
      const run = (async () => {
        setLoadError(false);
        setLoading({ done: 0, total: 1 });
        try {
          const rows = await fetchGlucoseRange(identity, needFrom, toMs, (done, total) => setLoading({ done, total }));
          const merged = mergeReadings(rows, have?.readings ?? []);
          setFetched({ key: idKey, fromMs: needFrom, readings: merged });
          return merged;
        } catch {
          setLoadError(true);
          return null;
        } finally {
          setLoading(null);
          inflight.current = null;
        }
      })();
      inflight.current = run;
      return run;
    },
    // identity fields are folded into idKey; the fetch itself reads the latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endMs, fetched, idKey],
  );

  useEffect(() => {
    void ensureReadings(range);
  }, [range, idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveHistory = useMemo(() => history.map((h) => ({ glucose: h.glucose, timestamp: h.timestamp })), [history]);
  const readings = useMemo(
    () => mergeReadings(fetched && fetched.key === idKey ? fetched.readings : [], liveHistory),
    [fetched, idKey, liveHistory],
  );

  const startMs = endMs - range * DAY_MS;
  const rangeReady = !!fetched && fetched.key === idKey && fetched.fromMs <= startMs;
  const peek = useMemo(() => {
    const inRange = readings.filter((r) => inWindow(r.timestamp, startMs, endMs));
    const s = glucoseStats(inRange);
    return { tir: s ? Math.round(s.pct.inRange) : null, gmi: s?.gmi ?? null, lows: s ? lowEpisodes(inRange).length : null };
  }, [readings, startMs, endMs]);

  const [includePhotos, setIncludePhotos] = useState(false);
  const [everyMeal, setEveryMeal] = useState(false);
  const [building, setBuilding] = useState(false);
  const listsEveryMeal = range <= EVERY_MEAL_MAX_DAYS || everyMeal;

  async function photoSources(meals: { timestamp: string; photoUri?: string }[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const m of meals.filter((x) => x.photoUri).slice(0, MAX_PHOTOS)) {
      const uri = m.photoUri!;
      try {
        if (/^https?:\/\//i.test(uri)) {
          out[m.timestamp] = uri;
        } else {
          const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 120 } }], {
            compress: 0.6,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          });
          if (small.base64) out[m.timestamp] = `data:image/jpeg;base64,${small.base64}`;
        }
      } catch {
        /* a photo that can't be read is just left out */
      }
    }
    return out;
  }

  async function downloadPdf() {
    if (building) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuilding(true);
    try {
      const rows = await ensureReadings(range);
      if (!rows) throw new Error("readings");
      const data = buildVisitSummary({
        days: range,
        endMs,
        readings: mergeReadings(rows, liveHistory),
        food: foodLog,
        insulin: insulinLog,
        sticks: fingerStickLog ?? [],
        accessLog: profile?.accessLog ?? [],
      });
      const meta = {
        patientName,
        ageYears,
        diabetesType: profile?.diabetesType,
        carbRatio,
        correctionFactor,
        targetGlucose,
        generatedAt: Date.now(),
      };
      const photos = includePhotos && listsEveryMeal ? await photoSources(data.meals) : undefined;
      const html = buildVisitSummaryHtml(data, meta, { includeEveryMeal: everyMeal, photos });
      // Letter size. iOS takes margins here; Android uses the @page margin in the HTML.
      const { uri } = await Print.printToFileAsync({
        html,
        width: 612,
        height: 792,
        ...(Platform.OS === "ios" ? { margins: { left: 32, right: 32, top: 32, bottom: 32 } } : {}),
      });
      const dest = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "") + visitSummaryFileName(meta);
      await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `${patientName}'s Visit Summary` });
      } else {
        Alert.alert("PDF ready", "Sharing isn't available on this device.");
      }
    } catch {
      Alert.alert("Couldn't build the summary", "Check your internet connection and try again.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        A PDF for {patientName}'s doctor: time in range, the daily pattern, lows, insulin, and every meal with the glucose before and after.
      </Text>

      <View style={styles.seg}>
        {RANGES.map((d) => {
          const on = d === range;
          return (
            <Pressable
              key={d}
              onPress={() => {
                Haptics.selectionAsync();
                setRange(d);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.segBtn, { borderColor: on ? COLORS.primary : colors.border, backgroundColor: on ? COLORS.primary + "26" : colors.backgroundTertiary }]}
            >
              <Text style={[styles.segText, { color: on ? colors.text : colors.textSecondary }]}>{d} days</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.peek}>
        {loading && !rangeReady ? (
          <View style={[styles.peekBox, styles.peekWide, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={[styles.peekNote, { color: colors.textSecondary }]}>
              Loading {range} days of readings{loading.total > 1 ? ` (${loading.done} of ${loading.total})` : ""}…
            </Text>
          </View>
        ) : loadError && !rangeReady ? (
          <Pressable
            onPress={() => void ensureReadings(range)}
            style={[styles.peekBox, styles.peekWide, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
          >
            <Text style={[styles.peekNote, { color: colors.textSecondary }]}>Couldn't load readings. Tap to try again.</Text>
          </Pressable>
        ) : (
          <>
            <PeekBox colors={colors} value={peek.tir != null ? `${peek.tir}%` : "None"} label="In range" color={peek.tir != null && peek.tir >= 70 ? COLORS.success : undefined} />
            <PeekBox colors={colors} value={peek.gmi != null ? `${peek.gmi}%` : "None"} label="Est. A1C" />
            <PeekBox colors={colors} value={peek.lows != null ? String(peek.lows) : "None"} label={peek.lows === 1 ? "Low" : "Lows"} color={peek.lows ? COLORS.danger : undefined} />
          </>
        )}
      </View>

      {range > EVERY_MEAL_MAX_DAYS && (
        <ToggleRow colors={colors} label="Include every meal" hint="90 days lists the foods eaten most often. Turn on to list every meal too." value={everyMeal} onChange={setEveryMeal} />
      )}
      {listsEveryMeal && (
        <ToggleRow colors={colors} label="Include meal photos" hint="Small pictures next to each meal. Makes the file bigger." value={includePhotos} onChange={setIncludePhotos} />
      )}

      <Pressable
        onPress={downloadPdf}
        disabled={building}
        accessibilityRole="button"
        style={({ pressed }) => [styles.bigBtn, { opacity: pressed || building ? 0.85 : 1 }]}
      >
        <BrandShade radius={16} />
        {building ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="download" size={18} color="#fff" />}
        <Text style={styles.bigBtnTitle}>{building ? "Building your PDF…" : "Download PDF"}</Text>
      </Pressable>
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        Save it to Files, or send it to the doctor by email, text, or your patient portal (like MyChart).
      </Text>
    </View>
  );
}

function PeekBox({ colors, value, label, color }: { colors: Palette; value: string; label: string; color?: string }) {
  return (
    <View style={[styles.peekBox, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
      <Text style={[styles.peekValue, { color: color ?? colors.text }]}>{value}</Text>
      <Text style={[styles.peekLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function ToggleRow({ colors, label, hint, value, onChange }: { colors: Palette; label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.toggleHint, { color: colors.textMuted }]}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: COLORS.success }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20 },
  seg: { flexDirection: "row", gap: 6 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  segText: { fontSize: 13, fontWeight: "600" },
  peek: { flexDirection: "row", gap: 8 },
  peekBox: { flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1 },
  peekWide: { flexDirection: "row", alignItems: "center", gap: 10 },
  peekValue: { fontSize: 18, fontWeight: "700" },
  peekLabel: { fontSize: 11, marginTop: 1 },
  peekNote: { fontSize: 13, flexShrink: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 },
  toggleLabel: { fontSize: 14, fontWeight: "600" },
  toggleHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  bigBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 16, overflow: "hidden", backgroundColor: COLORS.primary, marginTop: 4 },
  bigBtnTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 17, textAlign: "center" },
});
