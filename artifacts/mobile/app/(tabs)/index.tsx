import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { scheduleGlucoseAlert } from "@/services/notifications";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlucoseGauge } from "@/components/GlucoseGauge";
import type { GlucoseTrend } from "@/components/GlucoseGauge";
import { mapDexcomTrend, trendFromDiff } from "@/utils/trend";
import { ReadingCard } from "@/components/ReadingCard";
import { CGMChart } from "@/components/CGMChart";
import { Surface } from "@/components/Surface";
import { T, withAlpha } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import type { Id } from "../../../../convex/_generated/dataModel";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Visual pull threshold — aligned with iOS RefreshControl release distance (~72pt). */
const PULL_REFRESH_THRESHOLD = 72;

type SyncResultStatus = "ok" | "zero" | "session_expired" | "error";

type SyncResult = {
  status: SyncResultStatus;
  count?: number;
  at: Date;
  message?: string;
};

function TrendAlertBanner({
  trend,
  glucose,
}: {
  trend: "rapidly_falling" | "rapidly_rising";
  glucose: number;
}) {
  const [dismissed, setDismissed] = React.useState(false);
  const c = useThemeColors();
  if (dismissed) return null;
  const isFalling = trend === "rapidly_falling";
  const bannerColor = isFalling ? T.color.coral : T.color.amber;
  const icon = isFalling ? "trending-down" : "trending-up";
  const title = isFalling ? "Glucose Dropping Fast ↓↓" : "Glucose Rising Fast ↑↑";
  const message = isFalling
    ? `At ${glucose} mg/dL and dropping quickly — eat 15g fast-acting carbs (juice or glucose tabs) now. Do not take insulin.`
    : `At ${glucose} mg/dL and rising quickly — avoid high-carb food now. Consider a short walk or consult your dose plan.`;
  return (
    <View style={[styles.banner, { backgroundColor: withAlpha(bannerColor, 0.12), borderColor: withAlpha(bannerColor, 0.4) }]}>
      <View style={[styles.bannerIcon, { backgroundColor: withAlpha(bannerColor, 0.18) }]}>
        <Feather name={icon} size={18} color={bannerColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerTitle, { color: bannerColor }]}>{title}</Text>
        <Text style={[styles.bannerMessage, { color: c.textSecondary }]}>{message}</Text>
      </View>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setDismissed(true);
        }}
        hitSlop={10}
      >
        <Feather name="x" size={16} color={c.textMuted} />
      </Pressable>
    </View>
  );
}

function formatLastSync(date: Date | null): string {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function syncResultLabel(
  result: SyncResult | null,
  fallbackTime: Date | null,
): string {
  if (!result) {
    return formatLastSync(fallbackTime);
  }
  const when = formatLastSync(result.at);
  switch (result.status) {
    case "ok":
      return result.count != null ? `${result.count} new · ${when}` : when;
    case "zero":
      return `0 readings · ${when}`;
    case "session_expired":
      return `Session expired · ${when}`;
    case "error":
      return `Sync failed · ${when}`;
  }
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const { history, latestReading, bulkAddReadings, clearHistory, targetGlucose, notifyCgmSyncSuccess } = useGlucose();
  const { profile, cgmConnection, emergencyContacts, alertPrefs, account } = useAuth();
  const [isSyncingCGM, setIsSyncingCGM] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [cgmLatestReading, setCgmLatestReading] = useState<{ glucose: number; timestamp: string } | null>(null);
  const [backupMissing, setBackupMissing] = useState(false);
  const [, forceUpdate] = useState(0);
  const isConnected = !!cgmConnection.type;
  const autoSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef = useRef(false);
  const prevConnectedRef = useRef(isConnected);
  const lastAlertTimeRef = useRef<number>(0);
  const lastSilentSyncRef = useRef<number>(0);
  const pullHapticFiredRef = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const [pullArmed, setPullArmed] = useState(false);
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
  // Client-side debounce so rapid foreground/tab/timer events don't spam the expedited-sync action.
  // The server also throttles actual provider hits (`minSinceAttemptMs`), which is authoritative.
  const SILENT_SYNC_MIN_GAP_MS = 20 * 1000;

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    if (wasConnected && !isConnected) {
      setCgmLatestReading(null);
      setLastSyncResult(null);
      clearHistory();
    }
  }, [isConnected, clearHistory]);

  // Opportunistic credential-backup check. A connected patient with no server-stored credentials is
  // silently excluded from the ingestion cron and can't be auto-reconnected when the session expires.
  // This catches connect-time backup failures, an app killed mid-connect, and pre-existing
  // connections; the banner nudges a one-tap reconnect (the password isn't recoverable client-side).
  useEffect(() => {
    if (!isConnected || !account?.convexUserId || !account.passwordHash) {
      setBackupMissing(false);
      return;
    }
    const userId = account.convexUserId as Id<"users">;
    const passwordHash = account.passwordHash;
    const connectionType = cgmConnection.type;
    let cancelled = false;
    (async () => {
      try {
        const client = createConvexAuthClient();
        const result = await client.query(api.patientCgm.hasCredentials, {
          userId,
          passwordHash,
        });
        if (cancelled || !result) return; // null/unknown or offline → don't raise a false alarm
        const missing =
          connectionType === "dexcom"
            ? !result.hasDexcom
            : connectionType === "libre"
              ? !result.hasLibre
              : false;
        setBackupMissing(missing);
      } catch {
        /* offline / transient — leave the banner hidden rather than show a false alarm */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, cgmConnection.type, cgmConnection.connectedAt, account?.convexUserId, account?.passwordHash]);

  const displayGlucose = isConnected && cgmLatestReading
    ? cgmLatestReading.glucose
    : latestReading?.glucose ?? 0;
  const recentHistory = [...history].reverse().slice(0, 10);

  const glucoseTrend: GlucoseTrend | undefined = (() => {
    const latest = isConnected && cgmLatestReading
      ? history.find(h => h.timestamp === cgmLatestReading.timestamp)
      : history[history.length - 1];
    if (latest?.dexcomTrend != null) {
      return mapDexcomTrend(latest.dexcomTrend).glucoseTrend;
    }
    if (history.length < 2) return undefined;
    const last = history[history.length - 1].glucose;
    const prev = history[history.length - 2].glucose;
    return trendFromDiff(last - prev).glucoseTrend;
  })();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const childName = profile?.childName ?? "Glucose Guardian";
  const updatedLabel = (lastSyncResult || lastSyncTime)
    ? `Updated ${formatLastSync(lastSyncResult?.at ?? lastSyncTime).toLowerCase()}`
    : undefined;

  const performSync = useCallback(async (silent: boolean) => {
    if (isSyncingRef.current || !cgmConnection.type) return false;
    // Convex is the single ingestion + cursor authority. The app requests an expedited canonical
    // sync and renders the canonical history Convex returns; it no longer calls Dexcom/Libre
    // directly, computes a backfill count, or refreshes provider sessions itself.
    if (!account?.convexUserId || !account.passwordHash) {
      if (!silent) {
        Alert.alert("Sign in required", "Reconnect your account to enable CGM monitoring.");
      }
      return false;
    }
    isSyncingRef.current = true;
    if (silent) {
      setIsAutoSyncing(true);
    } else {
      setIsSyncingCGM(true);
    }
    try {
      const client = createConvexAuthClient();
      const result = await client.action(api.cgmIngest.requestExpeditedSync, {
        userId: account.convexUserId as Id<"users">,
        passwordHash: account.passwordHash,
      });

      const entries = (result.readings ?? []).map((r) => ({
        glucose: r.glucose,
        timestamp: r.timestamp,
        anomaly: r.anomaly,
        dexcomTrend: r.dexcomTrend != null ? r.dexcomTrend : undefined,
      }));
      bulkAddReadings(entries);

      if (entries.length > 0) {
        const mostRecent = entries[entries.length - 1];
        setCgmLatestReading({ glucose: mostRecent.glucose, timestamp: mostRecent.timestamp });

        if (alertPrefs.notificationsEnabled) {
          const g = mostRecent.glucose;
          const urgLow = alertPrefs.urgentLowThreshold;
          const low = alertPrefs.lowThreshold;
          const high = alertPrefs.highThreshold;
          const urgHigh = alertPrefs.urgentHighThreshold;
          const nowMs = Date.now();
          const overThreshold = g <= urgLow || (g < low && g > urgLow) || g >= urgHigh || (g > high && g < urgHigh);

          if (overThreshold && nowMs - lastAlertTimeRef.current > ALERT_COOLDOWN_MS) {
            lastAlertTimeRef.current = nowMs;
            const latestDexcomTrend = mostRecent.dexcomTrend;
            const trendLabel = latestDexcomTrend != null
              ? mapDexcomTrend(latestDexcomTrend).label
              : (() => {
                  const diff = entries.length >= 2
                    ? entries[entries.length - 1].glucose - entries[entries.length - 2].glucose
                    : 0;
                  return trendFromDiff(diff).label;
                })();
            const status = g <= urgLow ? "critically_low" : g < low ? "low" : g >= urgHigh ? "critically_high" : "high";
            scheduleGlucoseAlert({
              childName: profile?.childName ?? "Child",
              glucose: g,
              status,
              trendLabel,
            }).catch(() => {});
          }
        }
      }

      const now = new Date();

      if (
        result.status === "unauthorized" ||
        result.status === "needs_reconnect" ||
        result.status === "no_credentials"
      ) {
        setLastSyncResult({ status: "session_expired", at: now, message: "Reconnect your CGM" });
        if (!silent) {
          Alert.alert(
            "Reconnect Needed",
            "We couldn't keep your CGM connected. Reconnect to resume monitoring.",
            [
              { text: "Reconnect", onPress: () => router.push("/cgm-setup") },
              { text: "OK", style: "cancel" },
            ]
          );
        }
        return false;
      }

      if (result.status === "retrying") {
        setLastSyncResult({ status: "error", at: now, message: "Temporary sync issue" });
        if (!silent) {
          Alert.alert(
            "Sync Delayed",
            "Couldn't reach your CGM right now. We'll keep retrying automatically in the background."
          );
        }
        return false;
      }

      // result.status === "ok"
      setLastSyncTime(now);
      if (entries.length > 0) {
        setLastSyncResult({ status: "ok", count: result.inserted, at: now });
        if (!silent) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            "Synced!",
            result.inserted > 0
              ? `${result.inserted} new reading${result.inserted === 1 ? "" : "s"} from ${cgmConnection.type === "dexcom" ? "Dexcom" : "FreeStyle Libre"}.`
              : "You're up to date."
          );
        }
      } else {
        setLastSyncResult({ status: "zero", count: 0, at: now });
        if (!silent) {
          const deviceName = cgmConnection.type === "dexcom" ? "Dexcom" : "FreeStyle Libre";
          const hint =
            cgmConnection.type === "dexcom"
              ? "Make sure Share is enabled in your Dexcom app, the sensor is active, and the Outside US toggle matches your region."
              : "Make sure LibreLinkUp Sharing is enabled and your sensor is active.";
          Alert.alert(
            "No Readings Yet",
            `No readings available from ${deviceName} yet. ${hint}`,
            [
              { text: "Reconnect", onPress: () => router.push("/cgm-setup") },
              { text: "OK", style: "cancel" },
            ]
          );
        }
      }
      notifyCgmSyncSuccess();
      return true;
    } catch {
      setLastSyncResult({
        status: "error",
        at: new Date(),
        message: "Network error",
      });
      if (!silent) {
        Alert.alert("Error", "Could not sync CGM. Check your connection.");
      }
      return false;
    } finally {
      isSyncingRef.current = false;
      setIsSyncingCGM(false);
      setIsAutoSyncing(false);
    }
  }, [cgmConnection.type, account?.convexUserId, account?.passwordHash, bulkAddReadings, alertPrefs, profile?.childName, notifyCgmSyncSuccess]);

  useEffect(() => {
    if (!isConnected) return;

    // Debounced freshness trigger: mount, the 5-min timer, and every return-to-foreground ask Convex
    // for an expedited canonical sync, but never more than once per SILENT_SYNC_MIN_GAP_MS — so a
    // burst of AppState/tab/timer events can't pile up. (Convex additionally throttles real provider
    // hits server-side, so this is purely to avoid redundant action calls.)
    const triggerSilentSync = () => {
      const nowMs = Date.now();
      if (nowMs - lastSilentSyncRef.current < SILENT_SYNC_MIN_GAP_MS) return;
      lastSilentSyncRef.current = nowMs;
      performSync(true);
      forceUpdate((n) => n + 1);
    };

    triggerSilentSync();

    autoSyncTimerRef.current = setInterval(triggerSilentSync, AUTO_SYNC_INTERVAL_MS);

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") triggerSilentSync();
    });

    const labelTimer = setInterval(() => forceUpdate((n) => n + 1), 30_000);

    return () => {
      if (autoSyncTimerRef.current) clearInterval(autoSyncTimerRef.current);
      clearInterval(labelTimer);
      sub.remove();
    };
  }, [isConnected, performSync]);

  async function syncCGM() {
    await performSync(false);
  }

  async function onRefresh() {
    if (!isConnected) return;
    setRefreshing(true);
    await syncCGM();
    setRefreshing(false);
    pullHapticFiredRef.current = false;
    setPullArmed(false);
  }

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y;
        const armed = y <= -PULL_REFRESH_THRESHOLD;
        setPullArmed(armed);
        if (armed && !pullHapticFiredRef.current) {
          pullHapticFiredRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        if (y > -PULL_REFRESH_THRESHOLD * 0.45) {
          pullHapticFiredRef.current = false;
        }
      },
    },
  );

  const pullOpacity = scrollY.interpolate({
    inputRange: [-PULL_REFRESH_THRESHOLD, -PULL_REFRESH_THRESHOLD * 0.25, 0],
    outputRange: [1, 0.35, 0],
    extrapolate: "clamp",
  });
  const pullTranslateY = scrollY.interpolate({
    inputRange: [-PULL_REFRESH_THRESHOLD, 0],
    outputRange: [10, -32],
    extrapolate: "clamp",
  });
  const pullScale = scrollY.interpolate({
    inputRange: [-PULL_REFRESH_THRESHOLD, 0],
    outputRange: [1, 0.8],
    extrapolate: "clamp",
  });

  const deviceLabel = cgmConnection.type === "dexcom" ? "Dexcom" : cgmConnection.type === "libre" ? "FreeStyle Libre" : "";

  return (
    <View style={[styles.root, { backgroundColor: c.screen }]}>
      {!refreshing && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pullDroplet,
            { top: topPadding + 2, opacity: pullOpacity, transform: [{ translateY: pullTranslateY }, { scale: pullScale }] },
          ]}
        >
          <MaterialCommunityIcons
            name="water"
            size={28}
            color={pullArmed ? T.color.emerald : T.color.violetActive}
          />
        </Animated.View>
      )}
      <Animated.ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPadding + 8, paddingBottom: 130 }]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={["transparent"]}
            progressBackgroundColor="transparent"
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.greeting, { color: c.textSecondary }]}>Good {getTimeOfDay()}</Text>
            <Text style={[styles.title, { color: c.textPrimary }]}>{childName}</Text>
          </View>
          {/* CGM connector — restored from the pre-redesign Glucose screen, restyled dark-clinical.
              Shows the connected provider (Dexcom/Libre) + new-count/recency, or "Connect CGM" when
              disconnected; taps to the same /cgm-setup destination. Independent of the sync card. */}
          <Pressable
            onPress={() => router.push("/cgm-setup")}
            style={[
              styles.cgmChip,
              {
                backgroundColor: isConnected ? withAlpha(T.color.emerald, 0.1) : c.card,
                borderColor: isConnected ? withAlpha(T.color.emerald, 0.4) : c.border,
              },
            ]}
          >
            {isAutoSyncing ? (
              <ActivityIndicator size={10} color={T.color.emerald} />
            ) : (
              <View style={[styles.cgmDot, { backgroundColor: isConnected ? T.color.emerald : c.textMuted }]} />
            )}
            <View style={{ flexShrink: 1 }}>
              <Text
                style={[styles.cgmChipText, { color: isConnected ? T.color.emerald : c.textMuted }]}
                numberOfLines={1}
              >
                {isConnected ? (cgmConnection.type === "dexcom" ? "Dexcom" : "Libre") : "Connect CGM"}
              </Text>
              {isConnected && (lastSyncResult || lastSyncTime) ? (
                <Text style={[styles.cgmChipSub, { color: c.textMuted }]} numberOfLines={1}>
                  {syncResultLabel(lastSyncResult, lastSyncTime)}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </View>

        {backupMissing && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/cgm-setup");
            }}
            style={[styles.banner, { backgroundColor: withAlpha(T.color.amber, 0.12), borderColor: withAlpha(T.color.amber, 0.4) }]}
          >
            <Feather name="alert-triangle" size={16} color={T.color.amber} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.bannerTitle, { color: T.color.amber }]}>Background monitoring not fully enabled</Text>
              <Text style={[styles.bannerMessage, { color: c.textSecondary }]}>
                Reconnect your {deviceLabel} so we can refresh your connection automatically. Without it,
                monitoring may stop until you reopen the app and reconnect.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={c.textMuted} />
          </Pressable>
        )}

        {/* Pull-to-sync helper — centered in the open header space, above the glucose summary card.
            Page-centered (its own full-width row), not anchored to the greeting or the Dexcom card. */}
        {isConnected && (
          <View style={styles.syncHintRow}>
            <Text style={[styles.syncHintLine, { color: c.textMuted }]}>Pull down to sync</Text>
            <Text style={[styles.syncHintLine, styles.syncHintSub, { color: c.textMuted }]}>
              (Auto-sync every 5 min)
            </Text>
          </View>
        )}

        {/* Glucose summary */}
        {latestReading ? (
          <Surface style={styles.section} padding={T.space.xl}>
            <GlucoseGauge
              value={displayGlucose}
              size={172}
              trend={glucoseTrend}
              lowThreshold={alertPrefs.lowThreshold}
              highThreshold={alertPrefs.highThreshold}
              recentReadings={history}
              updatedLabel={updatedLabel}
            />
          </Surface>
        ) : (
          <Surface style={styles.section}>
            <View style={styles.emptyGauge}>
              <Feather name="activity" size={30} color={c.textMuted} />
              <Text style={[styles.emptyGaugeText, { color: c.textPrimary }]}>No readings yet</Text>
              <Text style={[styles.emptyGaugeSub, { color: c.textSecondary }]}>
                {isConnected ? "Pull down to sync your CGM" : "Connect a CGM to start monitoring"}
              </Text>
            </View>
          </Surface>
        )}

        {(glucoseTrend === "rapidly_falling" || glucoseTrend === "rapidly_rising") && history.length > 1 && (
          <View style={styles.section}>
            <TrendAlertBanner trend={glucoseTrend} glucose={displayGlucose} />
          </View>
        )}

        {latestReading?.anomaly.warning && (
          <View style={[styles.section, styles.banner, { backgroundColor: withAlpha(T.color.coral, 0.12), borderColor: withAlpha(T.color.coral, 0.4) }]}>
            <Feather name="alert-triangle" size={16} color={T.color.coral} />
            <Text style={[styles.bannerMessage, { color: c.textSecondary, flex: 1 }]}>
              {latestReading.anomaly.message}
            </Text>
          </View>
        )}

        {latestReading && alertPrefs.emergencyAlertsEnabled && emergencyContacts.length > 0 &&
          (latestReading.glucose < alertPrefs.lowThreshold || latestReading.glucose > alertPrefs.highThreshold) && (
            <View style={[styles.section, styles.emergencyBanner, { backgroundColor: withAlpha(T.color.coral, 0.1), borderColor: withAlpha(T.color.coral, 0.4) }]}>
              <View style={styles.emergencyTop}>
                <Feather name="phone-call" size={15} color={T.color.coral} />
                <Text style={[styles.emergencyTitle, { color: T.color.coral }]}>Emergency Alert Ready</Text>
              </View>
              <Text style={[styles.bannerMessage, { color: c.textSecondary }]}>
                Glucose is {latestReading.glucose < alertPrefs.lowThreshold ? "critically low" : "critically high"} — tap to alert your emergency contact{emergencyContacts.length > 1 ? "s" : ""}.
              </Text>
              <View style={styles.emergencyList}>
                {emergencyContacts.map((c) => (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [styles.emergencyBtn, { backgroundColor: T.color.coral, opacity: pressed ? 0.85 : 1 }]}
                    onPress={() => {
                      const name = profile?.childName ?? "your child";
                      const level = latestReading!.glucose;
                      const status = level < alertPrefs.lowThreshold ? "DANGEROUSLY LOW" : "DANGEROUSLY HIGH";
                      const msg = `🚨 GLUCO GUARDIAN ALERT: ${name}'s blood sugar is ${status} at ${level} mg/dL. Please check on them immediately!`;
                      const url = Platform.OS === "ios"
                        ? `sms:${c.phone}&body=${encodeURIComponent(msg)}`
                        : `sms:${c.phone}?body=${encodeURIComponent(msg)}`;
                      Linking.openURL(url).catch(() => Alert.alert("Could not open SMS", "Please check the phone number for " + c.name));
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                    }}
                  >
                    <Feather name="send" size={13} color="#fff" />
                    <Text style={styles.emergencyBtnText}>Alert {c.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

        {/* Trend chart */}
        {history.length > 1 && (
          <Surface style={styles.section} padding={T.space.lg}>
            <CGMChart
              readings={history}
              targetGlucose={targetGlucose}
              chartHeight={264}
              paddingHorizontal={34}
              urgentLowThreshold={alertPrefs.urgentLowThreshold}
              lowThreshold={alertPrefs.lowThreshold}
              highThreshold={alertPrefs.highThreshold}
              urgentHighThreshold={alertPrefs.urgentHighThreshold}
            />
          </Surface>
        )}

        {/* Recent readings */}
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Recent Readings</Text>
        </View>
        {recentHistory.length === 0 ? (
          <Surface>
            <View style={styles.emptyList}>
              <Feather name="clipboard" size={22} color={c.textMuted} />
              <Text style={[styles.emptyListText, { color: c.textMuted }]}>
                {isConnected ? "Pull down to sync readings from your CGM" : "No readings yet. Connect a CGM to begin."}
              </Text>
            </View>
          </Surface>
        ) : (
          <Surface padding={T.space.lg}>
            {recentHistory.map((entry, i) => (
              <ReadingCard key={i} entry={entry} last={i === recentHistory.length - 1} />
            ))}
          </Surface>
        )}
      </Animated.ScrollView>
    </View>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pullDroplet: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  scroll: { paddingHorizontal: T.space.xl },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: T.space.md },
  headerText: { flex: 1 },
  /** Centered pull-to-sync helper row above the glucose summary card (page-centered, own row). */
  syncHintRow: { alignItems: "center", gap: 3, marginBottom: T.space.md },
  syncHintLine: { fontSize: 8.25, fontWeight: T.font.regular, textAlign: "center" },
  syncHintSub: { opacity: 0.82 },
  cgmChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 184,
    marginTop: 4,
  },
  cgmDot: { width: 8, height: 8, borderRadius: 4 },
  cgmChipText: { fontSize: 13, fontWeight: T.font.semibold },
  cgmChipSub: { fontSize: 10.5, fontWeight: T.font.regular, marginTop: 1 },
  greeting: { fontSize: 14, fontWeight: T.font.regular },
  title: { fontSize: 26, fontWeight: T.font.heavy, marginTop: 2, letterSpacing: -0.5 },

  section: { marginBottom: T.space.lg },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: T.radius.control,
    borderWidth: 1,
  },
  bannerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bannerTitle: { fontSize: 13, fontWeight: T.font.bold, marginBottom: 2 },
  bannerMessage: { fontSize: 12, fontWeight: T.font.regular, lineHeight: 17 },

  emptyGauge: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyGaugeText: { fontSize: 16, fontWeight: T.font.semibold },
  emptyGaugeSub: { fontSize: 12.5, fontWeight: T.font.regular, textAlign: "center" },

  emergencyBanner: { borderRadius: T.radius.control, borderWidth: 1, padding: 14, gap: 8 },
  emergencyTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  emergencyTitle: { fontSize: 14, fontWeight: T.font.bold },
  emergencyList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emergencyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  emergencyBtnText: { fontSize: 13, fontWeight: T.font.semibold, color: "#fff" },

  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: T.font.bold, letterSpacing: -0.2 },

  emptyList: { padding: 12, alignItems: "center", gap: 10 },
  emptyListText: { fontSize: 14, fontWeight: T.font.regular, textAlign: "center", lineHeight: 20 },
});
