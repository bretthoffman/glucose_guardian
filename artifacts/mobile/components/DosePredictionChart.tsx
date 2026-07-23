/**
 * Dose-tab prediction mini-chart. Shows the last ~6 h of real glucose readings and a 4 h forward
 * projection of where glucose is heading IF the suggested dose is taken (see utils/glucoseForecast).
 *
 * Behavior (per spec):
 *  - Fixed 10 h window, hour-locked so "Now" floats near 60% (25-min axis rounding rule).
 *  - A purple vertical "Now" line; the glucose line turns purple once it crosses into the future.
 *  - The user's target glucose drawn as a horizontal reference, like the app's other charts.
 *  - On page open, the reading line draws in left→right, easing slower at 30 min and 10 min before
 *    Now, blinking the Now line and pausing 0.5 s AT Now, then drawing the purple future line.
 *  - When the dose or carbs change, only the future line re-draws (blink + redraw), same cadence.
 *
 * The reveal is a background-colored "cover" rectangle sliding left→right over the glucose line, so
 * only the reading line animates — the grid, target, and Now line stay static on top.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Line, Polyline, Rect } from "react-native-svg";
import { useFocusEffect } from "expo-router";
import Colors, { COLORS } from "@/constants/colors";
import { withAlpha } from "@/constants/theme";
import { glucoseTone } from "@/constants/theme";
import {
  buildAxisLabelSpecs,
  chartValueToY,
  formatGlucoseAxisLabel,
  resolveAxisLabelPositions,
} from "@/utils/cgmChartAxis";
import {
  predictionHourTicks,
  predictionWindow,
  type ForecastPoint,
} from "@/utils/glucoseForecast";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedLine = Animated.createAnimatedComponent(Line);

/** Right-hand y-axis gutter (label width + a little breathing room), matching the app's charts. */
const Y_AXIS_W = 36;

// Draw-in cadence (ms). A: bulk left→30m-before-Now (fast). B: 30m→10m (slower). C: 10m→Now
// (slowest). PAUSE at Now (with the blink). D: Now→right, the purple future line.
const DUR_A = 1100;
const DUR_B = 550;
const DUR_C = 550;
const PAUSE = 500;
const DUR_D = 1500;
const BLINK_DOWN = 110;
const BLINK_UP = 150;

/** Skip a history line segment when its two readings are more than this far apart (CGM gap). */
const GAP_MS = 25 * 60000;

interface HistPt {
  x: number;
  y: number;
  glucose: number;
  ms: number;
}

interface DosePredictionChartProps {
  readings: { glucose: number; timestamp: string }[];
  forecast: ForecastPoint[];
  currentBG: number;
  targetGlucose: number;
  /** User's alert thresholds — drive the reference lines + right-axis labels, like the other charts. */
  lowThreshold: number;
  highThreshold: number;
  urgentHighThreshold: number;
  nowMs: number;
  /** Changes when the committed carbs or the effective dose changes → re-draw the future line. */
  redrawKey: string;
  colors: (typeof Colors)["light"];
  height?: number;
}

export default function DosePredictionChart({
  readings,
  forecast,
  currentBG,
  targetGlucose,
  lowThreshold,
  highThreshold,
  urgentHighThreshold,
  nowMs,
  redrawKey,
  colors,
  height = 156,
}: DosePredictionChartProps) {
  const H = height;
  const [plotW, setPlotW] = useState(0);
  // "now" is frozen when the chart draws (on focus / mount), so the window + hour ticks don't drift
  // as real time passes. It is re-captured only when the graph re-animates from the left.
  const [drawNow, setDrawNow] = useState(nowMs);

  const revealX = useRef(new Animated.Value(0)).current;
  const nowBlink = useRef(new Animated.Value(1)).current;
  const geomRef = useRef({ plotW: 0, xNow: 0, xNow30: 0, xNow10: 0 });
  const pendingIntroRef = useRef(false);
  const redrawKeyRef = useRef(redrawKey);

  const win = useMemo(() => predictionWindow(drawNow), [drawNow]);
  const ticks = useMemo(() => predictionHourTicks(drawNow), [drawNow]);

  const xOf = useCallback(
    (ms: number) => ((ms - win.leftMs) / win.spanMs) * plotW,
    [win, plotW],
  );
  const yOf = useCallback((g: number) => chartValueToY(g, H), [H]);

  const xNow = win.nowFrac * plotW;

  // Keep the animation's target x-positions current for the imperative sequence below.
  geomRef.current = {
    plotW,
    xNow,
    xNow30: xOf(drawNow - 30 * 60000),
    xNow10: xOf(drawNow - 10 * 60000),
  };

  // ── History line, split into same-color runs (broken across CGM gaps) ──
  const histRuns = useMemo(() => {
    if (plotW <= 0) return [] as { color: string; points: string }[];
    const pts: HistPt[] = readings
      .map((r) => ({ ms: new Date(r.timestamp).getTime(), glucose: r.glucose }))
      .filter((r) => r.ms >= win.leftMs && r.ms <= drawNow && r.glucose > 0)
      .sort((a, b) => a.ms - b.ms)
      .map((r) => ({ x: xOf(r.ms), y: yOf(r.glucose), glucose: r.glucose, ms: r.ms }));
    // Anchor the end of the past line to the Now line at the calculator's current BG, so it meets
    // the purple future line seamlessly.
    if (pts.length > 0) {
      pts.push({ x: xNow, y: yOf(currentBG), glucose: currentBG, ms: drawNow });
    }
    if (pts.length < 2) return [];
    const runs: { color: string; points: string }[] = [];
    let cur: { color: string; pts: HistPt[] } | null = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (b.ms - a.ms > GAP_MS) {
        if (cur) { runs.push({ color: cur.color, points: cur.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") }); cur = null; }
        continue;
      }
      const color = glucoseTone((a.glucose + b.glucose) / 2);
      if (cur && cur.color === color) {
        cur.pts.push(b);
      } else {
        if (cur) runs.push({ color: cur.color, points: cur.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") });
        cur = { color, pts: [a, b] };
      }
    }
    if (cur) runs.push({ color: cur.color, points: cur.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") });
    return runs;
  }, [readings, plotW, win, drawNow, xNow, currentBG, xOf, yOf]);

  // ── Future (purple) projection line ──
  const futurePoints = useMemo(() => {
    if (plotW <= 0) return "";
    return forecast
      .map((p) => `${xOf(drawNow + p.tMin * 60000).toFixed(1)},${yOf(p.bg).toFixed(1)}`)
      .join(" ");
  }, [forecast, plotW, drawNow, xOf, yOf]);

  // Right-axis labels + their reference lines, built from the user's thresholds exactly like the
  // app's other glucose charts (buildAxisLabelSpecs handles the fixed grid ticks + target clamping).
  const axisLabels = useMemo(
    () =>
      resolveAxisLabelPositions(
        buildAxisLabelSpecs({
          urgentHighThreshold,
          highThreshold,
          targetGlucose,
          lowThreshold,
          axisNeutralColor: colors.textMuted,
        }),
        H,
      ),
    [urgentHighThreshold, highThreshold, targetGlucose, lowThreshold, colors.textMuted, H],
  );

  // ── Animation orchestration ──
  const blinkNow = useCallback(() => {
    nowBlink.setValue(1);
    Animated.sequence([
      Animated.timing(nowBlink, { toValue: 0.15, duration: BLINK_DOWN, useNativeDriver: false }),
      Animated.timing(nowBlink, { toValue: 1, duration: BLINK_UP, useNativeDriver: false }),
    ]).start();
  }, [nowBlink]);

  const drawFuture = useCallback(() => {
    Animated.sequence([
      Animated.delay(PAUSE),
      Animated.timing(revealX, {
        toValue: geomRef.current.plotW,
        duration: DUR_D,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]).start();
  }, [revealX]);

  const runIntro = useCallback(() => {
    const g = geomRef.current;
    if (g.plotW <= 0) return;
    revealX.stopAnimation();
    nowBlink.stopAnimation();
    nowBlink.setValue(1);
    revealX.setValue(0);
    const leg = (to: number, duration: number, then: () => void) =>
      Animated.timing(revealX, { toValue: to, duration, easing: Easing.linear, useNativeDriver: false })
        .start(({ finished }) => { if (finished) then(); });
    leg(g.xNow30, DUR_A, () =>
      leg(g.xNow10, DUR_B, () =>
        leg(g.xNow, DUR_C, () => {
          blinkNow();
          drawFuture();
        }),
      ),
    );
  }, [revealX, nowBlink, blinkNow, drawFuture]);

  // Re-animate whenever the Dose tab regains focus (opened from another screen / toggled back):
  // mark a draw pending, hide the line, and re-capture "now" so the window anchors to draw time.
  useFocusEffect(
    useCallback(() => {
      pendingIntroRef.current = true;
      revealX.setValue(0); // hide immediately so the fresh window doesn't flash fully-drawn
      nowBlink.setValue(1);
      setDrawNow(Date.now());
      return () => {
        revealX.stopAnimation();
        nowBlink.stopAnimation();
      };
    }, [revealX, nowBlink]),
  );

  // Run the pending intro once BOTH the frozen "now" and the measured width are in place — this
  // effect fires on the drawNow refresh above and again when onLayout reports the width.
  useEffect(() => {
    if (pendingIntroRef.current && plotW > 0) {
      pendingIntroRef.current = false;
      runIntro();
    }
  }, [drawNow, plotW, runIntro]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    // Reserve the right-axis gutter; the plot (and every x-position) uses the remaining width.
    const w = Math.max(0, e.nativeEvent.layout.width - Y_AXIS_W);
    setPlotW(w);
    geomRef.current.plotW = w;
  }, []);

  // Dose / carbs changed after the intro → blink Now and re-draw only the purple future line.
  // (No-op on mount: redrawKeyRef starts equal to redrawKey, so the intro owns the first draw.)
  useEffect(() => {
    if (redrawKeyRef.current === redrawKey) return;
    redrawKeyRef.current = redrawKey;
    if (geomRef.current.plotW > 0 && !pendingIntroRef.current) {
      revealX.stopAnimation(() => {
        revealX.setValue(geomRef.current.xNow); // keep the past, hide the future
        blinkNow();
        drawFuture();
      });
    }
  }, [redrawKey, revealX, blinkNow, drawFuture]);

  const gridColor = withAlpha(colors.textMuted, 0.22);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.head, { color: colors.textSecondary }]}>PROJECTED GLUCOSE IF DOSED NOW</Text>
      <View style={styles.chartRow} onLayout={onLayout}>
        <View style={{ width: plotW, height: H }}>
          {plotW > 0 && (
            <Svg width={plotW} height={H}>
              {/* Target line drawn FIRST (underneath) so the glucose reading line always renders in
                  front of it. */}
              {(() => {
                const t = axisLabels.find((l) => l.kind === "target");
                if (!t) return null;
                const y = yOf(t.value);
                if (y < -0.5 || y > H + 0.5) return null;
                return <Line x1={0} y1={y} x2={plotW} y2={y} stroke={t.color} strokeWidth={1.5} opacity={0.85} />;
              })()}

              {/* Glucose lines — the ONLY animated layer (revealed by the cover below). */}
              {histRuns.map((r, i) => (
                <Polyline
                  key={`h-${i}`}
                  points={r.points}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {futurePoints.length > 0 && (
                <Polyline
                  points={futurePoints}
                  fill="none"
                  stroke={COLORS.primary}
                  strokeWidth={2.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

              {/* Background-colored cover slides left→right to reveal the reading line. Must match the
                  card surface the chart sits on, so the un-drawn area is invisible. */}
              <AnimatedRect x={revealX} y={0} width={plotW} height={H} fill={colors.card} />

              {/* Reference lines (neutral grid + threshold colors), drawn ON TOP of the cover so they
                  never animate — one line per right-axis label. The target is excluded here; it's
                  drawn underneath the glucose line above. */}
              {axisLabels.map((label) => {
                if (label.kind === "target") return null;
                const y = yOf(label.value);
                if (y < -0.5 || y > H + 0.5) return null;
                const neutral = label.kind === "neutral_grid";
                return (
                  <Line
                    key={`gl-${label.kind}-${label.value}`}
                    x1={0} y1={y} x2={plotW} y2={y}
                    stroke={neutral ? gridColor : label.color}
                    strokeWidth={1}
                    strokeDasharray={neutral ? undefined : "5 6"}
                    opacity={neutral ? 1 : 0.5}
                  />
                );
              })}
              <AnimatedLine
                x1={xNow} y1={0} x2={xNow} y2={H}
                stroke={COLORS.primary} strokeWidth={2} opacity={nowBlink}
              />
            </Svg>
          )}
        </View>

        {/* Right y-axis — scale numbers colored by threshold kind, same as the app's other charts. */}
        <View style={[styles.yAxis, { width: Y_AXIS_W, height: H }]}>
          {plotW > 0 && axisLabels.map((label) => {
            if (label.top < -8 || label.top > H - 6) return null;
            return (
              <Text
                key={`${label.kind}-${label.value}`}
                style={[styles.yLabel, { top: label.top, color: label.color }]}
              >
                {formatGlucoseAxisLabel(label.value)}
              </Text>
            );
          })}
        </View>
      </View>

      {/* Hour axis — non-hidden ticks + the purple Now label at its true position. */}
      {plotW > 0 && (
        <View style={[styles.axis, { width: plotW }]}>
          {ticks.filter((t) => !t.hidden).map((t) => (
            <Text
              key={`t-${t.ms}`}
              numberOfLines={1}
              style={[styles.axisLabel, { left: t.xFrac * plotW - 16, color: colors.textMuted }]}
            >
              {t.label}
            </Text>
          ))}
          <Text
            numberOfLines={1}
            style={[styles.axisLabel, styles.nowLabel, { left: win.nowFrac * plotW - 16, color: COLORS.primary }]}
          >
            Now
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The chart lives inside the suggested-dose card now, so the card's own gap spaces it above; gap
  // 10 spaces the chart→x-axis, and the head's marginBottom sets head→400-line.
  wrap: { gap: 10 },
  head: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 },
  chartRow: { flexDirection: "row", alignItems: "flex-start", width: "100%" },
  yAxis: { position: "relative" },
  yLabel: {
    position: "absolute",
    right: 0,
    width: 30,
    textAlign: "right",
    fontSize: 9.5,
    fontWeight: "500",
  },
  axis: { position: "relative", height: 15, marginTop: 2 },
  axisLabel: {
    position: "absolute",
    width: 32,
    textAlign: "center",
    fontSize: 9.5,
    fontWeight: "500",
  },
  nowLabel: { fontWeight: "800" },
});
