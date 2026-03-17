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

const QUICK_FOODS = ["Apple", "Pizza", "Rice", "Banana", "Sandwich", "Oatmeal", "Pasta", "Milk"];

export default function FoodScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { carbRatio } = useGlucose();
  const { addFoodLogEntry } = useAuth();

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FoodResult | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [error, setError] = useState("");
  const [logged, setLogged] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const confidenceColor = {
    high: COLORS.success,
    medium: COLORS.warning,
    low: COLORS.danger,
  };

  async function search(food: string) {
    const q = food.trim();
    if (!q) return;
    setQuery(q);
    setError("");
    setIsLoading(true);
    setResult(null);
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
      setResult({ ...data, insulinUnits, fromPhoto: false });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    setQuery("");
    setLogged(false);
    setError("");
    setIsAnalyzingPhoto(true);

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
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
          const text = await res.text().catch(() => "");
          if (res.status === 413) {
            errorMsg = "Photo is too large. Try taking a closer, smaller shot.";
          } else if (text) {
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
    });
    setLogged(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

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

        <View style={styles.cameraRow}>
          <Pressable
            style={({ pressed }) => [
              styles.cameraBtn,
              {
                backgroundColor: COLORS.primary,
                opacity: pressed ? 0.85 : 1,
                flex: 1,
              },
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
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
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

        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
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
            <Pressable onPress={() => { setQuery(""); setResult(null); setError(""); }}>
              <Feather name="x" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.searchBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
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
          <View
            style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
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
                  <Text style={[styles.portionText, { color: colors.textMuted }]}>
                    {result.portion}
                  </Text>
                )}
                <View
                  style={[
                    styles.confidenceBadge,
                    { backgroundColor: confidenceColor[result.confidence] + "20" },
                  ]}
                >
                  <View
                    style={[
                      styles.confidenceDot,
                      { backgroundColor: confidenceColor[result.confidence] },
                    ]}
                  />
                  <Text
                    style={[
                      styles.confidenceText,
                      { color: confidenceColor[result.confidence] },
                    ]}
                  >
                    {result.confidence} confidence
                  </Text>
                </View>
              </View>
              <View style={styles.carbBubble}>
                <Text style={[styles.carbValue, { color: COLORS.primary }]}>
                  {result.estimatedCarbs}
                </Text>
                <Text style={[styles.carbLabel, { color: COLORS.primary }]}>g carbs</Text>
              </View>
            </View>

            {result.insulinUnits !== undefined && result.insulinUnits > 0 && (
              <View
                style={[
                  styles.insulinBox,
                  { backgroundColor: COLORS.accent + "15", borderColor: COLORS.accent + "30" },
                ]}
              >
                <Feather name="droplet" size={16} color={COLORS.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.insulinTitle, { color: COLORS.accent }]}>
                    Suggested Insulin
                  </Text>
                  <Text style={[styles.insulinValue, { color: colors.text }]}>
                    {result.insulinUnits} units{" "}
                    <Text style={[styles.insulinNote, { color: colors.textMuted }]}>
                      (based on 1:{carbRatio} carb ratio)
                    </Text>
                  </Text>
                </View>
              </View>
            )}

            {result.tips && (
              <View
                style={[styles.tipsBox, { backgroundColor: colors.backgroundTertiary }]}
              >
                <Feather name="info" size={14} color={colors.textSecondary} />
                <Text style={[styles.tipsText, { color: colors.textSecondary }]}>
                  {result.tips}
                </Text>
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
              <Feather
                name={logged ? "check-circle" : "plus-circle"}
                size={16}
                color={logged ? COLORS.success : "#fff"}
              />
              <Text
                style={[
                  styles.logBtnText,
                  { color: logged ? COLORS.success : "#fff" },
                ]}
              >
                {logged ? "Logged to Food Diary" : "Log This Meal"}
              </Text>
            </Pressable>
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
                  {
                    color:
                      result?.foodName?.toLowerCase() === food.toLowerCase()
                        ? "#fff"
                        : colors.text,
                  },
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 20 },
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
  photoOverlayText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
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
  resultCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 24,
    gap: 12,
  },
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
  resultTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  foodName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
    textTransform: "capitalize",
  },
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
  insulinBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  insulinTitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 2 },
  insulinValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  insulinNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  tipsBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
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
  quickTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickChipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
