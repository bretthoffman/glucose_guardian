import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  PanResponder,
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
import { glucoseColor } from "@/components/CGMChart";
import { computeDose } from "@/utils/dose";
import type { DoseBreakdown } from "@/utils/dose";
import { getEffectiveTrend } from "@/utils/trend";

const LOW_THRESH = 70;
const HIGH_THRESH = 180;
const Y_MIN = 40;
const Y_MAX = 400;
const Y_RANGE = Y_MAX - Y_MIN;
const Y_LABELS = [400, 300, 250, 200, 180, 100, 70, 40];
const CHART_H = 230;
const Y_AXIS_W = 38;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function yPct(glucose: number) {
  return 1 - (Math.max(Y_MIN, Math.min(Y_MAX, glucose)) - Y_MIN) / Y_RANGE;
}

interface Suggestion {
  icon: string;
  title: string;
  body: string;
  color: string;
  priority: number;
  chatPrompt: string;
}

function analyzeReadings(readings: GlucoseEntry[], targetGlucose: number, isMinor: boolean): Suggestion[] {
  if (readings.length === 0) return [];
  const suggestions: Suggestion[] = [];
  const lows = readings.filter((r) => r.glucose < LOW_THRESH);
  const highs = readings.filter((r) => r.glucose > HIGH_THRESH);
  const inRange = readings.filter((r) => r.glucose >= LOW_THRESH && r.glucose <= HIGH_THRESH);
  const timeInRange = Math.round((inRange.length / readings.length) * 100);
  const avg = Math.round(readings.reduce((s, r) => s + r.glucose, 0) / readings.length);
  const trend = getEffectiveTrend(readings).glucoseTrend;

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
        : `I've been having hypoglycemia episodes. Can you help me understand the causes and how to prevent them? My last low was ${worstLow} mg/dL.`,
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
        : `I'm seeing an elevated glucose pattern, peaking around ${worstHigh} mg/dL. Can you help me understand post-meal spikes and what pre-bolusing means?`,
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
        : `My time-in-range is only ${timeInRange}%. What questions should I ask my endocrinologist about adjusting my insulin settings?`,
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
        : `My average glucose is ${avg} mg/dL. Can you explain how meal composition, portion size, and timing affect post-meal glucose spikes?`,
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
        : `I'm achieving ${timeInRange}% time-in-range. What advanced strategies could help me optimize even further?`,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 4);
}

interface AlertDot {
  x: number;
  y: number;
  glucose: number;
  timestamp: string;
  alertColor: string;
}

function ZoomableChart({
  readings,
  targetGlucose,
}: {
  readings: GlucoseEntry[];
  targetGlucose: number;
}) {
  const screenW = Dimensions.get("window").width;
  const containerW = screenW - 40; // paddingHorizontal * 2 = 40
  const plotW = containerW - Y_AXIS_W - 5; // 5 = gap between plot and y-axis

  const zoomScaleRef = useRef(1);
  const [zoomScale, setZoomScaleRaw] = useState(1);
  const lastPinchDist = useRef<number | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AlertDot | null>(null);

  function applyZoom(newScale: number) {
    const clamped = Math.max(1, Math.min(6, newScale));
    zoomScaleRef.current = clamped;
    setZoomScaleRaw(clamped);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: (evt) =>
        evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponderCapture: (evt) =>
        evt.nativeEvent.touches.length === 2,
      onPanResponderGrant: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          const [t1, t2] = evt.nativeEvent.touches;
          lastPinchDist.current = Math.hypot(
            t2.pageX - t1.pageX,
            t2.pageY - t1.pageY,
          );
        }
      },
      onPanResponderMove: (evt) => {
        if (evt.nativeEvent.touches.length === 2) {
          const [t1, t2] = evt.nativeEvent.touches;
          const dist = Math.hypot(t2.pageX - t1.pageX, t2.pageY - t1.pageY);
          if (lastPinchDist.current !== null && lastPinchDist.current > 0) {
            const ratio = dist / lastPinchDist.current;
            const newScale = Math.max(
              1,
              Math.min(6, zoomScaleRef.current * ratio),
            );
            zoomScaleRef.current = newScale;
            setZoomScaleRaw(newScale);
            lastPinchDist.current = dist;
          }
        }
      },
      onPanResponderRelease: () => {
        lastPinchDist.current = null;
      },
    }),
  ).current;

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const filtered = readings
    .filter((r) => new Date(r.timestamp).getTime() >= windowStart)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

  const contentW = plotW * zoomScale;

  const points = filtered.map((r) => ({
    x: Math.max(
      0,
      Math.min(
        contentW,
        ((new Date(r.timestamp).getTime() - windowStart) / WINDOW_MS) *
          contentW,
      ),
    ),
    y: yPct(r.glucose) * CHART_H,
    glucose: r.glucose,
    timestamp: r.timestamp,
    isAlert: r.glucose < LOW_THRESH || r.glucose > HIGH_THRESH,
    alertColor:
      r.glucose < LOW_THRESH ? COLORS.danger : COLORS.warning,
  }));

  const alertPeaks = useMemo(() => {
    const peaks: typeof points = [];
    let i = 0;
    while (i < points.length) {
      if (!points[i].isAlert) { i++; continue; }
      const isLow = points[i].glucose < LOW_THRESH;
      let j = i;
      let peakIdx = i;
      while (j < points.length && points[j].isAlert && (points[j].glucose < LOW_THRESH) === isLow) {
        if (isLow ? points[j].glucose < points[peakIdx].glucose : points[j].glucose > points[peakIdx].glucose) {
          peakIdx = j;
        }
        j++;
      }
      peaks.push(points[peakIdx]);
      i = j;
    }
    return peaks;
  }, [points]);

  const lowLineY = yPct(LOW_THRESH) * CHART_H;
  const highLineY = yPct(HIGH_THRESH) * CHART_H;
  const targetLineY =
    yPct(Math.max(LOW_THRESH, Math.min(HIGH_THRESH, targetGlucose))) * CHART_H;

  const xLabels = [0, 1 / 4, 1 / 2, 3 / 4, 1].map((frac) => {
    const hoursAgo = Math.round((1 - frac) * (WINDOW_MS / (60 * 60 * 1000)));
    const label = frac === 1 ? "Now" : `${hoursAgo}h ago`;
    return { x: frac * contentW, label };
  });

  const isZoomed = zoomScale > 1.05;

  return (
    <View {...panResponder.panHandlers}>
      <View style={chartStyles.toolbar}>
        <Text style={chartStyles.toolbarHint}>
          {isZoomed
            ? `${zoomScale.toFixed(1)}× — scroll to pan`
            : "Pinch or + / − to zoom  ·  tap ⚠ dots for tips"}
        </Text>
        <View style={chartStyles.zoomBtns}>
          <Pressable
            style={({ pressed }) => [chartStyles.zoomBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => applyZoom(zoomScaleRef.current - 0.5)}
          >
            <Text style={chartStyles.zoomBtnText}>−</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [chartStyles.zoomBtn, { opacity: pressed ? 0.6 : 1 }]}
            onPress={() => applyZoom(zoomScaleRef.current + 0.5)}
          >
            <Text style={chartStyles.zoomBtnText}>+</Text>
          </Pressable>
          {isZoomed && (
            <Pressable
              style={({ pressed }) => [chartStyles.zoomBtn, chartStyles.resetBtn, { opacity: pressed ? 0.6 : 1 }]}
              onPress={() => applyZoom(1)}
            >
              <Text style={[chartStyles.zoomBtnText, { fontSize: 11 }]}>Reset</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={chartStyles.chartRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={true}
          style={{ width: plotW }}
          contentContainerStyle={{ width: contentW }}
        >
          <View
            style={{
              width: contentW,
              height: CHART_H,
              backgroundColor: "#1a2540",
              borderRadius: 6,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <View style={[czs.zoneLow, { height: CHART_H - lowLineY, bottom: 0 }]} />
            <View style={[czs.zoneTarget, { top: highLineY, height: lowLineY - highLineY }]} />
            <View style={[czs.zoneHigh, { height: highLineY, top: 0 }]} />

            <View style={[czs.line, { top: lowLineY, backgroundColor: "#EF444488" }]} />
            <View style={[czs.line, { top: highLineY, backgroundColor: "#F59E0B55" }]} />
            <View style={[czs.line, { top: targetLineY, backgroundColor: "rgba(99,102,241,0.45)" }]} />

            {filtered.length === 0 ? (
              <View style={czs.empty}>
                <Text style={czs.emptyText}>No readings in the last 24 hours</Text>
              </View>
            ) : (
              <>
                {points.map((p, i) => {
                  if (i >= points.length - 1) return null;
                  const next = points[i + 1];
                  const dx = next.x - p.x;
                  const dy = next.y - p.y;
                  const len = Math.sqrt(dx * dx + dy * dy);
                  if (len < 0.5) return null;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  const col = glucoseColor((p.glucose + next.glucose) / 2);
                  return (
                    <View
                      key={`seg-${i}`}
                      style={{
                        position: "absolute",
                        width: len,
                        left: p.x,
                        top: p.y - 1.5,
                        height: 3,
                        backgroundColor: col + "CC",
                        transform: [{ rotate: `${angle}deg` }],
                        transformOrigin: "left center",
                      }}
                    />
                  );
                })}

                {points.map((p, i) => {
                  if (p.isAlert) return null;
                  const isLatest = i === points.length - 1;
                  const sz = isLatest ? 11 : 5;
                  return (
                    <View
                      key={`ndot-${i}`}
                      style={{
                        position: "absolute",
                        left: p.x - sz / 2,
                        top: p.y - sz / 2,
                        width: sz,
                        height: sz,
                        borderRadius: sz / 2,
                        backgroundColor: glucoseColor(p.glucose),
                        borderWidth: isLatest ? 2 : 0,
                        borderColor: "#fff",
                        opacity: isLatest ? 1 : 0.75,
                      }}
                    />
                  );
                })}

                {alertPeaks.map((p, i) => {
                  const isSelected = selectedAlert?.timestamp === p.timestamp;
                  return (
                    <Pressable
                      key={`adot-${i}`}
                      style={{
                        position: "absolute",
                        left: p.x - 12,
                        top: p.y - 12,
                        width: 24,
                        height: 24,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedAlert(
                          isSelected ? null : {
                            x: p.x, y: p.y,
                            glucose: p.glucose,
                            timestamp: p.timestamp,
                            alertColor: p.alertColor,
                          },
                        );
                      }}
                    >
                      <View
                        style={{
                          position: "absolute",
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: p.alertColor + (isSelected ? "35" : "22"),
                          borderWidth: 1.5,
                          borderColor: p.alertColor + "70",
                        }}
                      />
                      <View
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 7,
                          backgroundColor: p.alertColor,
                          borderWidth: 2,
                          borderColor: "#fff",
                        }}
                      />
                    </Pressable>
                  );
                })}

                {selectedAlert && (() => {
                  const isLow = selectedAlert.glucose < LOW_THRESH;
                  const tooltipW = 148;
                  const leftPos = Math.max(4, Math.min(contentW - tooltipW - 4, selectedAlert.x - tooltipW / 2));
                  const showBelow = selectedAlert.y < CHART_H / 2;
                  return (
                    <Pressable
                      key="tooltip"
                      style={{
                        position: "absolute",
                        left: leftPos,
                        top: showBelow ? selectedAlert.y + 18 : selectedAlert.y - 78,
                        width: tooltipW,
                        backgroundColor: selectedAlert.alertColor,
                        borderRadius: 12,
                        padding: 10,
                        shadowColor: "#000",
                        shadowOpacity: 0.35,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 3 },
                        zIndex: 200,
                      }}
                      onPress={() => setSelectedAlert(null)}
                    >
                      <Text style={{ color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold", lineHeight: 19 }}>
                        {selectedAlert.glucose} mg/dL
                      </Text>
                      <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: "Inter_400Regular", marginBottom: 4 }}>
                        {new Date(selectedAlert.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                      <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" }}>
                        {isLow
                          ? "⬇ Low — treat with fast carbs"
                          : "⬆ High — hydrate & check dose"}
                      </Text>
                      <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 }}>
                        Tap to dismiss
                      </Text>
                    </Pressable>
                  );
                })()}
              </>
            )}

            <View style={[czs.xAxisRow, { width: contentW }]}>
              {xLabels.map((l, i) => (
                <Text key={i} style={czs.xLabel}>{l.label}</Text>
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={{ width: Y_AXIS_W, height: CHART_H, position: "relative", marginLeft: 5 }}>
          {Y_LABELS.map((v) => {
            const top = yPct(v) * CHART_H - 7;
            if (top < -8 || top > CHART_H - 6) return null;
            return (
              <Text
                key={v}
                style={{
                  position: "absolute",
                  top,
                  right: 0,
                  width: 33,
                  textAlign: "right",
                  fontSize: 9,
                  fontFamily: "Inter_400Regular",
                  color: "rgba(255,255,255,0.35)",
                }}
              >
                {v}
              </Text>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const czs = StyleSheet.create({
  zoneLow: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(239,68,68,0.10)" },
  zoneTarget: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(34,197,94,0.07)" },
  zoneHigh: { position: "absolute", left: 0, right: 0, backgroundColor: "rgba(245,158,11,0.07)" },
  line: { position: "absolute", left: 0, right: 0, height: 1 },
  empty: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  emptyText: { color: "rgba(255,255,255,0.3)", fontSize: 13, fontFamily: "Inter_400Regular" },
  xAxisRow: { position: "absolute", bottom: 5, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 },
  xLabel: { color: "rgba(255,255,255,0.35)", fontSize: 9, fontFamily: "Inter_400Regular" },
});

const chartStyles = StyleSheet.create({
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingHorizontal: 2 },
  toolbarHint: { color: "rgba(255,255,255,0.45)", fontSize: 10, fontFamily: "Inter_500Medium", flex: 1, flexWrap: "wrap" },
  zoomBtns: { flexDirection: "row", gap: 6, marginLeft: 8 },
  zoomBtn: { backgroundColor: "rgba(255,255,255,0.14)", paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8, minWidth: 32, alignItems: "center" },
  resetBtn: { paddingHorizontal: 9 },
  zoomBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  chartRow: { flexDirection: "row", alignItems: "flex-start" },
});

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { targetGlucose, carbRatio, correctionFactor, history } = useGlucose();
  const { isMinor, alertPrefs, profile } = useAuth();

  const [carbInput, setCarbInput] = useState("");
  const [bgInput, setBgInput] = useState("");
  const [bgManual, setBgManual] = useState(false);

  const latest = history[history.length - 1];

  useEffect(() => {
    if (!bgManual && latest) {
      setBgInput(String(latest.glucose));
    }
  }, [latest, bgManual]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const filteredReadings = useMemo(() => {
    const cutoff = Date.now() - WINDOW_MS;
    return history.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }, [history]);

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
    [filteredReadings, targetGlucose, isMinor],
  );

  const hasCarbs = carbInput !== "" && parseFloat(carbInput) > 0;

  const dose = useMemo<DoseBreakdown | null>(() => {
    const carbs = carbInput === "" ? 0 : parseFloat(carbInput);
    const bg = parseFloat(bgInput);
    if (isNaN(carbs) || carbs < 0 || isNaN(bg) || bg <= 0) return null;
    const trend = latest ? getEffectiveTrend(history).glucoseTrend : "stable";
    const prev = history.length >= 2 ? history[history.length - 2].glucose : undefined;
    return computeDose({
      carbs,
      currentBG: bg,
      targetBG: targetGlucose,
      carbRatio,
      correctionFactor,
      trend,
      previousBG: prev,
    });
  }, [carbInput, bgInput, targetGlucose, carbRatio, correctionFactor, history, latest]);

  function openChat(prompt: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/(tabs)/chat", params: { prompt } });
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.scroll, { paddingTop: topPadding + 12, paddingBottom: bottomPadding + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.pageTitle, { color: colors.text }]}>Glucose Trends</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {isMinor
          ? "See your sugar patterns and get helpful tips"
          : "24-hour glucose pattern with alert markers and AI insights"}
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
            <TrendArrow
                      trend={getEffectiveTrend(history).glucoseTrend}
                      glucoseValue={latest.glucose}
                      lowThreshold={alertPrefs.lowThreshold}
                      highThreshold={alertPrefs.highThreshold}
                    />
            <Text style={[styles.rangeCount, { color: colors.textMuted }]}>
              {filteredReadings.length} reading{filteredReadings.length !== 1 ? "s" : ""} · last 24 hours
            </Text>
          </View>
        </View>
      )}

      <View style={[styles.chartCard, { backgroundColor: isDark ? "#0D1526" : "#0F172A" }]}>
        <ZoomableChart readings={history} targetGlucose={targetGlucose} />
      </View>

      {stats && (
        <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StatBox label="Avg Glucose" value={`${stats.avg}`} unit="mg/dL" color={glucoseColor(stats.avg)} colors={colors} />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox
            label="Time in Range"
            value={`${stats.tir}%`}
            unit={stats.tir >= 70 ? "On target" : "Below goal"}
            color={stats.tir >= 70 ? COLORS.success : stats.tir >= 50 ? COLORS.warning : COLORS.danger}
            colors={colors}
          />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox label="Lows" value={`${stats.lows}`} unit="events" color={stats.lows > 0 ? COLORS.danger : COLORS.success} colors={colors} />
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <StatBox label="Highs" value={`${stats.highs}`} unit="events" color={stats.highs > 0 ? COLORS.warning : COLORS.success} colors={colors} />
        </View>
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {isMinor ? "Dose Helper 💉" : "Dose Calculator"}
      </Text>

      <View style={[styles.doseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.doseInputRow}>
          <View style={styles.doseInputGroup}>
            <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Carbs (g)</Text>
            <TextInput
              style={[styles.doseInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]}
              value={carbInput}
              onChangeText={(v) => setCarbInput(v.replace(/[^0-9.]/g, ""))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.doseInputDivider} />
          <View style={styles.doseInputGroup}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[styles.doseInputLabel, { color: colors.textSecondary }]}>Current BG</Text>
              {latest && !bgManual && (
                <View style={[styles.liveTag, { backgroundColor: COLORS.success + "22" }]}>
                  <Text style={[styles.liveTagText, { color: COLORS.success }]}>LIVE</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <TextInput
                style={[styles.doseInput, { flex: 1, backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: bgManual ? COLORS.primary : colors.border }]}
                value={bgInput}
                onChangeText={(v) => { setBgInput(v.replace(/[^0-9]/g, "")); setBgManual(true); }}
                keyboardType="numeric"
                placeholder="mg/dL"
                placeholderTextColor={colors.textMuted}
              />
              {bgManual && latest && (
                <Pressable
                  onPress={() => { setBgInput(String(latest.glucose)); setBgManual(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={{ padding: 4 }}
                >
                  <Feather name="refresh-cw" size={15} color={COLORS.primary} />
                </Pressable>
              )}
            </View>
          </View>
        </View>

        {dose && (
          <>
            {dose.warnings.map((w, i) => (
              <View key={i} style={[styles.doseWarning, {
                backgroundColor: w.level === "danger" ? "#EF444418" : w.level === "warning" ? "#F59E0B18" : COLORS.primary + "14",
                borderColor: w.level === "danger" ? "#EF4444" : w.level === "warning" ? "#F59E0B" : COLORS.primary,
              }]}>
                <Feather
                  name={w.level === "danger" ? "alert-circle" : w.level === "warning" ? "alert-triangle" : "info"}
                  size={13}
                  color={w.level === "danger" ? "#EF4444" : w.level === "warning" ? "#F59E0B" : COLORS.primary}
                />
                <Text style={[styles.doseWarningText, {
                  color: w.level === "danger" ? "#EF4444" : w.level === "warning" ? "#F59E0B" : COLORS.primary,
                }]}>{w.message}</Text>
              </View>
            ))}

            <View style={[styles.doseBreakdown, { borderTopColor: colors.border }]}>
              {hasCarbs && (
                <DoseRow label="Carb Dose" sub={`${parseFloat(carbInput)}g ÷ ${carbRatio}g`} value={dose.carbInsulin} unit="u" colors={colors} />
              )}
              <DoseRow
                label="Correction"
                sub={dose.correctionSuppressed
                  ? "BG below target — suppressed"
                  : `(${bgInput} − ${targetGlucose}) ÷ ${correctionFactor}`}
                value={dose.correctionInsulin}
                unit="u"
                colors={colors}
                dimmed={dose.correctionSuppressed}
              />
              <DoseRow
                label="Trend Adj."
                sub={dose.trendLabel}
                value={dose.trendAdjustment}
                unit="u"
                colors={colors}
                signed
              />
            </View>

            <View style={[styles.doseTotalRow, { borderTopColor: colors.border }]}>
              <View>
                <Text style={[styles.doseTotalLabel, { color: colors.textSecondary }]}>
                  {isMinor
                    ? "Ask your adult to give:"
                    : hasCarbs
                    ? `Insulin to give (with ${carbInput}g carbs)`
                    : "Insulin to give (no carbs)"}
                </Text>
                {dose.totalRaw !== dose.totalDose && (
                  <Text style={[styles.doseRoundNote, { color: colors.textMuted }]}>
                    Raw {dose.totalRaw}u → rounded to nearest ½
                  </Text>
                )}
              </View>
              <View style={styles.doseTotalBadge}>
                <Text style={styles.doseTotalValue}>{dose.totalDose}</Text>
                <Text style={styles.doseTotalUnit}>units</Text>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.explainBtn, { backgroundColor: COLORS.primary + "18", opacity: pressed ? 0.7 : 1 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const name = profile?.childName ?? "them";
                const prompt = hasCarbs
                  ? `Explain my insulin dose. Current BG: ${bgInput} mg/dL, eating ${carbInput}g carbs. Carb ratio 1:${carbRatio}, target BG ${targetGlucose}, ISF 1:${correctionFactor}. Trend: ${dose.trendLabel}. Carb dose: ${dose.carbInsulin}u, correction: ${dose.correctionInsulin}u, trend adj: ${dose.trendAdjustment}u. Total: ${dose.totalDose}u.`
                  : `${name}'s BG is ${bgInput} mg/dL with no carbs. Correction only: (${bgInput}−${targetGlucose})÷${correctionFactor} = ${dose.correctionInsulin}u, rounded to ${dose.totalDose}u. Is this right?`;
                openChat(prompt);
              }}
            >
              <Feather name="help-circle" size={13} color={COLORS.primary} />
              <Text style={[styles.explainBtnText, { color: COLORS.primary }]}>Explain My Dose</Text>
              <Feather name="chevron-right" size={13} color={COLORS.primary} />
            </Pressable>
          </>
        )}

        {!dose && (
          <Text style={[styles.dosePrompt, { color: colors.textMuted }]}>
            {isMinor
              ? "Enter how many carbs you're eating above and I'll help figure out your dose 🍎"
              : "Enter a blood sugar reading to see the correction dose, then add carbs to include a meal dose."}
          </Text>
        )}
      </View>

      {suggestions.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {isMinor ? "Tips for You 💡" : "Insights & Recommendations"}
          </Text>
          {suggestions.map((s, i) => (
            <SuggestionCard key={i} suggestion={s} colors={colors} onChat={() => openChat(s.chatPrompt)} />
          ))}
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
    </ScrollView>
  );
}

function TrendArrow({
  trend,
  glucoseValue,
  lowThreshold = LOW_THRESH,
  highThreshold = HIGH_THRESH,
}: {
  trend: string;
  glucoseValue?: number;
  lowThreshold?: number;
  highThreshold?: number;
}) {
  const stableColor =
    glucoseValue !== undefined
      ? glucoseColor(glucoseValue, lowThreshold, highThreshold)
      : COLORS.success;

  const map: Record<string, { icon: string; color: string; label: string }> = {
    rapidly_rising:  { icon: "↑",  color: COLORS.danger,  label: "Rising fast"  },
    rising:          { icon: "↗",  color: COLORS.warning, label: "Rising"       },
    stable:          { icon: "→",  color: stableColor,    label: "Stable"       },
    falling:         { icon: "↘",  color: COLORS.warning, label: "Falling"      },
    rapidly_falling: { icon: "↓",  color: COLORS.danger,  label: "Falling fast" },
  };
  const info = map[trend] ?? map.stable;
  return (
    <View style={styles.trendArrowRow}>
      <Text style={[styles.trendArrowIcon, { color: info.color }]}>{info.icon}</Text>
      <Text style={[styles.trendArrowLabel, { color: info.color }]}>{info.label}</Text>
    </View>
  );
}

function SuggestionCard({ suggestion, colors, onChat }: { suggestion: Suggestion; colors: (typeof Colors)["light"]; onChat: () => void }) {
  return (
    <View style={[styles.suggCard, { backgroundColor: suggestion.color + "0E", borderColor: suggestion.color + "30" }]}>
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
        style={({ pressed }) => [styles.chatBtn, { backgroundColor: suggestion.color + "18", opacity: pressed ? 0.7 : 1 }]}
        onPress={onChat}
      >
        <Feather name="message-circle" size={13} color={suggestion.color} />
        <Text style={[styles.chatBtnText, { color: suggestion.color }]}>Chat about this</Text>
        <Feather name="chevron-right" size={13} color={suggestion.color} />
      </Pressable>
    </View>
  );
}

function DoseRow({
  label, sub, value, unit, colors, signed = false, dimmed = false,
}: {
  label: string; sub: string; value: number; unit: string;
  colors: (typeof Colors)["light"]; signed?: boolean; dimmed?: boolean;
}) {
  const display = signed
    ? value > 0 ? `+${value}` : `${value}`
    : `${value}`;
  const color = dimmed
    ? colors.textMuted
    : value > 0 && signed ? COLORS.warning
    : value < 0 && signed ? COLORS.success
    : colors.text;
  return (
    <View style={styles.doseRowItem}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.doseRowLabel, { color: colors.text, opacity: dimmed ? 0.45 : 1 }]}>{label}</Text>
        <Text style={[styles.doseRowSub, { color: colors.textMuted }]}>{sub}</Text>
      </View>
      <Text style={[styles.doseRowValue, { color, opacity: dimmed ? 0.45 : 1 }]}>{display} {unit}</Text>
    </View>
  );
}

function StatBox({ label, value, unit, color, colors }: { label: string; value: string; unit: string; color: string; colors: (typeof Colors)["light"] }) {
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
  latestCircle: { width: 96, height: 96, borderRadius: 48, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  latestValue: { fontSize: 30, fontFamily: "Inter_700Bold", lineHeight: 34 },
  latestUnit: { fontSize: 11, fontFamily: "Inter_500Medium" },
  latestMeta: { gap: 6 },
  latestTime: { fontSize: 14, fontFamily: "Inter_500Medium" },
  rangeCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  trendArrowRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  trendArrowIcon: { fontSize: 18, fontFamily: "Inter_700Bold" },
  trendArrowLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  chartCard: { borderRadius: 18, overflow: "hidden", marginBottom: 14, padding: 12 },

  statsCard: { flexDirection: "row", borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20, alignItems: "center" },
  statBox: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  statUnit: { fontSize: 9, fontFamily: "Inter_400Regular", textAlign: "center" },
  statDivider: { width: 1, height: 40, marginHorizontal: 4 },

  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10 },

  suggCard: { borderRadius: 16, borderWidth: 1, marginBottom: 12, overflow: "hidden" },
  suggTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14 },
  suggIconBg: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  suggIcon: { fontSize: 22 },
  suggTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 3 },
  suggBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  chatBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "rgba(0,0,0,0.05)" },
  chatBtnText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },

  emptyCard: { borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10, marginTop: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },

  doseCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20, gap: 14 },
  doseInputRow: { flexDirection: "row", gap: 12 },
  doseInputGroup: { flex: 1, gap: 6 },
  doseInputLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  doseInput: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  doseInputDivider: { width: 1, backgroundColor: "rgba(128,128,128,0.15)", marginVertical: 4 },
  liveTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  liveTagText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },

  doseWarning: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  doseWarningText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },

  doseBreakdown: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  doseRowItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  doseRowLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  doseRowSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  doseRowValue: { fontSize: 16, fontFamily: "Inter_700Bold" },

  doseTotalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 14, gap: 10 },
  doseTotalLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 3 },
  doseRoundNote: { fontSize: 11, fontFamily: "Inter_400Regular" },
  doseTotalBadge: { flexDirection: "row", alignItems: "baseline", gap: 4, backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  doseTotalValue: { fontSize: 30, fontFamily: "Inter_700Bold", color: "#fff" },
  doseTotalUnit: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)" },

  explainBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 11 },
  explainBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dosePrompt: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20, textAlign: "center", paddingVertical: 8 },
});
