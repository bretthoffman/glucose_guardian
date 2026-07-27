import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { T, withAlpha } from "@/constants/theme";
import { doseCardExplanation, type DoseCardKey } from "@/utils/doseExplain";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { glucoseColor } from "@/components/CGMChart";
import { computeDose } from "@/utils/dose";
import { effectiveDoseSettings } from "@/utils/doseSettings";
import { computePatternTuning, patternFactorForNow } from "@/utils/doseTuning";
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
import DosePredictionChart from "@/components/DosePredictionChart";
import { runPrediction, type PredictionResult, type StrengthLabel } from "@/utils/predictionClient";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
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
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";

type ScreenTab = "predict" | "log";

// Accent hues for the calculator's operation cards. Literal hex (like the app's other accents) so
// the same hue reads correctly in both light and dark; the card background/border are theme-tinted.
const CARD_BLUE = "#3B82F6";
const CARD_PURPLE = "#8B5CF6";

// Enable smooth grow/shrink of the suggested-dose window on Android when the toggles reveal content.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type OpCardDef = {
  key: DoseCardKey;
  label: string;
  color: string;
  value: number;
  /** Third row: the live input feeding this piece, e.g. "241 mg/dL", "20 g", "2.1 u". */
  sub: string;
  icon: React.ComponentProps<typeof Feather>["name"];
};

/** Signed unit value for a card, e.g. "4.88 u", "0 u", "-2.96 u". */
function fmtU(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r === 0 ? 0 : r} u`;
}

/** One tappable colored operation card in the "How your dose is calculated" row. */
function OpCard({
  def, selected, onPress, colors, scale = 1,
}: {
  def: OpCardDef;
  selected: boolean;
  onPress: () => void;
  colors: (typeof Colors)["light"];
  /** iPad: contents render ~50% larger; positions and the window itself stay put. */
  scale?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${def.label} ${fmtU(def.value)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.opCard,
        {
          // The unified window (calcUnified) carries the single purple outline; each piece is
          // borderless and identified by its color through the tinted label/value text. Selection
          // shows as a soft pill tint of the piece's own color.
          backgroundColor: selected ? withAlpha(def.color, 0.14) : "transparent",
          opacity: pressed ? 0.85 : 1,
          gap: 5 * scale,
        },
      ]}
    >
      {/* Title in the same muted grey as the section header; only the VALUE carries the piece's
          color. The third row shows the live input feeding this piece. */}
      <Text style={[styles.opLabel, { color: colors.textSecondary, fontSize: 9.5 * scale, lineHeight: 12 * scale }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{def.label}</Text>
      <Text style={[styles.opValue, { color: def.color, fontSize: 15 * scale }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {fmtU(def.value)}
      </Text>
      <Text style={[styles.opSub, { color: colors.textSecondary, fontSize: 9.5 * scale, lineHeight: 12 * scale }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {def.sub}
      </Text>
    </Pressable>
  );
}

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  // iPad: the calc-window contents (labels, values, operators, breakdown text) render ~50% larger.
  const calcScale = Platform.OS === "ios" && (Platform as unknown as { isPad?: boolean }).isPad === true ? 1.5 : 1;
  const { targetGlucose, carbRatio, correctionFactor, doseSettingsByTime, history, cgmSyncSuccessTick } = useGlucose();
  const { isMinor, alertPrefs, profile, account, foodLog, insulinLog, logInsulinDose, caregiverSession, doctorSession, isChildMode, accessCodeRole, accessCodePermissions, messagingIdentity } = useAuth();
  const confirmLog = useCareLogConfirm();
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


  const [carbInput, setCarbInput] = useState("");
  const [bgInput, setBgInput] = useState("");
  const [bgManual, setBgManual] = useState(false);
  // ── Deferred input commit ──────────────────────────────────────────────────────────────────
  // `carbInput` / `bgInput` hold the COMMITTED values — they're what feed `dose`/`doseBg` (and, in
  // Phase 2, the prediction graph). While a field is being typed in, the keystrokes live in a
  // separate draft (null = "not editing this field; show the committed value"). The draft is pushed
  // into the committed value only when the user leaves the field — on blur, when the other field is
  // focused, when the dose editor opens, or when the page is scrolled — never on each keystroke. A
  // ref mirrors each draft so the blur/focus handlers always read the latest text.
  const [carbDraft, setCarbDraft] = useState<string | null>(null);
  const [bgDraft, setBgDraft] = useState<string | null>(null);
  const carbDraftRef = useRef<string | null>(null);
  const bgDraftRef = useRef<string | null>(null);
  const [manualDoseOverride, setManualDoseOverride] = useState<number | null>(null);
  const [doseEditing, setDoseEditing] = useState(false);
  const [doseEditText, setDoseEditText] = useState("");
  const manualOverrideBeforeEditRef = useRef<number | null>(null);
  const doseInputRef = useRef<TextInput>(null);
  const cgmSyncTickRef = useRef(cgmSyncSuccessTick);
  // Scroll to the page bottom after a toggle/card reveals content downward, so it comes into view.
  const scrollRef = useRef<ScrollView>(null);
  const pendingScrollRef = useRef(false);

  // ── Insulin type selection (persisted; validated against the profile's configured insulins) ──
  const [insulinTypeLabel, setInsulinTypeLabel] = useState<string | null>(null);
  const [insulinTypeReady, setInsulinTypeReady] = useState(false);
  const [insulinModalVisible, setInsulinModalVisible] = useState(false);
  const [pendingInsulinLabel, setPendingInsulinLabel] = useState<string | null>(null);
  // Which colored operation card is expanded in "Your Dose Breakdown" (null = collapsed by default).
  const [expandedCard, setExpandedCard] = useState<DoseCardKey | null>(null);
  // Prediction graph is revealed on demand by the "See Prediction" toggle.

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
  // Stable "now" for the prediction chart — advances on the 30s tick, not on every render.
  const nowMs = useMemo(() => Date.now(), [clockTick]);

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

  // ── Time-of-day effective settings: a per-meal override (when the family set one) wins over the
  // base carb ratio / ISF. Keyed on the latest reading so the bucket rolls over as readings land. ──
  const effSettings = useMemo(
    () => effectiveDoseSettings(carbRatio, correctionFactor, doseSettingsByTime, new Date()),
    [carbRatio, correctionFactor, doseSettingsByTime, latest?.timestamp],
  );

  // ── Glucose movement over the last ~45 min — the IOB-effectiveness input: high + not falling
  // despite active insulin means that insulin is provably not landing. ──
  const bgDelta45Min = useMemo(() => {
    if (!latest) return undefined;
    const nowT = new Date(latest.timestamp).getTime();
    let best: { deltaFromTarget: number; glucose: number } | null = null;
    for (const r of history) {
      const age = (nowT - new Date(r.timestamp).getTime()) / 60_000;
      if (age < 35 || age > 60) continue;
      const d = Math.abs(age - 45);
      if (best == null || d < best.deltaFromTarget) best = { deltaFromTarget: d, glucose: r.glucose };
    }
    return best ? latest.glucose - best.glucose : undefined;
  }, [history, latest]);

  // ── Pattern tuning: bounded, visible multiplier from two weeks of given-vs-recommended doses in
  // this time-of-day bucket. Settings are never changed by this. ──
  const bucketTuning = useMemo(() => {
    const tuning = computePatternTuning(insulinLog ?? [], Date.now());
    return patternFactorForNow(tuning, new Date());
  }, [insulinLog, latest?.timestamp]);

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
      carbRatio: effSettings.carbRatio,
      correctionFactor: effSettings.correctionFactor,
      trend,
      previousBG: prev,
      insulinKind: selectedInsulinOption?.type,
      activeInsulinUnits: activeInsulin.totalUnits,
      activeCarbsGrams: activeCarbs.totalGrams,
      bgDelta45Min,
      weightLbs: profile?.weightLbs,
      patternFactor: bucketTuning.factor,
    });
  }, [carbInput, doseBg, targetGlucose, effSettings, history, latest, selectedInsulinOption, activeInsulin, activeCarbs, bgDelta45Min, profile?.weightLbs, bucketTuning]);

  // ── The colored "operation" cards for the calculator. Correct BG shows the full correction
  // (base + resistance + trend) BEFORE the active-insulin credit; Active Insulin shows the credit
  // actually subtracted; Active Carbs shows the UNCOVERED portion added — so the four cards sum
  // exactly to the subtotal the Dose card explains (see doseExplain). ──
  const opCards: OpCardDef[] = useMemo(() => {
    if (!dose) return [];
    const carbsNum = parseFloat(carbInput) || 0;
    return [
      { key: "correction", label: "Correct BG", color: CARD_BLUE, value: dose.correctionInsulin + dose.resistanceBump + dose.trendAdjustment, sub: doseBg ? `${doseBg.label} mg/dL` : "—", icon: "trending-up" },
      { key: "carb", label: "Carb Dose", color: COLORS.success, value: dose.carbInsulin, sub: `${carbsNum} g`, icon: "coffee" },
      { key: "activeCarbs", label: "Active Carbs", color: COLORS.warning, value: dose.uncoveredCarbInsulin, sub: `${activeCarbs.totalGrams} g`, icon: "clock" },
      { key: "activeInsulin", label: "Active Insulin", color: CARD_PURPLE, value: -dose.iobCredit, sub: fmtU(dose.activeInsulinUnits), icon: "droplet" },
    ];
  }, [dose, doseBg, carbInput, activeCarbs]);

  const explainInput = useMemo(() => ({
    bg: doseBg?.n ?? 0,
    target: targetGlucose,
    correctionFactor: effSettings.correctionFactor,
    carbRatio: effSettings.carbRatio,
    carbs: parseFloat(carbInput) || 0,
    correctionInsulin: dose?.correctionInsulin ?? 0,
    resistanceBump: dose?.resistanceBump ?? 0,
    trendAdjustment: dose?.trendAdjustment ?? 0,
    trendLabel: dose?.trendLabel ?? "",
    hyperTrendZeroed: dose?.hyperTrendZeroed ?? false,
    correctionSuppressed: dose?.correctionSuppressed ?? false,
    carbInsulin: dose?.carbInsulin ?? 0,
    settingsBucket: effSettings.bucket,
    settingsFromOverride: effSettings.usedOverride,
    activeCarbGrams: activeCarbs.totalGrams,
    activeCarbInsulin: dose?.activeCarbInsulin ?? 0,
    activeCarbAgeMin: activeCarbs.lastEntryAgeMin,
    uncoveredCarbInsulin: dose?.uncoveredCarbInsulin ?? 0,
    activeInsulinUnits: dose?.activeInsulinUnits ?? 0,
    activeInsulinDoseCount: activeInsulin.doseCount,
    activeInsulinAgeMin: activeInsulin.lastDoseAgeMin,
    iobCredit: dose?.iobCredit ?? 0,
    iobDiscounted: dose?.iobDiscounted ?? false,
    correctionApplied: dose?.correctionApplied ?? 0,
    subTotal: dose?.subTotal ?? 0,
    patternFactor: dose?.patternFactor ?? 1,
    patternDelta: dose?.patternDelta ?? 0,
    maxDoseCap: dose?.maxDoseCap ?? 10,
    cappedAtMax: dose?.cappedAtMax ?? false,
    totalRaw: dose?.totalRaw ?? 0,
    totalDose: dose?.totalDose ?? 0,
  }), [doseBg, targetGlucose, effSettings, carbInput, dose, activeCarbs, activeInsulin]);

  const OP_SYMBOLS = ["+", "+", "−"];

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

  // ── Prediction chart (bolus only): the top-3 REAL past episodes matching this situation, drawn
  // directly — no AI call. Always on: it runs by itself on open, whenever a committed input changes
  // (typed edits lock in on done/tap-off), and whenever a fresh reading shifts the calculator.
  // Estimate-only — never feeds the calculator. ──
  const [predicting, setPredicting] = useState(false);
  const [drawing, setDrawing] = useState(false); // graph is still animating in
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predictedInputs, setPredictedInputs] = useState<{ bg: number; carbs: string; dose: number } | null>(null);
  const predictRunRef = useRef(0);
  // The run whose intro animation has COMPLETED — a tab flip remounts the chart for the same run,
  // which must render fully drawn instead of replaying the animation.
  const introDoneRunRef = useRef(0);

  const runPredict = useCallback(async () => {
    if (isBasalMode || !doseBg || effectiveDose <= 0) return;
    const runId = ++predictRunRef.current;
    // Clear the old graph immediately so the "Building your prediction" state shows while the
    // matcher works (the stale curve must not linger while fresh matches are en route).
    setPrediction(null);
    setDrawing(false);
    setPredicting(true);
    const submitted = { bg: doseBg.n, carbs: carbInput, dose: roundToQuarterUnits(effectiveDose) };
    const result = await runPrediction({
      identity: messagingIdentity,
      currentBG: doseBg.n,
      doseUnits: effectiveDose,
      carbsGrams: parseFloat(carbInput) || 0,
      nowMs: Date.now(),
      history,
    });
    if (predictRunRef.current !== runId) return; // a newer run superseded this one
    setPrediction(result);
    setPredicting(false);
    if (result.ok) {
      setPredictedInputs(submitted);
      setDrawing(true); // spinner on the button until the graph finishes drawing (onDrawComplete)
      // Safety net in case the draw is interrupted (navigation) and the completion never fires.
      setTimeout(() => {
        if (predictRunRef.current === runId) setDrawing(false);
      }, 6000);
    }
  }, [isBasalMode, doseBg, effectiveDose, messagingIdentity, carbInput, history]);

  // The result is stale once the submitted tuple (BG, carbs, or dose) no longer matches what was
  // last matched against — committed manual edits and self-updating readings both land here. Only
  // an OK result can be stale: after a failed fetch we wait for Predict Again (no retry loop).
  const predictionStale =
    prediction?.ok === true &&
    predictedInputs != null &&
    (predictedInputs.bg !== (doseBg?.n ?? null) ||
      predictedInputs.carbs !== carbInput ||
      predictedInputs.dose !== roundToQuarterUnits(effectiveDose));

  // ── Auto-predict: first run when the calculator becomes ready, then a debounced re-run whenever
  // the inputs actually change. The debounce coalesces cascades (a new reading shifts BG, dose, and
  // IOB in one burst) into a single rebuild. ──
  const runPredictRef = useRef(runPredict);
  useEffect(() => {
    runPredictRef.current = runPredict;
  }, [runPredict]);
  const canPredict = !isBasalMode && !!doseBg && effectiveDose > 0;
  useEffect(() => {
    if (!canPredict) return;
    if (prediction === null && !predicting) {
      const id = setTimeout(() => runPredictRef.current(), 150);
      return () => clearTimeout(id);
    }
    if (predictionStale && !predicting) {
      const id = setTimeout(() => runPredictRef.current(), 400);
      return () => clearTimeout(id);
    }
  }, [canPredict, prediction, predicting, predictionStale]);

  // Manual "Predict Again": always available (except mid-fetch) — pulls fresh matches on demand.
  const predictDisabled = effectiveDose <= 0 || predicting;

  // Push a field's in-progress draft into its committed value. No-op when the field isn't being
  // edited, so it's safe to call defensively from anywhere.
  const commitCarb = useCallback(() => {
    const d = carbDraftRef.current;
    if (d == null) return;
    carbDraftRef.current = null;
    setCarbDraft(null);
    setCarbInput(d);
  }, []);

  const commitBg = useCallback(() => {
    const d = bgDraftRef.current;
    if (d == null) return;
    bgDraftRef.current = null;
    setBgDraft(null);
    if (d.trim() === "") {
      setBgManual(false); // cleared the field → fall back to the live CGM value
    } else {
      setBgInput(d);
      setBgManual(true);
    }
  }, []);

  // Focusing a field first commits whatever the OTHER field had in progress (so tapping straight
  // from Carbs to BG folds the carbs in immediately), then seeds this field's draft from its value.
  const beginCarbEdit = useCallback(() => {
    commitBg();
    carbDraftRef.current = carbInput;
    setCarbDraft(carbInput);
  }, [commitBg, carbInput]);

  const beginBgEdit = useCallback(() => {
    commitCarb();
    const cur = bgManual ? bgInput : doseBg?.label ?? "";
    bgDraftRef.current = cur;
    setBgDraft(cur);
  }, [commitCarb, bgManual, bgInput, doseBg]);

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
    // Opening the dose editor commits any pending Carbs/BG edit first, so the suggested dose it
    // seeds from reflects the numbers the user just typed above.
    commitCarb();
    commitBg();
    manualOverrideBeforeEditRef.current = manualDoseOverride;
    const current = manualDoseOverride ?? systemRecommendedDose;
    setDoseEditText(formatDoseAmount(current));
    setDoseEditing(true);
    requestAnimationFrame(() => {
      doseInputRef.current?.focus();
    });
  }, [manualDoseOverride, systemRecommendedDose, commitCarb, commitBg]);

  // Live mirror of everything the log handler needs — the flush-then-log tick below must read the
  // values RECOMPUTED from a just-committed edit, not the ones captured when the tap started.
  const logStateRef = useRef({ dose, effectiveDose, systemRecommendedDose, manualDoseOverride, doseJustLogged });
  useEffect(() => {
    logStateRef.current = { dose, effectiveDose, systemRecommendedDose, manualDoseOverride, doseJustLogged };
  });

  const handleTookDose = useCallback(() => {
    // Lock in any in-progress edit FIRST (carb/BG drafts + an open dose editor): tapping this
    // button straight from the keyboard must log the number on screen, not the last committed one.
    // The commits land with this event's state batch; the zero-delay timeout then runs after the
    // re-render, reading the freshly recomputed values off the render-updated ref.
    commitCarb();
    commitBg();
    completeDoseEdit();
    setTimeout(() => {
      const { dose, effectiveDose, systemRecommendedDose, manualDoseOverride, doseJustLogged } =
        logStateRef.current;
      if (doseJustLogged || effectiveDose <= 0) return;
      if (!isBasalMode && !dose) return;
      const wasManual =
        manualDoseOverride != null && !doseAmountsEqual(effectiveDose, systemRecommendedDose);
      // Caregiver sessions confirm before writing into the patient's profile; everyone else commits now.
      confirmLog(() => {
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
      });
    }, 0);
  }, [
    commitCarb,
    commitBg,
    completeDoseEdit,
    isBasalMode,
    insulinTypeLabel,
    logInsulinDose,
    cgmSyncSuccessTick,
    triggerLogPlusOne,
    confirmLog,
  ]);

  function openChat(prompt: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/(tabs)/chat", params: { prompt } });
  }

  /** Shared by the bolus and basal action rows — identical logging behavior in both modes. */
  // Hidden when the access-code grant excludes logging: pressing it would be a no-op (logging is
  // gated server-side by the `log` grant), so don't show it rather than have a dead button.
  // The disabled gate honors an in-progress dose edit: a value typed but not yet committed must
  // keep the button tappable (handleTookDose locks the edit in before logging).
  const pendingEditedDose = doseEditing ? finalizeManualDoseInput(doseEditText) : null;
  const tookDoseButton = canLog ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="I just took this dose"
      disabled={doseJustLogged || (pendingEditedDose ?? effectiveDose) <= 0}
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
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        {...NO_AUTO_CONTENT_INSETS}
        onContentSizeChange={() => {
          // A toggle/card just grew the page — pull the user to the bottom so the reveal is in view.
          if (pendingScrollRef.current) {
            pendingScrollRef.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
        onScrollBeginDrag={() => {
          // Scrolling with the keyboard up dismisses it, which blurs the focused field and fires
          // its onBlur → commit. So a user can edit a value, scroll down, and see the fresh result.
          Keyboard.dismiss();
        }}
      >

      {/* ── Title + insulin-type dropdown (top-right) ── */}
      <View style={styles.titleRow}>
        <Text style={[styles.pageTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>Dose Calculator</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose insulin type"
          style={({ pressed }) => [
            styles.insulinDropdown,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setPendingInsulinLabel(insulinTypeLabel);
            setInsulinModalVisible(true);
          }}
        >
          <Feather name="droplet" size={13} color={COLORS.primary} />
          <Text numberOfLines={1} style={[styles.insulinDropdownText, { color: colors.text }]}>
            {selectedInsulinOption ? `Insulin: ${selectedInsulinOption.name}` : "Select insulin"}
          </Text>
          <Feather name="chevron-down" size={15} color={colors.textMuted} />
        </Pressable>
      </View>

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
          {/* Carbs — big tappable number */}
          <View style={styles.doseInputGroup}>
            <View style={styles.doseInputHead}>
              <MaterialCommunityIcons name="silverware-fork-knife" size={15} color={COLORS.success} />
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>CARBS</Text>
            </View>
            <View style={styles.doseValueRow}>
              <TextInput
                style={[styles.doseBigInput, { color: colors.text }]}
                value={carbDraft ?? carbInput}
                onFocus={beginCarbEdit}
                onChangeText={(v) => {
                  const c = v.replace(/[^0-9.]/g, "");
                  carbDraftRef.current = c;
                  setCarbDraft(c);
                }}
                onBlur={commitCarb}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={[styles.doseUnit, { color: colors.textMuted }]}>g</Text>
            </View>
            <Text style={[styles.doseHint, { color: colors.textMuted }]}>Tap to edit</Text>
          </View>

          <View style={styles.doseInputDivider} />

          {/* Current BG — big tappable number + target */}
          <View style={styles.doseInputGroup}>
            <View style={styles.doseInputHead}>
              <Feather name="droplet" size={14} color={COLORS.primary} />
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>CURRENT BG</Text>
              {latest && !bgManual && bgDraft == null && (
                <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}>
                  <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                </View>
              )}
            </View>
            <View style={styles.doseValueRow}>
              <TextInput
                style={[styles.doseBigInput, { color: bgManual ? COLORS.primary : colors.text }]}
                value={bgDraft ?? (bgManual ? bgInput : doseBg?.label ?? "")}
                onFocus={beginBgEdit}
                onChangeText={(v) => {
                  const c = v.replace(/[^0-9]/g, "");
                  bgDraftRef.current = c;
                  setBgDraft(c);
                }}
                onBlur={commitBg}
                keyboardType="numeric"
                placeholder="—"
                placeholderTextColor={colors.textMuted}
              />
              <Text style={[styles.doseUnit, { color: colors.textMuted }]}>mg/dL</Text>
              {bgManual && latest && (
                <Pressable
                  onPress={() => {
                    bgDraftRef.current = null;
                    setBgDraft(null);
                    setBgInput(String(latest.glucose));
                    setBgManual(false);
                    Keyboard.dismiss();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={{ padding: 4 }}
                >
                  <Feather name="refresh-cw" size={15} color={COLORS.primary} />
                </Pressable>
              )}
            </View>
            <View style={[styles.targetPill, { backgroundColor: colors.backgroundTertiary }]}>
              <Text style={[styles.targetPillText, { color: colors.textSecondary }]}>Target: {targetGlucose} mg/dL</Text>
            </View>
          </View>
        </View>
        )}

        {!isBasalMode && dose && (
          <DoseWarningsList warnings={dose.warnings} />
        )}
      </View>

      {!isBasalMode && dose && doseBg && (
        <>
          {/* ── How your dose is calculated — ALWAYS on, floating between the two windows. Only the
              colored cards + the explanation window carry the card surface; the label/operators
              float on the page. ── */}
          <View key="calc-head" style={styles.calcHeadRow}>
            <Text style={[styles.calcHeadLabel, { color: colors.textSecondary }]}>HOW YOUR DOSE IS CALCULATED</Text>
          </View>
          {/* ── One unified window, purple-outlined (the old Active Insulin card border): the four
              tappable pieces live inside it, and when one is open the SAME window extends down to
              wrap the explanation. Each piece stays individually tappable and works as before. ── */}
          <View
            key="calc-window"
            style={[styles.calcUnified, { backgroundColor: colors.card, borderColor: withAlpha(CARD_PURPLE, 0.55) }]}
          >
            <View style={styles.opCardsRow}>
              {opCards.map((c, i) => (
                <React.Fragment key={c.key}>
                  {i > 0 && (
                    <Text style={[styles.opSymbol, { color: colors.textMuted, fontSize: 14 * calcScale, width: 12 * calcScale }]}>{OP_SYMBOLS[i - 1]}</Text>
                  )}
                  <OpCard
                    def={c}
                    scale={calcScale}
                    selected={expandedCard === c.key}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      // The breakdown opens within the always-visible calc section (no scroll needed).
                      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setExpandedCard((prev) => (prev === c.key ? null : c.key));
                    }}
                    colors={colors}
                  />
                </React.Fragment>
              ))}
            </View>

            {/* The explanation, inside the same purple window: icon keeps its color; the title now
                matches it. */}
            {expandedCard != null && (() => {
              const def = opCards.find((c) => c.key === expandedCard);
              if (!def) return null;
              const ex = doseCardExplanation(expandedCard, explainInput);
              return (
                <View key="breakdown" style={[styles.breakdownWrap, { borderTopColor: colors.separator }]}>
                  <View style={styles.breakdownTitleRow}>
                    <View style={[styles.breakdownIcon, { borderColor: def.color, width: 22 * calcScale, height: 22 * calcScale, borderRadius: 11 * calcScale }]}>
                      <Feather name={def.icon} size={13 * calcScale} color={def.color} />
                    </View>
                    <Text style={[styles.breakdownTitle, { color: def.color, fontSize: 17 * calcScale }]}>{ex.title}</Text>
                  </View>
                  {ex.lines.map((line, li) => (
                    <Text key={li} style={[styles.breakdownLine, { color: colors.textSecondary, fontSize: 13.5 * calcScale, lineHeight: 20 * calcScale }]}>{line}</Text>
                  ))}
                </View>
              );
            })()}
          </View>
          {dose.iobCredit > 0 && (
            <View key="calc-note" style={[styles.calcNote, { backgroundColor: colors.backgroundTertiary }]}>
              <Feather name="zap" size={12} color={COLORS.primary} />
              <Text style={[styles.calcNoteText, { color: colors.textSecondary }]}>
                Active insulin reduces only the correction — your carbs are always covered in full.
              </Text>
            </View>
          )}
          {Math.abs(dose.patternDelta) >= 0.005 && (
            <View key="pattern-note" style={[styles.calcNote, { backgroundColor: colors.backgroundTertiary }]}>
              <Feather name="bar-chart-2" size={12} color={COLORS.primary} />
              <Text style={[styles.calcNoteText, { color: colors.textSecondary }]}>
                Pattern adjustment: {dose.patternDelta > 0 ? "+" : "−"}{Math.abs(dose.patternDelta).toFixed(2)}u ({Math.round(Math.abs(dose.patternFactor - 1) * 100)}%) because doses given at this time of day have consistently run {dose.patternDelta > 0 ? "above" : "below"} the suggestions over the last two weeks. Your saved settings are unchanged — consider reviewing them with your care team.
              </Text>
            </View>
          )}
          {dose.cappedAtMax && (
            <View key="cap-note" style={[styles.calcNote, { backgroundColor: colors.backgroundTertiary }]}>
              <Feather name="shield" size={12} color={COLORS.warning} />
              <Text style={[styles.calcNoteText, { color: colors.textSecondary }]}>
                Capped at the {dose.maxDoseCap}u single-dose safety limit.
              </Text>
            </View>
          )}

          {/* Divider above the suggested-dose window (the window sits below it). */}
          <View key="divider" style={[styles.sectionDivider, { borderTopColor: colors.border }]} />

          <View key="suggest" style={[styles.suggestCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Suggested Dose + editable badge */}
            <View style={styles.suggestTotalRow}>
              <View style={styles.doseTotalLabelWrap}>
                <Text style={[styles.doseTotalHeadLabel, { color: colors.textSecondary }]}>
                  {isMinor ? "Ask your adult to give:" : "Suggested Dose"}
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

            {/* Actions: Predict Again (re-pulls fresh matches on demand — the graph also refreshes
                itself on input/reading changes) + I Just Took This Dose. */}
            <View style={[styles.doseActionsRow, { marginTop: 0 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: predictDisabled, busy: predicting || drawing }}
                accessibilityLabel="Predict again"
                disabled={predictDisabled}
                style={({ pressed }) => [
                  styles.tookDoseBtn,
                  {
                    backgroundColor: COLORS.primary,
                    opacity: pressed ? 0.8 : predictDisabled ? 0.5 : 1,
                  },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  void runPredict();
                }}
              >
                {predicting || drawing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="trending-up" size={13} color="#fff" />
                )}
                <Text style={styles.tookDoseBtnText}>
                  {predicting || drawing ? "Predicting…" : "Predict Again"}
                </Text>
              </Pressable>
              {tookDoseButton}
            </View>

            {/* Graph — ALWAYS open. While the matcher works we show the "building" placeholder;
                results refresh automatically when committed inputs or readings change. The dotted
                lines after Now are the top matches' REAL past outcomes — no AI synthesis. */}
            {(
              <View key="graph-area">
                {predicting || (prediction === null && canPredict) ? (
                  <View style={[styles.predictBuilding, { borderColor: colors.border }]}>
                    <ActivityIndicator color={COLORS.primary} />
                    <Text style={[styles.predictBuildingText, { color: colors.textSecondary }]}>
                      Building your prediction…
                    </Text>
                  </View>
                ) : prediction?.ok ? (
                  <>
                    <DosePredictionChart
                      key={`graph-${predictRunRef.current}`}
                      readings={history}
                      // Rank opacities: #1 solid, #2 and #3 each fading by the same proportion.
                      forecastLines={prediction.matches.map((m, i) => ({
                        points: m.points,
                        opacity: [1, 0.68, 0.46][i] ?? 0.46,
                      }))}
                      currentBG={doseBg?.n ?? 0}
                      targetGlucose={targetGlucose}
                      lowThreshold={alertPrefs.lowThreshold}
                      highThreshold={alertPrefs.highThreshold}
                      urgentHighThreshold={alertPrefs.urgentHighThreshold}
                      nowMs={nowMs}
                      redrawKey={`run-${predictRunRef.current}`}
                      colors={colors}
                      skipIntro={introDoneRunRef.current === predictRunRef.current}
                      onDrawComplete={() => {
                        introDoneRunRef.current = predictRunRef.current;
                        setDrawing(false);
                      }}
                    />
                    <PredictionStrength result={prediction} colors={colors} />
                    <Text style={[styles.predictStaleHint, { color: colors.textMuted }]}>
                      The more you use the app, the more accurate your predictions can be
                    </Text>
                    {prediction.matches.length === 0 && (
                      <Text style={[styles.predictStaleHint, { color: colors.textMuted }]}>
                        No similar past situations yet — prediction lines appear as more doses build history.
                      </Text>
                    )}
                  </>
                ) : prediction && !prediction.ok ? (
                  <View style={[styles.predictBuilding, { borderColor: colors.border }]}>
                    <Feather name="cloud-off" size={22} color={colors.textMuted} />
                    <Text style={[styles.predictBuildingText, { color: colors.text, fontWeight: "700" }]}>
                      Prediction unavailable
                    </Text>
                    <Text style={[styles.predictUnavailableSub, { color: colors.textSecondary }]}>
                      Couldn&apos;t load your history matches. Check your connection and tap Predict Again.
                    </Text>
                  </View>
                ) : !canPredict ? (
                  <View style={[styles.predictBuilding, { borderColor: colors.border }]}>
                    <Feather name="trending-up" size={22} color={colors.textMuted} />
                    <Text style={[styles.predictUnavailableSub, { color: colors.textSecondary }]}>
                      The prediction draws once there&apos;s a dose to model — add carbs or wait for a
                      correction-worthy reading.
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
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

const STRENGTH_META: Record<StrengthLabel, { text: string; color: string }> = {
  strong: { text: "Strong match", color: COLORS.success },
  good: { text: "Good match", color: COLORS.primary },
  rough: { text: "Rough estimate", color: "#F59E0B" },
  building: { text: "Building — log more to sharpen predictions", color: "#8190A4" },
};

/** The reference-strength readout under the prediction chart (combines the chosen matches' confidence). */
function PredictionStrength({
  result,
  colors,
}: {
  result: Extract<PredictionResult, { ok: true }>;
  colors: (typeof Colors)["light"];
}) {
  const meta = STRENGTH_META[result.strengthLabel];
  const suffix =
    result.referenceCount > 0
      ? ` · ${result.referenceCount} past ${result.referenceCount === 1 ? "match" : "matches"}`
      : "";
  return (
    <View style={styles.strengthPill}>
      <View style={[styles.strengthDot, { backgroundColor: meta.color }]} />
      <Text style={[styles.strengthText, { color: colors.textSecondary }]}>
        Prediction strength: <Text style={{ color: meta.color, fontWeight: "700" }}>{meta.text}</Text>
        {suffix}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // iPad: cap + center the content column so it doesn't stretch across a 13" screen. No-op on phones.
  scroll: { paddingHorizontal: 20, paddingTop: 10, width: "100%", maxWidth: T.layout.contentMaxWidth, alignSelf: "center" },

  screenHeader: { paddingBottom: 10, borderBottomWidth: 1 },
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




  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 10 },

  // ── Title row + insulin dropdown ──
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  pageTitle: { fontSize: 16, fontWeight: "700" },
  pageSub: { fontSize: 12.5, fontWeight: "500", marginTop: 2 },
  insulinDropdown: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, maxWidth: 200, flexShrink: 1,
  },
  insulinDropdownText: { fontSize: 12.5, fontWeight: "600", flexShrink: 1 },

  // ── "How your dose is calculated" op cards ──
  // Vertical margins zeroed here: the 10px reference gaps above/below this label come from
  // doseCard.marginBottom (above) and opCardsRow.marginTop (below), keeping them symmetric.
  calcHeadRow: { marginTop: 0, marginBottom: 0 },
  calcHeadLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  /** The single purple-outlined window housing the four pieces + the opened explanation. */
  calcUnified: { marginTop: 20, borderWidth: 1.5, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 8 },
  opCardsRow: { flexDirection: "row", alignItems: "flex-start", gap: 2 },
  opSymbol: { fontSize: 14, fontWeight: "800", alignSelf: "center", width: 12, textAlign: "center" },
  // aspectRatio 1 makes each card a square (height follows the flex-computed width); content is
  // centered vertically now that the card is taller.
  opCard: { flex: 1, minWidth: 0, aspectRatio: 1, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", gap: 5 },
  opLabel: { fontSize: 9.5, fontWeight: "700", textAlign: "center", lineHeight: 12 },
  opValue: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  /** Third row inside each piece: the live input value, title-grey and smaller than the value. */
  opSub: { fontSize: 9.5, fontWeight: "600", textAlign: "center", lineHeight: 12 },
  calcNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 10, marginTop: 10 },
  calcNoteText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 17 },

  // ── Collapsible "Your Dose Breakdown" ──
  /** Lives INSIDE calcUnified — a soft top rule separates it from the pieces row above. */
  breakdownWrap: { marginTop: 10, paddingTop: 12, paddingHorizontal: 8, paddingBottom: 5, borderTopWidth: 1, gap: 7 },
  breakdownTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  breakdownIcon: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  breakdownTitle: { fontSize: 17, fontWeight: "800" },
  breakdownLine: { fontSize: 13.5, fontWeight: "400", lineHeight: 20 },

  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, marginTop: 20 },
  disclaimerText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 18 },


  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10, marginTop: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 14, fontWeight: "400", textAlign: "center", lineHeight: 20 },

  doseCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 20, gap: 10 },
  doseInputRow: { flexDirection: "row", gap: 12, paddingVertical: 2 },
  doseInputGroup: { flex: 1, alignItems: "center", gap: 5 },
  doseInputHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  doseInputLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  doseValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 },
  doseBigInput: { fontSize: 20, fontWeight: "700", textAlign: "center", minWidth: 30, padding: 0 },
  doseUnit: { fontSize: 12, fontWeight: "500" },
  doseHint: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  targetPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, marginTop: 4 },
  targetPillText: { fontSize: 12, fontWeight: "600" },
  doseInput: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 20, fontWeight: "700", textAlign: "center" },
  doseInputDivider: { width: 1, backgroundColor: "rgba(128,128,128,0.18)", marginVertical: 2 },
  liveTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  liveTagText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },

  doseBreakdown: { borderTopWidth: 1, paddingTop: 12, gap: 10 },

  doseTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 10, marginTop: 10, gap: 10 },
  /** Lets long labels wrap instead of shoving the units badge off-screen. */
  doseTotalLabelWrap: { flex: 1, minWidth: 0 },
  doseTotalLabel: { fontSize: 13, fontWeight: "600", marginBottom: 3 },
  // "SUGGESTED DOSE" — matches the "HOW YOUR DOSE IS CALCULATED" head (calcHeadLabel) exactly.
  doseTotalHeadLabel: { fontSize: 14, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },

  explainBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 11, borderWidth: 1, borderColor: "transparent" },

  // ── Suggested-dose window (wraps the dose result, the See Calculation / See Prediction toggles,
  //    and whatever they reveal). Same surface as the carbs/BG card. ──
  sectionDivider: { borderTopWidth: 1, marginTop: 20, marginBottom: 18 },
  suggestCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 20, gap: 14 },
  // baseline so "SUGGESTED DOSE" stays in line with the dose value in the pill, regardless of the
  // "Tap to edit" / recommended-dose line that sits below the pill.
  suggestTotalRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
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

  doseActionsRow: { flexDirection: "row", gap: 8, marginTop: 10 },
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
  predictBuilding: {
    marginTop: 12,
    height: 156,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  predictBuildingText: { fontSize: 13, fontWeight: "500" },
  predictUnavailableSub: { fontSize: 12, fontWeight: "400", textAlign: "center", lineHeight: 17, paddingHorizontal: 24 },
  strengthPill: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10, paddingHorizontal: 2 },
  strengthDot: { width: 9, height: 9, borderRadius: 4.5 },
  strengthText: { fontSize: 12, fontWeight: "500", flex: 1 },
  predictStaleHint: { fontSize: 12, fontWeight: "500", fontStyle: "italic", marginTop: 6, paddingHorizontal: 2 },

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
