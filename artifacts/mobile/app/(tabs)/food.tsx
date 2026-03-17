import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
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

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface FoodResult {
  foodName: string;
  estimatedCarbs: number;
  confidence: "high" | "medium" | "low";
  tips?: string;
}

const QUICK_FOODS = [
  "Apple",
  "Pizza",
  "Rice",
  "Banana",
  "Sandwich",
  "Oatmeal",
  "Pasta",
  "Milk",
];

export default function FoodScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<FoodResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  async function search(food: string) {
    const q = food.trim();
    if (!q) return;
    setQuery(q);
    setError("");
    setIsLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE_URL}/api/food/estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodName: q }),
      });
      const data: FoodResult = await res.json();
      setResult(data);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setError("Could not estimate. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const confidenceColor = {
    high: COLORS.success,
    medium: COLORS.warning,
    low: COLORS.danger,
  };

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
        <Text style={[styles.pageTitle, { color: colors.text }]}>
          Food Lookup
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Estimate carbs in any food
        </Text>

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
            <Pressable
              onPress={() => {
                setQuery("");
                setResult(null);
                setError("");
              }}
            >
              <Feather name="x" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.searchBtn,
            {
              backgroundColor: COLORS.primary,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
          onPress={() => search(query)}
          disabled={isLoading}
        >
          <Text style={styles.searchBtnText}>
            {isLoading ? "Looking up..." : "Estimate Carbs"}
          </Text>
        </Pressable>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: COLORS.dangerLight }]}>
            <Feather name="alert-circle" size={16} color={COLORS.danger} />
            <Text style={[styles.errorText, { color: COLORS.danger }]}>{error}</Text>
          </View>
        ) : null}

        {result && (
          <View
            style={[
              styles.resultCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.resultTop}>
              <View>
                <Text style={[styles.foodName, { color: colors.text }]}>
                  {result.foodName}
                </Text>
                <View
                  style={[
                    styles.confidenceBadge,
                    {
                      backgroundColor:
                        confidenceColor[result.confidence] + "20",
                    },
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
                <Text style={[styles.carbLabel, { color: COLORS.primary }]}>
                  g carbs
                </Text>
              </View>
            </View>

            {result.tips && (
              <View
                style={[
                  styles.tipsBox,
                  { backgroundColor: colors.backgroundTertiary },
                ]}
              >
                <Feather name="info" size={14} color={colors.textSecondary} />
                <Text style={[styles.tipsText, { color: colors.textSecondary }]}>
                  {result.tips}
                </Text>
              </View>
            )}
          </View>
        )}

        <Text style={[styles.quickTitle, { color: colors.text }]}>
          Quick Lookup
        </Text>
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
  pageTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 24,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },
  searchBtn: {
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 20,
  },
  searchBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  resultCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 24,
    gap: 14,
  },
  resultTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  foodName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
    textTransform: "capitalize",
  },
  confidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  confidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  confidenceText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  carbBubble: {
    alignItems: "center",
    backgroundColor: COLORS.primary + "14",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
  },
  carbValue: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    lineHeight: 38,
  },
  carbLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  tipsBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  tipsText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  quickTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
