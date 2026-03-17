import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import type { GlucoseEntry } from "@/context/GlucoseContext";

const SCREEN_WIDTH = Dimensions.get("window").width;

const CHART_H = 180;
const CHART_INNER_H = 150;
const CHART_W = SCREEN_WIDTH - 72;
const Y_MIN = 40;
const Y_MAX = 320;
const Y_RANGE = Y_MAX - Y_MIN;

const LOW_THRESH = 70;
const HIGH_THRESH = 180;

type TimeRange = "3H" | "6H" | "12H" | "24H";
const TIME_RANGES: TimeRange[] = ["3H", "6H", "12H", "24H"];
const RANGE_MS: Record<TimeRange, number> = {
  "3H": 3 * 60 * 60 * 1000,
  "6H": 6 * 60 * 60 * 1000,
  "12H": 12 * 60 * 60 * 1000,
  "24H": 24 * 60 * 60 * 1000,
};

const Y_LABELS = [300, 250, 200, 180, 100, 70, 40];

interface Suggestion {
  icon: string;
  title: string;
  body: string;
  color: string;
  priority: number;
  chatPrompt: string;
}

function glucoseColor(val: number): string {
  if (val < 70) return COLORS.danger;
  if (val <= 180) return COLORS.success;
  if (val <= 250) return COLORS.warning;
  return COLORS.danger;
}

function yPos(glucose: number): number {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, glucose));
  return (1 - (clamped - Y_MIN) / Y_RANGE) * CHART_INNER_H;
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

  if (lows.length > 0) {
    const worstLow = Math.min(...lows.map((r) => r.glucose));
    suggestions.push({
      icon: "🧃",
      title: isMinor ? "Sugar went low — drink juice!" : "Hypoglycemia detected",
      body: isMinor
        ? `Your sugar dropped to ${worstLow} mg/dL. Drink 4 oz of juice or eat 4 glucose tablets and tell an adult!`
        : `Glucose reached ${worstLow} mg/dL. Treat with 15–20g fast-acting carbs. Consider whether your last dose was too large.`,
      color: COLORS.danger,
      priority: 1,
      chatPrompt: isMinor
        ? "I had a blood sugar low. What should I do and how can I stop it from happening again?"
        : "I've been having hypoglycemia episodes. Can you help me understand the causes and how to prevent them? My last low was " + worstLow + " mg/dL.",
    });
  }

  if (trend === "rapidly_falling" || trend === "falling") {
    suggestions.push({
      icon: "🍎",
      title: isMinor ? "Sugar is dropping — eat a snack!" : "Falling glucose — act now",
      body: isMinor
        ? "Your sugar is going down. Eat a small snack like an apple or crackers now!"
        : "Glucose is trending down. Have 15g carbs. If you recently dosed, insulin may still be peaking — delay your next dose.",
      color: COLORS.warning,
      priority: 2,
      chatPrompt: isMinor
        ? "My blood sugar keeps dropping. What snacks should I eat and when?"
        : "My glucose is falling quickly. Can you explain the best strategy for treating a falling trend and how to avoid going low?",
    });
  }

  if (trend === "rapidly_rising" || trend === "rising") {
    suggestions.push({
      icon: "🚶",
      title: isMinor ? "Try a short walk to help!" : "Rising glucose — try activity",
      body: isMinor
        ? "Your sugar is going up! A 10–15 min walk or active play can help bring it back down naturally."
        : "Glucose is rising. A brisk 10–15 min walk can reduce glucose by 20–40 mg/dL without insulin.",
      color: COLORS.warning,
      priority: 3,
      chatPrompt: isMinor
        ? "My blood sugar keeps going up. Can walking really help? What else can I do?"
        : "My glucose is rising and I want to know how exercise affects blood sugar. When should I walk vs when should I take a correction dose?",
    });
  }

  if (highs.length > 0 && lows.length === 0 && trend !== "rapidly_rising") {
    const worstHigh = Math.max(...highs.map((r) => r.glucose));
    suggestions.push({
      icon: "💧",
      title: isMinor ? "High sugar — drink water!" : "Elevated glucose pattern",
      body: isMinor
        ? `Your sugar got up to ${worstHigh} mg/dL. Drink a big glass of water and tell an adult!`
        : `Peak of ${worstHigh} mg/dL detected. Increase water intake. If this happens after meals, try pre-bolusing 10–15 min earlier.`,
      color: COLORS.warning,
      priority: 4,
      chatPrompt: isMinor
        ? "My blood sugar has been high. What can I drink or eat to help bring it down safely?"
        : "I'm seeing an elevated glucose pattern, peaking around " + worstHigh + " mg/dL. Can you help me understand post-meal spikes and what pre-bolusing means?",
    });
  }

  if (timeInRange < 50 && readings.length >= 4) {
    suggestions.push({
      icon: "👨‍⚕️",
      title: "Talk to your care team",
      body: isMinor
        ? `You were in your safe zone ${timeInRange}% of the time. Your doctor might want to look at your settings!`
        : `Time-in-range is ${timeInRange}% (target: 70%+). Review your carb ratio and correction factor with your endocrinologist.`,
      color: COLORS.primary,
      priority: 5,
      chatPrompt: isMinor
        ? "I wasn't in my safe blood sugar zone very much today. What does that mean and what can my doctor do to help?"
        : "My time-in-range is only " + timeInRange + "%. What questions should I ask my endocrinologist about adjusting my insulin settings?",
    });
  }

  if (avg > HIGH_THRESH && trend === "stable" && lows.length === 0) {
    suggestions.push({
      icon: "🍽️",
      title: isMinor ? "Try smaller meal portions" : "Consistently elevated — meal timing",
      body: isMinor
        ? "Your sugar has been a bit high. Smaller portions and fewer sugary drinks can really help!"
        : `Average ${avg} mg/dL suggests post-meal drift. Try smaller portions, more fiber, and pre-bolusing 10–15 min before meals.`,
      color: COLORS.accent,
      priority: 6,
      chatPrompt: isMinor
        ? "My blood sugar has been high after meals. What kinds of foods help keep it lower?"
        : "My average glucose is " + avg + " mg/dL. Can you explain how meal composition, portion size, and timing affect post-meal glucose spikes?",
    });
  }

  if (timeInRange >= 70 && lows.length === 0 && readings.length >= 3) {
    suggestions.push({
      icon: "🌟",
      title: isMinor ? "Amazing sugar control!" : "Excellent glucose control",
      body: isMinor
        ? `You were in your safe zone ${timeInRange}% of the time — incredible! Keep up your great routine!`
        : `Time-in-range: ${timeInRange}%. Average: ${avg} mg/dL. Your management is on track.`,
      color: COLORS.success,
      priority: 7,
      chatPrompt: isMinor
        ? "I've been doing really well with my blood sugar! What else can I do to keep it up?"
        : "I'm achieving " + timeInRange + "% time-in-range. What advanced strategies could help me optimize even further?",
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 4);
}

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { targetGlucose, history } = useGlucose();
  const { isMinor } = useAuth();

  const [timeRange, setTimeRange] = useState<TimeRange>("6H");

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

  const latest = history[history.length - 1];

  function openChat(prompt: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/(tabs)/chat", params: { prompt } });
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: topPadding + 12, paddingBottom: bottomPadding + 80 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: colors.text }]}>Glucose Trends</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {isMinor
          ? "See your sugar patterns and get helpful tips"
          : "Analyze glucose patterns, time-in-range, and personalized recommendations"}
      </Text>

      {latest && (
        <View style={styles.latestRow}>
          <View style={[styles.latestCircle, { borderColor: glucoseColor(latest.glucose) }]}>
            <Text style={[styles.latestValue, { color: glucoseColor(latest.glucose) }]}>
              {latest.glucose}
            </Text>
            <Text style={[styles.latestUnit, { color: colors.textMuted }]}>mg/dL</Text>
          </View>
          <View style={styles.latestMeta}>
            <Text style={[styles.latestTime, { color: colors.textSecondary }]}>
              {new Date(latest.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </Text>
            <TrendArrow trend={detectTrend(history)} />
          </View>
        </View>
      )}

      <View style={[styles.chartCard, { backgroundColor: isDark ? "#0D1526" : "#0F172A" }]}>
        <View style={styles.rangeRow}>
          {TIME_RANGES.map((r) => (
            <Pressable
              key={r}
              style={[
                styles.rangeTab,
                { backgroundColor: timeRange === r ? "rgba(255,255,255,0.18)" : "transparent" },
              ]}
              onPress={() => {
                setTimeRange(r);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Text style={[styles.rangeTabText, { color: timeRange === r ? "#fff" : "rgba(255,255,255,0.45)" }]}>
                {r}
              </Text>
            </Pressable>
          ))}
        </View>

        <CGMChart readings={filteredReadings} targetGlucose={targetGlucose} />
      </View>

      {stats && (
        <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StatBox
            label="Avg Glucose"
            value={`${stats.avg}`}
            unit="mg/dL"
            color={glucoseColor(stats.avg)}
            colors={colors}
          />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox
            label="Time in Range"
            value={`${stats.tir}%`}
            unit={`${stats.tir >= 70 ? "On target" : "Below goal"}`}
            color={stats.tir >= 70 ? COLORS.success : stats.tir >= 50 ? COLORS.warning : COLORS.danger}
            colors={colors}
          />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox
            label="Lows"
            value={`${stats.lows}`}
            unit="events"
            color={stats.lows > 0 ? COLORS.danger : COLORS.success}
            colors={colors}
          />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox
            label="Highs"
            value={`${stats.highs}`}
            unit="events"
            color={stats.highs > 0 ? COLORS.warning : COLORS.success}
            colors={colors}
          />
        </View>
      )}

      {suggestions.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {isMinor ? "Tips for You 💡" : "Insights & Recommendations"}
          </Text>
          {suggestions.map((s, i) => (
            <SuggestionCard
              key={i}
              suggestion={s}
              colors={colors}
              onChat={() => openChat(s.chatPrompt)}
            />
          ))}
        </>
      )}

      {filteredReadings.length === 0 && (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={styles.emptyIcon}>📊</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No readings in this period</Text>
          <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
            {isMinor
              ? "Sync your CGM or add a reading from the Glucose tab to see your trends here!"
              : "Sync your CGM or add readings from the Glucose tab to see trend analysis."}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function CGMChart({
  readings,
  targetGlucose,
}: {
  readings: GlucoseEntry[];
  targetGlucose: number;
}) {
  const yAxisW = 36;
  const plotW = CHART_W - yAxisW;

  const lowBandH = yPos(Y_MIN) - yPos(LOW_THRESH);
  const targetBandTop = yPos(HIGH_THRESH);
  const targetBandH = yPos(LOW_THRESH) - yPos(HIGH_THRESH);
  const highBandH = yPos(HIGH_THRESH);

  if (readings.length === 0) {
    return (
      <View style={[styles.cgmOuter, { height: CHART_H + 24 }]}>
        <View style={[styles.cgmPlotArea, { width: plotW, height: CHART_INNER_H, backgroundColor: "#1a2540" }]}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, fontFamily: "Inter_400Regular" }}>
              No data for this period
            </Text>
          </View>
        </View>
      </View>
    );
  }

  const sorted = [...readings].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const startTime = new Date(sorted[0].timestamp).getTime();
  const endTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
  const timeSpan = Math.max(endTime - startTime, 1);

  const points = sorted.map((r) => ({
    x: ((new Date(r.timestamp).getTime() - startTime) / timeSpan) * plotW,
    y: yPos(r.glucose),
    glucose: r.glucose,
    timestamp: r.timestamp,
  }));

  const midIdx = Math.floor(sorted.length / 2);

  return (
    <View style={styles.cgmWrapper}>
      <View style={[styles.cgmOuter, { height: CHART_INNER_H }]}>
        <View style={[styles.cgmPlotArea, { width: plotW, height: CHART_INNER_H }]}>
          <View style={[styles.cgmZoneLow, { height: lowBandH, bottom: 0 }]} />
          <View style={[styles.cgmZoneTarget, { top: targetBandTop, height: targetBandH }]} />
          <View style={[styles.cgmZoneHigh, { top: 0, height: highBandH }]} />

          <View style={[styles.cgmThreshLine, { top: yPos(LOW_THRESH), backgroundColor: "#EF444488" }]} />
          <View style={[styles.cgmThreshLine, { top: yPos(HIGH_THRESH), backgroundColor: "#F59E0B55" }]} />
          {targetGlucose >= LOW_THRESH && targetGlucose <= HIGH_THRESH && (
            <View style={[styles.cgmTargetLine, { top: yPos(targetGlucose) }]} />
          )}

          {points.map((p, i) => {
            if (i >= points.length - 1) return null;
            const next = points[i + 1];
            const dx = next.x - p.x;
            const dy = next.y - p.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            const col = glucoseColor((p.glucose + next.glucose) / 2);
            return (
              <View
                key={`seg-${i}`}
                style={[
                  styles.cgmSegment,
                  {
                    width: len,
                    left: p.x,
                    top: p.y - 1,
                    backgroundColor: col + "AA",
                    transform: [{ rotate: `${angle}deg` }],
                  },
                ]}
              />
            );
          })}

          {points.map((p, i) => {
            const isLatest = i === points.length - 1;
            const col = glucoseColor(p.glucose);
            return (
              <View
                key={`dot-${i}`}
                style={[
                  styles.cgmDot,
                  {
                    left: p.x - (isLatest ? 6 : 4),
                    top: p.y - (isLatest ? 6 : 4),
                    width: isLatest ? 12 : 8,
                    height: isLatest ? 12 : 8,
                    borderRadius: isLatest ? 6 : 4,
                    backgroundColor: col,
                    borderWidth: isLatest ? 2 : 1,
                    borderColor: isLatest ? "#fff" : col + "80",
                    opacity: isLatest ? 1 : 0.85,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={[styles.cgmYAxis, { height: CHART_INNER_H, width: yAxisW }]}>
          {Y_LABELS.map((v) => (
            <Text
              key={v}
              style={[styles.cgmYLabel, { top: yPos(v) - 7 }]}
            >
              {v}
            </Text>
          ))}
        </View>
      </View>

      <View style={[styles.cgmXAxis, { width: plotW }]}>
        <Text style={styles.cgmXLabel}>
          {sorted[0]
            ? new Date(sorted[0].timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
            : ""}
        </Text>
        {sorted[midIdx] && (
          <Text style={styles.cgmXLabel}>
            {new Date(sorted[midIdx].timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>
        )}
        <Text style={styles.cgmXLabel}>Now</Text>
      </View>
    </View>
  );
}

function TrendArrow({ trend }: { trend: string }) {
  const map: Record<string, { icon: string; color: string; label: string }> = {
    rapidly_rising: { icon: "↑↑", color: COLORS.danger, label: "Rising fast" },
    rising: { icon: "↑", color: COLORS.warning, label: "Rising" },
    stable: { icon: "→", color: COLORS.success, label: "Stable" },
    falling: { icon: "↓", color: COLORS.accent, label: "Falling" },
    rapidly_falling: { icon: "↓↓", color: COLORS.primary, label: "Falling fast" },
  };
  const info = map[trend] ?? map.stable;
  return (
    <View style={styles.trendArrowRow}>
      <Text style={[styles.trendArrowIcon, { color: info.color }]}>{info.icon}</Text>
      <Text style={[styles.trendArrowLabel, { color: info.color }]}>{info.label}</Text>
    </View>
  );
}

function SuggestionCard({
  suggestion,
  colors,
  onChat,
}: {
  suggestion: Suggestion;
  colors: (typeof Colors)["light"];
  onChat: () => void;
}) {
  return (
    <View
      style={[
        styles.suggCard,
        {
          backgroundColor: suggestion.color + "0E",
          borderColor: suggestion.color + "30",
        },
      ]}
    >
      <View style={styles.suggTop}>
        <View style={[styles.suggIconBg, { backgroundColor: suggestion.color + "20" }]}>
          <Text style={styles.suggIcon}>{suggestion.icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.suggTitle, { color: suggestion.color }]}>{suggestion.title}</Text>
          <Text style={[styles.suggBody, { color: colors.text }]}>{suggestion.body}</Text>
        </View>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.chatBtn,
          { backgroundColor: suggestion.color + "18", opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={onChat}
      >
        <Feather name="message-circle" size={13} color={suggestion.color} />
        <Text style={[styles.chatBtnText, { color: suggestion.color }]}>Chat about this</Text>
        <Feather name="chevron-right" size={13} color={suggestion.color} />
      </Pressable>
    </View>
  );
}

function StatBox({
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
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statUnit, { color: colors.textMuted }]}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", marginBottom: 18, lineHeight: 22 },

  latestRow: { flexDirection: "row", alignItems: "center", gap: 18, marginBottom: 18 },
  latestCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  latestValue: { fontSize: 30, fontFamily: "Inter_700Bold", lineHeight: 34 },
  latestUnit: { fontSize: 11, fontFamily: "Inter_500Medium" },
  latestMeta: { gap: 8 },
  latestTime: { fontSize: 14, fontFamily: "Inter_500Medium" },
  trendArrowRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  trendArrowIcon: { fontSize: 18, fontFamily: "Inter_700Bold" },
  trendArrowLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  chartCard: { borderRadius: 18, overflow: "hidden", marginBottom: 14 },
  rangeRow: { flexDirection: "row", paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8, gap: 4 },
  rangeTab: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  rangeTabText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  cgmWrapper: { paddingHorizontal: 12, paddingBottom: 10 },
  cgmOuter: { flexDirection: "row", position: "relative" },
  cgmPlotArea: { position: "relative", overflow: "hidden", borderRadius: 8, backgroundColor: "#111d35" },
  cgmZoneLow: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(239,68,68,0.18)" },
  cgmZoneTarget: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(16,185,129,0.10)" },
  cgmZoneHigh: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(245,158,11,0.07)" },
  cgmThreshLine: { position: "absolute", left: 0, right: 0, height: 1 },
  cgmTargetLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(16,185,129,0.55)",
  },
  cgmSegment: {
    position: "absolute",
    height: 2,
    borderRadius: 1,
    transformOrigin: "left center",
  },
  cgmDot: { position: "absolute" },
  cgmYAxis: { position: "relative", marginLeft: 4 },
  cgmYLabel: {
    position: "absolute",
    right: 0,
    fontSize: 9,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.45)",
    textAlign: "right",
    width: 32,
  },
  cgmXAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  cgmXLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.4)",
  },

  statsCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    alignItems: "center",
  },
  statBox: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  statUnit: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  statDivider: { width: 1, height: 40, marginHorizontal: 4 },

  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10 },

  suggCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  suggTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
  },
  suggIconBg: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  suggIcon: { fontSize: 22 },
  suggTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 3 },
  suggBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  chatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  chatBtnText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },

  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
});
