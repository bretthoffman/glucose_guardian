/**
 * Dashboard → Doctor Office: the Visit Summary PDF. Pick a range, choose what to include, preview
 * it (the phone's print preview), then Download PDF opens the share menu with the file (Save to
 * Files, Mail, Messages, AirDrop, print). No doctor info is collected or needed. The math and layout live in
 * utils/visitSummary and utils/visitSummaryHtml. Read-only: nothing here writes logs or touches
 * dose settings.
 */
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { BrandShade } from "@/components/Shade";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import { fetchGlucoseRange, identityKey, mergeReadings, type GlucoseIdentity } from "@/utils/glucoseRangeFetch";
import { buildVisitSummary, DAY_MS, glucoseStats, inWindow, lowEpisodes, type SummaryReading } from "@/utils/visitSummary";
import {
  ALL_SECTIONS_ON,
  buildVisitSummaryHtml,
  EVERY_MEAL_MAX_DAYS,
  SECTIONS,
  visitSummaryFileName,
  type SectionChoices,
  type SectionKey,
} from "@/utils/visitSummaryHtml";

type Palette = typeof Colors.dark;
const RANGES = [7, 14, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];
/** Where the PDF's Doctor Portal box sends doctors. */
const PORTAL_URL = "https://portal.glucoseguardian.io";

/** This device remembers which sections were last chosen. */
const SECTIONS_KEY = "@glucose_guardian_visit_summary_sections";

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

  // ── Doctor Portal pass: a one-time code printed on the family's PDF (see convex/portalTrial). Only
  // a signed-in family account has one; access-code sessions just get the demo invitation. ──
  const canUsePass = auth.isSignedIn && !!auth.account?.convexUserId && !auth.caregiverSession && !auth.nurseViewCode;
  const passStatus = useQuery(api.portalTrial.passStatus, canUsePass ? {} : "skip");
  async function passCodeForPdf(): Promise<string | null> {
    if (!canUsePass) return null;
    try {
      const r = await createConvexAuthClient().mutation(api.portalTrial.passForReport, {});
      return r.code;
    } catch {
      return null; // offline or not deployed yet: the PDF still gets the demo invitation
    }
  }
  function confirmTurnOffPass() {
    Alert.alert(
      "Turn off the Doctor Portal pass?",
      "No doctor will be able to use it to see " + patientName + "'s data, and future PDFs won't include a code. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: () => {
            void createConvexAuthClient()
              .mutation(api.portalTrial.turnOffPass, {})
              .then(() => {
                lastPdf.current = null;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              })
              .catch(() => Alert.alert("Couldn't turn it off", "Check your internet connection and try again."));
          },
        },
      ],
    );
  }

  const [everyMeal, setEveryMeal] = useState(false);
  const [building, setBuilding] = useState<null | "preview" | "download">(null);
  const [sections, setSections] = useState<SectionChoices>(ALL_SECTIONS_ON);
  useEffect(() => {
    AsyncStorage.getItem(SECTIONS_KEY)
      .then((v) => {
        if (!v) return;
        const saved = JSON.parse(v) as Partial<SectionChoices>;
        setSections((cur) => ({ ...cur, ...saved }));
      })
      .catch(() => {});
  }, []);
  const toggleSection = (key: SectionKey) => {
    Haptics.selectionAsync();
    setSections((cur) => {
      const next = { ...cur, [key]: !cur[key] };
      AsyncStorage.setItem(SECTIONS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  /** The last PDF built, reused by Download right after Preview when nothing changed. */
  const lastPdf = useRef<{ key: string; file: string; at: number } | null>(null);
  const pdfKey = JSON.stringify({ range, sections, everyMeal, idKey, pass: passStatus?.state, from: fetched?.fromMs, n: readings.length, f: foodLog.length, i: insulinLog.length, s: fingerStickLog?.length ?? 0 });

  async function buildPdf(): Promise<string> {
    if (lastPdf.current && lastPdf.current.key === pdfKey && Date.now() - lastPdf.current.at < 5 * 60_000) return lastPdf.current.file;
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
      provider: auth.cgmConnection?.type,
    });
    const meta = {
      patientName,
      ageYears,
      diabetesType: profile?.diabetesType,
      carbRatio,
      correctionFactor,
      targetGlucose,
      generatedAt: Date.now(),
      cgmName: auth.cgmConnection?.type === "libre" ? "FreeStyle Libre" : auth.cgmConnection?.type === "dexcom" ? "Dexcom" : "CGM",
    };
    const code = await passCodeForPdf();
    const html = buildVisitSummaryHtml(data, meta, { sections, includeEveryMeal: everyMeal, portal: { code, url: PORTAL_URL } });
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
    lastPdf.current = { key: pdfKey, file: dest, at: Date.now() };
    return dest;
  }

  async function previewPdf() {
    if (building) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBuilding("preview");
    try {
      const file = await buildPdf();
      // The phone's print preview: every page, pinch to zoom. Nothing prints unless they tap Print.
      await Print.printAsync({ uri: file });
    } catch (e) {
      // Closing the print preview without printing can reject on some phones; that's not an error.
      if (!lastPdf.current || lastPdf.current.key !== pdfKey) {
        Alert.alert("Couldn't build the summary", "Check your internet connection and try again.");
      }
      void e;
    } finally {
      setBuilding(null);
    }
  }

  async function downloadPdf() {
    if (building) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuilding("download");
    try {
      const file = await buildPdf();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `${patientName}'s Visit Summary` });
      } else {
        Alert.alert("PDF ready", "Sharing isn't available on this device.");
      }
    } catch {
      Alert.alert("Couldn't build the summary", "Check your internet connection and try again.");
    } finally {
      setBuilding(null);
    }
  }

  const noneChosen = !Object.values(sections).some(Boolean);

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        A PDF for {patientName}'s doctor. Pick the days and what to include, preview it, then download and send it.
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

      <Text style={[styles.section, { color: colors.textMuted }]}>WHAT TO INCLUDE</Text>
      <View style={styles.chips}>
        <View style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: 0.75 }]}>
          <Feather name="lock" size={12} color={colors.textMuted} />
          <Text style={[styles.chipText, { color: colors.textSecondary }]}>Glucose overview</Text>
        </View>
        {SECTIONS.map((sec) => {
          const isOn = sections[sec.key];
          return (
            <Pressable
              key={sec.key}
              onPress={() => toggleSection(sec.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isOn }}
              accessibilityLabel={`${sec.title}. ${sec.hint}`}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: isOn ? COLORS.primary : colors.border,
                  backgroundColor: isOn ? COLORS.primary + "22" : colors.backgroundTertiary,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Feather name={isOn ? "check-circle" : "circle"} size={13} color={isOn ? COLORS.primary : colors.textMuted} />
              <Text style={[styles.chipText, { color: isOn ? colors.text : colors.textSecondary }]}>{sec.title}</Text>
            </Pressable>
          );
        })}
      </View>
      {sections.meals && range > EVERY_MEAL_MAX_DAYS && (
        <ToggleRow colors={colors} label="List every meal" hint="90 days lists the foods eaten most often. Turn on to list every meal with its day graph." value={everyMeal} onChange={setEveryMeal} />
      )}

      <View style={styles.btnRow}>
        <Pressable
          onPress={previewPdf}
          disabled={!!building}
          accessibilityRole="button"
          style={({ pressed }) => [styles.previewBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed || building ? 0.8 : 1 }]}
        >
          {building === "preview" ? <ActivityIndicator size="small" color={colors.text} /> : <Feather name="eye" size={17} color={colors.text} />}
          <Text style={[styles.previewText, { color: colors.text }]}>{building === "preview" ? "Building…" : "Preview"}</Text>
        </Pressable>
        <Pressable
          onPress={downloadPdf}
          disabled={!!building}
          accessibilityRole="button"
          style={({ pressed }) => [styles.bigBtn, { opacity: pressed || building ? 0.85 : 1 }]}
        >
          <BrandShade radius={16} />
          {building === "download" ? <ActivityIndicator color="#fff" size="small" /> : <Feather name="download" size={18} color="#fff" />}
          <Text style={styles.bigBtnTitle}>{building === "download" ? "Building…" : "Download PDF"}</Text>
        </Pressable>
      </View>
      {canUsePass && passStatus && <PassRow colors={colors} status={passStatus} patientName={patientName} onTurnOff={confirmTurnOffPass} />}
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        {noneChosen
          ? "Only the glucose overview is on. Tap a section above to add it."
          : "Preview shows every page first. Download lets you save it to Files or send it by email, text, or your patient portal (like MyChart)."}
      </Text>
    </View>
  );
}

type PassStatus = NonNullable<ReturnType<typeof useQuery<typeof api.portalTrial.passStatus>>>;

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Where the family's one-time Doctor Portal pass stands, with the way to turn it off. */
function PassRow({ colors, status, patientName, onTurnOff }: { colors: Palette; status: PassStatus; patientName: string; onTurnOff: () => void }) {
  const text =
    status.state === "ready"
      ? `Your PDF includes a one-time Doctor Portal code (${status.code}). A doctor can use it once to see ${patientName}'s data, view only, for 24 hours.`
      : status.state === "active"
        ? `A doctor is viewing ${patientName}'s data with your Doctor Portal code until ${fmtClock(status.expiresAt)}.`
        : status.state === "used"
          ? `A doctor used your one-time Doctor Portal code on ${new Date(status.usedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. New PDFs invite the doctor to the portal demo instead.`
          : status.state === "off"
            ? "The Doctor Portal code is off. New PDFs invite the doctor to the portal demo instead."
            : `Your first PDF will include a one-time Doctor Portal code, so the doctor can see ${patientName}'s data, view only, for 24 hours.`;
  const canTurnOff = status.state === "ready" || status.state === "active" || status.state === "none";
  return (
    <View style={[styles.passRow, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}>
      <Feather name="key" size={15} color={COLORS.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={[styles.passText, { color: colors.textSecondary }]}>{text}</Text>
        {canTurnOff && (
          <Pressable onPress={onTurnOff} accessibilityRole="button" hitSlop={6}>
            <Text style={[styles.passLink, { color: COLORS.danger }]}>Turn off the code</Text>
          </Pressable>
        )}
      </View>
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
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginTop: 6, marginLeft: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: "600" },
  btnRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  previewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1 },
  previewText: { fontSize: 15, fontWeight: "700" },
  bigBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 16, overflow: "hidden", backgroundColor: COLORS.primary },
  bigBtnTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  passRow: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  passText: { fontSize: 12.5, lineHeight: 18 },
  passLink: { fontSize: 13, fontWeight: "700" },
});
