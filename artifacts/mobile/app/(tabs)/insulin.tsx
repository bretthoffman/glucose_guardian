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
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import type { GlucoseEntry } from "@/context/GlucoseContext";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface PredictionResult {
  carbs: number;
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
  carbRatio: number;
  correctionFactor: number;
}

const MONSTER_FACE: Record<string, string> = {
  happy: "😊",
  worried: "😟",
  danger: "😨",
};

const MONSTER_MSG: Record<string, string> = {
  happy: "Sugar Monster is happy!",
  worried: "Sugar Monster is a little worried...",
  danger: "Sugar Monster needs your help!",
};

const MONSTER_BG: Record<string, string> = {
  happy: COLORS.success,
  worried: COLORS.warning,
  danger: COLORS.danger,
};

const TREND_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  rapidly_rising: { label: "↑↑ Rising fast", color: COLORS.danger, icon: "trending-up" },
  rising: { label: "↑ Rising", color: COLORS.warning, icon: "trending-up" },
  stable: { label: "→ Stable", color: COLORS.success, icon: "minus" },
  falling: { label: "↓ Falling", color: COLORS.accent, icon: "trending-down" },
  rapidly_falling: { label: "↓↓ Falling fast", color: COLORS.primary, icon: "trending-down" },
};

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

function glucoseColor(val: number): string {
  if (val < 70) return COLORS.danger;
  if (val <= 180) return COLORS.success;
  if (val <= 250) return COLORS.warning;
  return COLORS.danger;
}

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { carbRatio, targetGlucose, correctionFactor, latestReading, history } = useGlucose();
  const { isMinor } = useAuth();

  const [carbs, setCarbs] = useState("");
  const [currentGlucose, setCurrentGlucose] = useState(
    latestReading ? String(latestReading.glucose) : ""
  );
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const currentTrend = detectTrend(history);
  const trendInfo = TREND_LABELS[currentTrend] ?? TREND_LABELS.stable;

  async function predict() {
    const carbsNum = parseFloat(carbs);
    if (!carbs || isNaN(carbsNum) || carbsNum <= 0) {
      setError("Enter how many carbs you plan to eat.");
      return;
    }
    setError("");
    setIsLoading(true);
    setPrediction(null);
    try {
      const cgNum = parseFloat(currentGlucose);
      const res = await fetch(`${BASE_URL}/api/insulin/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carbs: carbsNum,
          currentGlucose: !isNaN(cgNum) && cgNum > 0 ? cgNum : null,
          carbRatio,
          targetGlucose,
          correctionFactor,
          trendDirection: currentTrend,
          isMinor,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Could not generate prediction. Please try again.");
        return;
      }
      const data: PredictionResult = await res.json();
      setPrediction(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError("Could not connect. Check your internet connection.");
    } finally {
      setIsLoading(false);
    }
  }

  function reset() {
    setCarbs("");
    setCurrentGlucose(latestReading ? String(latestReading.glucose) : "");
    setPrediction(null);
    setError("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const levels = prediction
    ? [
        { label: "Now", value: prediction.currentGlucose },
        { label: "30 min\npeak", value: prediction.predictedPeak30 },
        { label: "60 min\nw/ insulin", value: prediction.predicted60WithInsulin },
      ]
    : [];

  const maxVal = levels.length ? Math.max(...levels.map((l) => l.value), targetGlucose + 60) : 200;
  const minVal = levels.length ? Math.min(...levels.map((l) => l.value), 60) : 60;
  const chartRange = Math.max(maxVal - minVal, 60);

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
        <Text style={[styles.pageTitle, { color: colors.text }]}>Glucose Predictor</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isMinor
            ? "See how your sugar will change after eating and get insulin advice"
            : "Predict post-meal glucose and get a precise insulin recommendation"}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {history.length > 1 && (
            <View style={[styles.trendRow, { backgroundColor: trendInfo.color + "15", borderColor: trendInfo.color + "30" }]}>
              <Feather name={trendInfo.icon as any} size={14} color={trendInfo.color} />
              <Text style={[styles.trendLabel, { color: trendInfo.color }]}>
                Current trend: {trendInfo.label}
              </Text>
            </View>
          )}

          <Text style={[styles.inputLabel, { color: colors.text }]}>Carbs to eat (g)</Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundTertiary,
                color: colors.text,
                borderColor: error ? COLORS.danger : colors.border,
              },
            ]}
            value={carbs}
            onChangeText={setCarbs}
            placeholder="e.g. 45"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="next"
          />
          {!!error && <Text style={styles.errorText}>{error}</Text>}

          <Text style={[styles.inputLabel, { color: colors.text, marginTop: 14 }]}>
            Current glucose (mg/dL){" "}
            <Text style={[styles.optional, { color: colors.textMuted }]}>optional</Text>
          </Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border },
            ]}
            value={currentGlucose}
            onChangeText={setCurrentGlucose}
            placeholder={`e.g. ${latestReading?.glucose ?? 120}`}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="done"
            onSubmitEditing={predict}
          />

          <View style={[styles.settingsPills, { borderTopColor: colors.separator }]}>
            <SettingPill label="Carb Ratio" value={`1:${carbRatio}`} colors={colors} />
            <SettingPill label="Target" value={`${targetGlucose}`} colors={colors} />
            <SettingPill label="ISF" value={`1:${correctionFactor}`} colors={colors} />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.predictBtn,
            { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={predict}
          disabled={isLoading}
        >
          <Feather name="trending-up" size={18} color="#fff" />
          <Text style={styles.predictBtnText}>{isLoading ? "Predicting..." : "Predict Glucose"}</Text>
        </Pressable>

        {prediction && (
          <>
            {isMinor ? (
              <KidResultView prediction={prediction} colors={colors} />
            ) : (
              <AdultResultView
                prediction={prediction}
                levels={levels}
                minVal={minVal}
                chartRange={chartRange}
                colors={colors}
              />
            )}

            <View style={[styles.disclaimer, { backgroundColor: COLORS.warningLight }]}>
              <Feather name="alert-circle" size={14} color={COLORS.warning} />
              <Text style={[styles.disclaimerText, { color: "#92400E" }]}>
                This is an estimate only. Always verify doses with your doctor or care team before taking insulin.
              </Text>
            </View>

            <Pressable onPress={reset} style={[styles.resetBtn, { borderColor: colors.border }]}>
              <Feather name="refresh-cw" size={15} color={colors.textMuted} />
              <Text style={[styles.resetBtnText, { color: colors.textMuted }]}>New Prediction</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function KidResultView({
  prediction,
  colors,
}: {
  prediction: PredictionResult;
  colors: (typeof Colors)["light"];
}) {
  const mood = prediction.monsterMood;
  const monsterBg = MONSTER_BG[mood];
  const spikePercent = Math.min(100, Math.max(0, ((prediction.predictedPeak30 - 70) / (350 - 70)) * 100));

  return (
    <View style={styles.kidResult}>
      <View style={[styles.monsterCard, { backgroundColor: monsterBg + "18", borderColor: monsterBg + "40" }]}>
        <Text style={styles.monsterFace}>{MONSTER_FACE[mood]}</Text>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.monsterMoodLabel, { color: monsterBg }]}>{MONSTER_MSG[mood]}</Text>
          <Text style={[styles.friendlyMsg, { color: colors.text }]}>{prediction.friendlyMessage}</Text>
        </View>
      </View>

      <View style={[styles.spikeSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.spikeSectionTitle, { color: colors.text }]}>Sugar Spike Forecast</Text>
        <View style={[styles.spikeBarBg, { backgroundColor: colors.backgroundTertiary }]}>
          <View style={[styles.spikeBarFill, { width: `${spikePercent}%` as any, backgroundColor: monsterBg }]} />
          <View style={[styles.targetMarker, { left: `${Math.min(99, ((prediction.targetGlucose - 70) / (350 - 70)) * 100)}%` as any }]} />
        </View>
        <View style={styles.spikeLegend}>
          <Text style={[styles.spikeLegendText, { color: colors.textMuted }]}>70</Text>
          <Text style={[styles.spikePeakLabel, { color: monsterBg }]}>Peak: ~{prediction.predictedPeak30} mg/dL</Text>
          <Text style={[styles.spikeLegendText, { color: colors.textMuted }]}>350</Text>
        </View>
      </View>

      <View style={[styles.timingCard, { backgroundColor: COLORS.accent + "12", borderColor: COLORS.accent + "30" }]}>
        <Text style={styles.timingEmoji}>{prediction.timingEmoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.timingTitle, { color: COLORS.accent }]}>Timing Tip</Text>
          <Text style={[styles.timingBody, { color: colors.text }]}>{prediction.timingAdvice}</Text>
        </View>
      </View>

      <View style={[styles.doseCard, { backgroundColor: COLORS.primary + "12", borderColor: COLORS.primary + "30" }]}>
        <Feather name="droplet" size={22} color={COLORS.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.doseLabel, { color: COLORS.primary }]}>Suggested Insulin</Text>
          <Text style={[styles.doseValue, { color: colors.text }]}>
            {prediction.insulinDose} units{" "}
            <Text style={[styles.doseNote, { color: colors.textMuted }]}>
              (1:{prediction.carbRatio} ratio)
            </Text>
          </Text>
        </View>
      </View>
    </View>
  );
}

function AdultResultView({
  prediction,
  levels,
  minVal,
  chartRange,
  colors,
}: {
  prediction: PredictionResult;
  levels: { label: string; value: number }[];
  minVal: number;
  chartRange: number;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={styles.adultResult}>
      <View style={[styles.glucoseRangeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.rangCardTitle, { color: colors.text }]}>Predicted Glucose Range</Text>
        <View style={styles.glucoseChart}>
          {levels.map((level, i) => {
            const barH = Math.max(10, ((level.value - minVal) / chartRange) * 100);
            const col = glucoseColor(level.value);
            return (
              <View key={i} style={styles.chartCol}>
                <Text style={[styles.chartValue, { color: col }]}>{level.value}</Text>
                <Text style={[styles.chartUnit, { color: colors.textMuted }]}>mg/dL</Text>
                <View style={styles.barContainer}>
                  <View style={[styles.bar, { height: barH, backgroundColor: col }]} />
                </View>
                <Text style={[styles.chartLabel, { color: colors.textMuted }]}>{level.label}</Text>
              </View>
            );
          })}
        </View>
        <View style={[styles.targetRow, { borderTopColor: colors.separator }]}>
          <View style={[styles.targetDot, { backgroundColor: COLORS.success }]} />
          <Text style={[styles.targetRowText, { color: colors.textSecondary }]}>
            Target: {prediction.targetGlucose} mg/dL
          </Text>
          <Text style={[styles.inRangeBadge, {
            color: prediction.inRange60 ? COLORS.success : COLORS.warning,
            backgroundColor: prediction.inRange60 ? COLORS.success + "15" : COLORS.warning + "15",
          }]}>
            {prediction.inRange60 ? "In range ✓" : "Above range"}
          </Text>
        </View>
      </View>

      <View style={[styles.timingCard, { backgroundColor: COLORS.accent + "12", borderColor: COLORS.accent + "30" }]}>
        <Text style={styles.timingEmoji}>{prediction.timingEmoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.timingTitle, { color: COLORS.accent }]}>Timing Recommendation</Text>
          <Text style={[styles.timingBody, { color: colors.text }]}>{prediction.timingAdvice}</Text>
        </View>
      </View>

      <View style={styles.adultStatRow}>
        <View style={[styles.adultStatBox, { backgroundColor: COLORS.primary + "12", borderColor: COLORS.primary + "30" }]}>
          <Text style={[styles.adultStatValue, { color: COLORS.primary }]}>{prediction.insulinDose}u</Text>
          <Text style={[styles.adultStatLabel, { color: colors.textMuted }]}>Suggested dose</Text>
        </View>
        <View style={[styles.adultStatBox, { backgroundColor: glucoseColor(prediction.predicted60WithInsulin) + "12", borderColor: glucoseColor(prediction.predicted60WithInsulin) + "30" }]}>
          <Text style={[styles.adultStatValue, { color: glucoseColor(prediction.predicted60WithInsulin) }]}>
            {prediction.predicted60WithInsulin}
          </Text>
          <Text style={[styles.adultStatLabel, { color: colors.textMuted }]}>Predicted @ 60 min</Text>
        </View>
      </View>

      <View style={[styles.doseBreakdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.breakdownTitle, { color: colors.text }]}>Dose Breakdown</Text>
        <BreakdownRow label="Meal dose" value={`${prediction.insulinDose}u`} sub={`${prediction.carbs}g ÷ 1:${prediction.carbRatio}`} colors={colors} color={COLORS.primary} />
        <BreakdownRow label="ISF used" value={`1:${prediction.correctionFactor}`} sub="mg/dL per unit" colors={colors} color={colors.textSecondary} />
      </View>
    </View>
  );
}

function SettingPill({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={[styles.pill, { backgroundColor: colors.backgroundTertiary }]}>
      <Text style={[styles.pillLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function BreakdownRow({
  label,
  value,
  sub,
  color,
  colors,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={styles.bRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.bSub, { color: colors.textMuted }]}>{sub}</Text>
      </View>
      <Text style={[styles.bValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 20, lineHeight: 22 },
  card: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 16, gap: 4 },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  trendLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  inputLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  optional: { fontFamily: "Inter_400Regular", fontSize: 13 },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  errorText: { color: COLORS.danger, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  settingsPills: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  pill: { flex: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  pillLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginBottom: 2 },
  pillValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  predictBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 20,
  },
  predictBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  kidResult: { gap: 14, marginBottom: 16 },
  monsterCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  monsterFace: { fontSize: 52, lineHeight: 60 },
  monsterMoodLabel: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 4 },
  friendlyMsg: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  spikeSection: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  spikeSectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  spikeBarBg: { height: 14, borderRadius: 7, overflow: "visible" },
  spikeBarFill: { height: "100%", borderRadius: 7 },
  targetMarker: {
    position: "absolute",
    top: -4,
    width: 3,
    height: 22,
    backgroundColor: COLORS.success,
    borderRadius: 2,
  },
  spikeLegend: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  spikeLegendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  spikePeakLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  timingCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  timingEmoji: { fontSize: 22, lineHeight: 28 },
  timingTitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 2 },
  timingBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  doseCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  doseLabel: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 2 },
  doseValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  doseNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  adultResult: { gap: 14, marginBottom: 16 },
  glucoseRangeCard: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 14 },
  rangCardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  glucoseChart: { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end", gap: 8 },
  chartCol: { flex: 1, alignItems: "center", gap: 2 },
  chartValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  chartUnit: { fontSize: 10, fontFamily: "Inter_400Regular" },
  barContainer: { width: "100%", height: 110, justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 6 },
  chartLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 14, marginTop: 4 },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  targetRowText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  inRangeBadge: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  adultStatRow: { flexDirection: "row", gap: 12 },
  adultStatBox: { flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, alignItems: "center", gap: 4 },
  adultStatValue: { fontSize: 28, fontFamily: "Inter_700Bold" },
  adultStatLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  doseBreakdown: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  breakdownTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  bRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  bLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  bSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  bValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  resetBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
