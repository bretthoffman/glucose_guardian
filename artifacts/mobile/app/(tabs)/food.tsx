import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import React, { useState } from "react";
import {
  ActivityIndicator,
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
import { useAuth } from "@/context/AuthContext";
import { useCareLogConfirm } from "@/hooks/useCareLogConfirm";

import { getEffectiveTrend, trendTone } from "@/utils/trend";
import TabGlucoseHeaderRow, { TabGlucoseHeaderShell, tabGlucoseHeaderPaddingTop } from "@/components/TabGlucoseHeaderRow";
import FoodInsulinModal from "@/components/FoodInsulinModal";
import { apiUrl } from "@/utils/api-base-url";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";
import { AccentShade, CardShade, ControlShade, ScreenShade, TintShade } from "@/components/Shade";
import QuickLookupManager from "@/components/QuickLookupManager";
import FoodScanner, { type BarcodeLookupState } from "@/components/FoodScanner";
import { QUICK_LOOKUP_VISIBLE, type QuickFood } from "@/utils/quickFoods";

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
 * One Quick Lookup row: name · carbs (big number, small unit) · chevron. Compact on purpose — eight
 * of these plus the header must fit a phone screen cleanly — and the name never wraps.
 */
function QuickFoodRow({
  food,
  selected,
  last,
  colors,
  onPress,
}: {
  food: QuickFood;
  selected: boolean;
  last: boolean;
  colors: (typeof Colors)["light"];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Look up ${food.name}`}
      style={({ pressed }) => [
        styles.quickRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.quickRowName, { color: selected ? COLORS.primary : colors.text }]} numberOfLines={1}>
        {food.name}
      </Text>
      <View style={styles.quickRowCarbs}>
        <Text style={[styles.quickRowCarbsValue, { color: food.carbs != null ? colors.text : colors.textMuted }]}>
          {food.carbs != null ? food.carbs : "—"}
        </Text>
        <Text style={[styles.quickRowCarbsUnit, { color: colors.textMuted }]}>g carbs</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </Pressable>
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
  const { addFoodLogEntry, isMinor, quickFoods, saveQuickFood, updateQuickFoodCarbs, alertPrefs } = useAuth();
  const confirmLog = useCareLogConfirm();

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

  // ── "Calculate Insulin" popup — once THIS analyzed meal's insulin is taken, its button stays
  // "Insulin Taken" until a NEW analysis replaces the meal (both analyze paths reset it). It used
  // to re-arm on the next successful CGM sync (~minutes): the same meal card then re-opened the
  // calculator pre-filled with the same carbs, and since carb insulin is never IOB-reduced it
  // recommended the ENTIRE meal dose again — an insulin-stacking path. A meal that was dosed
  // stays dosed; more food means a new analysis or the main calculator. ──
  const [insulinCalcVisible, setInsulinCalcVisible] = useState(false);
  const [insulinTaken, setInsulinTaken] = useState(false);

  // ── Quick Lookup chips now live in AuthContext: one mutual list for the whole care circle
  // (an add by any co-guardian shows up on every guardian's Food tab within a poll). ──
  const [savedToQuick, setSavedToQuick] = useState(false);
  const [quickManagerOpen, setQuickManagerOpen] = useState(false);
  // Camera screen (barcode detection + shutter) and the barcode lookup it drives.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeLookup, setBarcodeLookup] = useState<BarcodeLookupState>("idle");
  /** Servings picker for barcode results (text so the field can be cleared while typing). */
  const [servingsText, setServingsText] = useState("1");

  function saveToQuickLookup() {
    if (!result || savedToQuick) return;
    saveQuickFood(result.foodName, result.estimatedCarbs);
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

  async function search(food: string) {
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
    setSavedToQuick(false);
    try {
      const res = await fetch(apiUrl("/api/food/estimate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: q }),
      });
      const data: FoodResult = await res.json();
      const insulinUnits = Math.round((data.estimatedCarbs / carbRatio) * 10) / 10;
      const finalResult = { ...data, insulinUnits, fromPhoto: false };
      setResult(finalResult);
      setEditedCarbs(data.estimatedCarbs.toString());
      // A quick food tapped before it had carbs on file (older saves) learns them now, in place.
      updateQuickFoodCarbs(q, data.estimatedCarbs);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchGuidance(data.estimatedCarbs);
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
      setSavedToQuick(false);
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
    setSavedToQuick(false);
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

  function logMeal() {
    if (!result) return;
    const carbs = parseFloat(editedCarbs) || result.estimatedCarbs;
    // Caregiver sessions confirm before writing into the patient's profile; everyone else commits now.
    confirmLog(() => {
      addFoodLogEntry({
        timestamp: new Date().toISOString(),
        foodName: result.foodName,
        estimatedCarbs: carbs,
        insulinUnits: result.insulinUnits ?? 0,
        confidence: result.confidence,
        fromPhoto: !!result.fromPhoto,
        photoUri: photoUri ?? undefined,
        fatGrams: result.fatGrams,
        proteinGrams: result.proteinGrams,
        absorption: result.absorption,
      });
      setLogged(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }

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
                <View style={[styles.trendChip, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
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

        <View style={styles.searchRow}>
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
            <Pressable onPress={() => { setQuery(""); setResult(null); setGuidance(null); setError(""); }}>
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
                  <Text style={[styles.aiTagText, { color: COLORS.primary }]}>AI Photo Analysis</Text>
                </View>
              ) : result.fromBarcode ? (
                <View style={[styles.aiTag, { backgroundColor: COLORS.success + "18" }]}>
                  <Feather name="maximize" size={12} color={COLORS.success} />
                  <Text style={[styles.aiTagText, { color: COLORS.success }]}>
                    {result.source === "usda" ? "Barcode · USDA label" : "Barcode · Open Food Facts"}
                  </Text>
                </View>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save to quick lookup"
                disabled={savedToQuick}
                onPress={saveToQuickLookup}
                style={({ pressed }) => [
                  styles.saveQuickBtn,
                  {
                    borderColor: savedToQuick ? COLORS.success : colors.border,
                    backgroundColor: savedToQuick ? COLORS.success + "18" : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather
                  name={savedToQuick ? "check" : "bookmark"}
                  size={11}
                  color={savedToQuick ? COLORS.success : colors.textMuted}
                />
                <Text style={[styles.saveQuickBtnText, { color: savedToQuick ? COLORS.success : colors.textMuted }]}>
                  {savedToQuick ? "Saved" : "Save to Quick Lookup"}
                </Text>
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
                <Feather name={insulinTaken ? "check-circle" : "percent"} size={16} color={insulinTaken ? COLORS.success : "#fff"} />
                <Text style={[styles.logBtnText, { color: insulinTaken ? COLORS.success : "#fff" }]}>
                  {insulinTaken ? "Insulin Taken" : "Calculate Insulin"}
                </Text>
              </Pressable>
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
            </View>
          </View>
        )}

        {/* Insulin logging on this page happens only through the Calculate Insulin popup —
            the old post-log "Suggested dose / I Took X Units" card double-logged with it. */}

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
            style={({ pressed }) => [styles.seeAllBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setQuickManagerOpen(true);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="See all quick lookup foods"
          >
            <Text style={[styles.seeAllText, { color: COLORS.primary }]}>See All</Text>
            <Feather name="chevron-right" size={16} color={COLORS.primary} />
          </Pressable>
        </View>
        {quickFoods.length === 0 ? (
          <Text style={[styles.quickEmpty, { color: colors.textMuted }]}>
            Nothing saved yet — look a food up and tap the bookmark to keep it here.
          </Text>
        ) : (
          <View style={[styles.quickList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <CardShade radius={16} />
            {quickFoods.slice(0, QUICK_LOOKUP_VISIBLE).map((food, i, arr) => (
              <QuickFoodRow
                key={food.name}
                food={food}
                selected={result?.foodName?.toLowerCase() === food.name.toLowerCase()}
                last={i === arr.length - 1}
                colors={colors}
                onPress={() => search(food.name)}
              />
            ))}
          </View>
        )}
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
          search(name);
        }}
        colors={colors}
      />

      {/* ── Meal insulin calculator popup — self-contained; never touches the main calculator ── */}
      <FoodInsulinModal
        visible={insulinCalcVisible}
        onClose={() => setInsulinCalcVisible(false)}
        initialCarbs={result ? parseFloat(editedCarbs) || result.estimatedCarbs : 0}
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

// The in-card "Dose Calculation" summary box was removed — the Calculate Insulin popup
// (FoodInsulinModal) is the single dose surface on this page.

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
  },
  aiTagText: { fontSize: 12, fontWeight: "700" },
  resultHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  saveQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  saveQuickBtnText: { fontSize: 10, fontWeight: "600" },
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
  // 44pt rows: eight of them (plus the header) fit a phone screen with the scan panel above.
  quickRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, paddingHorizontal: 14, minHeight: 44 },
  quickRowName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "600" },
  quickRowCarbs: { alignItems: "flex-end", flexShrink: 0 },
  quickRowCarbsValue: { fontSize: 16, fontWeight: "700", lineHeight: 18 },
  quickRowCarbsUnit: { fontSize: 10.5, fontWeight: "500" },
});
