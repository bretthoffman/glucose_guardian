import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  LayoutAnimation,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useTheme } from "@/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { T, withAlpha } from "@/constants/theme";
import { doseCardExplanation, type DoseCardKey } from "@/utils/doseExplain";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { glucoseColor } from "@/components/CGMChart";
import { computeDose } from "@/utils/dose";
import { AccentShade, CardShade, ControlShade, TintShade } from "@/components/Shade";
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
import BrandHeaderLeft from "@/components/BrandHeaderLeft";
import TabGlucoseHeaderRow, { TabGlucoseHeaderShell } from "@/components/TabGlucoseHeaderRow";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import { DoseRow, DoseWarningsList, EditableDoseTotalBadge } from "@/components/DoseCalculatorBits";
import LogFingerStickModal from "@/components/LogFingerStickModal";
import PensCard from "@/components/PensCard";
import DosePredictionChart from "@/components/DosePredictionChart";
import { runPrediction, type PredictionResult, type StrengthLabel } from "@/utils/predictionClient";
import { PREDICTION_UNLOCK_DAYS, distinctLogDayCount, predictionDaysRemaining } from "@/utils/predictionUnlock";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";
import { activePens, penStatus, penTitle, toLocalDate } from "@/utils/pens";
import { showsCountdown } from "@/utils/insulinForms";
import { activeFractionRemaining, computeActiveCarbs, computeActiveInsulin, formatAgeShort } from "@/utils/onBoard";
import { withoutLowTreatments } from "@/utils/lowTreatment";
import {
  defaultInsulinChipLabel,
  findInsulinByChipLabel,
  insulinChipLabel,
  insulinDisplayLabel,
  isBolusInsulin,
  type InsulinOption,
} from "@/constants/insulin";
import { DOSE_INSULIN_TYPE_STORAGE_KEY } from "@/constants/storage-keys";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";
import { ScreenShade } from "@/components/Shade";
import { useHelpAnchor, useHelpPage, useHelpScroll } from "@/context/HelpContext";
import { findRecentFastActing } from "@/utils/insulinStacking";
import { useStackingGuard } from "@/components/StackingWarningModal";
import { CloseButton } from "@/components/CloseButton";

// Accent hues for the calculator's operation cards. Literal hex (like the app's other accents) so
// the same hue reads correctly in both light and dark; the card background/border are theme-tinted.
const CARD_BLUE = "#3B82F6";
const CARD_PURPLE = "#2F80FF";

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
          // The unified window (calcUnified) carries the single outline; each piece is
          // borderless and identified by its color through the tinted label/value text. Selection
          // shows as a soft pill tint of the piece's own color.
          backgroundColor: selected ? withAlpha(def.color, 0.14) : "transparent",
          opacity: pressed ? 0.85 : 1,
          gap: 5 * scale,
        },
      ]}
    >
      {/* Title in the same muted grey as the section header; only the VALUE carries the piece's
          color. The third row shows the live input feeding this piece.

          Sizing rules, learned the hard way (labels randomly rendered near-unreadably tiny on SOME
          devices):
          - NO explicit lineHeight together with adjustsFontSizeToFit. On iOS that combination is a
            long-standing RN defect: the fit pass measures against the lineHeight box, shrinks PAST
            minimumFontScale, and the tiny size can stick across re-layouts.
          - maxFontSizeMultiplier caps the device's accessibility text-size setting. Uncapped, a
            phone at 1.3× overflowed the card and engaged autoshrink on that phone only — which is
            why the bug looked different per device.
          - alignSelf:"stretch" gives the text the card's real width up front; without it the first
            measure can happen at ~0 width, and Android (where minimumFontScale is NOT supported)
            commits an arbitrarily tiny size.
          adjustsFontSizeToFit stays as the graceful fallback for genuinely narrow screens. */}
      <Text style={[styles.opLabel, { color: colors.textSecondary, fontSize: 9.5 * scale }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.15}>{def.label}</Text>
      <Text style={[styles.opValue, { color: def.color, fontSize: 15 * scale }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.15}>
        {fmtU(def.value)}
      </Text>
      <Text style={[styles.opSub, { color: colors.textSecondary, fontSize: 9.5 * scale }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.15}>
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
  const { isMinor, alertPrefs, profile, account, foodLog, insulinLog, fingerStickLog, penLog, logInsulinDose, caregiverSession, doctorSession, isChildMode, accessCodeRole, accessCodePermissions, messagingIdentity } = useAuth();
  const confirmLog = useCareLogConfirm();
  const { askStacking, stackingModal } = useStackingGuard();
  // "Enter finger stick" shortcut from a "verify with a finger stick" dose warning. Informational
  // only — logging one never changes the dose shown here.
  const [fingerStickOpen, setFingerStickOpen] = useState(false);
  // Fresh insulin log for the stacking guard inside handleTookDose's zero-delay tick.
  const insulinLogRef = useRef(insulinLog);
  useEffect(() => { insulinLogRef.current = insulinLog; }, [insulinLog]);
  // Access-code grants: the calculator grant gates this page's content (the tab bar hides the tab
  // too; this covers deep links), and the log grant still gates "I Just Took This Dose" below.
  // The day record itself lives on the Logs tab now (app/(tabs)/logs.tsx).
  const isAccessCodeSession = accessCodeRole != null;
  const canUseCalculator = !isAccessCodeSession || !!accessCodePermissions?.useCalculator;
  const canLog = !isAccessCodeSession || !!accessCodePermissions?.log;
  const [carbInput, setCarbInput] = useState("");
  /**
   * "ACTIVE CARBS" overlay on the carbs field — shows AUTOMATICALLY whenever a logged meal's carbs
   * are still active, so nobody re-types carbs that the math already counts through the active-carbs
   * term below. Purely visual: it paints the on-board grams (amber, same as the on-board bar) over
   * the input, the input itself is CLEARED the moment the overlay appears (so no hidden leftover
   * value can double-count), and the ✕ dismisses it back to the normal editable field without
   * touching the math. Dismissal re-arms when the NEXT food log lands; it self-hides as carbs drain
   * — and in any case 15 minutes after the newest log (see overlayFresh below).
   */
  const [activeCarbsOverlayDismissed, setActiveCarbsOverlayDismissed] = useState(false);
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
  // ── Help Mode wiring: anchors are refs only; the page reports itself so tours start and stop
  // on tab switches. isTouring opens the collapsed math window while this page's tour runs. ──
  const { isTouring } = useHelpPage();
  const helpPill = useHelpAnchor("insulin.glucosePill");
  const helpSelector = useHelpAnchor("insulin.selector");
  const helpInputs = useHelpAnchor("insulin.inputs");
  const helpOnBoard = useHelpAnchor("insulin.onBoard");
  const helpCalc = useHelpAnchor("insulin.calc");
  const helpSuggest = useHelpAnchor("insulin.suggest");
  const helpPredict = useHelpAnchor("insulin.predict");
  const helpTookDose = useHelpAnchor("insulin.tookDose");
  const helpMyInsulin = useHelpAnchor("insulin.myInsulin");
  const helpDisclaimer = useHelpAnchor("insulin.disclaimer");
  useHelpScroll("insulin", scrollRef);
  const pendingScrollRef = useRef(false);

  // ── Insulin type selection (persisted; validated against the profile's configured insulins) ──
  const [insulinTypeLabel, setInsulinTypeLabel] = useState<string | null>(null);
  const [insulinTypeReady, setInsulinTypeReady] = useState(false);
  // My Insulin (the full pens card) lives in a sheet now, opened from the insulin strip's chevron.
  const [pensSheetOpen, setPensSheetOpen] = useState(false);
  // Which colored operation card is expanded in "Your Dose Breakdown" (null = collapsed by default).
  const [expandedCard, setExpandedCard] = useState<DoseCardKey | null>(null);
  // Prediction graph is revealed on demand by the first Predict tap.
  const [showPrediction, setShowPrediction] = useState(false);
  // The dose-math window is tucked away by default; the section title / info circle toggles it.
  const [calcOpen, setCalcOpen] = useState(false);
  const calcShown = calcOpen || isTouring("insulin");

  // ── "I just took this dose" — green until the next successful CGM sync ──
  const [doseLoggedAtTick, setDoseLoggedAtTick] = useState<number | null>(null);

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
  // Carbs given to treat a low are left out: the calculator must never cover them with insulin.
  const activeCarbs = useMemo(
    () => computeActiveCarbs(withoutLowTreatments(foodLog ?? []), Date.now()),
    [foodLog, clockTick],
  );
  /**
   * Fill for the on-board bars. 0 hides the bar entirely, so a card with nothing carried over looks
   * exactly as it did before. `clockTick` already drives the memos above, so both bars drain on their
   * own without a dedicated timer.
   *
   * These read the SAME summaries the dose math consumes, so the bar can never disagree with the
   * "Active Carbs / Active Insulin" figures in the breakdown below — and because `foodLog`/
   * `insulinLog` come from `useAuth()` (which serves the VIEWED patient's pooled logs for a
   * co-guardian, access code, or nurse viewing a linked profile), the bars appear for every linked
   * identity with no extra wiring.
   */
  const activeCarbsFraction = activeFractionRemaining(activeCarbs.remainingMin, activeCarbs.remainingWindowMin);
  // A NEW food log re-arms the overlay a previous ✕ dismissed (newest entry id as the signal).
  const newestFoodLogId = foodLog.length > 0 ? foodLog[foodLog.length - 1]!.id : null;
  useEffect(() => {
    setActiveCarbsOverlayDismissed(false);
  }, [newestFoodLogId]);
  /**
   * The overlay is a JUST-LOGGED reminder, not a permanent face for the field: it shows for
   * 15 MINUTES after the newest food log (then behaves as if ✕ was tapped). Logs from ANYWHERE in
   * the care circle count — `foodLog` is the circle's shared pool, so a meal a co-guardian or an
   * access-code device logs pops the same reminder here. `clockTick` (30 s) drives the expiry.
   */
  const OVERLAY_WINDOW_MS = 15 * 60_000;
  const newestFoodLogAt = useMemo(() => {
    let newest = 0;
    for (const f of foodLog) {
      const t = new Date(f.timestamp).getTime();
      if (Number.isFinite(t) && t > newest) newest = t;
    }
    return newest;
  }, [foodLog]);
  const overlayFresh = useMemo(
    () => newestFoodLogAt > 0 && Date.now() - newestFoodLogAt <= OVERLAY_WINDOW_MS,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clockTick is the 30s re-evaluation pulse
    [newestFoodLogAt, clockTick],
  );
  const activeCarbsOverlayVisible = !activeCarbsOverlayDismissed && overlayFresh && activeCarbs.totalGrams > 0;
  useEffect(() => {
    // The overlay HIDES the input, so the input must hold nothing while it shows — a value typed
    // before a log landed would otherwise keep feeding the math invisibly.
    if (activeCarbsOverlayVisible) {
      carbDraftRef.current = null;
      setCarbDraft(null);
      setCarbInput("");
    }
  }, [activeCarbsOverlayVisible]);
  const activeInsulinFraction = activeFractionRemaining(activeInsulin.remainingMin, activeInsulin.remainingWindowMin);
  /** The strip is all-or-nothing: either side being active brings BOTH bars in. */
  /**
   * Every open pen/vial with its status, soonest due first, for the My Insulin strip under the
   * dose card. Forms whose countdown is switched off in Insulin Settings are skipped, exactly
   * like PensCard. `clockTick` (30s) keeps "today" fresh across midnight.
   */
  const stripPens = useMemo(() => {
    const today = toLocalDate(new Date());
    return activePens(penLog ?? [], today)
      .filter((p) => !profile || showsCountdown(profile, p.insulinLabel, p.form))
      .map((p) => ({ pen: p, status: penStatus(p, today) }));
    // clockTick re-runs this on the 30s tick so the day labels can roll over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penLog, profile, clockTick]);

  const openPensSheet = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPensSheetOpen(true);
  }, []);

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
      prePeakIobUnits: activeInsulin.prePeakUnits,
      correctionHoldRemainingMin: activeInsulin.correctionHoldRemainingMin,
      newestBolusAgeMin: activeInsulin.lastDoseAgeMin,
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
      {
        key: "correction",
        label: "Correct BG",
        color: CARD_BLUE,
        // While the post-bolus hold is active the correction contributes NOTHING to the dose, and
        // the card says so — a full correction figure over a 0u suggestion reads as a broken sum.
        value: dose.correctionHeldUnits > 0 ? 0 : dose.correctionInsulin + dose.resistanceBump + dose.trendAdjustment,
        // "manual" marks a typed meter reading (the override lives in this card's breakdown now).
        sub: dose.correctionHeldUnits > 0 ? `on hold ~${dose.correctionHoldRemainingMin}m` : doseBg ? `${doseBg.label}${bgManual ? " manual" : " mg/dL"}` : "—",
        icon: "trending-up",
      },
      { key: "carb", label: "Carb Dose", color: COLORS.success, value: dose.carbInsulin, sub: `${carbsNum} g`, icon: "coffee" },
      /**
       * These two show their FULL standalone contribution, not the netted remainder.
       *
       * The calculator nets them against each other internally (`netInFlight = iobUnits -
       * activeCarbInsulin`), so only ONE of `uncoveredCarbInsulin` / `iobCredit` is ever non-zero —
       * which is correct math but made the row unreadable: logging 3 u of insulin on top of 25 g of
       * carbs flipped Active Carbs from 1.67 u to 0 u and put a NEGATIVE -0.58 u under a "−" operator
       * that already means subtraction. Showing each side's real amount (1.67 u of carbs on board, 3 u
       * of insulin on board) matches the equation printed above the cards and keeps the minus sign
       * doing exactly one job.
       *
       * `dose.activeCarbInsulin` and `dose.activeInsulinUnits` are the un-netted values the calculator
       * already computes and returns. NOTHING about the dose math changes — `subTotal` still uses the
       * netted figures, so the suggested dose is byte-for-byte what it was.
       */
      { key: "activeCarbs", label: "Active Carbs", color: COLORS.warning, value: dose.activeCarbInsulin, sub: `${activeCarbs.totalGrams} g`, icon: "clock" },
      { key: "activeInsulin", label: "Active Insulin", color: CARD_PURPLE, value: dose.activeInsulinUnits, sub: fmtU(dose.activeInsulinUnits), icon: "droplet" },
    ];
  }, [dose, doseBg, bgManual, carbInput, activeCarbs]);

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
    correctionHeldUnits: dose?.correctionHeldUnits ?? 0,
    correctionHoldRemainingMin: dose?.correctionHoldRemainingMin ?? 0,
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

  // ── Predict unlock gate: predictions are matched against the profile's own history, so a new
  // profile sees the section locked until 7 distinct local days carry at least one log of any kind
  // (utils/predictionUnlock). Pooled logs, so every device in the circle sees the same state, and a
  // backfilled Add Entry day counts the moment it's saved. Deleting logs can re-lock — that's fine. ──
  const predictDaysLeft = useMemo(
    () =>
      predictionDaysRemaining(
        distinctLogDayCount([
          ...(insulinLog ?? []).map((e) => e.timestamp),
          ...(foodLog ?? []).map((e) => e.timestamp),
          ...(fingerStickLog ?? []).map((e) => e.timestamp),
        ]),
      ),
    [insulinLog, foodLog, fingerStickLog],
  );
  const predictLocked = predictDaysLeft > 0;

  // ── Prediction chart: an AI projection of the next 90 min IF this dose is taken now (bolus only).
  // Estimate-only — never feeds the calculator. Runs ONLY on an explicit Predict tap and holds that
  // result until Predict is tapped again, even if the calculator inputs change. ──
  const [predicting, setPredicting] = useState(false);
  const [drawing, setDrawing] = useState(false); // graph is still animating in
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [predictedInputs, setPredictedInputs] = useState<{ bg: number; carbs: string; dose: number } | null>(null);
  const predictRunRef = useRef(0);

  const runPredict = useCallback(async () => {
    if (predictLocked || isBasalMode || !doseBg || effectiveDose <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const runId = ++predictRunRef.current;
    // Clear the old graph immediately so "Predict Again" drops to the loading state (the stale curve
    // must not linger while the new prediction is en route).
    setPrediction(null);
    setDrawing(false);
    setPredicting(true);
    if (!showPrediction) {
      pendingScrollRef.current = true;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setShowPrediction(true);
    }
    const submitted = { bg: doseBg.n, carbs: carbInput, dose: roundToQuarterUnits(effectiveDose) };
    const result = await runPrediction({
      identity: messagingIdentity,
      currentBG: doseBg.n,
      doseUnits: effectiveDose,
      carbsGrams: parseFloat(carbInput) || 0,
      nowMs: Date.now(),
      history,
      correctionFactor: effSettings.correctionFactor,
      carbRatio: effSettings.carbRatio,
      newDoseDiaMin: selectedInsulinOption?.type === "regular" ? 360 : 240,
    });
    if (predictRunRef.current !== runId) return; // a newer run superseded this one
    setPrediction(result);
    setPredicting(false);
    if (result.ok) {
      setPredictedInputs(submitted);
      setDrawing(true); // hold the button until the graph finishes drawing (onDrawComplete)
      // Safety net in case the draw is interrupted (navigation) and the completion never fires.
      setTimeout(() => {
        if (predictRunRef.current === runId) setDrawing(false);
      }, 6000);
    }
  }, [predictLocked, isBasalMode, doseBg, effectiveDose, showPrediction, messagingIdentity, carbInput, history, effSettings, selectedInsulinOption]);

  // The snapshot is stale once the data being submitted (BG, carbs, or dose) no longer exactly
  // matches what was last predicted — the only condition under which Predict may run again.
  const predictionStale =
    !!prediction?.ok &&
    predictedInputs != null &&
    (predictedInputs.bg !== (doseBg?.n ?? null) ||
      predictedInputs.carbs !== carbInput ||
      predictedInputs.dose !== roundToQuarterUnits(effectiveDose));
  /**
   * Close the prediction and put the card back exactly as it was before Predict was tapped.
   *
   * Clearing `prediction` (not just hiding the graph) is what reverts the button label to "Predict" —
   * it reads `prediction?.ok ? "Predict Again" : "Predict"` — and re-enables the button, since
   * `predictDisabled` below blocks a repeat only while an identical result is on screen. Clearing the
   * input snapshot too keeps `predictionStale` honest for the next run.
   */
  const dismissPrediction = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowPrediction(false);
    setPrediction(null);
    setPredictedInputs(null);
  }, []);

  // Predict is blocked while locked (not enough logged days yet), while computing, while drawing,
  // and while an IDENTICAL prediction is on screen. An unavailable result leaves it enabled so it
  // can be retried.
  const predictDisabled =
    predictLocked || effectiveDose <= 0 || predicting || drawing || (prediction?.ok === true && !predictionStale);

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
      const proceed = () => confirmLog(() => {
        logInsulinDose({
          timestamp: new Date().toISOString(),
          units: roundToQuarterUnits(effectiveDose),
          type: isBasalMode ? "basal" : "bolus",
          ...(insulinTypeLabel ? { insulinType: insulinTypeLabel } : {}),
          recommendedUnits: roundToQuarterUnits(systemRecommendedDose),
          manualOverride: wasManual,
        });
        /**
         * The dose for these carbs is now GIVEN, so the field must not survive to the next
         * calculation. It used to: carb insulin is (correctly) never reduced by IOB, so coming
         * back to the calculator with the grams still typed re-recommended the entire meal
         * portion minutes after it was dosed — the single biggest insulin-stacking path.
         * (Deliberately NOT auto-logged as food: families who log meals on the Food page would
         * then have the same carbs counted twice in COB, inflating the next dose instead.)
         */
        if (!isBasalMode) {
          carbDraftRef.current = null;
          setCarbDraft(null);
          setCarbInput("");
        }
        setDoseLoggedAtTick(cgmSyncSuccessTick);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      });
      // ── Insulin-stacking guard: a fast-acting dose logged by ANYONE in the circle within the
      // last 2 hours opens "Beware of insulin stacking" before this (fast-acting) one is logged.
      // Basal mode skips it — a basal dose beside a mealtime bolus is normal therapy, not stacking.
      const recent = !isBasalMode ? findRecentFastActing(insulinLogRef.current ?? []) : null;
      askStacking(recent, insulinLogRef.current ?? [], proceed);
    }, 0);
  }, [
    commitCarb,
    commitBg,
    completeDoseEdit,
    isBasalMode,
    insulinTypeLabel,
    logInsulinDose,
    cgmSyncSuccessTick,
    confirmLog,
    askStacking,
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
      ref={helpTookDose}
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
      <AccentShade color={doseJustLogged ? COLORS.success : COLORS.primary} radius={11} />
      <Feather name={doseJustLogged ? "check-circle" : "check"} size={13} color="#fff" />
      {/* The text box is bounded (flexShrink), so it can never grow past the space beside the icon —
          that is what used to shove the icon off the button at the largest text sizes. Normally one
          line, shrinking to fit (floor 80%); at large accessibility sizes a one-line shrink would have to
          go below the floor and truncate, so the label may take a second line inside the button instead. */}
      <Text
        style={styles.tookDoseBtnText}
        numberOfLines={ACTION_LABEL_LINES}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.6}
      >
        {doseJustLogged ? "Dose Logged" : "I Just Took This Dose"}
      </Text>
    </Pressable>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Background shading — see components/Shade; the root keeps its own opaque color beneath. */}
      <ScreenShade />
      {/* ── Header ── */}
      <TabGlucoseHeaderShell
        borderBottomColor={colors.border}
        style={[styles.screenHeader, { backgroundColor: colors.background }]}
      >
        {/* The old Dose/Log toggle is gone (the day record lives on the Logs tab); the brand block
            fills the slot, same as Chat. */}
        <TabGlucoseHeaderRow left={<BrandHeaderLeft />} glucoseSlotRef={helpPill} />
      </TabGlucoseHeaderShell>

      {!canUseCalculator ? (
        <View style={[styles.lockedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={26} color={colors.textMuted} />
          <Text style={[styles.lockedTitle, { color: colors.text }]}>The dose calculator isn't available</Text>
          <Text style={[styles.lockedSub, { color: colors.textSecondary }]}>
            The dose calculator isn't turned on for you. Ask a parent to enable it.
          </Text>
        </View>
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

      {/* ── Insulin strip: the page's ONE insulin surface. Tap a chip to switch the insulin being
          dosed (the same selection the old dropdown set — a long-acting chip flips the page to the
          basal view exactly as before); each chip carries its soonest open pen/vial countdown, and
          the chevron opens My Insulin (start new, edit, History) as a sheet. ── */}
      <View style={styles.insulinStripRow}>
        <View ref={helpSelector} collapsable={false} style={styles.insulinStripBody}>
          <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>Insulin</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.insulinStripChips}>
            {availableInsulinOptions.length === 0 ? (
              <Text style={[styles.insulinStripEmpty, { color: colors.textMuted }]}>Add your insulins in Insulin Settings</Text>
            ) : (
              availableInsulinOptions.map((o) => {
                const label = insulinChipLabel(o);
                const selected = label === insulinTypeLabel;
                return (
                  <Pressable
                    key={label}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Dose with ${o.name}`}
                    onPress={() => {
                      if (label === insulinTypeLabel) return;
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      commitInsulinTypeLabel(label);
                    }}
                    style={({ pressed }) => [
                      styles.insulinChip,
                      selected
                        ? { backgroundColor: COLORS.primary }
                        : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    {selected ? <AccentShade radius={12} /> : <ControlShade radius={12} />}
                    <Feather name="droplet" size={12} color={selected ? "#fff" : COLORS.primary} />
                    <Text numberOfLines={1} style={[styles.insulinChipText, { color: selected ? "#fff" : colors.text }]}>
                      {o.name}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>

      <View ref={helpInputs} collapsable={false} style={[styles.doseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={16} />
        {isBasalMode ? (
          /* ── Basal mode: carbs/BG inputs don't apply — show time + live glucose instead ── */
          <View style={styles.doseInputRow}>
            <View style={styles.doseInputGroup}>
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Current Time</Text>
              <View style={[styles.basalInfoBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <ControlShade radius={12} />
                <Text style={[styles.basalInfoValue, { color: colors.text }]}>{currentTimeLabel}</Text>
              </View>
            </View>
            <View style={styles.doseInputDivider} />
            <View style={styles.doseInputGroup}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Current Glucose</Text>
                {latest && (
                  <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}><TintShade color={COLORS.success} radius={6} />
                    <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                  </View>
                )}
              </View>
              <View style={[styles.basalInfoBox, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <ControlShade radius={12} />
                <Text style={[styles.basalInfoValue, { color: latest ? glucoseColor(latest.glucose) : colors.textMuted }]}>
                  {latest ? latest.glucose : "—"}
                </Text>
                <Text style={[styles.basalInfoUnit, { color: colors.textMuted }]}>mg/dL</Text>
              </View>
            </View>
          </View>
        ) : (
        <View style={styles.doseInputRow}>
          {/* Carbs — big tappable number. While a logged meal's carbs are still active the field is
              REPLACED visually by the on-board grams (display only, never part of the math — the
              active-carbs term below is what counts them); ✕ restores the editable field.
              Spread: the column stretches to the rings half's height so label / value / hint line
              up with label / rings / captions across the divider. */}
          <View style={[styles.doseInputGroup, styles.doseInputGroupSpread]}>
            {activeCarbsOverlayVisible ? (
              <>
                <View style={styles.doseInputHead}>
                  <MaterialCommunityIcons name="silverware-fork-knife" size={15} color={COLORS.warning} />
                  <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>ACTIVE CARBS</Text>
                </View>
                <View style={styles.doseValueRow}>
                  <Text style={[styles.doseBigInput, { color: COLORS.warning }]}>{activeCarbs.totalGrams}</Text>
                  <Text style={[styles.doseUnit, { color: colors.textMuted }]}>g</Text>
                </View>
                {/* Invisible hint keeps this column's height identical to the editable state. */}
                <Text style={[styles.doseHint, { opacity: 0 }]}>Tap to edit</Text>
                <CloseButton onPress={() => setActiveCarbsOverlayDismissed(true)} accessibilityLabel="Dismiss and enter carbs manually" size={26} hitSlop={10} style={styles.overlayDismiss} />
              </>
            ) : (
              <>
            <View style={styles.doseInputHead}>
              <MaterialCommunityIcons name="silverware-fork-knife" size={15} color={COLORS.success} />
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3}>CARBS</Text>
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
              </>
            )}
          </View>

          <View style={styles.doseInputDivider} />

          {/* "Still working" — the two on-board drain rings (amber carbs, purple insulin) in the
              pens' ring language, filling the half where live BG used to sit. Always present;
              faint empty rings at zero, so the pair reads as a fixture, never a pop-in. Live BG
              moved to the header pill and the Correct BG piece (which holds the meter override). */}
          <View style={styles.doseInputGroup} ref={helpOnBoard} collapsable={false}>
            <View style={styles.doseInputHead}>
              <Feather name="clock" size={14} color={colors.textSecondary} />
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3}>STILL WORKING</Text>
            </View>
            <View style={styles.ringsRow}>
              <OnBoardRing
                fraction={activeCarbsFraction}
                amount={String(activeCarbs.totalGrams)}
                unit="g"
                kind="carbs"
                remainingMin={activeCarbs.remainingMin}
                color={COLORS.warning}
                colors={colors}
              />
              <OnBoardRing
                fraction={activeInsulinFraction}
                amount={String(Math.round(activeInsulin.totalUnits * 100) / 100)}
                unit="u"
                kind="insulin"
                remainingMin={activeInsulin.remainingMin}
                color={CARD_PURPLE}
                colors={colors}
              />
            </View>
          </View>
        </View>
        )}

        {!isBasalMode && dose && (
          <DoseWarningsList
            warnings={dose.warnings}
            onEnterFingerStick={canLog ? () => setFingerStickOpen(true) : undefined}
          />
        )}
      </View>

      {!isBasalMode && dose && doseBg && (
        <>
          {/* ── How your dose is calculated — ALWAYS on, floating between the two windows. Only the
              colored cards + the explanation window carry the card surface; the label/operators
              float on the page. ── */}
          {/* Collapsible since 2026-11-20: the math window stays tucked away until this title or
              its info circle is tapped (the Help tour opens it while running via calcShown). The
              pattern/cap notes below are dose annotations, not math, so they show either way. */}
          <Pressable
            key="calc-head"
            accessibilityRole="button"
            accessibilityState={{ expanded: calcShown }}
            accessibilityLabel="How your dose is calculated"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setExpandedCard(null);
              setCalcOpen((v) => !v);
            }}
            // Full-width row + generous hitSlop: the whole line is the button, not just the glyphs.
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            style={({ pressed }) => [styles.calcHeadRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.calcHeadLabel, { color: colors.textSecondary }]}>TAP TO VIEW HOW YOUR DOSE IS CALCULATED</Text>
            <Feather name="info" size={13} color={colors.textSecondary} />
          </Pressable>
          {/* ── One unified window, purple-outlined (the old Active Insulin card border): the four
              tappable pieces live inside it, and when one is open the SAME window extends down to
              wrap the explanation. Each piece stays individually tappable and works as before. ── */}
          {calcShown && (
          <View
            ref={helpCalc}
            collapsable={false}
            key="calc-window"
            style={[styles.calcUnified, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <CardShade radius={14} />
            <View style={styles.opCardsRow}>
              {opCards.map((c, i) => (
                <React.Fragment key={c.key}>
                  {i > 0 && (
                    <Text style={[styles.opSymbol, { color: colors.textMuted, fontSize: 14 * calcScale, width: 12 * calcScale }]} maxFontSizeMultiplier={1.15}>{OP_SYMBOLS[i - 1]}</Text>
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
                  {expandedCard === "correction" && (
                    /* The meter override moved here from the old Current BG tile — same state and
                       commit path (bgManual / bgInput / commitBg), now beside the math it feeds. */
                    <>
                      <View style={[styles.bgOverrideRow, { borderTopColor: colors.separator }]}>
                        <Text style={[styles.bgOverrideLabel, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>BG used</Text>
                        <TextInput
                          style={[styles.bgOverrideInput, { color: bgManual ? COLORS.primary : colors.text, borderColor: colors.border, backgroundColor: colors.backgroundTertiary }]}
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
                        <Text style={[styles.doseUnit, { color: colors.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>mg/dL</Text>
                        {latest && !bgManual && bgDraft == null ? (
                          <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}>
                            <TintShade color={COLORS.success} radius={6} />
                            <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                          </View>
                        ) : bgManual && latest ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Back to the live sensor reading"
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
                        ) : null}
                      </View>
                      <Text style={[styles.bgOverrideHint, { color: colors.textMuted }]}>
                        Type a meter number to use it instead of the sensor.
                      </Text>
                    </>
                  )}
                </View>
              );
            })()}
          </View>
          )}
          {/* No active-insulin note here: the warning at the top of the page (and the on-board bar)
              already say it, so a second copy above the suggested dose was just noise. The pattern
              and safety-cap notes below are different messages and stay. */}
          {Math.abs(dose.patternDelta) >= 0.005 && (
            <View key="pattern-note" style={[styles.calcNote, { backgroundColor: colors.backgroundTertiary }]}>
              <Feather name="bar-chart-2" size={12} color={COLORS.primary} />
              <Text style={[styles.calcNoteText, { color: colors.textSecondary }]}>
                Pattern adjustment: {dose.patternDelta > 0 ? "+" : "−"}{Math.abs(dose.patternDelta).toFixed(2)}u ({Math.round(Math.abs(dose.patternFactor - 1) * 100)}%) because doses given at this time of day have consistently run {dose.patternDelta > 0 ? "above" : "below"} the suggestions over the last two weeks. Your saved settings are unchanged. Consider reviewing them with your care team.
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

          {/* A note sits 10 below the calc window (calcNote.marginTop); when one is showing, the
              suggested dose sits the same 10 below the note — not the full section gap. */}
          <View
            key="suggest"
            ref={helpSuggest}
            collapsable={false}
            style={[
              styles.suggestCard,
              (Math.abs(dose.patternDelta) >= 0.005 || dose.cappedAtMax) && { marginTop: CALC_NOTE_GAP },
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <CardShade radius={16} />
            {/* Suggested Dose + editable badge */}
            <View style={styles.suggestTotalRow}>
              <View style={styles.doseTotalLabelWrap}>
                <Text style={[styles.doseTotalHeadLabel, { color: colors.textSecondary }]}>
                  {/* Kid-facing phrasing ONLY on a kid's access-code session — guardians,
                      caregivers, and adults all see the standard label. */}
                  {caregiverSession && accessCodeRole === "child" ? "Ask your adult to give:" : "Suggested Dose"}
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

            {/* Actions: Predict (runs an AI prediction on an EXPLICIT tap only) + I Just Took This
                Dose. Disabled exactly like Took Dose when there's no dose (faded, not clickable). */}
            <View style={[styles.doseActionsRow, { marginTop: 0 }]}>
              <Pressable
                ref={helpPredict}
                accessibilityRole="button"
                accessibilityState={{ disabled: predictDisabled, busy: predicting || drawing }}
                accessibilityLabel="Predict"
                disabled={predictDisabled}
                style={({ pressed }) => [
                  styles.tookDoseBtn,
                  {
                    backgroundColor: COLORS.primary,
                    opacity: pressed ? 0.8 : predictDisabled ? 0.5 : 1,
                  },
                ]}
                onPress={runPredict}
              >
                <AccentShade radius={11} />
                {predicting || drawing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="trending-up" size={13} color="#fff" />
                )}
                <Text
                  style={styles.tookDoseBtnText}
                  numberOfLines={ACTION_LABEL_LINES}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={1.6}
                >
                  {predicting || drawing ? "Predicting…" : prediction?.ok ? "Predict Again" : "Predict"}
                </Text>
              </Pressable>
              {tookDoseButton}
            </View>

            {/* Graph — appears only after a Predict tap. While the model works we show a "building"
                placeholder; the result holds until Predict is tapped again (never auto-updates). If
                the AI prediction can't be produced we say so — there is no local-math fallback.
                While LOCKED the graph area shows the unlock message instead: the section stays
                visible (button greyed via predictDisabled) but can't run until 7 days have logs. */}
            {predictLocked ? (
              <View key="locked" style={[styles.predictBuilding, { borderColor: colors.border, opacity: 0.75 }]}>
                <Feather name="lock" size={18} color={colors.textMuted} />
                <Text style={[styles.predictLockedText, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.4}>
                  Log 7 days to unlock accurate predictions
                </Text>
                <Text style={[styles.predictLockedSub, { color: colors.textMuted }]} maxFontSizeMultiplier={1.4}>
                  {predictDaysLeft} of {PREDICTION_UNLOCK_DAYS} days remaining
                </Text>
              </View>
            ) : showPrediction && (
              <View key="graph-area">
                {predicting ? (
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
                      forecast={prediction.forecast}
                      currentBG={doseBg?.n ?? prediction.forecast[0]?.bg ?? 0}
                      targetGlucose={targetGlucose}
                      lowThreshold={alertPrefs.lowThreshold}
                      highThreshold={alertPrefs.highThreshold}
                      urgentHighThreshold={alertPrefs.urgentHighThreshold}
                      nowMs={nowMs}
                      onDismiss={dismissPrediction}
                      redrawKey={`run-${predictRunRef.current}`}
                      colors={colors}
                      onDrawComplete={() => setDrawing(false)}
                    />
                    <PredictionStrength result={prediction} colors={colors} />
                    <Text style={[styles.predictStaleHint, { color: colors.textMuted }]}>
                      The more you use the app, the more accurate your predictions will be
                    </Text>
                    {predictionStale && (
                      <Text style={[styles.predictStaleHint, { color: colors.textMuted }]}>
                        Inputs changed. Tap Predict to update.
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
                      Couldn&apos;t reach the prediction service. Check your connection and tap Predict to try again.
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
                    ? `0.2 u/kg × ${Math.round((profile?.weightLbs ?? 0) * 0.45359237)} kg, starting estimate`
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
                    ? "Basal dose: enter your prescribed amount"
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
                      : "none, since I haven't logged a basal dose or set my weight";
                  const fastingDesc =
                    basalDose.fastingAvg != null
                      ? `${basalDose.fastingAvg} mg/dL (target ${targetGlucose})`
                      : "not enough early-morning readings";
                  const prompt = `Explain my basal insulin dose. I use ${selectedInsulinOption ? insulinDisplayLabel(selectedInsulinOption) : "a long-acting insulin"}. Baseline: ${baselineDesc}. 3-day fasting average: ${fastingDesc}. Fasting adjustment: ${basalDose.fastingAdjustment}u. Suggested dose: ${formatDoseAmount(basalDose.totalDose)}u.${manualNote} How does basal titration work, and when should I take it?`;
                  openChat(prompt);
                }}
              >
                <TintShade color={COLORS.primary} radius={11} />
                <Feather name="help-circle" size={13} color={COLORS.primary} />
                <Text style={[styles.explainBtnText, { color: COLORS.primary }]}>Explain My Dose</Text>
              </Pressable>
              {tookDoseButton}
            </View>
          </>
        )}

      {/* ── My Insulin — every open pen/vial in a horizontal strip under the dose card (the
          prediction window, when open, sits above this inside the card): countdown ring, the name
          the family gave it, and days left. Tapping a chip or the arrow opens the full My Insulin
          sheet (start new, edit, History). The strip up top stays a pure calculator selector. ── */}
      {!doctorSession && (
        <View ref={helpMyInsulin} collapsable={false} style={styles.pensStripRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.insulinStripChips} style={{ flex: 1 }}>
            {stripPens.length === 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start new insulin"
                onPress={openPensSheet}
                style={({ pressed }) => [styles.pensChip, { borderColor: colors.border, borderStyle: "dashed", opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="plus" size={13} color={COLORS.primaryLight} />
                <Text numberOfLines={1} style={[styles.pensChipTitle, { color: colors.textSecondary }]}>Start new insulin</Text>
              </Pressable>
            ) : (
              stripPens.map(({ pen, status }) => (
                <Pressable
                  key={pen.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${penTitle(pen)}, ${status.label}. Opens My Insulin.`}
                  onPress={openPensSheet}
                  style={({ pressed }) => [styles.pensChip, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
                >
                  <ControlShade radius={12} />
                  <PenStripRing daysLeft={status.daysLeft} tone={status.tone} fraction={status.fraction} colors={colors} />
                  <View style={{ minWidth: 0 }}>
                    <Text numberOfLines={1} style={[styles.pensChipTitle, { color: colors.text }]}>{penTitle(pen)}</Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.pensChipSub,
                        { color: status.tone === "ok" ? colors.textSecondary : status.tone === "soon" ? COLORS.warning : COLORS.danger },
                      ]}
                    >
                      {status.label}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open My Insulin"
            hitSlop={10}
            onPress={openPensSheet}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
          >
            <Feather name="chevron-right" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      )}

      {history.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <CardShade radius={16} />
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No readings yet</Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            {isMinor
              ? "Sync your CGM or add a reading from the Glucose tab to see your trends here!"
              : "Sync your CGM or add readings from the Glucose tab to see trend analysis."}
          </Text>
        </View>
      )}

      <View ref={helpDisclaimer} collapsable={false} style={[styles.disclaimer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <CardShade radius={12} />
        <Feather name="info" size={14} color={colors.textMuted} />
        <Text style={[styles.disclaimerText, { color: colors.textMuted }]}>
          This app provides estimates only and does not replace medical advice. Always follow your doctor's instructions.
        </Text>
      </View>
    </ScrollView>
      )}

      {/* ── My Insulin sheet — the full pens card (start new, edit, History), opened from the
          insulin strip's chevron. The card component is unchanged; only its home moved. ── */}
      <DashboardSectionModal
        visible={pensSheetOpen}
        onClose={() => setPensSheetOpen(false)}
        accessibilityLabel="My Insulin"
      >
        <PensCard
          colors={colors}
          canEdit={canLog}
          choice={{ insulinTypes: profile?.insulinTypes, insulinPens: profile?.insulinPens, insulinVials: profile?.insulinVials }}
        />
      </DashboardSectionModal>

      <LogFingerStickModal
        visible={fingerStickOpen}
        onClose={() => setFingerStickOpen(false)}
        selectedDay={new Date()}
        initialReason="before_dosing"
        colors={colors}
      />
      {stackingModal}
    </View>
  );
}

const STRENGTH_META: Record<StrengthLabel, { text: string; color: string }> = {
  strong: { text: "Strong match", color: COLORS.success },
  good: { text: "Good match", color: COLORS.primary },
  rough: { text: "Rough estimate", color: "#F59E0B" },
  building: { text: "Building. Log more to sharpen predictions", color: "#8190A4" },
};

/** The reference-strength readout under the prediction chart (combines the chosen matches' confidence). */
/** Mini pen-countdown ring for the My Insulin strip — PenRing (components/PensCard) at chip scale. */
function PenStripRing({
  daysLeft,
  tone,
  fraction,
  colors,
}: {
  daysLeft: number;
  tone: "ok" | "soon" | "today" | "over";
  fraction: number;
  colors: (typeof Colors)["light"];
}) {
  const size = 26;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = tone === "ok" ? COLORS.primaryLight : tone === "soon" ? COLORS.warning : COLORS.danger;
  const overdue = tone === "today" || tone === "over";
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={overdue ? color : colors.border} strokeWidth={stroke} fill={overdue ? color + "22" : "none"} />
        {!overdue && fraction > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * fraction} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <Text style={{ fontSize: 9, fontWeight: "800", color: tone === "ok" ? colors.text : color }} maxFontSizeMultiplier={1.2}>
        {overdue ? "!" : String(daysLeft)}
      </Text>
    </View>
  );
}

/**
 * On-board drain ring — active carbs or active insulin, in the pens' ring language (PenRing in
 * components/PensCard): the arc is the share still working and empties as the body absorbs; the
 * amount sits in the middle with its unit, and "<kind> · <time left>" rides underneath. Renders a
 * faint empty track at zero so the pair reads as a steady fixture, never a pop-in.
 */
function OnBoardRing({
  fraction,
  amount,
  unit,
  kind,
  remainingMin,
  color,
  colors,
}: {
  /** Share still active, 0–1 (amount-based: utils/onBoard activeFractionRemaining). */
  fraction: number;
  /** The number in the ring's middle, e.g. "9" or "0.5". */
  amount: string;
  unit: string;
  /** Caption word: "carbs" / "insulin". */
  kind: string;
  /** Minutes until the last entry finishes absorbing — the caption's time. */
  remainingMin: number;
  color: string;
  colors: (typeof Colors)["light"];
}) {
  const size = 54;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const active = fraction > 0;
  // Same end-of-window sliver rule as the old bars: never read as empty while still deducting.
  const frac = active ? Math.max(0.06, Math.min(1, fraction)) : 0;
  const hours = remainingMin / 60;
  const timeLabel = !active
    ? null
    : remainingMin < 60
      ? `${Math.max(1, Math.round(remainingMin))}m`
      : `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  return (
    <View style={styles.ringCell}>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
          {active && (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${c * frac} ${c}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </Svg>
        <View style={{ alignItems: "center" }}>
          <Text
            style={[styles.ringAmount, { color: active ? color : colors.textMuted }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            maxFontSizeMultiplier={1.2}
          >
            {amount}
          </Text>
          <Text style={[styles.ringUnit, { color: colors.textMuted }]} maxFontSizeMultiplier={1.2}>{unit}</Text>
        </View>
      </View>
      <Text style={[styles.ringCaption, { color: active ? color : colors.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {timeLabel ? `${kind} · ${timeLabel}` : kind}
      </Text>
    </View>
  );
}

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

/**
 * THE one vertical gap between sections on the Dose tab — the same 16 that sits between the suggested
 * dose window and the disclaimer. Every section below the dose card owns its TOP margin of this size
 * and nothing owns a bottom margin, so whatever renders (the on-board bars, the calc head, the
 * window, the suggestion, the empty state, the disclaimer) is always exactly this far from whatever
 * came before it. No negative-margin cancelling, no gap that depends on which sections are showing.
 */
const SECTION_GAP = 16;
/**
 * Lines the Predict / "I Just Took This Dose" labels may use. One at normal text sizes; two once the
 * device text size is up, because "I Just Took This Dose" on one line would then have to shrink below
 * the 80% floor and truncate. The label's box is bounded either way, so the icon stays on the button.
 * Read once: the device text size can't change while the app is running.
 */
const ACTION_LABEL_LINES = PixelRatio.getFontScale() > 1.05 ? 2 : 1;
/** Gap around a note under the calc window (pattern / safety-cap): above it, and below it when shown. */
const CALC_NOTE_GAP = 10;

const styles = StyleSheet.create({
  root: { flex: 1 },
  // iPad: cap + center the content column so it doesn't stretch across a 13" screen. No-op on phones.
  scroll: { paddingHorizontal: 20, paddingTop: 10, width: "100%", maxWidth: T.layout.contentMaxWidth, alignSelf: "center" },

  screenHeader: { paddingBottom: 10,},




  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 10 },

  // ── Title row + insulin dropdown ──
  insulinStripRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  insulinStripBody: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
  insulinStripChips: { flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 4 },
  insulinStripEmpty: { fontSize: 12, fontWeight: "500" },
  // The chip is the old header dropdown's visual language (card fill, hairline border, droplet,
  // ControlShade) with the old Dose/Log toggle's selected treatment (solid primary + AccentShade).
  insulinChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, overflow: "hidden" },
  insulinChipText: { fontSize: 12.5, fontWeight: "600", maxWidth: 110 },
  // ── My Insulin strip (under the dose card): one chip per open pen/vial. ──
  pensStripRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: SECTION_GAP },
  pensChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  pensChipTitle: { fontSize: 12, fontWeight: "600", maxWidth: 150 },
  pensChipSub: { fontSize: 10.5, fontWeight: "600", marginTop: 1 },
  bgOverrideRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  bgOverrideLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  bgOverrideInput: { minWidth: 64, textAlign: "center", fontSize: 15, fontWeight: "700", borderWidth: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10 },
  bgOverrideHint: { fontSize: 11, fontWeight: "400", marginTop: 6 },
  pageSub: { fontSize: 12.5, fontWeight: "500", marginTop: 2 },
  // ── "How your dose is calculated" op cards ──
  // The head is a section of its own: SECTION_GAP above it (from whatever precedes — the dose card or
  // the on-board bars) and SECTION_GAP below it (calcUnified's top margin).
  calcHeadRow: { marginTop: SECTION_GAP, marginBottom: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  calcHeadLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  /** The single purple-outlined window housing the four pieces + the opened explanation. */
  calcUnified: { marginTop: SECTION_GAP, borderWidth: 1.5, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 8 },
  opCardsRow: { flexDirection: "row", alignItems: "flex-start", gap: 2 },
  opSymbol: { fontSize: 14, fontWeight: "800", alignSelf: "center", width: 12, textAlign: "center" },
  // aspectRatio 1 makes each card a square (height follows the flex-computed width); content is
  // centered vertically now that the card is taller.
  opCard: { flex: 1, minWidth: 0, aspectRatio: 1, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", gap: 5 },
  // No lineHeight here on purpose, and alignSelf:"stretch" is load-bearing — see the sizing
  // comment in OpCard before touching either.
  opLabel: { fontSize: 9.5, fontWeight: "700", textAlign: "center", alignSelf: "stretch" },
  opValue: { fontSize: 15, fontWeight: "800", textAlign: "center", alignSelf: "stretch" },
  /** Third row inside each piece: the live input value, title-grey and smaller than the value. */
  opSub: { fontSize: 9.5, fontWeight: "600", textAlign: "center", alignSelf: "stretch" },
  calcNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 11, borderRadius: 10, marginTop: CALC_NOTE_GAP },
  calcNoteText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 17 },

  // ── Collapsible "Your Dose Breakdown" ──
  /** Lives INSIDE calcUnified — a soft top rule separates it from the pieces row above. */
  breakdownWrap: { marginTop: 10, paddingTop: 12, paddingHorizontal: 8, paddingBottom: 5, borderTopWidth: 1, gap: 7 },
  breakdownTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  breakdownIcon: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  breakdownTitle: { fontSize: 17, fontWeight: "800" },
  breakdownLine: { fontSize: 13.5, fontWeight: "400", lineHeight: 20 },

  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, marginTop: SECTION_GAP },
  disclaimerText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 18 },


  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10, marginTop: SECTION_GAP },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 14, fontWeight: "400", textAlign: "center", lineHeight: 20 },

  // No bottom margin: the section after it (bars, calc head, or the disclaimer in basal mode) brings
  // its own SECTION_GAP, so the space under the card is the same in every state.
  doseCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  doseInputRow: { flexDirection: "row", gap: 12, paddingVertical: 2 },
  doseInputGroup: { flex: 1, alignItems: "center", gap: 5 },
  /** Bolus carbs half only: stretch to the rings half's height, bottom line level with captions. */
  doseInputGroupSpread: { justifyContent: "space-between" },
  /** The ✕ on the ACTIVE CARBS overlay — floated up-right into the dose card's padding, clear of
   *  the centered title (whose accessibility growth is capped) at every text size. */
  overlayDismiss: { position: "absolute", top: -13, right: -11, zIndex: 2 },
  doseInputHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  doseInputLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, flexShrink: 1 },
  doseValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 },
  doseBigInput: { fontSize: 20, fontWeight: "700", textAlign: "center", minWidth: 30, maxWidth: 80, padding: 0 },
  doseUnit: { fontSize: 12, fontWeight: "500" },
  doseHint: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  // Laid out as a ROW so each bar sits under the column it belongs to — carbs left, insulin right,
  // mirroring the CARBS | CURRENT BG split in the card above.
  // ── "Still working" on-board rings (OnBoardRing) — pens' ring language, see PenRing. ──
  ringsRow: { flexDirection: "row", alignItems: "flex-start", gap: 16, paddingTop: 2 },
  ringCell: { alignItems: "center", gap: 4 },
  ringAmount: { fontSize: 13, fontWeight: "800", lineHeight: 15 },
  ringUnit: { fontSize: 8.5, fontWeight: "600", lineHeight: 10 },
  ringCaption: { fontSize: 10.5, fontWeight: "600" },
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
  // Sits one card-gap below the calc window (the divider that used to separate them is gone).
  // No bottom margin: the disclaimer below owns that gap, so it's the SAME 16px whether the
  // prediction graph is open (it grows this card from the inside) or not.
  suggestCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: SECTION_GAP, gap: 14 },
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
  // flexShrink so the text box is bounded by the button (shrink-to-fit needs a bound to fit into).
  tookDoseBtnText: { flexShrink: 1, fontSize: 12, fontWeight: "700", color: "#fff", textAlign: "center" },
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
  predictLockedText: { fontSize: 13, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },
  predictLockedSub: { fontSize: 12, fontWeight: "500" },
  predictUnavailableSub: { fontSize: 12, fontWeight: "400", textAlign: "center", lineHeight: 17, paddingHorizontal: 24 },
  strengthPill: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10, paddingHorizontal: 2 },
  strengthDot: { width: 9, height: 9, borderRadius: 4.5 },
  strengthText: { fontSize: 12, fontWeight: "500", flex: 1 },
  predictStaleHint: { fontSize: 12, fontWeight: "500", fontStyle: "italic", marginTop: 6, paddingHorizontal: 2 },

});
