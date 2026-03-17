import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useMemo, useState } from "react";
import {
  Dimensions,
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

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_H = 160;
const CHART_INNER_H = CHART_H - 28;
const LOW_THRESH = 70;
const HIGH_THRESH = 180;
const CHART_MIN = 40;
const CHART_MAX = 320;
const CHART_RANGE = CHART_MAX - CHART_MIN;

type TimeRange = "3H" | "6H" | "12H" | "24H";
const TIME_RANGES: TimeRange[] = ["3H", "6H", "12H", "24H"];
const RANGE_MS: Record<TimeRange, number> = {
  "3H": 3 * 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "12H": 12 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
};

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

interface Suggestion {
  icon: string;
  feather: string;
  title: string;
  body: string;
  color: string;
  priority: number;
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

function glucoseColor(val: number): string {
  if (val < 70) return COLORS.danger;
  if (val <= 180) return COLORS.success;
  if (val <= 250) return COLORS.warning;
  return COLORS.danger;
}

function yPct(glucose: number): number {
  const clamped = Math.max(CHART_MIN, Math.min(CHART_MAX, glucose));
  return 1 - (clamped - CHART_MIN) / CHART_RANGE;
}

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

function analyzeReadings(readings: GlucoseEntry[], targetGlucose: number, isMinor: boolean): Suggestion[] {
  if (readings.length === 0) return [];

  const suggestions: Suggestion[] = [];
  const lows = readings.filter((r) => r.glucose < LOW_THRESH);
  const highs = readings.filter((r) => r.glucose > HIGH_THRESH);
  const inRange = readings.filter((r) => r.glucose >= LOW_THRESH && r.glucose <= HIGH_THRESH);
  const timeInRange = Math.round((inRange.length / readings.length) * 100);
  const avg = Math.round(readings.reduce((s, r) => s + r.glucose, 0) / readings.length);
  const trend = detectTrend(readings);
  const latest = readings[readings.length - 1]?.glucose ?? 0;

  if (lows.length > 0) {
    const worstLow = Math.min(...lows.map((r) => r.glucose));
    suggestions.push({
      icon: "🧃",
      feather: "alert-triangle",
      title: isMinor ? "Sugar went low! Drink juice!" : "Hypoglycemia detected",
      body: isMinor
        ? `Your sugar dropped to ${worstLow} mg/dL. Drink 4 oz of juice or eat 4 glucose tablets right now! Tell an adult and wait 15 min then recheck.`
        : `Glucose dropped to ${worstLow} mg/dL. Treat with 15–20g fast-acting carbs (juice, glucose tabs, or regular soda). Recheck in 15 min. Consider whether your last insulin dose was too large.`,
      color: COLORS.danger,
      priority: 1,
    });
  }

  if (trend === "rapidly_falling" || trend === "falling") {
    suggestions.push({
      icon: "🍎",
      feather: "trending-down",
      title: isMinor ? "Your sugar is dropping — eat a snack!" : "Falling glucose — act now",
      body: isMinor
        ? "Your sugar is going down fast. Eat a small snack like an apple, crackers, or a few glucose tablets. Don't wait until you feel bad!"
        : "Glucose is trending down. Have 15g of carbs (fruit, crackers, milk). If you recently took insulin, it may still be peaking — delay your next dose.",
      color: COLORS.warning,
      priority: 2,
    });
  }

  if (trend === "rapidly_rising" || trend === "rising") {
    suggestions.push({
      icon: "🚶",
      feather: "trending-up",
      title: isMinor ? "Try a short walk to help!" : "Rising glucose — consider activity",
      body: isMinor
        ? "Your sugar is going up! A 10–15 minute walk or some active play can help bring it back down naturally. Ask a parent about a correction dose too."
        : "Glucose is trending up. A brisk 10–15 min walk can reduce glucose 20–40 mg/dL naturally. If you're above 250, consider a correction dose per your insulin settings.",
      color: COLORS.warning,
      priority: 3,
    });
  }

  if (highs.length > 0 && lows.length === 0 && trend !== "rapidly_rising") {
    const worstHigh = Math.max(...highs.map((r) => r.glucose));
    suggestions.push({
      icon: "💧",
      feather: "droplet",
      title: isMinor ? "High sugar — drink water!" : "Elevated glucose pattern",
      body: isMinor
        ? `Your sugar got up to ${worstHigh} mg/dL. Drink a big glass of water and tell an adult. Staying hydrated helps your body manage sugar!`
        : `Peak of ${worstHigh} mg/dL detected. Increase water intake (glucose is excreted in urine when high). If this pattern persists after meals, consider taking insulin 10–15 min earlier.`,
      color: COLORS.warning,
      priority: 4,
    });
  }

  if (timeInRange < 50 && readings.length >= 4) {
    suggestions.push({
      icon: "👨‍⚕️",
      feather: "user",
      title: "Talk to your care team",
      body: isMinor
        ? `You were only in your safe zone ${timeInRange}% of the time. Your doctor might want to look at your insulin settings. That's totally OK — they're here to help!`
        : `Time-in-range is ${timeInRange}% over this period (target: 70%+). Review your carb ratio, correction factor, and meal timing with your endocrinologist.`,
      color: COLORS.primary,
      priority: 5,
    });
  }

  if (avg > HIGH_THRESH && trend === "stable" && lows.length === 0) {
    suggestions.push({
      icon: "🍽️",
      feather: "coffee",
      title: isMinor ? "Try smaller meal portions" : "Consistently elevated — meal timing",
      body: isMinor
        ? "Your sugar has been a bit high. Eating smaller portions and not having too many sugary drinks can really help keep it in the safe zone!"
        : `Average glucose ${avg} mg/dL suggests post-meal spikes or basal drift. Try smaller portions, more fiber-rich foods, and consider pre-bolusing insulin 10–15 min before meals.`,
      color: COLORS.accent,
      priority: 6,
    });
  }

  if (timeInRange >= 70 && lows.length === 0 && readings.length >= 3) {
    suggestions.push({
      icon: "🌟",
      feather: "star",
      title: isMinor ? "Great job managing your sugar!" : "Excellent glucose control",
      body: isMinor
        ? `You were in your safe zone ${timeInRange}% of the time — amazing work! Keep it up with your meals and insulin routine. You're a diabetes superstar! 🌟`
        : `Time-in-range: ${timeInRange}%. Average: ${avg} mg/dL. Your diabetes management is on track. Continue your current meal and insulin routine.`,
      color: COLORS.success,
      priority: 7,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 4);
}

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { carbRatio, targetGlucose, correctionFactor, latestReading, history } = useGlucose();
  const { isMinor } = useAuth();

  const [timeRange, setTimeRange] = useState<TimeRange>("6H");
  const [carbs, setCarbs] = useState("");
  const [currentGlucose, setCurrentGlucose] = useState(
    latestReading ? String(latestReading.glucose) : ""
  );
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const filteredReadings = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[timeRange];
    return history.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }, [history, timeRange]);

  const stats = useMemo(() => {
    if (filteredReadings.length === 0) return null;
    const vals = filteredReadings.map((r) => r.glucose);
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    const inRange = filteredReadings.filter((r) => r.glucose >= LOW_THRESH && r.glucose <= HIGH_THRESH).length;
    const tir = Math.round((inRange / filteredReadings.length) * 100);
    const lows = filteredReadings.filter((r) => r.glucose < LOW_THRESH).length;
    const highs = filteredReadings.filter((r) => r.glucose > HIGH_THRESH).length;
    return { avg, tir, lows, highs };
  }, [filteredReadings]);

  const suggestions = useMemo(
    () => analyzeReadings(filteredReadings, targetGlucose, isMinor),
    [filteredReadings, targetGlucose, isMinor]
  );

  const currentTrend = detectTrend(history);

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

  const predLevels = prediction
    ? [
        { label: "Now", value: prediction.currentGlucose },
        { label: "30 min\npeak", value: prediction.predictedPeak30 },
        { label: "60 min\nw/ insulin", value: prediction.predicted60WithInsulin },
      ]
    : [];
  const predMax = predLevels.length ? Math.max(...predLevels.map((l) => l.value), targetGlucose + 60) : 200;
  const predMin = predLevels.length ? Math.min(...predLevels.map((l) => l.value), 60) : 60;
  const predRange = Math.max(predMax - predMin, 60);

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
        <Text style={[styles.pageTitle, { color: colors.text }]}>Glucose Trends</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isMinor
            ? "See your sugar patterns and get helpful tips"
            : "Analyze glucose patterns, time-in-range, and AI-powered recommendations"}
        </Text>

        <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.rangeRow}>
            {TIME_RANGES.map((r) => (
              <Pressable
                key={r}
                style={[
                  styles.rangeTab,
                  {
                    backgroundColor: timeRange === r ? COLORS.primary : colors.backgroundTertiary,
                    borderColor: timeRange === r ? COLORS.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setTimeRange(r);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Text style={[styles.rangeTabText, { color: timeRange === r ? "#fff" : colors.textMuted }]}>
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>

          <GlucoseLineChart
            readings={filteredReadings}
            colors={colors}
            isDark={isDark}
            targetGlucose={targetGlucose}
          />

          {stats && (
            <View style={styles.statsRow}>
              <StatChip
                label="Avg"
                value={`${stats.avg}`}
                unit="mg/dL"
                color={glucoseColor(stats.avg)}
                colors={colors}
              />
              <StatChip
                label="In Range"
                value={`${stats.tir}%`}
                unit="time"
                color={stats.tir >= 70 ? COLORS.success : stats.tir >= 50 ? COLORS.warning : COLORS.danger}
                colors={colors}
              />
              <StatChip
                label="Lows"
                value={`${stats.lows}`}
                unit="events"
                color={stats.lows > 0 ? COLORS.danger : COLORS.success}
                colors={colors}
              />
              <StatChip
                label="Highs"
                value={`${stats.highs}`}
                unit="events"
                color={stats.highs > 0 ? COLORS.warning : COLORS.success}
                colors={colors}
              />
            </View>
          )}
        </View>

        {suggestions.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {isMinor ? "Tips for You 💡" : "AI Suggestions"}
            </Text>
            {suggestions.map((s, i) => (
              <SuggestionCard key={i} suggestion={s} colors={colors} isMinor={isMinor} />
            ))}
          </>
        )}

        {filteredReadings.length === 0 && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.emptyIcon}>📊</Text>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No readings in this period</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              {isMinor
                ? "Sync your CGM or simulate a reading from the Glucose tab to see your trends here!"
                : "Sync your CGM or add readings from the Glucose tab to see trend analysis."}
            </Text>
          </View>
        )}

        <View style={[styles.dividerSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {isMinor ? "What will my sugar do? 🔮" : "Meal Prediction"}
          </Text>
          <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
            {isMinor
              ? "Tell me what you're eating and I'll show you what happens!"
              : "Enter carbs to predict post-meal glucose and get an insulin recommendation"}
          </Text>
        </View>

        <View style={[styles.inputCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>Carbs to eat (g)</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: error ? COLORS.danger : colors.border },
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
            Current glucose{" "}
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

          <View style={[styles.pillsRow, { borderTopColor: colors.separator }]}>
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
                levels={predLevels}
                minVal={predMin}
                chartRange={predRange}
                colors={colors}
              />
            )}

            <View style={[styles.disclaimer, { backgroundColor: COLORS.warningLight }]}>
              <Feather name="alert-circle" size={14} color={COLORS.warning} />
              <Text style={[styles.disclaimerText, { color: "#92400E" }]}>
                Estimates only. Always verify doses with your doctor or care team.
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

function GlucoseLineChart({
  readings,
  colors,
  isDark,
  targetGlucose,
}: {
  readings: GlucoseEntry[];
  colors: (typeof Colors)["light"];
  isDark: boolean;
  targetGlucose: number;
}) {
  const CHART_W = SCREEN_WIDTH - 80;

  if (readings.length === 0) {
    return (
      <View style={[styles.chartEmpty, { backgroundColor: colors.backgroundTertiary }]}>
        <Text style={[styles.chartEmptyText, { color: colors.textMuted }]}>No data for this period</Text>
      </View>
    );
  }

  const sorted = [...readings].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const startTime = new Date(sorted[0].timestamp).getTime();
  const endTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
  const timeSpan = Math.max(endTime - startTime, 1);

  const lowY = yPct(LOW_THRESH) * CHART_INNER_H;
  const highY = yPct(HIGH_THRESH) * CHART_INNER_H;
  const targetY = yPct(targetGlucose) * CHART_INNER_H;

  const points = sorted.map((r) => {
    const x = ((new Date(r.timestamp).getTime() - startTime) / timeSpan) * CHART_W;
    const y = yPct(r.glucose) * CHART_INNER_H;
    return { x, y, glucose: r.glucose, timestamp: r.timestamp };
  });

  const firstTs = sorted[0]?.timestamp ?? "";
  const lastTs = sorted[sorted.length - 1]?.timestamp ?? "";

  return (
    <View style={[styles.chartOuter, { height: CHART_H }]}>
      <View style={[styles.chartArea, { width: CHART_W, height: CHART_INNER_H }]}>
        <View
          style={[
            styles.zoneBand,
            {
              top: highY,
              height: lowY - highY,
              backgroundColor: COLORS.success + (isDark ? "18" : "12"),
            },
          ]}
        />
        <View
          style={[
            styles.threshLine,
            { top: lowY - 1, backgroundColor: COLORS.danger + "60" },
          ]}
        />
        <View
          style={[
            styles.threshLine,
            { top: highY - 1, backgroundColor: COLORS.warning + "60" },
          ]}
        />
        <View
          style={[
            styles.threshLine,
            { top: targetY - 1, borderStyle: "dashed" as any, backgroundColor: COLORS.success + "80" },
          ]}
        />

        {points.map((p, i) => {
          const col = glucoseColor(p.glucose);
          return (
            <React.Fragment key={i}>
              {i < points.length - 1 && (() => {
                const next = points[i + 1];
                const dx = next.x - p.x;
                const dy = next.y - p.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                const midColor = glucoseColor((p.glucose + next.glucose) / 2);
                return (
                  <View
                    style={[
                      styles.lineSegment,
                      {
                        width: len,
                        left: p.x,
                        top: p.y,
                        backgroundColor: midColor,
                        transform: [{ rotate: `${angle}deg` }],
                      },
                    ]}
                  />
                );
              })()}
              <View
                style={[
                  styles.dot,
                  {
                    left: p.x - 4,
                    top: p.y - 4,
                    backgroundColor: col,
                    borderColor: isDark ? "#1E293B" : "#fff",
                  },
                ]}
              />
            </React.Fragment>
          );
        })}

        <Text style={[styles.threshLabel, { top: lowY - 12, color: COLORS.danger + "CC" }]}>
          70
        </Text>
        <Text style={[styles.threshLabel, { top: highY + 2, color: COLORS.warning + "CC" }]}>
          180
        </Text>
      </View>

      <View style={styles.timeLabels}>
        <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
          {firstTs
            ? new Date(firstTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : ""}
        </Text>
        {sorted[Math.floor(sorted.length / 2)] && (
          <Text style={[styles.timeLabel, { color: colors.textMuted }]}>
            {new Date(sorted[Math.floor(sorted.length / 2)].timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        )}
        <Text style={[styles.timeLabel, { color: colors.textMuted }]}>Now</Text>
      </View>
    </View>
  );
}

function SuggestionCard({
  suggestion,
  colors,
  isMinor,
}: {
  suggestion: Suggestion;
  colors: (typeof Colors)["light"];
  isMinor: boolean;
}) {
  return (
    <View
      style={[
        styles.suggestionCard,
        {
          backgroundColor: suggestion.color + "10",
          borderColor: suggestion.color + "35",
        },
      ]}
    >
      <View style={[styles.suggIconBg, { backgroundColor: suggestion.color + "20" }]}>
        <Text style={styles.suggIconText}>{suggestion.icon}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.suggTitle, { color: suggestion.color }]}>{suggestion.title}</Text>
        <Text style={[styles.suggBody, { color: colors.text }]}>{suggestion.body}</Text>
      </View>
    </View>
  );
}

function StatChip({
  label,
  value,
  unit,
  color,
  colors,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={styles.statChip}>
      <Text style={[styles.statChipValue, { color }]}>{value}</Text>
      <Text style={[styles.statChipLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
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
            <Text style={[styles.doseNote, { color: colors.textMuted }]}>(1:{prediction.carbRatio} ratio)</Text>
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
          <Text
            style={[
              styles.inRangeBadge,
              {
                color: prediction.inRange60 ? COLORS.success : COLORS.warning,
                backgroundColor: prediction.inRange60 ? COLORS.success + "15" : COLORS.warning + "15",
              },
            ]}
          >
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
        <View
          style={[
            styles.adultStatBox,
            {
              backgroundColor: glucoseColor(prediction.predicted60WithInsulin) + "12",
              borderColor: glucoseColor(prediction.predicted60WithInsulin) + "30",
            },
          ]}
        >
          <Text style={[styles.adultStatValue, { color: glucoseColor(prediction.predicted60WithInsulin) }]}>
            {prediction.predicted60WithInsulin}
          </Text>
          <Text style={[styles.adultStatLabel, { color: colors.textMuted }]}>Predicted @ 60 min</Text>
        </View>
      </View>

      <View style={[styles.doseBreakdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.breakdownTitle, { color: colors.text }]}>Dose Breakdown</Text>
        <BreakdownRow
          label="Meal dose"
          value={`${prediction.insulinDose}u`}
          sub={`${prediction.carbs}g ÷ 1:${prediction.carbRatio}`}
          colors={colors}
          color={COLORS.primary}
        />
        <BreakdownRow
          label="ISF used"
          value={`1:${prediction.correctionFactor}`}
          sub="mg/dL per unit"
          colors={colors}
          color={colors.textSecondary}
        />
      </View>
    </View>
  );
}

function SettingPill({ label, value, colors }: { label: string; value: string; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.pill, { backgroundColor: colors.backgroundTertiary }]}>
      <Text style={[styles.pillLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function BreakdownRow({
  label, value, sub, color, colors,
}: { label: string; value: string; sub: string; color: string; colors: (typeof Colors)["light"] }) {
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
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 16, lineHeight: 22 },

  chartCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20, gap: 14 },
  rangeRow: { flexDirection: "row", gap: 8 },
  rangeTab: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rangeTabText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  chartOuter: { width: "100%" },
  chartArea: { position: "relative", overflow: "hidden" },
  chartEmpty: { height: CHART_INNER_H, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chartEmptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  zoneBand: { position: "absolute", left: 0, right: 0 },
  threshLine: { position: "absolute", left: 0, right: 0, height: 1 },
  threshLabel: { position: "absolute", left: 2, fontSize: 9, fontFamily: "Inter_600SemiBold" },
  lineSegment: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    transformOrigin: "left center",
  },
  dot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  timeLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  timeLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },

  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  statChip: { alignItems: "center", flex: 1 },
  statChipValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  statChipLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 1 },

  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10 },
  sectionSub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 14 },

  suggestionCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  suggIconBg: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  suggIconText: { fontSize: 22 },
  suggTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  suggBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },

  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  dividerSection: { borderTopWidth: 1, paddingTop: 20, marginBottom: 4 },
  inputCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 16, gap: 4 },
  inputLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  optional: { fontFamily: "Inter_400Regular", fontSize: 13 },
  input: {
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 16, fontFamily: "Inter_500Medium",
  },
  errorText: { color: COLORS.danger, fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  pillsRow: { flexDirection: "row", gap: 8, marginTop: 14, paddingTop: 14, borderTopWidth: 1 },
  pill: { flex: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  pillLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginBottom: 2 },
  pillValue: { fontSize: 13, fontFamily: "Inter_700Bold" },

  predictBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 16, borderRadius: 16, marginBottom: 20,
  },
  predictBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },

  kidResult: { gap: 14, marginBottom: 16 },
  monsterCard: { flexDirection: "row", alignItems: "flex-start", gap: 14, padding: 16, borderRadius: 16, borderWidth: 1 },
  monsterFace: { fontSize: 52, lineHeight: 60 },
  monsterMoodLabel: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 4 },
  friendlyMsg: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  spikeSection: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 8 },
  spikeSectionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  spikeBarBg: { height: 14, borderRadius: 7, overflow: "hidden" },
  spikeBarFill: { height: "100%", borderRadius: 7 },
  spikeLegend: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  spikeLegendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  spikePeakLabel: { fontSize: 12, fontFamily: "Inter_700Bold" },
  timingCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  timingEmoji: { fontSize: 22, lineHeight: 28 },
  timingTitle: { fontSize: 12, fontFamily: "Inter_700Bold", marginBottom: 2 },
  timingBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  doseCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 14, borderWidth: 1 },
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
  targetRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 12, borderTopWidth: 1 },
  targetDot: { width: 8, height: 8, borderRadius: 4 },
  targetRowText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  inRangeBadge: { fontSize: 12, fontFamily: "Inter_700Bold", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
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
    flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12,
    borderRadius: 10, marginBottom: 12,
  },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  resetBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  resetBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
