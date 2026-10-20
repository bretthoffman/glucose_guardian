import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { T, glucoseTone, withAlpha } from "@/constants/theme";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth, type FoodLogEntry } from "@/context/AuthContext";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";

import { getEffectiveTrend, trendTone } from "@/utils/trend";
import TabGlucoseHeaderRow, { TabGlucoseHeaderShell, tabGlucoseHeaderPaddingTop } from "@/components/TabGlucoseHeaderRow";
import FoodInsulinModal from "@/components/FoodInsulinModal";
import { apiUrl } from "@/utils/api-base-url";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";
import { AccentShade, CardShade, ControlShade, ScreenShade, TintShade } from "@/components/Shade";
import QuickLookupManager from "@/components/QuickLookupManager";
import EditFoodModal from "@/components/EditFoodModal";
import { canEditExistingLogs } from "@/utils/logEditPermission";
import { FOOD_QUICK_TAB_STORAGE_KEY } from "@/constants/storage-keys";
import FoodScanner, { type BarcodeLookupState } from "@/components/FoodScanner";
import {
  QUICK_LOOKUP_VISIBLE,
  editQuickFood,
  findQuickFood,
  formatCarbs,
  formatRecentWhen,
  isQuickFood,
  mealInsulinUnits,
  recentFoods,
  splitFoodName,
  type QuickFood,
} from "@/utils/quickFoods";

type QuickTab = "recent" | "favorites";
import { useHelpAnchor, useHelpPage, useHelpScroll } from "@/context/HelpContext";

interface FoodResult {
  foodName: string;
  estimatedCarbs: number;
  confidence: "high" | "medium" | "low";
  portion?: string;
  tips?: string;
  insulinUnits?: number;
  fromPhoto?: boolean;
  /** Optional nutrition context from the AI/lookup — plain carbs-only results stay supported. */
  fatGrams?: number;
  proteinGrams?: number;
  absorption?: "fast" | "medium" | "slow";
  /** Barcode results: label values are per ONE serving; the servings picker scales them. */
  fromBarcode?: boolean;
  source?: "usda" | "openfoodfacts";
  perServing?: { carbs: number; fat?: number; protein?: number };
  servingText?: string;
  servingsPerContainer?: number;
}

/** Whole servings, 1–99, from whatever the picker holds. */
function parseServings(text: string): number {
  const n = Math.round(parseFloat(text));
  return Number.isFinite(n) && n >= 1 ? Math.min(99, n) : 1;
}

interface MealGuidance {
  insulinDose: number;
  currentGlucose: number;
  predictedPeak30: number;
  predicted60WithInsulin: number;
  predicted60WithoutInsulin: number;
  targetGlucose: number;
  inRange30: boolean;
  inRange60: boolean;
  timingAdvice: string;
  timingEmoji: string;
  friendlyMessage: string;
  monsterMood: "happy" | "worried" | "danger";
  trendDirection: string;
}

/**
 * One Quick Lookup row (Recent or Favorites): a bold title with a small second line, the carbs, then
 * a pencil (edit) and a heart (favorite). Tapping the name/carbs looks the food up, as before.
 * The second line is the logged time on Recent, and the part of a long name that was in parentheses
 * on Favorites.
 */
function QuickFoodRow({
  title,
  detail,
  carbs,
  selected,
  isFavorite,
  last,
  colors,
  onPress,
  onEdit,
  onToggleFavorite,
  editLabel,
}: {
  title: string;
  detail?: string;
  carbs?: number;
  selected: boolean;
  isFavorite: boolean;
  last: boolean;
  colors: (typeof Colors)["light"];
  onPress: () => void;
  /** Omitted when this session may not edit (the pencil is hidden). */
  onEdit?: () => void;
  onToggleFavorite: () => void;
  editLabel: string;
}) {
  return (
    <View
      style={[
        styles.quickRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Look up ${title}`}
        style={({ pressed }) => [styles.quickRowMain, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.quickRowText}>
          <Text style={[styles.quickRowName, { color: selected ? COLORS.primary : colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text style={[styles.quickRowDetail, { color: colors.textSecondary }]} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <View style={styles.quickRowCarbs}>
          <Text style={[styles.quickRowCarbsValue, { color: carbs != null ? colors.text : colors.textMuted }]}>
            {carbs != null ? formatCarbs(carbs) : "—"}
          </Text>
          <Text style={[styles.quickRowCarbsUnit, { color: colors.textSecondary }]}>g carbs</Text>
        </View>
      </Pressable>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={editLabel}
          hitSlop={4}
          style={({ pressed }) => [styles.quickIconBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="edit-2" size={16} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onToggleFavorite}
        accessibilityRole="button"
        accessibilityState={{ selected: isFavorite }}
        accessibilityLabel={isFavorite ? `Remove ${title} from Favorites` : `Add ${title} to Favorites`}
        hitSlop={4}
        style={({ pressed }) => [styles.quickIconBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <MaterialCommunityIcons
          name={isFavorite ? "heart" : "heart-outline"}
          size={20}
          color={isFavorite ? COLORS.primaryLight : colors.textSecondary}
        />
      </Pressable>
    </View>
  );
}

const TREND_LABELS: Record<string, string> = {
  rapidly_rising: "↑↑ Rising fast",
  rising: "↑ Rising",
  stable: "→ Stable",
  falling: "↓ Falling",
  rapidly_falling: "↓↓ Falling fast",
};

const MONSTER_FACE: Record<string, string> = {
  happy: "😊",
  worried: "😟",
  danger: "😨",
};

const SPIKE_COLOR = (predicted: number, target: number): string => {
  if (predicted <= target + 30) return COLORS.success;
  if (predicted <= target + 80) return COLORS.warning;
  return COLORS.danger;
};

export default function FoodScreen() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { carbRatio, targetGlucose, correctionFactor, latestReading, history } = useGlucose();
  const {
    addFoodLogEntry, editFoodLogEntry, foodLog, isMinor, quickFoods, saveQuickFood, updateQuickFoodCarbs, removeQuickFood,
    reorderQuickFoods, alertPrefs,
    accessCodeRole, accessCodePermissions, profile, caregiverSession,
  } = useAuth();
  // Same grant derivation as the Insulin page (which shows/hides its tabs by these): an access-code
  // (kid/caregiver) session only gets the actions its grants allow; every account session gets both.
  const isAccessCodeSession = accessCodeRole != null;
  const canUseCalculator = !isAccessCodeSession || !!accessCodePermissions?.useCalculator;
  const canLogMeals = !isAccessCodeSession || !!accessCodePermissions?.log;
  const confirmLog = useCareLogConfirm();
  // Same rule as the Log page: who may correct an existing entry (the Recent tab's pencil).
  const canEditLogs = canEditExistingLogs({
    isCaregiverAccount: profile?.accountRole === "caregiver",
    caregiverSession,
    accessCodeRole,
    canAddLogs: !!accessCodePermissions?.log,
  });

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FoodResult | null>(null);
  const [guidance, setGuidance] = useState<MealGuidance | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [isFetchingGuidance, setIsFetchingGuidance] = useState(false);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState(false);
  const [editedCarbs, setEditedCarbs] = useState<string>("");

  // ── "Calculate Insulin" popup — ORDER-AWARE so the same meal counts exactly once: the analyzed
  // carbs pre-fill the popup's real input in BOTH orders, and when the meal was logged first the
  // popup sets THAT log entry aside in its active-carbs math (see excludeLogTimestamp). Once this
  // meal's insulin is taken the button stays "Insulin Taken" until a new analysis replaces the
  // meal — the anti-stacking rule from before. ──
  const [insulinCalcVisible, setInsulinCalcVisible] = useState(false);
  const [insulinTaken, setInsulinTaken] = useState(false);
  /** The timestamp of the entry "Log This Meal" wrote — the popup sets that log aside in its math. */
  const [loggedEntryTimestamp, setLoggedEntryTimestamp] = useState<string | null>(null);

  // ── Quick Lookup chips now live in AuthContext: one mutual list for the whole care circle
  // (an add by any co-guardian shows up on every guardian's Food tab within a poll). ──
  const [savedToQuick, setSavedToQuick] = useState(false);
  const [quickManagerOpen, setQuickManagerOpen] = useState(false);
  /**
   * The saved/recent name the current lookup came from. The AI may return a slightly different
   * foodName, so logging updates THIS favorite's carbs (the "carbs don't stick" fix).
   */
  const [quickSource, setQuickSource] = useState<string | null>(null);
  // ── Recent / Favorites tabs. The last tab used is remembered on this device; until then Recent
  // shows when there's anything logged, Favorites otherwise. ──
  const [quickTabChoice, setQuickTabChoice] = useState<QuickTab | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(FOOD_QUICK_TAB_STORAGE_KEY)
      .then((v) => {
        if (v === "recent" || v === "favorites") setQuickTabChoice((cur) => cur ?? v);
      })
      .catch(() => {});
  }, []);
  const recentList = recentFoods(foodLog, QUICK_LOOKUP_VISIBLE);
  const quickTab: QuickTab = quickTabChoice ?? (recentList.length > 0 ? "recent" : "favorites");
  const chooseQuickTab = (tab: QuickTab) => {
    if (tab === quickTab) return;
    Haptics.selectionAsync();
    setQuickTabChoice(tab);
    AsyncStorage.setItem(FOOD_QUICK_TAB_STORAGE_KEY, tab).catch(() => {});
  };
  const [editingLog, setEditingLog] = useState<FoodLogEntry | null>(null);
  const [editingFavorite, setEditingFavorite] = useState<QuickFood | null>(null);
  const [favoriteToast, setFavoriteToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  const flashFavoriteToast = (text: string) => {
    setFavoriteToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setFavoriteToast(null), 1800);
  };
  function addFavorite(name: string, carbs?: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    saveQuickFood(name, carbs);
    flashFavoriteToast("Added to Favorites");
  }
  function confirmRemoveFavorite(name: string) {
    Alert.alert("Remove from Favorites?", splitFoodName(name).title, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          removeQuickFood(name);
          flashFavoriteToast("Removed from Favorites");
        },
      },
    ]);
  }
  const toggleFavorite = (name: string, carbs?: number) =>
    isQuickFood(quickFoods, name) ? confirmRemoveFavorite(name) : addFavorite(name, carbs);
  // ── Help Mode wiring (refs only; see context/HelpContext + utils/helpScripts). ──
  useHelpPage();
  const helpScrollRef = useRef<import("react-native").ScrollView>(null);
  const helpScrollProps = useHelpScroll("food", helpScrollRef);
  const helpTrendChip = useHelpAnchor("food.trend");
  const helpScan = useHelpAnchor("food.scan");
  const helpSearch = useHelpAnchor("food.search");
  const helpEstimate = useHelpAnchor("food.estimate");
  const helpQuick = useHelpAnchor("food.quick");
  const helpSeeAll = useHelpAnchor("food.seeAll");
  // Camera screen (barcode detection + shutter) and the barcode lookup it drives.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeLookup, setBarcodeLookup] = useState<BarcodeLookupState>("idle");
  /** Servings picker for barcode results (text so the field can be cleared while typing). */
  const [servingsText, setServingsText] = useState("1");

  function saveToQuickLookup() {
    if (!result || savedToQuick) return;
    // Save the number on screen — if it was corrected, the correction is what should stick.
    const edited = parseFloat(editedCarbs);
    saveQuickFood(result.foodName, Number.isFinite(edited) && edited >= 0 ? edited : result.estimatedCarbs);
    setSavedToQuick(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const confidenceColor = {
    high: COLORS.success,
    medium: COLORS.warning,
    low: COLORS.danger,
  };

  const currentTrend = getEffectiveTrend(history).glucoseTrend;
  // The trend's color, exactly as the Glucose page's trend pill picks it: fast → red, slow → amber,
  // stable → the reading's own status color.
  const trendStatusColor =
    latestReading?.glucose != null
      ? glucoseTone(latestReading.glucose, alertPrefs.lowThreshold, alertPrefs.highThreshold, alertPrefs.urgentHighThreshold)
      : T.color.emerald;
  const trendColor = trendTone(currentTrend, trendStatusColor);

  async function fetchGuidance(carbs: number) {
    setIsFetchingGuidance(true);
    try {
      const res = await fetch(apiUrl("/api/insulin/predict"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carbs,
          currentGlucose: latestReading?.glucose ?? null,
          carbRatio,
          targetGlucose,
          correctionFactor,
          trendDirection: currentTrend,
          isMinor,
        }),
      });
      if (res.ok) {
        const data: MealGuidance = await res.json();
        setGuidance(data);
      }
    } catch {}
    setIsFetchingGuidance(false);
  }

  /**
   * `startCarbs`: the saved/last-logged carbs when the lookup comes from a Quick Lookup row — the
   * card starts from that number instead of a fresh estimate, so a corrected value (5.5 g, not the
   * estimate's 45 g) sticks. `source` is that row's name (see quickSource).
   */
  async function search(food: string, opts?: { startCarbs?: number; source?: string }) {
    // Estimate Carbs button + Quick Lookup chips both route here — dismiss the keyboard on tap.
    Keyboard.dismiss();
    const q = food.trim();
    if (!q) return;
    setQuery(q);
    setError("");
    setIsLoading(true);
    setResult(null);
    setGuidance(null);
    setPhotoUri(null);
    setLogged(false);
    setInsulinTaken(false);
    setLoggedEntryTimestamp(null);
    setSavedToQuick(false);
    setQuickSource(opts?.source ?? null);
    try {
      const res = await fetch(apiUrl("/api/food/estimate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: q }),
      });
      const data: FoodResult = await res.json();
      const startCarbs =
        opts?.startCarbs != null && Number.isFinite(opts.startCarbs) && opts.startCarbs >= 0 ? opts.startCarbs : data.estimatedCarbs;
      const insulinUnits = mealInsulinUnits(startCarbs, carbRatio);
      const finalResult = { ...data, estimatedCarbs: startCarbs, insulinUnits, fromPhoto: false };
      setResult(finalResult);
      setEditedCarbs(formatCarbs(startCarbs));
      setSavedToQuick(isQuickFood(quickFoods, data.foodName) || (opts?.source != null && isQuickFood(quickFoods, opts.source)));
      // A favorite that has no carbs on file yet (older saves) learns them now. One that HAS carbs is
      // never overwritten by a fresh estimate — that was the "45 g keeps coming back" bug.
      const saved = findQuickFood(quickFoods, opts?.source ?? q);
      if (saved && saved.carbs == null) updateQuickFoodCarbs(saved.name, data.estimatedCarbs);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchGuidance(startCarbs);
    } catch {
      setError("Could not estimate. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  /** The scan panel: our own camera screen — barcode detection while framing, shutter for a photo. */
  function takePhoto() {
    setError("");
    setBarcodeLookup("idle");
    setScannerOpen(true);
  }

  /** Fallback when camera access is refused: the system picker path this page always had. */
  async function takePhotoWithSystemCamera() {
    setScannerOpen(false);
    setError("");
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      const { status: galleryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (galleryStatus !== "granted") {
        setError("Camera or photo library permission is needed to analyze food.");
        return;
      }
      await pickFromGallery();
      return;
    }

    const pickerResult = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });

    if (!pickerResult.canceled && pickerResult.assets[0]) {
      await analyzePhoto(pickerResult.assets[0].uri);
    }
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setError("Photo library permission is needed to analyze food.");
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });

    if (!pickerResult.canceled && pickerResult.assets[0]) {
      await analyzePhoto(pickerResult.assets[0].uri);
    }
  }

  /** A barcode was detected on the camera screen: look it up; on a hit close the camera and show it. */
  async function lookupBarcode(code: string) {
    setBarcodeLookup("looking");
    try {
      const res = await fetch(apiUrl("/api/food/barcode"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.status === 404) {
        // Our endpoint answers 404 with { found: false }. Any other 404 is a server without the
        // route (e.g. not deployed yet) — that is an error, not "this product is unknown".
        const body = await res.json().catch(() => null) as { found?: boolean } | null;
        if (body && body.found === false) {
          setBarcodeLookup("notFound");
          return;
        }
        throw new Error("barcode endpoint unavailable");
      }
      if (!res.ok) throw new Error(`barcode lookup failed (${res.status})`);
      const data = (await res.json()) as {
        foodName: string; source?: "usda" | "openfoodfacts"; estimatedCarbs: number; confidence: "high" | "medium" | "low";
        tips?: string; fatGrams?: number; proteinGrams?: number; absorption?: "fast" | "medium" | "slow";
        servingText?: string; servingsPerContainer?: number;
      };
      const carbs = data.estimatedCarbs;
      const result: FoodResult = {
        foodName: data.foodName,
        estimatedCarbs: carbs,
        confidence: data.confidence,
        tips: data.tips,
        insulinUnits: Math.round((carbs / carbRatio) * 10) / 10,
        fromPhoto: false,
        fromBarcode: true,
        source: data.source,
        fatGrams: data.fatGrams,
        proteinGrams: data.proteinGrams,
        absorption: data.absorption,
        perServing: { carbs, fat: data.fatGrams, protein: data.proteinGrams },
        servingText: data.servingText,
        servingsPerContainer: data.servingsPerContainer,
        portion: data.servingText ? `1 serving · ${data.servingText}` : "1 serving",
      };
      setScannerOpen(false);
      setBarcodeLookup("idle");
      setQuery("");
      setPhotoUri(null);
      setGuidance(null);
      setLogged(false);
      setInsulinTaken(false);
      setLoggedEntryTimestamp(null);
      setSavedToQuick(false);
      setQuickSource(null);
      setError("");
      setServingsText("1");
      setResult(result);
      setEditedCarbs(String(carbs));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchGuidance(carbs);
    } catch {
      setScannerOpen(false);
      setBarcodeLookup("idle");
      setError("Could not look up that barcode. Please try again or take a photo.");
    }
  }

  /** Servings changed on a barcode result: scale the label's per-serving values across the card. */
  function applyServings(text: string) {
    setServingsText(text);
    if (!result?.fromBarcode || !result.perServing) return;
    const n = parseServings(text);
    const per = result.perServing;
    const carbs = Math.round(per.carbs * n * 10) / 10;
    setResult({
      ...result,
      estimatedCarbs: carbs,
      insulinUnits: Math.round((carbs / carbRatio) * 10) / 10,
      fatGrams: per.fat != null ? Math.round(per.fat * n * 10) / 10 : undefined,
      proteinGrams: per.protein != null ? Math.round(per.protein * n * 10) / 10 : undefined,
      portion: `${n} serving${n === 1 ? "" : "s"}${result.servingText ? ` · ${result.servingText} each` : ""}`,
    });
    setEditedCarbs(String(carbs));
    void fetchGuidance(carbs);
  }

  async function analyzePhoto(uri: string) {
    setPhotoUri(uri);
    setResult(null);
    setGuidance(null);
    setQuery("");
    setLogged(false);
    setInsulinTaken(false);
    setLoggedEntryTimestamp(null);
    setSavedToQuick(false);
    setQuickSource(null);
    setError("");
    setIsAnalyzingPhoto(true);

    let base64: string;
    try {
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipResult.base64) {
        throw new Error("No base64 output from image manipulator");
      }
      base64 = manipResult.base64;
    } catch (manipErr) {
      console.error("Image conversion error:", manipErr);
      setError("Could not process the photo. Please try a different image.");
      setIsAnalyzingPhoto(false);
      return;
    }

    try {
      const res = await fetch(apiUrl("/api/food/analyze-photo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoBase64: base64,
          mimeType: "image/jpeg",
          carbRatio,
        }),
      });

      if (!res.ok) {
        let errorMsg = "Could not analyze photo. Please try again.";
        try {
          const errBody = await res.json();
          errorMsg = errBody.error || errorMsg;
        } catch {
          if (res.status === 413) {
            errorMsg = "Photo is too large. Try taking a closer, smaller shot.";
          } else {
            errorMsg = `Server error (${res.status}). Please try again.`;
          }
        }
        setError(errorMsg);
        setIsAnalyzingPhoto(false);
        return;
      }

      const data = await res.json();
      setResult({ ...data, fromPhoto: true });
      setEditedCarbs((data.estimatedCarbs ?? 0).toString());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchGuidance(data.estimatedCarbs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("Network") || message.includes("fetch")) {
        setError("Network error. Make sure you have an internet connection.");
      } else {
        setError("Could not analyze photo. Please try again.");
      }
    } finally {
      setIsAnalyzingPhoto(false);
    }
  }

  /** Close the analysis card and reset the page — the search-bar ✕ and the card's ✕ share this.
   *  A meal that was already logged stays logged; only the on-screen analysis is dismissed. */
  function resetAnalysis() {
    setQuery("");
    setResult(null);
    setGuidance(null);
    setError("");
    setPhotoUri(null);
    setLogged(false);
    setInsulinTaken(false);
    setLoggedEntryTimestamp(null);
    setSavedToQuick(false);
    setQuickSource(null);
    setEditedCarbs("");
    setServingsText("1");
  }

  function logMeal() {
    if (!result) return;
    const parsedCarbs = parseFloat(editedCarbs);
    const carbs = Number.isFinite(parsedCarbs) && parsedCarbs >= 0 ? parsedCarbs : result.estimatedCarbs;
    // Caregiver sessions confirm before writing into the patient's profile; everyone else commits now.
    confirmLog(() => {
      const timestamp = new Date().toISOString();
      setLoggedEntryTimestamp(timestamp);
      addFoodLogEntry({
        timestamp,
        foodName: result.foodName,
        estimatedCarbs: carbs,
        // Recorded insulin follows the carbs actually logged (it used to keep the first estimate's
        // number even after the carbs were corrected). A record only — dose math is unchanged.
        insulinUnits: mealInsulinUnits(carbs, carbRatio),
        confidence: result.confidence,
        fromPhoto: !!result.fromPhoto,
        photoUri: photoUri ?? undefined,
        fatGrams: result.fatGrams,
        proteinGrams: result.proteinGrams,
        absorption: result.absorption,
      });
      setLogged(true);
      // The number you log is the number this favorite keeps.
      const fav = findQuickFood(quickFoods, quickSource ?? result.foodName) ?? findQuickFood(quickFoods, result.foodName);
      if (fav && fav.carbs !== carbs) updateQuickFoodCarbs(fav.name, carbs);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }

  // If the entry "Log This Meal" wrote is DELETED (Log page, this device or a sync from another
  // guardian), the card must stop claiming it's logged — otherwise the popup would keep setting
  // aside a log that no longer exists while the button stays green.
  useEffect(() => {
    if (!loggedEntryTimestamp) return;
    if (!foodLog.some((f) => f.timestamp === loggedEntryTimestamp)) {
      setLogged(false);
      setLoggedEntryTimestamp(null);
    }
  }, [foodLog, loggedEntryTimestamp]);

  function handleCarbsBlur() {
    const parsed = parseFloat(editedCarbs);
    if (!isNaN(parsed) && parsed > 0) {
      fetchGuidance(parsed);
    }
  }

  const spikePercent = guidance
    ? Math.min(100, Math.max(0, ((guidance.predictedPeak30 - 70) / (350 - 70)) * 100))
    : 0;
  const spikeColor = guidance ? SPIKE_COLOR(guidance.predictedPeak30, targetGlucose) : COLORS.success;

  const showGlucoseHeader = history.length > 1 || latestReading?.glucose != null;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Background shading — see components/Shade; the root keeps its own opaque color beneath. */}
      <ScreenShade />
      {/* Food's header is NOT its own shaded section (unlike Insulin/Chat): no band, no divider. */}
      {showGlucoseHeader && (
        <TabGlucoseHeaderShell shade={false} style={{ paddingBottom: 14 }}>
          <TabGlucoseHeaderRow
            left={
              history.length > 1 ? (
                <View ref={helpTrendChip} collapsable={false} style={[styles.trendChip, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                  {/* Same control fill + shade as the other control-colored chips and buttons. */}
                  <ControlShade radius={12} />
                  <Feather name="activity" size={13} color={colors.textSecondary} />
                  <Text style={[styles.trendChipText, { color: colors.textSecondary }]}>Glucose trend:</Text>
                  {/* Only the STATUS is colored — a small pill in the trend's color, like the gauge's
                      trend pill — while the chip around it stays neutral. */}
                  <View
                    style={[
                      styles.trendStatusPill,
                      { backgroundColor: withAlpha(trendColor, 0.14), borderColor: withAlpha(trendColor, 0.4) },
                    ]}
                  >
                    <TintShade color={trendColor} radius={10} />
                    <Text style={[styles.trendStatusText, { color: trendColor }]} numberOfLines={1}>
                      {TREND_LABELS[currentTrend] ?? "→ Stable"}
                    </Text>
                  </View>
                </View>
              ) : null
            }
          />
        </TabGlucoseHeaderShell>
      )}
      <ScrollView
        ref={helpScrollRef}
        {...helpScrollProps}
        {...NO_AUTO_CONTENT_INSETS}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: showGlucoseHeader ? 0 : tabGlucoseHeaderPaddingTop(insets.top),
            paddingBottom: bottomPadding + 80,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Scan panel: one big tinted card, a round camera button in the middle. Whole card taps. ── */}
        <Pressable
          ref={helpScan}
          style={({ pressed }) => [
            styles.scanCard,
            { backgroundColor: withAlpha(COLORS.primary, 0.14), borderColor: withAlpha(COLORS.primary, 0.4), opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={takePhoto}
          disabled={isAnalyzingPhoto}
          accessibilityRole="button"
          accessibilityLabel="Scan or take a photo of your meal"
        >
          <TintShade color={COLORS.primary} radius={20} />
          <View style={[styles.scanIcon, { backgroundColor: COLORS.primary }]}>
            <AccentShade radius={36} />
            {isAnalyzingPhoto ? <ActivityIndicator color="#fff" size="large" /> : <Feather name="camera" size={30} color="#fff" />}
          </View>
          <Text style={[styles.scanTitle, { color: colors.text }]}>{isAnalyzingPhoto ? "Analyzing…" : "Scan or Take a Photo"}</Text>
          <Text style={[styles.scanSub, { color: colors.textSecondary }]}>Log your meal in seconds</Text>
        </Pressable>

        {/* Top preview only while analyzing — once the analysis card is up, its inline photo is
            the single representation of the meal on the page. */}
        {photoUri && !result && (
          <View style={[styles.photoPreview, { borderColor: colors.border }]}>
            <Image source={{ uri: photoUri }} style={styles.photoImage} resizeMode="cover" />
            {isAnalyzingPhoto && (
              <View style={styles.photoOverlay}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.photoOverlayText}>AI analyzing food...</Text>
              </View>
            )}
          </View>
        )}

        <View ref={helpSearch} collapsable={false} style={styles.searchRow}>
        <View style={[styles.searchBar, { flex: 1, marginBottom: 0, backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder="e.g. apple, pizza, rice..."
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={() => search(query)}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable onPress={resetAnalysis} accessibilityRole="button" accessibilityLabel="Clear the search">
              <Feather name="x" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
          {/* Photo library — beside the search bar, matching its height. */}
          <Pressable
            style={({ pressed }) => [
              styles.galleryBtn,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={pickFromGallery}
            disabled={isAnalyzingPhoto}
            accessibilityRole="button"
            accessibilityLabel="Choose a photo from your library"
          >
            <ControlShade radius={14} />
            <Feather name="image" size={18} color={colors.text} />
          </Pressable>
        </View>

        <Pressable
          ref={helpEstimate}
          style={({ pressed }) => [
            styles.searchBtn,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={() => search(query)}
          disabled={isLoading || !query.trim()}
        >
          <ControlShade radius={14} />
          {isLoading ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : (
            <Feather name="zap" size={16} color={COLORS.primary} />
          )}
          <Text style={[styles.searchBtnText, { color: COLORS.primary }]}>
            {isLoading ? "Estimating..." : "Estimate Carbs"}
          </Text>
        </Pressable>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: COLORS.dangerLight }]}>
            <Feather name="alert-circle" size={16} color={COLORS.danger} />
            <Text style={[styles.errorText, { color: COLORS.danger }]}>{error}</Text>
          </View>
        )}

        {result && (
          <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {result.fromPhoto && photoUri && (
              <Image source={{ uri: photoUri }} style={styles.inlinePhoto} resizeMode="cover" />
            )}
            <View style={styles.resultHeaderRow}>
              {result.fromPhoto ? (
                <View style={[styles.aiTag, { backgroundColor: COLORS.primary + "15" }]}>
                  <Feather name="cpu" size={12} color={COLORS.primary} />
                  <Text style={[styles.aiTagText, { color: COLORS.primary }]} numberOfLines={1}>AI Photo Analysis</Text>
                </View>
              ) : result.fromBarcode ? (
                <View style={[styles.aiTag, { backgroundColor: COLORS.success + "18" }]}>
                  <Feather name="maximize" size={12} color={COLORS.success} />
                  <Text style={[styles.aiTagText, { color: COLORS.success }]} numberOfLines={1}>
                    {result.source === "usda" ? "Barcode · USDA label" : "Barcode · Open Food Facts"}
                  </Text>
                </View>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add to Favorites"
                disabled={savedToQuick}
                onPress={saveToQuickLookup}
                style={({ pressed }) => [
                  styles.saveQuickBtn,
                  {
                    borderColor: savedToQuick ? COLORS.primaryLight : colors.border,
                    backgroundColor: savedToQuick ? COLORS.primary + "1F" : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={savedToQuick ? "heart" : "heart-outline"}
                  size={12}
                  color={savedToQuick ? COLORS.primaryLight : colors.textMuted}
                />
                <Text style={[styles.saveQuickBtnText, { color: savedToQuick ? COLORS.primaryLight : colors.textMuted }]} numberOfLines={1}>
                  {savedToQuick ? "In Favorites" : "Add to Favorites"}
                </Text>
              </Pressable>
              {/* Close the analysis — photo results had no way out (the search-bar ✕ only exists
                  after a text search). Resets the page; an already-saved log stays logged. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close this food"
                hitSlop={10}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  resetAnalysis();
                }}
                style={({ pressed }) => [styles.resultClose, { backgroundColor: withAlpha(colors.textMuted, 0.18), opacity: pressed ? 0.6 : 1 }]}
              >
                <Feather name="x" size={14} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.resultTop}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.foodName, { color: colors.text }]}>{result.foodName}</Text>
                {result.portion && (
                  <Text style={[styles.portionText, { color: colors.textMuted }]}>{result.portion}</Text>
                )}
                <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor[result.confidence] + "20" }]}>
                  <View style={[styles.confidenceDot, { backgroundColor: confidenceColor[result.confidence] }]} />
                  <Text style={[styles.confidenceText, { color: confidenceColor[result.confidence] }]}>
                    {result.confidence} confidence
                  </Text>
                </View>
              </View>
              <View style={[styles.carbBubble, { borderColor: COLORS.primary + "30", borderWidth: 1 }]}>
                <TextInput
                  style={[styles.carbValue, { color: COLORS.primary, textAlign: "center", minWidth: 48 }]}
                  value={editedCarbs}
                  onChangeText={setEditedCarbs}
                  onBlur={handleCarbsBlur}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={handleCarbsBlur}
                  selectTextOnFocus
                />
                <Text style={[styles.carbLabel, { color: COLORS.primary }]}>g carbs</Text>
                <Text style={[{ fontSize: 9, color: COLORS.primary + "80", fontWeight: "400" }]}>tap to edit</Text>
              </View>
            </View>

            {/* Servings — barcode results only, and only when the package holds more than one serving
                (or we can't tell). Carbs, fat, protein and the insulin estimate all scale with it. */}
            {result.fromBarcode && (result.servingsPerContainer == null || result.servingsPerContainer > 1) && (
              <View style={[styles.servingsRow, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <ControlShade radius={12} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.servingsLabel, { color: colors.text }]}>Servings you're having</Text>
                  <Text style={[styles.servingsHint, { color: colors.textMuted }]} numberOfLines={1}>
                    {result.perServing ? `${result.perServing.carbs} g carbs per serving` : ""}
                    {result.servingsPerContainer != null ? ` · about ${result.servingsPerContainer} in the package` : ""}
                  </Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="One fewer serving"
                    hitSlop={6}
                    onPress={() => applyServings(String(Math.max(1, parseServings(servingsText) - 1)))}
                    style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Feather name="minus" size={16} color={colors.text} />
                  </Pressable>
                  <TextInput
                    style={[styles.stepInput, { color: colors.text }]}
                    value={servingsText}
                    onChangeText={(t) => setServingsText(t.replace(/[^0-9]/g, "").slice(0, 2))}
                    onBlur={() => applyServings(String(parseServings(servingsText)))}
                    onSubmitEditing={() => applyServings(String(parseServings(servingsText)))}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    selectTextOnFocus
                    maxLength={2}
                    accessibilityLabel="Number of servings"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="One more serving"
                    hitSlop={6}
                    onPress={() => applyServings(String(Math.min(99, parseServings(servingsText) + 1)))}
                    style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Feather name="plus" size={16} color={colors.text} />
                  </Pressable>
                </View>
              </View>
            )}

            {(result.fatGrams != null || result.proteinGrams != null || result.absorption != null) && (
              <View style={[styles.tipsBox, { backgroundColor: colors.backgroundTertiary }]}>
                <Feather name="pie-chart" size={14} color={colors.textSecondary} />
                <Text style={[styles.tipsText, { color: colors.textSecondary }]}>
                  {[
                    result.fatGrams != null ? `${result.fatGrams}g fat` : null,
                    result.proteinGrams != null ? `${result.proteinGrams}g protein` : null,
                    result.absorption != null
                      ? `${result.absorption === "fast" ? "fast-acting carbs" : result.absorption === "slow" ? "slow-absorbing meal" : "typical absorption"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            )}

            {result.absorption === "slow" && (
              <View style={[styles.tipsBox, { backgroundColor: COLORS.warning + "14" }]}>
                <Feather name="clock" size={14} color={COLORS.warning} />
                <Text style={[styles.tipsText, { color: colors.textSecondary }]}>
                  High fat/protein meals digest slowly — glucose can keep rising 3–4 hours after eating. Recheck in about 2 hours; a delayed rise may need a small follow-up correction.
                </Text>
              </View>
            )}

            {result.tips && (
              <View style={[styles.tipsBox, { backgroundColor: colors.backgroundTertiary }]}>
                <Feather name="info" size={14} color={colors.textSecondary} />
                <Text style={[styles.tipsText, { color: colors.textSecondary }]}>{result.tips}</Text>
              </View>
            )}

            <View style={styles.logActionsRow}>
              {canUseCalculator && (
              <Pressable
                style={({ pressed }) => [
                  styles.logBtn,
                  {
                    flex: 1,
                    backgroundColor: insulinTaken ? COLORS.success + "20" : COLORS.primary,
                    borderColor: insulinTaken ? COLORS.success : "transparent",
                    borderWidth: insulinTaken ? 1 : 0,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setInsulinCalcVisible(true);
                }}
                disabled={insulinTaken}
              >
                {!insulinTaken && <AccentShade radius={14} />}
                <Feather name={insulinTaken ? "check-circle" : "percent"} size={16} color={insulinTaken ? COLORS.success : "#fff"} />
                <Text style={[styles.logBtnText, { color: insulinTaken ? COLORS.success : "#fff" }]}>
                  {insulinTaken ? "Insulin Taken" : "Calculate Insulin"}
                </Text>
              </Pressable>
              )}
              {canLogMeals && (
              <Pressable
                style={({ pressed }) => [
                  styles.logBtn,
                  {
                    flex: 1,
                    backgroundColor: logged ? COLORS.success + "20" : COLORS.primary,
                    borderColor: logged ? COLORS.success : "transparent",
                    borderWidth: logged ? 1 : 0,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={logMeal}
                disabled={logged}
              >
                <Feather name={logged ? "check-circle" : "plus-circle"} size={16} color={logged ? COLORS.success : "#fff"} />
                <Text style={[styles.logBtnText, { color: logged ? COLORS.success : "#fff" }]}>
                  {logged ? "Meal Logged" : "Log This Meal"}
                </Text>
              </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Insulin dosing happens on the Insulin page's main calculator — "Calculate Insulin"
            hands off there (order-aware), so this page never computes or logs a dose itself. */}

        {(isFetchingGuidance || guidance) && result && (
          <View style={[styles.guidanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.guidanceHeader}>
              <Feather name="trending-up" size={16} color={COLORS.accent} />
              <Text style={[styles.guidanceTitle, { color: colors.text }]}>Meal Insulin Guidance</Text>
              {isFetchingGuidance && <ActivityIndicator size="small" color={COLORS.accent} />}
            </View>

            {guidance && !isFetchingGuidance && (
              isMinor ? (
                <KidGuidanceView
                  guidance={guidance}
                  spikePercent={spikePercent}
                  spikeColor={spikeColor}
                  colors={colors}
                />
              ) : (
                <AdultGuidanceView guidance={guidance} colors={colors} />
              )
            )}
          </View>
        )}

        {/* ── Quick Lookup: the first QUICK_LOOKUP_VISIBLE saved foods as compact rows in one shaded
            window (same treatment as the Event Log); "See All" opens the full, manageable list. ── */}
        <View style={styles.quickHeader}>
          <Text style={[styles.quickTitle, { color: colors.text }]}>Quick Lookup</Text>
          <Pressable
            ref={helpSeeAll}
            style={({ pressed }) => [styles.seeAllBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setQuickManagerOpen(true);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="See all favorites"
          >
            <Text style={[styles.seeAllText, { color: COLORS.primary }]}>See All</Text>
            <Feather name="chevron-right" size={16} color={COLORS.primary} />
          </Pressable>
        </View>
        <View
          accessibilityRole="tablist"
          style={[styles.quickTabs, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          {(["recent", "favorites"] as const).map((tab) => {
            const active = quickTab === tab;
            return (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => chooseQuickTab(tab)}
                style={({ pressed }) => [
                  styles.quickTab,
                  { backgroundColor: active ? COLORS.primary : "transparent", opacity: pressed ? 0.8 : 1 },
                ]}
              >
                {active && <AccentShade radius={10} />}
                <Text style={[styles.quickTabText, { color: active ? "#fff" : colors.textSecondary }]}>
                  {tab === "recent" ? "Recent" : "Favorites"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {quickTab === "recent" ? (
          recentList.length === 0 ? (
            <Text style={[styles.quickEmpty, { color: colors.textMuted }]}>
              Nothing logged yet — foods you log will show up here.
            </Text>
          ) : (
            <View ref={helpQuick} collapsable={false} style={[styles.quickList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <CardShade radius={16} />
              {recentList.map((entry, i, arr) => {
                const fav = findQuickFood(quickFoods, entry.foodName);
                const startCarbs = fav?.carbs ?? entry.estimatedCarbs;
                return (
                  <QuickFoodRow
                    key={entry.id}
                    title={splitFoodName(entry.foodName).title}
                    detail={formatRecentWhen(entry.timestamp)}
                    carbs={entry.estimatedCarbs}
                    selected={result?.foodName?.toLowerCase() === entry.foodName.toLowerCase()}
                    isFavorite={!!fav}
                    last={i === arr.length - 1}
                    colors={colors}
                    onPress={() => search(entry.foodName, { startCarbs, source: entry.foodName })}
                    onEdit={canEditLogs ? () => setEditingLog(entry) : undefined}
                    editLabel={`Edit this log: ${entry.foodName}`}
                    onToggleFavorite={() => toggleFavorite(entry.foodName, entry.estimatedCarbs)}
                  />
                );
              })}
            </View>
          )
        ) : quickFoods.length === 0 ? (
          <Text style={[styles.quickEmpty, { color: colors.textMuted }]}>
            No favorites yet — tap the heart on a food to keep it here.
          </Text>
        ) : (
          <View ref={helpQuick} collapsable={false} style={[styles.quickList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <CardShade radius={16} />
            {quickFoods.slice(0, QUICK_LOOKUP_VISIBLE).map((food, i, arr) => {
              const parts = splitFoodName(food.name);
              return (
                <QuickFoodRow
                  key={food.name}
                  title={parts.title}
                  detail={parts.detail}
                  carbs={food.carbs}
                  selected={result?.foodName?.toLowerCase() === food.name.toLowerCase()}
                  isFavorite
                  last={i === arr.length - 1}
                  colors={colors}
                  onPress={() => search(food.name, { startCarbs: food.carbs, source: food.name })}
                  onEdit={() => setEditingFavorite(food)}
                  editLabel={`Edit favorite: ${food.name}`}
                  onToggleFavorite={() => confirmRemoveFavorite(food.name)}
                />
              );
            })}
          </View>
        )}
        {favoriteToast ? (
          <View accessibilityLiveRegion="polite" style={[styles.favToast, { backgroundColor: COLORS.primary + "26", borderColor: COLORS.primary + "66" }]}>
            <MaterialCommunityIcons name="heart" size={14} color={COLORS.primaryLight} />
            <Text style={[styles.favToastText, { color: colors.text }]}>{favoriteToast}</Text>
          </View>
        ) : null}
      </ScrollView>

      <FoodScanner
        visible={scannerOpen}
        lookup={barcodeLookup}
        onClose={() => {
          setScannerOpen(false);
          setBarcodeLookup("idle");
        }}
        onBarcode={(code) => void lookupBarcode(code)}
        onPhoto={(uri) => {
          setScannerOpen(false);
          setBarcodeLookup("idle");
          void analyzePhoto(uri);
        }}
        onPermissionDenied={() => void takePhotoWithSystemCamera()}
      />
      <QuickLookupManager
        visible={quickManagerOpen}
        onClose={() => setQuickManagerOpen(false)}
        onPick={(name) => {
          setQuickManagerOpen(false);
          search(name, { startCarbs: findQuickFood(quickFoods, name)?.carbs, source: name });
        }}
        colors={colors}
      />

      {/* Pencil: one small name + carbs box for both tabs. Recent fixes that log (the insulin recorded
          with it is recalculated from the new carbs — same formula as logging); time and insulin stay
          on the Log page. Favorites change the saved food only. */}
      {editingLog && (
        <EditFoodModal
          key={editingLog.id}
          title="Edit log"
          initialName={editingLog.foodName}
          initialCarbs={editingLog.estimatedCarbs}
          notes={[
            ...(isQuickFood(quickFoods, editingLog.foodName)
              ? ["Also updates this food in Favorites, so it uses these carbs next time."]
              : []),
            "To change the time or insulin, use the Log page.",
          ]}
          colors={colors}
          onSave={(name, carbs) => {
            const entry = editingLog;
            confirmLog(() => {
              editFoodLogEntry(entry.id, {
                foodName: name,
                estimatedCarbs: carbs,
                insulinUnits: mealInsulinUnits(carbs, carbRatio),
              });
              const fav = findQuickFood(quickFoods, entry.foodName);
              if (fav && fav.carbs !== carbs) updateQuickFoodCarbs(fav.name, carbs);
            });
          }}
          onClose={() => setEditingLog(null)}
        />
      )}
      {editingFavorite && (
        <EditFoodModal
          key={editingFavorite.name}
          title="Edit favorite"
          initialName={editingFavorite.name}
          initialCarbs={editingFavorite.carbs}
          notes={["This is what it starts from next time you tap it. Past logs don't change."]}
          colors={colors}
          onSave={(name, carbs) => reorderQuickFoods(editQuickFood(quickFoods, editingFavorite.name, name, carbs))}
          onClose={() => setEditingFavorite(null)}
        />
      )}

      {/* ── Meal insulin calculator popup — same dose engine as the main calculator, order-aware:
          `mealLogged` decides whether the analyzed carbs pre-fill (not logged) or show as the
          non-dismissible ACTIVE CARBS display (logged — the log already counts in the math). ── */}
      <FoodInsulinModal
        visible={insulinCalcVisible}
        onClose={() => setInsulinCalcVisible(false)}
        initialCarbs={result ? parseFloat(editedCarbs) || result.estimatedCarbs : 0}
        excludeLogTimestamp={logged ? loggedEntryTimestamp : null}
        foodName={result?.foodName}
        colors={colors}
        onLogged={() => {
          setInsulinCalcVisible(false);
          setInsulinTaken(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function KidGuidanceView({
  guidance,
  spikePercent,
  spikeColor,
  colors,
}: {
  guidance: MealGuidance;
  spikePercent: number;
  spikeColor: string;
  colors: (typeof Colors)["light"];
}) {
  const monster = MONSTER_FACE[guidance.monsterMood];
  return (
    <View style={styles.kidGuidance}>
      <View style={styles.monsterRow}>
        <Text style={styles.monsterEmoji}>{monster}</Text>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.monsterLabel, { color: colors.textSecondary }]}>
            Sugar spike forecast
          </Text>
          <View style={[styles.spikeBar, { backgroundColor: colors.backgroundTertiary }]}>
            <View
              style={[
                styles.spikeFill,
                { width: `${spikePercent}%` as any, backgroundColor: spikeColor },
              ]}
            />
          </View>
          <Text style={[styles.spikePeak, { color: spikeColor }]}>
            Peak: ~{guidance.predictedPeak30} mg/dL
          </Text>
        </View>
      </View>

      <Text style={[styles.friendlyMsg, { color: colors.text }]}>{guidance.friendlyMessage}</Text>

      <View style={[styles.timingChip, { backgroundColor: COLORS.accent + "15" }]}>
        <Text style={styles.timingEmoji}>{guidance.timingEmoji}</Text>
        <Text style={[styles.timingText, { color: COLORS.accent }]}>{guidance.timingAdvice}</Text>
      </View>

      <View style={[styles.insulinPill, { backgroundColor: COLORS.primary + "14" }]}>
        <Feather name="droplet" size={14} color={COLORS.primary} />
        <Text style={[styles.insulinPillText, { color: COLORS.primary }]}>
          Suggested: {guidance.insulinDose} units
        </Text>
      </View>
    </View>
  );
}

function AdultGuidanceView({
  guidance,
  colors,
}: {
  guidance: MealGuidance;
  colors: (typeof Colors)["light"];
}) {
  const levels = [
    { label: "Now", value: guidance.currentGlucose, key: "now" },
    { label: "30 min\n(no insulin)", value: guidance.predictedPeak30, key: "30" },
    { label: "60 min\n(with insulin)", value: guidance.predicted60WithInsulin, key: "60" },
  ];
  const maxVal = Math.max(...levels.map((l) => l.value), guidance.targetGlucose + 60);
  const minVal = Math.min(...levels.map((l) => l.value), 60);
  const range = maxVal - minVal;

  return (
    <View style={styles.adultGuidance}>
      <View style={styles.glucoseChart}>
        {levels.map((level) => {
          const barHeight = range > 0 ? Math.max(8, ((level.value - minVal) / range) * 80) : 40;
          const barColor =
            level.value < 70 ? COLORS.danger
            : level.value <= 180 ? COLORS.success
            : level.value <= 250 ? COLORS.warning
            : COLORS.danger;
          return (
            <View key={level.key} style={styles.chartCol}>
              <Text style={[styles.chartValue, { color: barColor }]}>{level.value}</Text>
              <View style={styles.chartBarContainer}>
                <View
                  style={[styles.chartBar, { height: barHeight, backgroundColor: barColor }]}
                />
              </View>
              <Text style={[styles.chartLabel, { color: colors.textMuted }]}>{level.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={[styles.targetLine, { borderColor: COLORS.success + "60" }]}>
        <Text style={[styles.targetLineLabel, { color: COLORS.success }]}>
          Target: {guidance.targetGlucose} mg/dL
        </Text>
      </View>

      <View style={[styles.timingChip, { backgroundColor: COLORS.accent + "15" }]}>
        <Text style={styles.timingEmoji}>{guidance.timingEmoji}</Text>
        <Text style={[styles.timingText, { color: COLORS.accent }]}>{guidance.timingAdvice}</Text>
      </View>

      <View style={styles.adultStats}>
        <StatBox label="Insulin Dose" value={`${guidance.insulinDose}u`} color={COLORS.primary} colors={colors} />
        <StatBox
          label="60-min Pred."
          value={`${guidance.predicted60WithInsulin}`}
          color={guidance.inRange60 ? COLORS.success : COLORS.warning}
          colors={colors}
        />
        <StatBox
          label="In Range?"
          value={guidance.inRange60 ? "Yes ✓" : "Check"}
          color={guidance.inRange60 ? COLORS.success : COLORS.warning}
          colors={colors}
        />
      </View>
    </View>
  );
}

// The in-card "Dose Calculation" summary box was removed — the Insulin page's main calculator
// is the single dose surface in the app; "Calculate Insulin" hands off to it.

function StatBox({
  label,
  value,
  color,
  colors,
}: {
  label: string;
  value: string;
  color: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={[styles.statBox, { backgroundColor: color + "12", borderColor: color + "30" }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // iPad: cap + center the content column so it doesn't stretch across a 13" screen. No-op on phones.
  scroll: { paddingHorizontal: 20, width: "100%", maxWidth: T.layout.contentMaxWidth, alignSelf: "center" },
  trendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  trendChipText: { fontSize: 12, fontWeight: "500" },
  trendStatusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, marginLeft: 2 },
  trendStatusText: { fontSize: 12, fontWeight: "600" },
  /** The scan panel (Take Photo): a tinted card with a round camera button and two lines of text. */
  scanCard: { alignItems: "center", gap: 6, paddingVertical: 24, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, marginBottom: 14 },
  scanIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  scanTitle: { fontSize: 20, fontWeight: "700" },
  scanSub: { fontSize: 14, fontWeight: "400" },
  galleryBtn: {
    width: 50,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
  },
  photoPreview: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    marginBottom: 14,
    height: 200,
  },
  photoImage: { width: "100%", height: "100%" },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  photoOverlayText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  /** Search bar + photo-library button side by side; the button stretches to the bar's height. */
  searchRow: { flexDirection: "row", alignItems: "stretch", gap: 10, marginBottom: 10 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: "400" },
  searchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  searchBtnText: { fontSize: 15, fontWeight: "600" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 14, fontWeight: "400" },
  resultCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 14, gap: 12 },
  inlinePhoto: { width: "100%", height: 160, borderRadius: 10, marginBottom: 4 },
  aiTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  aiTagText: { fontSize: 12, fontWeight: "700", flexShrink: 1 },
  // Wraps: the tag shrinks first; if the two still can't share a line (long registry name, large
  // accessibility text) the save button drops to a second line INSIDE the card instead of poking out.
  resultHeaderRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  saveQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: "100%",
  },
  saveQuickBtnText: { fontSize: 10, fontWeight: "600", flexShrink: 1 },
  resultClose: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  resultTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  foodName: { fontSize: 20, fontWeight: "700", marginBottom: 4, textTransform: "capitalize" },
  portionText: { fontSize: 13, fontWeight: "400", marginBottom: 6 },
  confidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  confidenceDot: { width: 6, height: 6, borderRadius: 3 },
  confidenceText: { fontSize: 12, fontWeight: "600" },
  carbBubble: {
    alignItems: "center",
    backgroundColor: COLORS.primary + "14",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  carbValue: { fontSize: 32, fontWeight: "700", lineHeight: 38 },
  carbLabel: { fontSize: 12, fontWeight: "500" },
  tipsBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
  /** Barcode results: servings picker (label + hint on the left, − [n] + on the right). */
  servingsRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  servingsLabel: { fontSize: 14, fontWeight: "600" },
  servingsHint: { fontSize: 12, fontWeight: "400", marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primary + "18" },
  stepInput: { width: 44, textAlign: "center", fontSize: 18, fontWeight: "700", padding: 0 },
  tipsText: { flex: 1, fontSize: 13, fontWeight: "400", lineHeight: 20 },
  logActionsRow: { flexDirection: "row", gap: 10 },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  logBtnText: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  guidanceCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 24, gap: 14 },
  guidanceHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  guidanceTitle: { flex: 1, fontSize: 16, fontWeight: "700" },
  kidGuidance: { gap: 12 },
  monsterRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  monsterEmoji: { fontSize: 44 },
  monsterLabel: { fontSize: 12, fontWeight: "500", marginBottom: 4 },
  spikeBar: { height: 10, borderRadius: 5, overflow: "hidden" },
  spikeFill: { height: "100%", borderRadius: 5 },
  spikePeak: { fontSize: 12, fontWeight: "600" },
  friendlyMsg: { fontSize: 14, fontWeight: "400", lineHeight: 22 },
  timingChip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  timingEmoji: { fontSize: 16 },
  timingText: { flex: 1, fontSize: 13, fontWeight: "500", lineHeight: 20 },
  insulinPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  insulinPillText: { fontSize: 14, fontWeight: "700" },
  adultGuidance: { gap: 14 },
  glucoseChart: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end", gap: 8, paddingHorizontal: 8 },
  chartCol: { flex: 1, alignItems: "center", gap: 4 },
  chartValue: { fontSize: 13, fontWeight: "700" },
  chartBarContainer: { width: "100%", height: 90, justifyContent: "flex-end" },
  chartBar: { width: "100%", borderRadius: 6 },
  chartLabel: { fontSize: 10, fontWeight: "500", textAlign: "center", lineHeight: 14 },
  targetLine: { borderTopWidth: 1, borderStyle: "dashed", paddingTop: 6 },
  targetLineLabel: { fontSize: 11, fontWeight: "500" },
  adultStats: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 15, fontWeight: "700" },
  statLabel: { fontSize: 10, fontWeight: "500", textAlign: "center" },
  quickHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  quickTitle: { fontSize: 18, fontWeight: "700" },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4, paddingLeft: 8 },
  seeAllText: { fontSize: 14, fontWeight: "600" },
  quickEmpty: { fontSize: 13, lineHeight: 18 },
  /** The window around the rows — same box as the Event Log list. */
  quickList: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  quickTabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
  quickTab: { flex: 1, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  quickTabText: { fontSize: 15, fontWeight: "700" },
  // Two-line rows: name + time/detail, carbs, then pencil and heart (each a 40×44 target).
  quickRow: { flexDirection: "row", alignItems: "center", paddingRight: 4, minHeight: 56 },
  quickRowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingLeft: 14, minHeight: 56 },
  quickRowText: { flex: 1, minWidth: 0, gap: 1 },
  quickRowName: { fontSize: 14.5, fontWeight: "700" },
  quickRowDetail: { fontSize: 12, fontWeight: "500" },
  quickRowCarbs: { alignItems: "flex-end", flexShrink: 0 },
  quickRowCarbsValue: { fontSize: 16, fontWeight: "700", lineHeight: 18 },
  quickRowCarbsUnit: { fontSize: 10.5, fontWeight: "500" },
  quickIconBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  favToast: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10, borderRadius: 99, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7 },
  favToastText: { fontSize: 13.5, fontWeight: "600" },
});
