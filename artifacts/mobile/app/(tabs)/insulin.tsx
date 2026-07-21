import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useTheme } from "@/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import {
  A1C_RANGES,
  DEFAULT_A1C_RANGE,
  a1cInsight,
  a1cLabel,
  estimateA1C,
  rangeCutoffMs,
  type A1cRange,
} from "@/utils/a1c";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import {
  availableDaysFromOldest,
  mergeWindowStats,
  statsFromEntries,
  windowChunks,
  type GlucoseWindowStats,
} from "@/utils/a1cRange";
import { glucoseColor } from "@/components/CGMChart";
import { computeDose } from "@/utils/dose";
import type { DoseBreakdown } from "@/utils/dose";
import { computeBasalDose } from "@/utils/basalDose";
import type { BasalDoseBreakdown } from "@/utils/basalDose";
import {
  doseAmountsEqual,
  filterDoseInputText,
  finalizeManualDoseInput,
  formatDoseAmount,
  roundToQuarterUnits,
} from "@/utils/doseOverride";
import { getEffectiveTrend } from "@/utils/trend";
import LogHistory from "@/components/LogHistory";
import TabGlucoseHeaderRow, { TabGlucoseHeaderShell } from "@/components/TabGlucoseHeaderRow";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { DoseRow, DoseWarningsList, EditableDoseTotalBadge } from "@/components/DoseCalculatorBits";
import InsulinTypePicker from "@/components/InsulinTypePicker";
import { computeActiveCarbs, computeActiveInsulin, formatAgeShort } from "@/utils/onBoard";
import {
  defaultInsulinChipLabel,
  findInsulinByChipLabel,
  insulinDisplayLabel,
  isBolusInsulin,
  type InsulinOption,
} from "@/constants/insulin";
import { DOSE_INSULIN_TYPE_STORAGE_KEY } from "@/constants/storage-keys";

const LOW_THRESH = 70;
const HIGH_THRESH = 180;
type ScreenTab = "predict" | "log";
// Estimated-A1C range type + range list + A1C calc/label/copy live in `@/utils/a1c` (pure, tested).

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { targetGlucose, carbRatio, correctionFactor, history, cgmSyncSuccessTick } = useGlucose();
  const { isMinor, alertPrefs, profile, account, foodLog, insulinLog, logInsulinDose, caregiverSession, doctorSession, isChildMode, accessCodeRole, accessCodePermissions } = useAuth();
  // A child/caregiver access-code session only sees the tabs its grants allow (dose calculator /
  // logging). Everyone else — owner, co-guardian, doctor, legacy caregiver code — sees both.
  const isAccessCodeSession = accessCodeRole != null;
  const canUseCalculator = !isAccessCodeSession || !!accessCodePermissions?.useCalculator;
  const canLog = !isAccessCodeSession || !!accessCodePermissions?.log;
  const availableTabs = [
    ...(canUseCalculator ? (["predict"] as ScreenTab[]) : []),
    ...(canLog ? (["log"] as ScreenTab[]) : []),
  ];

  const [screenTab, setScreenTab] = useState<ScreenTab>("predict");
  // The tab actually shown: fall back to the first allowed tab when the stored one isn't available
  // (e.g. calculator grant off → default to Log; log grant off → only Dose).
  const effectiveTab: ScreenTab = availableTabs.includes(screenTab) ? screenTab : (availableTabs[0] ?? "predict");
  const [timeRange, setTimeRange] = useState<A1cRange>(DEFAULT_A1C_RANGE);


  const [carbInput, setCarbInput] = useState("");
  const [bgInput, setBgInput] = useState("");
  const [bgManual, setBgManual] = useState(false);
  const [manualDoseOverride, setManualDoseOverride] = useState<number | null>(null);
  const [doseEditing, setDoseEditing] = useState(false);
  const [doseEditText, setDoseEditText] = useState("");
  const manualOverrideBeforeEditRef = useRef<number | null>(null);
  const doseInputRef = useRef<TextInput>(null);
  const cgmSyncTickRef = useRef(cgmSyncSuccessTick);

  // ── Insulin type selection (persisted; validated against the profile's configured insulins) ──
  const [insulinTypeLabel, setInsulinTypeLabel] = useState<string | null>(null);
  const [insulinTypeReady, setInsulinTypeReady] = useState(false);
  const [insulinModalVisible, setInsulinModalVisible] = useState(false);
  const [pendingInsulinLabel, setPendingInsulinLabel] = useState<string | null>(null);

  // ── "I just took this dose" — green until the next successful CGM sync ──
  const [doseLoggedAtTick, setDoseLoggedAtTick] = useState<number | null>(null);

  // ── "+1" fly-away badge on the header Log toggle ──
  const [plusOneActive, setPlusOneActive] = useState(false);
  const plusOneOpacity = useRef(new Animated.Value(0)).current;
  const plusOneShift = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(DOSE_INSULIN_TYPE_STORAGE_KEY);
        if (!cancelled && stored) setInsulinTypeLabel(stored);
      } catch {
        /* ignore */
      }
      if (!cancelled) setInsulinTypeReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the selection valid: it must be one of the profile's configured insulins, defaulting to
  // the first bolus-capable one — so the calculator always has a type when any are configured.
  useEffect(() => {
    if (!insulinTypeReady) return;
    const configured = profile?.insulinTypes ?? [];
    if (insulinTypeLabel && configured.includes(insulinTypeLabel)) return;
    setInsulinTypeLabel(defaultInsulinChipLabel(configured));
  }, [insulinTypeReady, profile?.insulinTypes, insulinTypeLabel]);

  const availableInsulinOptions = useMemo<InsulinOption[]>(
    () =>
      (profile?.insulinTypes ?? [])
        .map(findInsulinByChipLabel)
        .filter((o): o is InsulinOption => o != null),
    [profile?.insulinTypes],
  );

  const selectedInsulinOption = useMemo(
    () => (insulinTypeLabel ? findInsulinByChipLabel(insulinTypeLabel) : undefined),
    [insulinTypeLabel],
  );

  /** Basal mode — long/ultra-long/intermediate insulins swap the meal calculator for titration. */
  const isBasalMode = selectedInsulinOption != null && !isBolusInsulin(selectedInsulinOption.type);

  // Switching insulin types re-baselines the calculator: a manual override for one insulin must
  // not carry over to another (a 12u basal override is not a 12u bolus).
  const prevInsulinLabelRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevInsulinLabelRef.current !== insulinTypeLabel) {
      prevInsulinLabelRef.current = insulinTypeLabel;
      setManualDoseOverride(null);
      setDoseEditing(false);
    }
  }, [insulinTypeLabel]);

  // 30s tick: keeps the basal card's "Current Time" fresh AND re-decays insulin/carbs-on-board.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const currentTimeLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // ── Insulin/carbs-on-board from the logs (see utils/onBoard) — makes the calculator aware of
  // recent doses and meals so it nets them out instead of re-suggesting a full dose. ──
  const activeInsulin = useMemo(
    () => computeActiveInsulin(insulinLog ?? [], Date.now()),
    [insulinLog, clockTick],
  );
  const activeCarbs = useMemo(
    () => computeActiveCarbs(foodLog ?? [], Date.now()),
    [foodLog, clockTick],
  );

  /** Most recent logged basal dose — the titration baseline. Log is stored newest-first. */
  const lastBasalEntry = useMemo(() => {
    for (const e of insulinLog ?? []) {
      if (!e.insulinType) continue;
      const opt = findInsulinByChipLabel(e.insulinType);
      if (opt && !isBolusInsulin(opt.type)) return e;
    }
    return null;
  }, [insulinLog]);

  /** Early-morning (3–9 AM) readings over the last 3 days — the fasting titration signal. */
  const fastingReadings = useMemo(() => {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return history
      .filter((r) => {
        const t = new Date(r.timestamp);
        const h = t.getHours();
        return t.getTime() >= cutoff && h >= 3 && h < 9;
      })
      .map((r) => r.glucose);
  }, [history]);

  const basalDose = useMemo<BasalDoseBreakdown | null>(() => {
    if (!isBasalMode) return null;
    return computeBasalDose({
      weightLbs: profile?.weightLbs,
      lastBasalUnits: lastBasalEntry?.units,
      fastingReadings,
      targetBG: targetGlucose,
    });
  }, [isBasalMode, profile?.weightLbs, lastBasalEntry, fastingReadings, targetGlucose]);

  const commitInsulinTypeLabel = useCallback((label: string | null) => {
    setInsulinTypeLabel(label);
    if (label) AsyncStorage.setItem(DOSE_INSULIN_TYPE_STORAGE_KEY, label).catch(() => {});
    else AsyncStorage.removeItem(DOSE_INSULIN_TYPE_STORAGE_KEY).catch(() => {});
  }, []);

  const triggerLogPlusOne = useCallback(() => {
    plusOneOpacity.setValue(0);
    plusOneShift.setValue({ x: 0, y: 0 });
    setPlusOneActive(true);
    Animated.sequence([
      Animated.timing(plusOneOpacity, { toValue: 1, duration: 140, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.parallel([
        Animated.timing(plusOneOpacity, { toValue: 0, duration: 450, useNativeDriver: true }),
        Animated.timing(plusOneShift, {
          toValue: { x: 18, y: -26 },
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
    ]).start(({ finished }) => {
      if (finished) setPlusOneActive(false);
    });
  }, [plusOneOpacity, plusOneShift]);

  const latest = history[history.length - 1];

  /** Live CGM value when not in manual entry mode — avoids stale `bgInput` one frame behind `history`. */
  const doseBg = useMemo(() => {
    if (bgManual) {
      const v = parseFloat(bgInput);
      if (!isNaN(v) && v > 0) return { n: v, label: bgInput } as const;
      return null;
    }
    if (latest != null && latest.glucose > 0) {
      return { n: latest.glucose, label: String(latest.glucose) } as const;
    }
    return null;
  }, [bgManual, bgInput, latest?.glucose, latest?.timestamp]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const rangeReadings = useMemo(() => {
    const cutoff = rangeCutoffMs(timeRange, Date.now());
    return history.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }, [history, timeRange]);

  // ── On-demand A1C ranges: 1D is served from in-memory history (which only ever holds ~1 day);
  // longer ranges fetch aggregated stats from Convex ONLY when tapped, in ≤15-day chunks. Falls
  // back to local history when signed out, offline, or the backend doesn't have windowStats yet. ──
  const [remoteRangeStats, setRemoteRangeStats] = useState<GlucoseWindowStats | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const rangeStatsCacheRef = useRef<Map<string, GlucoseWindowStats>>(new Map());

  useEffect(() => {
    setRemoteRangeStats(null);
    const acc = account;
    if (timeRange === 1 || caregiverSession || !acc?.convexUserId) {
      setRangeLoading(false);
      return;
    }
    const cacheKey = `${timeRange}:${cgmSyncSuccessTick}`;
    const cached = rangeStatsCacheRef.current.get(cacheKey);
    if (cached) {
      setRemoteRangeStats(cached);
      setRangeLoading(false);
      return;
    }
    let cancelled = false;
    setRangeLoading(true);
    (async () => {
      try {
        const client = createConvexAuthClient();
        const userId = acc.convexUserId as Id<"users">;
        const parts = await Promise.all(
          windowChunks(timeRange, Date.now()).map((w) =>
            client.query(api.patientGlucose.windowStats, {
              userId,
              passwordHash: acc.passwordHash,
              startTimestamp: w.startTimestamp,
              endTimestamp: w.endTimestamp,
              lowThreshold: LOW_THRESH,
              highThreshold: HIGH_THRESH,
            }),
          ),
        );
        if (cancelled) return;
        const merged = mergeWindowStats(parts);
        rangeStatsCacheRef.current.set(cacheKey, merged);
        setRemoteRangeStats(merged);
      } catch {
        /* offline or backend without windowStats yet — local-history fallback below */
      } finally {
        if (!cancelled) setRangeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timeRange, caregiverSession, account?.convexUserId, account?.passwordHash, cgmSyncSuccessTick]);

  const rangeStats = useMemo(() => {
    const agg =
      timeRange !== 1 && remoteRangeStats != null
        ? remoteRangeStats
        : statsFromEntries(rangeReadings, LOW_THRESH, HIGH_THRESH);
    if (agg.count === 0) return null;
    const avg = Math.round(agg.sum / agg.count);
    const tir = Math.round(((agg.count - agg.lowCount - agg.highCount) / agg.count) * 100);
    const pctHigh = Math.round((agg.highCount / agg.count) * 100);
    const pctLow = Math.round((agg.lowCount / agg.count) * 100);
    const a1c = estimateA1C(avg);
    const windowStart = rangeCutoffMs(timeRange, Date.now());
    const foodInRange = (foodLog ?? []).filter((f) => new Date(f.timestamp).getTime() >= windowStart);
    const insulinInRange = (insulinLog ?? []).filter((i) => new Date(i.timestamp).getTime() >= windowStart);
    const totalDays = timeRange;
    const avgCarbs = foodInRange.length > 0 ? Math.round(foodInRange.reduce((s, f) => s + f.estimatedCarbs, 0) / totalDays) : 0;
    const avgInsulin = insulinInRange.length > 0 ? Math.round((insulinInRange.reduce((s, i) => s + i.units, 0) / totalDays) * 10) / 10 : 0;
    const availableDays = availableDaysFromOldest(agg.oldestTimestamp, Date.now(), timeRange);
    return { avg, tir, pctHigh, pctLow, a1c, avgCarbs, avgInsulin, availableDays };
  }, [timeRange, remoteRangeStats, rangeReadings, foodLog, insulinLog]);

  const hasCarbs = carbInput !== "" && parseFloat(carbInput) > 0;

  const dose = useMemo<DoseBreakdown | null>(() => {
    const carbs = carbInput === "" ? 0 : parseFloat(carbInput);
    if (!doseBg || isNaN(carbs) || carbs < 0) return null;
    const bg = doseBg.n;
    const trend = latest ? getEffectiveTrend(history).glucoseTrend : "stable";
    const prev = history.length >= 2 ? history[history.length - 2].glucose : undefined;
    return computeDose({
      carbs,
      currentBG: bg,
      targetBG: targetGlucose,
      carbRatio,
      correctionFactor,
      trend,
      previousBG: prev,
      insulinKind: selectedInsulinOption?.type,
      activeInsulinUnits: activeInsulin.totalUnits,
      activeCarbsGrams: activeCarbs.totalGrams,
    });
  }, [carbInput, doseBg, targetGlucose, carbRatio, correctionFactor, history, latest, selectedInsulinOption, activeInsulin, activeCarbs]);

  useEffect(() => {
    if (cgmSyncSuccessTick !== cgmSyncTickRef.current) {
      cgmSyncTickRef.current = cgmSyncSuccessTick;
      setManualDoseOverride(null);
      setDoseEditing(false);
      setDoseLoggedAtTick(null);
    }
  }, [cgmSyncSuccessTick]);

  const systemRecommendedDose = isBasalMode ? basalDose?.totalDose ?? 0 : dose?.totalDose ?? 0;
  const effectiveDose = manualDoseOverride ?? systemRecommendedDose;
  const doseJustLogged = doseLoggedAtTick !== null && doseLoggedAtTick === cgmSyncSuccessTick;

  const handleTookDose = useCallback(() => {
    if (doseJustLogged || effectiveDose <= 0) return;
    if (!isBasalMode && !dose) return;
    const wasManual =
      manualDoseOverride != null && !doseAmountsEqual(effectiveDose, systemRecommendedDose);
    logInsulinDose({
      timestamp: new Date().toISOString(),
      units: roundToQuarterUnits(effectiveDose),
      type: isBasalMode ? "basal" : "bolus",
      ...(insulinTypeLabel ? { insulinType: insulinTypeLabel } : {}),
      recommendedUnits: roundToQuarterUnits(systemRecommendedDose),
      manualOverride: wasManual,
    });
    setDoseLoggedAtTick(cgmSyncSuccessTick);
    triggerLogPlusOne();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [
    dose,
    isBasalMode,
    doseJustLogged,
    effectiveDose,
    manualDoseOverride,
    systemRecommendedDose,
    insulinTypeLabel,
    logInsulinDose,
    cgmSyncSuccessTick,
    triggerLogPlusOne,
  ]);

  const completeDoseEdit = useCallback(() => {
    if (!doseEditing) return;
    const finalized = finalizeManualDoseInput(doseEditText);
    if (finalized == null) {
      setManualDoseOverride(manualOverrideBeforeEditRef.current);
    } else if (finalized === systemRecommendedDose) {
      setManualDoseOverride(null);
    } else {
      setManualDoseOverride(finalized);
    }
    setDoseEditing(false);
    Keyboard.dismiss();
  }, [doseEditing, doseEditText, systemRecommendedDose]);

  const startDoseEdit = useCallback(() => {
    manualOverrideBeforeEditRef.current = manualDoseOverride;
    const current = manualDoseOverride ?? systemRecommendedDose;
    setDoseEditText(formatDoseAmount(current));
    setDoseEditing(true);
    requestAnimationFrame(() => {
      doseInputRef.current?.focus();
    });
  }, [manualDoseOverride, systemRecommendedDose]);

  function openChat(prompt: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/(tabs)/chat", params: { prompt } });
  }

  /** Shared by the bolus and basal action rows — identical logging behavior in both modes. */
  // Hidden when the access-code grant excludes logging: pressing it would be a no-op (logging is
  // gated server-side by the `log` grant), so don't show it rather than have a dead button.
  const tookDoseButton = canLog ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="I just took this dose"
      disabled={doseJustLogged || effectiveDose <= 0}
      style={({ pressed }) => [
        styles.tookDoseBtn,
        {
          backgroundColor: doseJustLogged ? COLORS.success : COLORS.primary,
          opacity: pressed ? 0.8 : effectiveDose <= 0 && !doseJustLogged ? 0.5 : 1,
        },
      ]}
      onPress={handleTookDose}
    >
      <Feather name={doseJustLogged ? "check-circle" : "check"} size={13} color="#fff" />
      <Text style={styles.tookDoseBtnText}>
        {doseJustLogged ? "Dose Logged" : "I Just Took This Dose"}
      </Text>
    </Pressable>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <TabGlucoseHeaderShell
        borderBottomColor={colors.border}
        style={[styles.screenHeader, { backgroundColor: colors.background }]}
      >
        <TabGlucoseHeaderRow
          left={
            <View style={[styles.screenToggle, { backgroundColor: colors.backgroundTertiary }]}>
              {availableTabs.map((t) => (
                <Pressable
                  key={t}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: effectiveTab === t }}
                  style={[
                    styles.screenToggleBtn,
                    effectiveTab === t && {
                      backgroundColor: colors.card,
                      shadowColor: "#000",
                      shadowOpacity: 0.08,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 1 },
                    },
                  ]}
                  onPress={() => {
                    setScreenTab(t);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.screenToggleText,
                      { color: effectiveTab === t ? COLORS.primary : colors.textSecondary },
                    ]}
                  >
                    {t === "predict" ? "💉 Dose" : "📋 Log"}
                  </Text>
                  {t === "log" && plusOneActive && (
                    <Animated.Text
                      pointerEvents="none"
                      style={[
                        styles.plusOneBadge,
                        {
                          opacity: plusOneOpacity,
                          transform: plusOneShift.getTranslateTransform(),
                        },
                      ]}
                    >
                      +1
                    </Animated.Text>
                  )}
                </Pressable>
              ))}
            </View>
          }
        />
      </TabGlucoseHeaderShell>

      {availableTabs.length === 0 ? (
        <View style={[styles.lockedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={26} color={colors.textMuted} />
          <Text style={[styles.lockedTitle, { color: colors.text }]}>Insulin isn't available</Text>
          <Text style={[styles.lockedSub, { color: colors.textSecondary }]}>
            Neither the dose calculator nor logging is turned on for you. Ask a parent to enable one.
          </Text>
        </View>
      ) : effectiveTab === "log" ? (
        <LogHistory
          colors={colors}
          restrictToDay={caregiverSession}
          insulinOptions={availableInsulinOptions}
          selectedInsulinLabel={insulinTypeLabel}
          onLogAdded={triggerLogPlusOne}
        />
      ) : (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => {
          if (doseEditing) doseInputRef.current?.blur();
        }}
      >

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Calculator
      </Text>

      <View style={[styles.doseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {isBasalMode ? (
          /* ── Basal mode: carbs/BG inputs don't apply — show time + live glucose instead ── */
          <View style={styles.doseInputRow}>
            <View style={styles.doseInputGroup}>
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Current Time</Text>
              <View style={[styles.basalInfoBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <Text style={[styles.basalInfoValue, { color: colors.text }]}>{currentTimeLabel}</Text>
              </View>
            </View>
            <View style={styles.doseInputDivider} />
            <View style={styles.doseInputGroup}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Current Glucose</Text>
                {latest && (
                  <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}>
                    <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                  </View>
                )}
              </View>
              <View style={[styles.basalInfoBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <Text style={[styles.basalInfoValue, { color: latest ? glucoseColor(latest.glucose) : colors.textMuted }]}>
                  {latest ? latest.glucose : "—"}
                </Text>
                <Text style={[styles.basalInfoUnit, { color: colors.textMuted }]}>mg/dL</Text>
              </View>
            </View>
          </View>
        ) : (
        <View style={styles.doseInputRow}>
          <View style={styles.doseInputGroup}>
            <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Carbs (g)</Text>
            <TextInput
              style={[styles.doseInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
              value={carbInput}
              onChangeText={(v) => setCarbInput(v.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.doseInputDivider} />
          <View style={styles.doseInputGroup}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Current BG</Text>
              {latest && !bgManual && (
                <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}>
                  <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <TextInput
                style={[styles.doseInput, { flex: 1, backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: bgManual ? COLORS.primary : colors.border }]}
                value={bgManual ? bgInput : doseBg?.label ?? ""}
                onChangeText={(v) => { setBgInput(v.replace(/[^0-9]/g, "")); setBgManual(true); }}
                keyboardType="numeric"
                placeholder="mg/dL"
                placeholderTextColor={colors.textMuted}
              />
              {bgManual && latest && (
                <Pressable
                  onPress={() => { setBgInput(String(latest.glucose)); setBgManual(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={{ padding: 4 }}
                >
                  <Feather name="refresh-cw" size={15} color={COLORS.primary} />
                </Pressable>
              )}
            </View>
          </View>
        </View>
        )}

        {/* ── Insulin type — tiny current-type readout + small picker button ── */}
        <View style={styles.insulinTypeRow}>
          <Text numberOfLines={1} style={[styles.insulinTypeCurrent, { color: colors.textMuted }]}>
            {selectedInsulinOption
              ? insulinDisplayLabel(selectedInsulinOption)
              : "No insulin type set"}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose insulin type"
            style={({ pressed }) => [
              styles.insulinTypeBtn,
              { backgroundColor: COLORS.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setPendingInsulinLabel(insulinTypeLabel);
              setInsulinModalVisible(true);
            }}
          >
            <Feather name="droplet" size={11} color="#fff" />
            <Text style={styles.insulinTypeBtnText}>Insulin Type</Text>
          </Pressable>
        </View>

        {!isBasalMode && dose && doseBg && (
          <>
            <DoseWarningsList warnings={dose.warnings} />

            <View style={[styles.doseBreakdown, { borderTopColor: colors.border }]}>
              {hasCarbs && (
                <DoseRow label="Carb Dose" sub={`${parseFloat(carbInput)}g ÷ ${carbRatio}g`} value={dose.carbInsulin} unit="u" colors={colors} />
              )}
              <DoseRow
                label="Correction"
                sub={dose.correctionSuppressed
                  ? "BG below target — suppressed"
                  : `(${doseBg.label} − ${targetGlucose}) ÷ ${correctionFactor}`}
                value={dose.correctionInsulin}
                unit="u"
                colors={colors}
                dimmed={dose.correctionSuppressed}
              />
              <DoseRow
                label="Trend Adj."
                sub={dose.trendLabel}
                value={dose.trendAdjustment}
                unit="u"
                colors={colors}
                signed
              />
              {dose.activeCarbInsulin > 0 && (
                <DoseRow
                  label="Active Carbs"
                  sub={`${activeCarbs.totalGrams}g still absorbing · logged ${formatAgeShort(activeCarbs.lastEntryAgeMin)}${activeCarbs.lastEntryAgeMin != null && activeCarbs.lastEntryAgeMin >= 1 ? " ago" : ""}`}
                  value={dose.activeCarbInsulin}
                  unit="u"
                  colors={colors}
                  signed
                />
              )}
              {dose.activeInsulinUnits > 0 && (
                <DoseRow
                  label="Active Insulin"
                  sub={`${
                    activeInsulin.doseCount > 1
                      ? `${activeInsulin.doseCount} recent doses`
                      : `${formatDoseAmount(activeInsulin.lastDoseUnits ?? 0)}u`
                  } · taken ${formatAgeShort(activeInsulin.lastDoseAgeMin)}${activeInsulin.lastDoseAgeMin != null && activeInsulin.lastDoseAgeMin >= 1 ? " ago" : ""}`}
                  value={-dose.activeInsulinUnits}
                  unit="u"
                  colors={colors}
                  signed
                />
              )}
            </View>

            <View style={[styles.doseTotalRow, { borderTopColor: colors.border }]}>
              <View style={styles.doseTotalLabelWrap}>
                <Text style={[styles.doseTotalLabel, { color: colors.textSecondary }]}>
                  {isMinor
                    ? "Ask your adult to give:"
                    : hasCarbs
                    ? `Insulin to give (with ${carbInput}g carbs)`
                    : "Insulin to give (no carbs)"}
                </Text>
                {dose.totalRaw !== dose.totalDose && (
                  <Text style={[styles.doseRoundNote, { color: colors.textMuted }]}>
                    Raw {dose.totalRaw}u → rounded to nearest ½
                  </Text>
                )}
              </View>
              <EditableDoseTotalBadge
                effectiveDose={effectiveDose}
                systemRecommendedDose={systemRecommendedDose}
                manualOverrideActive={manualDoseOverride != null}
                editing={doseEditing}
                editText={doseEditText}
                inputRef={doseInputRef}
                colors={colors}
                onStartEdit={startDoseEdit}
                onChangeEditText={(t) => setDoseEditText(filterDoseInputText(t))}
                onCompleteEdit={completeDoseEdit}
              />
            </View>

            <View style={styles.doseActionsRow}>
              <Pressable
                style={({ pressed }) => [styles.explainBtn, { flex: 1, backgroundColor: COLORS.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const name = profile?.childName ?? "them";
                  const manualNote =
                    manualDoseOverride != null
                      ? ` I manually set my dose display to ${formatDoseAmount(manualDoseOverride)}u (temporary override). The system recommendation is ${formatDoseAmount(dose.totalDose)}u.`
                      : "";
                  const insulinNote = selectedInsulinOption
                    ? ` Insulin type: ${insulinDisplayLabel(selectedInsulinOption)}.`
                    : "";
                  const prompt = hasCarbs
                    ? `Explain my insulin dose. Current BG: ${doseBg.label} mg/dL, eating ${carbInput}g carbs. Carb ratio 1:${carbRatio}, target BG ${targetGlucose}, ISF 1:${correctionFactor}. Trend: ${dose.trendLabel}. Carb dose: ${dose.carbInsulin}u, correction: ${dose.correctionInsulin}u, trend adj: ${dose.trendAdjustment}u. System recommended total: ${dose.totalDose}u.${insulinNote}${manualNote}`
                    : `${name}'s BG is ${doseBg.label} mg/dL with no carbs. Correction only: (${doseBg.label}−${targetGlucose})÷${correctionFactor} = ${dose.correctionInsulin}u, system recommended total ${dose.totalDose}u.${insulinNote}${manualNote} Is this right?`;
                  openChat(prompt);
                }}
              >
                <Feather name="help-circle" size={13} color={COLORS.primary} />
                <Text style={[styles.explainBtnText, { color: COLORS.primary }]}>Explain My Dose</Text>
              </Pressable>
              {tookDoseButton}
            </View>
          </>
        )}

        {!isBasalMode && !dose && (
          <Text style={[styles.dosePrompt, { color: colors.textMuted }]}>
            {isMinor
              ? "Enter how many carbs you're eating above and I'll help figure out your dose 🍎"
              : "Enter a blood sugar reading to see the correction dose, then add carbs to include a meal dose."}
          </Text>
        )}

        {/* ── Basal mode: titration breakdown (baseline + fasting adjustment) ── */}
        {isBasalMode && basalDose && (
          <>
            <DoseWarningsList warnings={basalDose.warnings} />

            <View style={[styles.doseBreakdown, { borderTopColor: colors.border }]}>
              <DoseRow
                label="Baseline"
                sub={
                  basalDose.baselineSource === "lastDose"
                    ? "Your last logged basal dose"
                    : basalDose.baselineSource === "weight"
                    ? `0.2 u/kg × ${Math.round((profile?.weightLbs ?? 0) * 0.45359237)} kg — starting estimate`
                    : "No basal history or weight set"
                }
                value={basalDose.baselineUnits ?? 0}
                unit="u"
                colors={colors}
                dimmed={basalDose.baselineUnits == null}
              />
              <DoseRow
                label="Fasting Adj."
                sub={
                  basalDose.fastingAvg != null
                    ? `3-day fasting avg ${basalDose.fastingAvg} mg/dL`
                    : basalDose.baselineSource === "lastDose"
                    ? "Not enough morning readings"
                    : "Applies once you log a basal dose"
                }
                value={basalDose.fastingAdjustment}
                unit="u"
                colors={colors}
                signed
                dimmed={basalDose.baselineSource !== "lastDose"}
              />
            </View>

            <View style={[styles.doseTotalRow, { borderTopColor: colors.border }]}>
              <View style={styles.doseTotalLabelWrap}>
                <Text style={[styles.doseTotalLabel, { color: colors.textSecondary }]}>
                  {basalDose.baselineUnits == null
                    ? "Basal dose — enter your prescribed amount"
                    : isMinor
                    ? "Ask your adult about this basal dose:"
                    : "Suggested basal dose"}
                </Text>
              </View>
              <EditableDoseTotalBadge
                effectiveDose={effectiveDose}
                systemRecommendedDose={systemRecommendedDose}
                manualOverrideActive={manualDoseOverride != null}
                editing={doseEditing}
                editText={doseEditText}
                inputRef={doseInputRef}
                colors={colors}
                onStartEdit={startDoseEdit}
                onChangeEditText={(t) => setDoseEditText(filterDoseInputText(t))}
                onCompleteEdit={completeDoseEdit}
              />
            </View>

            <View style={styles.doseActionsRow}>
              <Pressable
                style={({ pressed }) => [styles.explainBtn, { flex: 1, backgroundColor: COLORS.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const manualNote =
                    manualDoseOverride != null
                      ? ` I manually set the dose display to ${formatDoseAmount(manualDoseOverride)}u. The suggestion is ${formatDoseAmount(basalDose.totalDose)}u.`
                      : "";
                  const baselineDesc =
                    basalDose.baselineSource === "lastDose"
                      ? `my last logged basal dose (${formatDoseAmount(basalDose.baselineUnits ?? 0)}u)`
                      : basalDose.baselineSource === "weight"
                      ? `a starting estimate from my weight (${formatDoseAmount(basalDose.baselineUnits ?? 0)}u at 0.2 u/kg/day)`
                      : "none — I haven't logged a basal dose or set my weight";
                  const fastingDesc =
                    basalDose.fastingAvg != null
                      ? `${basalDose.fastingAvg} mg/dL (target ${targetGlucose})`
                      : "not enough early-morning readings";
                  const prompt = `Explain my basal insulin dose. I use ${selectedInsulinOption ? insulinDisplayLabel(selectedInsulinOption) : "a long-acting insulin"}. Baseline: ${baselineDesc}. 3-day fasting average: ${fastingDesc}. Fasting adjustment: ${basalDose.fastingAdjustment}u. Suggested dose: ${formatDoseAmount(basalDose.totalDose)}u.${manualNote} How does basal titration work, and when should I take it?`;
                  openChat(prompt);
                }}
              >
                <Feather name="help-circle" size={13} color={COLORS.primary} />
                <Text style={[styles.explainBtnText, { color: COLORS.primary }]}>Explain My Dose</Text>
              </Pressable>
              {tookDoseButton}
            </View>
          </>
        )}
      </View>

      {/* ── Time Range Selector — hidden for caregivers ── */}
      {!caregiverSession && (
        <View style={[styles.rangeRow]}>
          {A1C_RANGES.map((r) => (
            <Pressable
              key={r}
              style={[styles.rangeBtn, { backgroundColor: timeRange === r ? COLORS.primary : colors.backgroundTertiary }]}
              onPress={() => setTimeRange(r)}
            >
              <Text style={[styles.rangeBtnText, { color: timeRange === r ? "#fff" : colors.textSecondary }]}>
                {r}D
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* ── A1C Estimation Card — hidden for caregivers ── */}
      {!caregiverSession && rangeStats ? (
        <View style={[styles.a1cCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.a1cTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.a1cLabel, { color: colors.textSecondary }]}>
                Estimated A1C · {timeRange}-day avg
              </Text>
              {rangeLoading ? (
                <View style={[styles.a1cValueRow, { paddingVertical: 12 }]}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={[styles.a1cLoadingText, { color: colors.textMuted }]}>
                    Loading {timeRange} days of readings…
                  </Text>
                </View>
              ) : (
                <View style={styles.a1cValueRow}>
                  <Text style={[styles.a1cValue, { color: a1cLabel(rangeStats.a1c).color }]}>
                    {rangeStats.a1c}%
                  </Text>
                  <View style={[styles.a1cBadge, { backgroundColor: a1cLabel(rangeStats.a1c).color + "20" }]}>
                    <Text style={[styles.a1cBadgeText, { color: a1cLabel(rangeStats.a1c).color }]}>
                      {a1cLabel(rangeStats.a1c).emoji} {a1cLabel(rangeStats.a1c).label}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.a1cStatsRow, { borderTopColor: colors.border, opacity: rangeLoading ? 0.4 : 1 }]}>
            <A1CStat label="Time in Range" value={`${rangeStats.tir}%`} color={rangeStats.tir >= 70 ? COLORS.success : COLORS.warning} />
            <View style={[styles.a1cDivider, { backgroundColor: colors.border }]} />
            <A1CStat label="% High" value={`${rangeStats.pctHigh}%`} color={rangeStats.pctHigh > 25 ? COLORS.warning : COLORS.success} />
            <View style={[styles.a1cDivider, { backgroundColor: colors.border }]} />
            <A1CStat label="% Low" value={`${rangeStats.pctLow}%`} color={rangeStats.pctLow > 5 ? COLORS.danger : COLORS.success} />
            <View style={[styles.a1cDivider, { backgroundColor: colors.border }]} />
            <A1CStat label="Avg Carbs/day" value={`${rangeStats.avgCarbs}g`} color={COLORS.accent} />
          </View>

          {!rangeLoading && rangeStats.availableDays > 0 && rangeStats.availableDays < timeRange && (
            <View style={styles.a1cCoverageNote}>
              <Feather name="info" size={12} color={COLORS.warning} />
              <Text style={[styles.a1cCoverageText, { color: COLORS.warning }]}>
                Only {rangeStats.availableDays} {rangeStats.availableDays === 1 ? "day" : "days"} of
                readings {rangeStats.availableDays === 1 ? "is" : "are"} available
              </Text>
            </View>
          )}

          <View style={[styles.a1cInsightBox, { backgroundColor: colors.backgroundTertiary, opacity: rangeLoading ? 0.4 : 1 }]}>
            <Feather name="zap" size={13} color={COLORS.primary} />
            <Text style={[styles.a1cInsightText, { color: colors.textSecondary }]}>
              {a1cInsight(rangeStats.avg, timeRange)}
            </Text>
          </View>
        </View>
      ) : !caregiverSession ? (
        <View style={[styles.a1cCard, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 20 }]}>
          <Text style={{ fontSize: 28 }}>📊</Text>
          <Text style={[styles.a1cLabel, { color: colors.textSecondary, textAlign: "center", marginTop: 6 }]}>
            No glucose data for this period. Sync your CGM to see A1C estimates.
          </Text>
        </View>
      ) : null}

      {history.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No readings yet</Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            {isMinor
              ? "Sync your CGM or add a reading from the Glucose tab to see your trends here!"
              : "Sync your CGM or add readings from the Glucose tab to see trend analysis."}
          </Text>
        </View>
      )}

      <View style={[styles.disclaimer, { backgroundColor: colors.backgroundTertiary }]}>
        <Feather name="info" size={14} color={colors.textMuted} />
        <Text style={[styles.disclaimerText, { color: colors.textMuted }]}>
          This app provides estimates only and does not replace medical advice. Always follow your doctor's instructions.
        </Text>
      </View>
    </ScrollView>
      )}

      {/* ── Insulin type picker popup ── */}
      <DashboardSectionModal
        visible={insulinModalVisible}
        onClose={() => setInsulinModalVisible(false)}
        accessibilityLabel="Insulin type selection"
      >
        <View style={[styles.insulinModalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.insulinModalTitle, { color: colors.text }]}>Insulin Type</Text>
          <Text style={[styles.insulinModalSub, { color: colors.textSecondary }]}>
            Choose which of your insulins this dose uses. The calculator adjusts for how it acts.
          </Text>
          <InsulinTypePicker
            options={availableInsulinOptions}
            selectedLabel={pendingInsulinLabel}
            onSelect={setPendingInsulinLabel}
            colors={colors}
          />
          <View style={styles.insulinModalFooter}>
            <Pressable
              accessibilityRole="button"
              disabled={!pendingInsulinLabel}
              style={({ pressed }) => [
                styles.insulinApplyBtn,
                {
                  backgroundColor: pendingInsulinLabel ? COLORS.primary : colors.backgroundTertiary,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              onPress={() => {
                if (!pendingInsulinLabel) return;
                commitInsulinTypeLabel(pendingInsulinLabel);
                setInsulinModalVisible(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
            >
              <Text style={[styles.insulinApplyBtnText, { color: pendingInsulinLabel ? "#fff" : colors.textMuted }]}>
                Apply
              </Text>
            </Pressable>
          </View>
        </View>
      </DashboardSectionModal>
    </View>
  );
}

function A1CStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
      <Text style={[styles.a1cStatValue, { color }]}>{value}</Text>
      <Text style={styles.a1cStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 10 },

  screenHeader: { paddingBottom: 12, borderBottomWidth: 1 },
  screenToggle: {
    flexDirection: "row",
    flexShrink: 1,
    minWidth: 0,
    alignSelf: "stretch",
    borderRadius: 12,
    padding: 2,
    gap: 2,
  },
  screenToggleBtn: {
    flex: 1,
    minWidth: 0,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  screenToggleText: { fontSize: 13, fontWeight: "600", textAlign: "center" },

  rangeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  rangeBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
  rangeBtnText: { fontSize: 13, fontWeight: "700" },

  a1cCard: { borderRadius: 18, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  a1cTop: { padding: 16 },
  a1cLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  a1cValueRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  a1cValue: { fontSize: 42, fontWeight: "700" },
  a1cBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  a1cBadgeText: { fontSize: 13, fontWeight: "700" },
  a1cStatsRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, padding: 14 },
  a1cDivider: { width: 1, height: 36, marginHorizontal: 2 },
  a1cStatValue: { fontSize: 16, fontWeight: "700" },
  a1cStatLabel: { fontSize: 9, fontWeight: "500", color: "#888", textAlign: "center" },
  a1cInsightBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, margin: 12, marginTop: 0, borderRadius: 10 },
  a1cInsightText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 18 },
  a1cLoadingText: { fontSize: 12, fontWeight: "500" },
  a1cCoverageNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 10, marginTop: -2 },
  a1cCoverageText: { fontSize: 11, fontWeight: "600" },




  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 10 },
  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, marginTop: 4 },
  disclaimerText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 18 },


  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10, marginTop: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 14, fontWeight: "400", textAlign: "center", lineHeight: 20 },

  doseCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20, gap: 14 },
  doseInputRow: { flexDirection: "row", gap: 12 },
  doseInputGroup: { flex: 1, gap: 6 },
  doseInputLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  doseInput: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 20, fontWeight: "700", textAlign: "center" },
  doseInputDivider: { width: 1, backgroundColor: "rgba(128,128,128,0.15)", marginVertical: 4 },
  liveTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  liveTagText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },

  doseBreakdown: { borderTopWidth: 1, paddingTop: 12, gap: 10 },

  doseTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 14, gap: 10 },
  /** Lets long labels wrap instead of shoving the units badge off-screen. */
  doseTotalLabelWrap: { flex: 1, minWidth: 0 },
  doseTotalLabel: { fontSize: 13, fontWeight: "600", marginBottom: 3 },
  doseRoundNote: { fontSize: 11, fontWeight: "400" },

  explainBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 11 },
  explainBtnText: { fontSize: 13, fontWeight: "600" },
  dosePrompt: { fontSize: 13, fontWeight: "400", lineHeight: 20, textAlign: "center", paddingVertical: 8 },
  lockedCard: { margin: 20, borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10 },
  lockedTitle: { fontSize: 17, fontWeight: "700" },
  lockedSub: { fontSize: 13, fontWeight: "400", textAlign: "center", lineHeight: 19 },

  basalInfoBox: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  basalInfoValue: { fontSize: 20, fontWeight: "700", textAlign: "center" },
  basalInfoUnit: { fontSize: 11, fontWeight: "500" },

  insulinTypeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  insulinTypeCurrent: { flex: 1, minWidth: 0, fontSize: 11, fontWeight: "500" },
  insulinTypeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  insulinTypeBtnText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  doseActionsRow: { flexDirection: "row", gap: 8 },
  tookDoseBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 11,
  },
  tookDoseBtnText: { fontSize: 12, fontWeight: "700", color: "#fff", textAlign: "center" },

  plusOneBadge: {
    position: "absolute",
    right: 4,
    top: 7,
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.success,
  },

  insulinModalCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  insulinModalTitle: { fontSize: 18, fontWeight: "700" },
  insulinModalSub: { fontSize: 12, fontWeight: "400", lineHeight: 17, marginTop: -6 },
  insulinModalFooter: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 },
  insulinApplyBtn: { paddingHorizontal: 22, paddingVertical: 10, borderRadius: 10 },
  insulinApplyBtnText: { fontSize: 14, fontWeight: "700" },
});
