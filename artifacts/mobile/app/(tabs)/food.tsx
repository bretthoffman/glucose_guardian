import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import type { GlucoseEntry } from "@/context/GlucoseContext";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface FoodResult {
  foodName: string;
  estimatedCarbs: number;
  confidence: "high" | "medium" | "low";
  portion?: string;
  tips?: string;
  insulinUnits?: number;
  fromPhoto?: boolean;
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

const QUICK_FOODS = ["Apple", "Pizza", "Rice", "Banana", "Sandwich", "Oatmeal", "Pasta", "Milk"];

function detectTrend(history: GlucoseEntry[]): string {
  if (history.length < 2) return "stable";
  const last = history[history.length - 1].glucose;
  const prev = history[history.length - 2].glucose;
  const diff = last - prev;
  if (diff > 30) return "rapidly_rising";
  if (diff > 15) return "rising";
  if (diff < -30) return "rapidly_falling";
  if (diff < -15) return "falling";
  return "stable";
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
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { carbRatio, targetGlucose, correctionFactor, latestReading, history } = useGlucose();
  const { addFoodLogEntry, isMinor } = useAuth();

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FoodResult | null>(null);
  const [guidance, setGuidance] = useState<MealGuidance | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [isFetchingGuidance, setIsFetchingGuidance] = useState(false);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const confidenceColor = {
    high: COLORS.success,
    medium: COLORS.warning,
    low: COLORS.danger,
  };

  const currentTrend = detectTrend(history);

  async function fetchGuidance(carbs: number) {
    setIsFetchingGuidance(true);
    try {
      const res = await fetch(`${BASE_URL}/api/insulin/predict`, {
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
    const q = food.trim();
    if (!q) return;
    setQuery(q);
    setError("");
    setIsLoading(true);
    setResult(null);
    setGuidance(null);
    setPhotoUri(null);
    setLogged(false);
    try {
      const res = await fetch(`${BASE_URL}/api/food/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: q }),
      });
      const data: FoodResult = await res.json();
      const insulinUnits = Math.round((data.estimatedCarbs / carbRatio) * 10) / 10;
      const finalResult = { ...data, insulinUnits, fromPhoto: false };
      setResult(finalResult);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchGuidance(data.estimatedCarbs);
    } catch {
      setError("Could not estimate. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function takePhoto() {
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

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.5,
      base64: false,
    });

    if (!result.canceled && result.assets[0]) {
      await analyzePhoto(result.assets[0].uri);
    }
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setError("Photo library permission is needed to analyze food.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: false,
    });

    if (!result.canceled && result.assets[0]) {
      await analyzePhoto(result.assets[0].uri);
    }
  }

  async function analyzePhoto(uri: string) {
    setPhotoUri(uri);
    setResult(null);
    setGuidance(null);
    setQuery("");
    setLogged(false);
    setError("");
    setIsAnalyzingPhoto(true);

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: "base64" as any,
      });

      const res = await fetch(`${BASE_URL}/api/food/analyze-photo`, {
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchGuidance(data.estimatedCarbs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("Network") || message.includes("fetch")) {
        setError("Network error. Make sure you have an internet connection.");
      } else if (message.includes("FileSystem") || message.includes("read")) {
        setError("Could not read the photo. Please try again.");
      } else {
        setError("Could not analyze photo. Please try again.");
      }
    } finally {
      setIsAnalyzingPhoto(false);
    }
  }

  function logMeal() {
    if (!result) return;
    addFoodLogEntry({
      timestamp: new Date().toISOString(),
      foodName: result.foodName,
      estimatedCarbs: result.estimatedCarbs,
      insulinUnits: result.insulinUnits ?? 0,
      confidence: result.confidence,
      fromPhoto: !!result.fromPhoto,
      photoUri: photoUri ?? undefined,
    });
    setLogged(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  const spikePercent = guidance
    ? Math.min(100, Math.max(0, ((guidance.predictedPeak30 - 70) / (350 - 70)) * 100))
    : 0;
  const spikeColor = guidance ? SPIKE_COLOR(guidance.predictedPeak30, targetGlucose) : COLORS.success;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPadding + 12, paddingBottom: bottomPadding + 80 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.pageTitle, { color: colors.text }]}>Food & Carbs</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Snap a photo or search to estimate carbs
        </Text>

        {history.length > 1 && (
          <View style={[styles.trendChip, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
            <Feather name="activity" size={13} color={colors.textSecondary} />
            <Text style={[styles.trendChipText, { color: colors.textSecondary }]}>
              Glucose trend: {TREND_LABELS[currentTrend] ?? "→ Stable"}
            </Text>
          </View>
        )}

        <View style={styles.cameraRow}>
          <Pressable
            style={({ pressed }) => [
              styles.cameraBtn,
              { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1, flex: 1 },
            ]}
            onPress={takePhoto}
            disabled={isAnalyzingPhoto}
          >
            {isAnalyzingPhoto ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="camera" size={18} color="#fff" />
            )}
            <Text style={styles.cameraBtnText}>
              {isAnalyzingPhoto ? "Analyzing..." : "Take Photo"}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.galleryBtn,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={pickFromGallery}
            disabled={isAnalyzingPhoto}
          >
            <Feather name="image" size={18} color={colors.text} />
          </Pressable>
        </View>

        {photoUri && (
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

        <View style={styles.dividerRow}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.textMuted }]}>or search by name</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
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

        <Pressable
          style={({ pressed }) => [
            styles.searchBtn,
            { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={() => search(query)}
          disabled={isLoading || !query.trim()}
        >
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
            {result.fromPhoto && (
              <View style={[styles.aiTag, { backgroundColor: COLORS.primary + "15" }]}>
                <Feather name="cpu" size={12} color={COLORS.primary} />
                <Text style={[styles.aiTagText, { color: COLORS.primary }]}>AI Photo Analysis</Text>
              </View>
            )}

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
              <View style={styles.carbBubble}>
                <Text style={[styles.carbValue, { color: COLORS.primary }]}>{result.estimatedCarbs}</Text>
                <Text style={[styles.carbLabel, { color: COLORS.primary }]}>g carbs</Text>
              </View>
            </View>

            {result.tips && (
              <View style={[styles.tipsBox, { backgroundColor: colors.backgroundTertiary }]}>
                <Feather name="info" size={14} color={colors.textSecondary} />
                <Text style={[styles.tipsText, { color: colors.textSecondary }]}>{result.tips}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.logBtn,
                {
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
                {logged ? "Logged to Food Diary" : "Log This Meal"}
              </Text>
            </Pressable>
          </View>
        )}

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

        <Text style={[styles.quickTitle, { color: colors.text }]}>Quick Lookup</Text>
        <View style={styles.quickGrid}>
          {QUICK_FOODS.map((food) => (
            <Pressable
              key={food}
              style={({ pressed }) => [
                styles.quickChip,
                {
                  backgroundColor:
                    result?.foodName?.toLowerCase() === food.toLowerCase()
                      ? COLORS.primary
                      : colors.card,
                  borderColor:
                    result?.foodName?.toLowerCase() === food.toLowerCase()
                      ? COLORS.primary
                      : colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              onPress={() => search(food)}
            >
              <Text
                style={[
                  styles.quickChipText,
                  { color: result?.foodName?.toLowerCase() === food.toLowerCase() ? "#fff" : colors.text },
                ]}
              >
                {food}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
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
  scroll: { paddingHorizontal: 20 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 12 },
  trendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  trendChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cameraRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  cameraBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  cameraBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  galleryBtn: {
    width: 50,
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
  photoOverlayText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  divider: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontFamily: "Inter_400Regular" },
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
  searchInput: { flex: 1, fontSize: 16, fontFamily: "Inter_400Regular" },
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
  searchBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
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
  aiTagText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  resultTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  foodName: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4, textTransform: "capitalize" },
  portionText: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 6 },
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
  confidenceText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  carbBubble: {
    alignItems: "center",
    backgroundColor: COLORS.primary + "14",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  carbValue: { fontSize: 32, fontFamily: "Inter_700Bold", lineHeight: 38 },
  carbLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tipsBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10 },
  tipsText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  logBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
  },
  logBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  guidanceCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 24, gap: 14 },
  guidanceHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  guidanceTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold" },
  kidGuidance: { gap: 12 },
  monsterRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  monsterEmoji: { fontSize: 44 },
  monsterLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  spikeBar: { height: 10, borderRadius: 5, overflow: "hidden" },
  spikeFill: { height: "100%", borderRadius: 5 },
  spikePeak: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  friendlyMsg: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  timingChip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
  },
  timingEmoji: { fontSize: 16 },
  timingText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 20 },
  insulinPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  insulinPillText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  adultGuidance: { gap: 14 },
  glucoseChart: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end", gap: 8, paddingHorizontal: 8 },
  chartCol: { flex: 1, alignItems: "center", gap: 4 },
  chartValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  chartBarContainer: { width: "100%", height: 90, justifyContent: "flex-end" },
  chartBar: { width: "100%", borderRadius: 6 },
  chartLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 14 },
  targetLine: { borderTopWidth: 1, borderStyle: "dashed", paddingTop: 6 },
  targetLineLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  adultStats: { flexDirection: "row", gap: 8 },
  statBox: { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center" },
  quickTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  quickChipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
