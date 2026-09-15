/**
 * Estimated-A1C card + time-range selector (1D–90D). Extracted from the Insulin "Dose" tab so it can
 * live on the Dashboard (where the old Glucose Trend window used to be). Self-contained: reads the
 * glucose history + logs from context and fetches longer-range aggregate stats from Convex on demand.
 *
 * Hidden (renders null) for read-only access-code sessions (accountless caregiver / kid), matching
 * the original placement's `!caregiverSession` guard.
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { Id } from "../../../convex/_generated/dataModel";
import Colors, { COLORS } from "@/constants/colors";
import { T } from "@/constants/theme";
import { useTheme } from "@/context/ThemeContext";
import { AccentShade, CardShade, ControlShade } from "@/components/Shade";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import {
  A1C_RANGES,
  DEFAULT_A1C_RANGE,
  a1cInsight,
  a1cLabel,
  estimateA1C,
  rangeCutoffMs,
  type A1cRange,
} from "@/utils/a1c";
import {
  availableDaysFromOldest,
  mergeWindowStats,
  statsFromEntries,
  windowChunks,
  type GlucoseWindowStats,
} from "@/utils/a1cRange";

const LOW_THRESH = 70;
const HIGH_THRESH = 180;

/** One of the four stat windows under the A1C value: its own bordered, shaded window. */
function A1CStat({ label, value, color, colors }: { label: string; value: string; color: string; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.a1cStatWin, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CardShade radius={12} />
      <Text style={[styles.a1cStatValue, { color }]}>{value}</Text>
      <Text style={[styles.a1cStatLabel, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </View>
  );
}

/**
 * `embedded`: render INSIDE a host window (the Dashboard's A1C popup) — no card border/background/
 * margins of its own, and no horizontal padding, so the host's padding is the only inset. Standalone
 * (default) keeps the self-contained card it always was.
 */
export default function A1CEstimateCard({ embedded = false }: { embedded?: boolean } = {}) {
  // Style overrides for embedded mode — the card chrome goes, the content stays put.
  const eCard = embedded ? { borderWidth: 0, backgroundColor: "transparent", marginBottom: 0, borderRadius: 0, overflow: "visible" as const } : null;
  const eTop = embedded ? { paddingHorizontal: 0, paddingTop: 2, paddingBottom: 12 } : null;
  const eStats = embedded ? { paddingHorizontal: 0 } : null;
  const eInsight = embedded ? { marginHorizontal: 0, marginBottom: 0 } : null;
  const eCoverage = embedded ? { paddingHorizontal: 0 } : null;
  const { scheme, colors: tc } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { history, cgmSyncSuccessTick } = useGlucose();
  const { account, caregiverSession, foodLog, insulinLog } = useAuth();

  const [timeRange, setTimeRange] = useState<A1cRange>(DEFAULT_A1C_RANGE);

  const rangeReadings = useMemo(() => {
    const cutoff = rangeCutoffMs(timeRange, Date.now());
    return history.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }, [history, timeRange]);

  // ── On-demand A1C ranges: 1D is served from in-memory history (which only ever holds ~1 day);
  // longer ranges fetch aggregated stats from Convex ONLY when tapped, in ≤15-day chunks. Falls
  // back to local history when signed out, offline, or the backend doesn't have windowStats yet. ──
  const [remoteRangeStats, setRemoteRangeStats] = useState<GlucoseWindowStats | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const rangeStatsCacheRef = useRef<Map<string, GlucoseWindowStats>>(new Map());

  useEffect(() => {
    setRemoteRangeStats(null);
    const acc = account;
    if (timeRange === 1 || caregiverSession || !acc?.convexUserId) {
      setRangeLoading(false);
      return;
    }
    const cacheKey = `${timeRange}:${cgmSyncSuccessTick}`;
    const cached = rangeStatsCacheRef.current.get(cacheKey);
    if (cached) {
      setRemoteRangeStats(cached);
      setRangeLoading(false);
      return;
    }
    let cancelled = false;
    setRangeLoading(true);
    (async () => {
      try {
        const client = createConvexAuthClient();
        const userId = acc.convexUserId as Id<"users">;
        const parts = await Promise.all(
          windowChunks(timeRange, Date.now()).map((w) =>
            client.query(api.patientGlucose.windowStats, {
              userId,
              passwordHash: acc.passwordHash,
              startTimestamp: w.startTimestamp,
              endTimestamp: w.endTimestamp,
              lowThreshold: LOW_THRESH,
              highThreshold: HIGH_THRESH,
            }),
          ),
        );
        if (cancelled) return;
        const merged = mergeWindowStats(parts);
        rangeStatsCacheRef.current.set(cacheKey, merged);
        setRemoteRangeStats(merged);
      } catch {
        /* offline or backend without windowStats yet — local-history fallback below */
      } finally {
        if (!cancelled) setRangeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timeRange, caregiverSession, account?.convexUserId, account?.passwordHash, cgmSyncSuccessTick]);

  const rangeStats = useMemo(() => {
    const agg =
      timeRange !== 1 && remoteRangeStats != null
        ? remoteRangeStats
        : statsFromEntries(rangeReadings, LOW_THRESH, HIGH_THRESH);
    if (agg.count === 0) return null;
    const avg = Math.round(agg.sum / agg.count);
    const tir = Math.round(((agg.count - agg.lowCount - agg.highCount) / agg.count) * 100);
    const pctHigh = Math.round((agg.highCount / agg.count) * 100);
    const pctLow = Math.round((agg.lowCount / agg.count) * 100);
    const a1c = estimateA1C(avg);
    const windowStart = rangeCutoffMs(timeRange, Date.now());
    const foodInRange = (foodLog ?? []).filter((f) => new Date(f.timestamp).getTime() >= windowStart);
    const totalDays = timeRange;
    const avgCarbs = foodInRange.length > 0 ? Math.round(foodInRange.reduce((s, f) => s + f.estimatedCarbs, 0) / totalDays) : 0;
    const availableDays = availableDaysFromOldest(agg.oldestTimestamp, Date.now(), timeRange);
    return { avg, tir, pctHigh, pctLow, a1c, avgCarbs, availableDays };
  }, [timeRange, remoteRangeStats, rangeReadings, foodLog]);

  // Read-only access-code sessions (accountless caregiver / kid) never saw this section.
  if (caregiverSession) return null;

  return (
    <View>
      {/* ── Time Range Selector — the same segmented bar toggle as the chart's 3H/6H/12H/24H:
          shaded track, the selected segment a shaded accent pill. ── */}
      <View style={[styles.rangeSeg, { backgroundColor: tc.chartControlTrack, borderColor: tc.border }]}>
        <ControlShade radius={T.radius.pill} />
        {A1C_RANGES.map((r) => {
          const active = timeRange === r;
          return (
            <Pressable
              key={r}
              style={[styles.rangeTab, active && { backgroundColor: tc.chartControlActive }]}
              onPress={() => setTimeRange(r)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              {active && <AccentShade color={tc.chartControlActive} radius={T.radius.pill - 4} />}
              <Text style={[styles.rangeTabText, { color: active ? tc.chartControlActiveText : tc.textMuted }]}>{r}D</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Estimated A1C card ── */}
      {rangeStats ? (
        <View style={[styles.a1cCard, { backgroundColor: colors.card, borderColor: colors.border }, eCard]}>
          <View style={[styles.a1cTop, eTop]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.a1cLabel, { color: colors.textSecondary }]}>
                Estimated A1C · {timeRange}-day avg
              </Text>
              {rangeLoading ? (
                <View style={[styles.a1cValueRow, { paddingVertical: 12 }]}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={[styles.a1cLoadingText, { color: colors.textMuted }]}>
                    Loading {timeRange} days of readings…
                  </Text>
                </View>
              ) : (
                <View style={styles.a1cValueRow}>
                  <Text style={[styles.a1cValue, { color: a1cLabel(rangeStats.a1c).color }]}>
                    {rangeStats.a1c}%
                  </Text>
                  <View style={[styles.a1cBadge, { backgroundColor: a1cLabel(rangeStats.a1c).color + "20" }]}>
                    <Text style={[styles.a1cBadgeText, { color: a1cLabel(rangeStats.a1c).color }]}>
                      {a1cLabel(rangeStats.a1c).emoji} {a1cLabel(rangeStats.a1c).label}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={[styles.a1cStatsRow, { opacity: rangeLoading ? 0.4 : 1 }, eStats]}>
            <A1CStat label="Time in Range" value={`${rangeStats.tir}%`} color={rangeStats.tir >= 70 ? COLORS.success : COLORS.warning} colors={colors} />
            <A1CStat label="% High" value={`${rangeStats.pctHigh}%`} color={rangeStats.pctHigh > 25 ? COLORS.warning : COLORS.success} colors={colors} />
            <A1CStat label="% Low" value={`${rangeStats.pctLow}%`} color={rangeStats.pctLow > 5 ? COLORS.danger : COLORS.success} colors={colors} />
            <A1CStat label="Avg Carbs/day" value={`${rangeStats.avgCarbs}g`} color={COLORS.accent} colors={colors} />
          </View>

          {!rangeLoading && rangeStats.availableDays > 0 && rangeStats.availableDays < timeRange && (
            <View style={[styles.a1cCoverageNote, eCoverage]}>
              <Feather name="info" size={12} color={COLORS.warning} />
              <Text style={[styles.a1cCoverageText, { color: COLORS.warning }]}>
                Only {rangeStats.availableDays} {rangeStats.availableDays === 1 ? "day" : "days"} of
                readings {rangeStats.availableDays === 1 ? "is" : "are"} available
              </Text>
            </View>
          )}

          <View style={[styles.a1cInsightBox, { backgroundColor: colors.backgroundTertiary, opacity: rangeLoading ? 0.4 : 1 }, eInsight]}>
            <Feather name="zap" size={13} color={COLORS.primary} />
            <Text style={[styles.a1cInsightText, { color: colors.textSecondary }]}>
              {a1cInsight(rangeStats.avg, timeRange)}
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.a1cCard, { backgroundColor: colors.card, borderColor: colors.border, alignItems: "center", paddingVertical: 20 }, eCard]}>
          <Text style={{ fontSize: 28 }}>📊</Text>
          <Text style={[styles.a1cLabel, { color: colors.textSecondary, textAlign: "center", marginTop: 6 }]}>
            No glucose data for this period. Sync your CGM to see A1C estimates.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rangeSeg: { flexDirection: "row", alignItems: "center", borderRadius: T.radius.pill, padding: 3, borderWidth: 1, marginBottom: 14 },
  rangeTab: { flex: 1, paddingVertical: 6, borderRadius: T.radius.pill - 4, alignItems: "center" },
  rangeTabText: { fontSize: 12.5, fontWeight: T.font.semibold, letterSpacing: 0.2 },

  a1cCard: { borderRadius: 18, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  a1cTop: { padding: 16 },
  a1cLabel: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  a1cValueRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  a1cValue: { fontSize: 42, fontWeight: "700" },
  a1cBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  a1cBadgeText: { fontSize: 13, fontWeight: "700" },
  // Four windows in a row; the gap between them is the divider (standalone card: inset by 14).
  a1cStatsRow: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  a1cStatWin: { flex: 1, minWidth: 0, alignItems: "center", gap: 2, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1 },
  a1cStatValue: { fontSize: 16, fontWeight: "700" },
  a1cStatLabel: { fontSize: 9, fontWeight: "500", textAlign: "center" },
  a1cInsightBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, margin: 12, marginTop: 0, borderRadius: 10 },
  a1cInsightText: { flex: 1, fontSize: 12, fontWeight: "400", lineHeight: 18 },
  a1cLoadingText: { fontSize: 12, fontWeight: "500" },
  a1cCoverageNote: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 10, marginTop: -2 },
  a1cCoverageText: { fontSize: 11, fontWeight: "600" },
});
