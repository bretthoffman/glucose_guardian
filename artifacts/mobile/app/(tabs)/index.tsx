import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlucoseGauge } from "@/components/GlucoseGauge";
import { mapDexcomTrend, trendFromDiff, type TrendInfo } from "@/utils/trend";
import { bannerKindFromSyncStatus, cgmDiagnosticMessage } from "@/utils/cgmDiagnosticMessages";
import { CGMChart } from "@/components/CGMChart";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import InsightsRecommendations from "@/components/InsightsRecommendations";
import { ReadingCard } from "@/components/ReadingCard";
import { Surface } from "@/components/Surface";
import { analyzeReadings } from "@/utils/insights";
import { T, withAlpha } from "@/constants/theme";
import { useThemeColors } from "@/context/ThemeContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";
import { api, createConvexAuthClient } from "@/utils/convex-auth-client";
import {
  HOME_SCROLL_REST_OFFSET,
  SCROLL_RETURN_DRAG_FALLBACK_MS,
  SCROLL_RETURN_FALLBACK_MS,
  homeScrollNeedsRecovery,
  isHomeScrollAtRest,
  shouldUseAnimatedScrollCorrection,
} from "@/utils/homeScrollRecovery";
import type { Id } from "../../../../convex/_generated/dataModel";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Visual pull threshold — aligned with iOS RefreshControl release distance (~72pt). */
const PULL_REFRESH_THRESHOLD = 72;

type SyncResultStatus =
  | "ok"
  | "zero"
  | "session_expired"
  | "error"
  | "no_shared_patient"
  | "connected_no_data"
  | "sharing_not_enabled";

type SyncResult = {
  status: SyncResultStatus;
  count?: number;
  at: Date;
  message?: string;
};

type ManualSyncAlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type ManualSyncAlert = {
  title: string;
  message: string;
  buttons?: ManualSyncAlertButton[];
  successHaptic?: boolean;
};

type PerformSyncOutcome = {
  ok: boolean;
  manualAlert: ManualSyncAlert | null;
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
    case "no_shared_patient":
      return `No shared patient · ${when}`;
    case "connected_no_data":
      return `Connected · no data · ${when}`;
    case "sharing_not_enabled":
      return `Sharing off · ${when}`;
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
  const { profile, cgmConnection, emergencyContacts, alertPrefs, account, caregiverSession, isMinor, foodLog, insulinLog, isViewingLinkedPatient, viewingPatientName, exitViewingMode, accessCodeRole } = useAuth();
  const [isSyncingCGM, setIsSyncingCGM] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** True while the chart's touch-hold reading cursor is engaged — freezes page scroll. */
  const [chartCursorActive, setChartCursorActive] = useState(false);
  // ── Popups opened from the glucose gauge: circle → recent readings, trend pill → insights ──
  const [recentReadingsVisible, setRecentReadingsVisible] = useState(false);
  const [insightsVisible, setInsightsVisible] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null);
  const [backupMissing, setBackupMissing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    diagnosticCategory: string;
    messageKey: string;
    reconnectRequired: boolean;
    hasStoredCredentials: boolean;
  } | null>(null);
  const [, forceUpdate] = useState(0);
  const isConnected = !!cgmConnection.type;
  const autoSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef = useRef(false);
  const prevConnectedRef = useRef(isConnected);
  const lastAlertTimeRef = useRef<number>(0);
  const lastSilentSyncRef = useRef<number>(0);
  const pullHapticFiredRef = useRef(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollOffsetRef = useRef(HOME_SCROLL_REST_OFFSET);
  const isManualPullRefreshRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isMomentumRef = useRef(false);
  const scrollResetInFlightRef = useRef(false);
  const pendingScrollResetRef = useRef(false);
  const scrollResetFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollResetDragFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollResetSettleCallbacksRef = useRef<Array<() => void>>([]);
  const deferredScrollResetStartRef = useRef<(() => void) | null>(null);
  const [pullArmed, setPullArmed] = useState(false);
  const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
  // Client-side debounce so rapid foreground/tab/timer events don't spam the expedited-sync action.
  // The server also throttles actual provider hits (`minSinceAttemptMs`), which is authoritative.
  const SILENT_SYNC_MIN_GAP_MS = 20 * 1000;

  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;
    if (wasConnected && !isConnected) {
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

  // Sanitized CGM sync/diagnostic state from Convex (no credentials or raw errors).
  useEffect(() => {
    if (!isConnected || !account?.convexUserId || !account.passwordHash) {
      setSyncStatus(null);
      return;
    }
    const userId = account.convexUserId as Id<"users">;
    const passwordHash = account.passwordHash;
    let cancelled = false;
    (async () => {
      try {
        const client = createConvexAuthClient();
        const result = await client.query(api.patientCgmSync.getSyncStatus, { userId, passwordHash });
        if (cancelled || !result || !result.connected) return;
        setSyncStatus({
          diagnosticCategory: result.diagnosticCategory,
          messageKey: result.messageKey,
          reconnectRequired: result.reconnectRequired,
          hasStoredCredentials: result.hasStoredCredentials,
        });
      } catch {
        /* offline — keep prior state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isConnected,
    cgmConnection.type,
    cgmConnection.connectedAt,
    lastSyncTime,
    account?.convexUserId,
    account?.passwordHash,
  ]);

  const libreBannerKind = bannerKindFromSyncStatus({
    provider: cgmConnection.type,
    diagnosticCategory: syncStatus?.diagnosticCategory,
    reconnectRequired: syncStatus?.reconnectRequired,
    backupMissing,
    hasStoredCredentials: syncStatus?.hasStoredCredentials,
  });

  const deviceLabel = cgmConnection.type === "dexcom" ? "Dexcom" : "FreeStyle Libre";

  // Always derive from `history` — the single source of truth the graph and header pill use — so
  // the value can never diverge (e.g. leak a prior account's reading into a caregiver session).
  const displayGlucose = latestReading?.glucose ?? 0;
  const recentHistory = [...history].reverse().slice(0, 10);

  /** Last-24h pattern analysis for the trend-pill popup (moved here from the Insulin Dose tab). */
  const insightSuggestions = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = history.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
    return analyzeReadings(recent, targetGlucose, isMinor, foodLog ?? [], insulinLog ?? []);
  }, [history, targetGlucose, isMinor, foodLog, insulinLog]);

  const effectiveTrend: TrendInfo | undefined = (() => {
    if (history.length === 0) return undefined;
    const latest = history[history.length - 1];
    if (latest.dexcomTrend != null) return mapDexcomTrend(latest.dexcomTrend);
    if (history.length < 2) return undefined;
    const last = history[history.length - 1].glucose;
    const prev = history[history.length - 2].glucose;
    return trendFromDiff(last - prev);
  })();

  const glucoseTrend = effectiveTrend?.glucoseTrend;

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  // One-pager scroll extent: with Recent Readings gone, the chart is the last element, so the
  // content should end just above the floating tab bar (≈71px tall — see (tabs)/_layout.tsx bar
  // metrics — sitting on the safe-area inset) plus a small breathing gap. No flat oversized
  // padding → no leftover scrollable slack; when everything fits the screen, a downward tug
  // just springs back. Screens where content truly overflows still scroll exactly as needed.
  const TAB_BAR_HEIGHT = 71;
  const tabBarClearance = TAB_BAR_HEIGHT + (insets.bottom > 0 ? insets.bottom : 12) + 8;

  const patientName = profile?.childName ?? "Glucose Guardian";
  // Greeting reflects who's actually looking:
  //  - child code → the kid on their own phone, so just their name ("Bella").
  //  - caregiver code (new or legacy) → "Bella's Caregiver".
  //  - co-guardian viewing / guardian-role account (parentName is only written for that role) → "Bella's Guardian".
  const childName = (() => {
    const name = profile?.childName;
    if (!name) return patientName;
    if (accessCodeRole === "child") return name;
    if (accessCodeRole === "caregiver" || caregiverSession) return `${name}'s Caregiver`;
    if (isViewingLinkedPatient || profile?.accountRole === "parent" || !!profile?.parentName) {
      return `${name}'s Guardian`;
    }
    return name;
  })();
  const updatedLabel = (lastSyncResult || lastSyncTime)
    ? `Updated ${formatLastSync(lastSyncResult?.at ?? lastSyncTime).toLowerCase()}`
    : undefined;

  const performSync = useCallback(async (silent: boolean): Promise<PerformSyncOutcome> => {
    if (isSyncingRef.current || !cgmConnection.type) return { ok: false, manualAlert: null };
    // Convex is the single ingestion + cursor authority. The app requests an expedited canonical
    // sync and renders the canonical history Convex returns; it no longer calls Dexcom/Libre
    // directly, computes a backfill count, or refreshes provider sessions itself.
    if (!account?.convexUserId || !account.passwordHash) {
      if (!silent) {
        return {
          ok: false,
          manualAlert: {
            title: "Sign in required",
            message: "Reconnect your account to enable CGM monitoring.",
          },
        };
      }
      return { ok: false, manualAlert: null };
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

      setSyncStatus({
        diagnosticCategory: result.diagnosticCategory,
        messageKey: result.messageKey,
        reconnectRequired: result.reconnectRequired,
        hasStoredCredentials: result.status !== "no_credentials",
      });

      if (
        result.status === "unauthorized" ||
        result.status === "needs_reconnect" ||
        result.status === "no_credentials" ||
        result.status === "sharing_not_enabled"
      ) {
        const msg = cgmDiagnosticMessage(result.messageKey, cgmConnection.type);
        setLastSyncResult({
          status: result.status === "sharing_not_enabled" ? "sharing_not_enabled" : "session_expired",
          at: now,
          message: msg,
        });
        if (!silent) {
          return {
            ok: false,
            manualAlert: {
              title: "Reconnect Needed",
              message: msg,
              buttons: [
                { text: "Reconnect", onPress: () => router.push("/cgm-setup") },
                { text: "OK", style: "cancel" },
              ],
            },
          };
        }
        return { ok: false, manualAlert: null };
      }

      if (result.status === "retrying") {
        setLastSyncResult({
          status: "error",
          at: now,
          message: cgmDiagnosticMessage(result.messageKey, cgmConnection.type),
        });
        if (!silent) {
          return {
            ok: false,
            manualAlert: {
              title: "Sync Delayed",
              message: cgmDiagnosticMessage(result.messageKey, cgmConnection.type),
            },
          };
        }
        return { ok: false, manualAlert: null };
      }

      setLastSyncTime(now);

      if (result.status === "no_shared_patient") {
        const msg = cgmDiagnosticMessage(result.messageKey, "libre");
        setLastSyncResult({ status: "no_shared_patient", at: now, message: msg });
        if (!silent) {
          return {
            ok: true,
            manualAlert: { title: "No Shared Patient", message: msg },
          };
        }
        notifyCgmSyncSuccess();
        return { ok: true, manualAlert: null };
      }

      if (result.status === "connected_no_data") {
        const msg = cgmDiagnosticMessage(result.messageKey, "libre");
        setLastSyncResult({ status: "connected_no_data", at: now, message: msg });
        if (!silent) {
          return {
            ok: true,
            manualAlert: { title: "Connected — No Readings Yet", message: msg },
          };
        }
        notifyCgmSyncSuccess();
        return { ok: true, manualAlert: null };
      }

      if (entries.length > 0) {
        setLastSyncResult({ status: "ok", count: result.inserted, at: now });
        if (!silent) {
          return {
            ok: true,
            manualAlert: {
              title: "Synced!",
              message:
                result.inserted > 0
                  ? `${result.inserted} new reading${result.inserted === 1 ? "" : "s"} from ${deviceLabel}.`
                  : "You're up to date.",
              successHaptic: true,
            },
          };
        }
      } else if (result.status === "ok") {
        setLastSyncResult({ status: "zero", count: 0, at: now });
        if (!silent && cgmConnection.type === "dexcom") {
          return {
            ok: true,
            manualAlert: {
              title: "No Readings Yet",
              message:
                "No readings available from Dexcom yet. Make sure Share is enabled in your Dexcom app, the sensor is active, and the Outside US toggle matches your region.",
              buttons: [
                { text: "Reconnect", onPress: () => router.push("/cgm-setup") },
                { text: "OK", style: "cancel" },
              ],
            },
          };
        }
      }
      notifyCgmSyncSuccess();
      return { ok: true, manualAlert: null };
    } catch {
      setLastSyncResult({
        status: "error",
        at: new Date(),
        message: "Network error",
      });
      if (!silent) {
        return {
          ok: false,
          manualAlert: {
            title: "Error",
            message: "Could not sync CGM. Check your connection.",
          },
        };
      }
      return { ok: false, manualAlert: null };
    } finally {
      isSyncingRef.current = false;
      setIsSyncingCGM(false);
      setIsAutoSyncing(false);
    }
  }, [cgmConnection.type, deviceLabel, account?.convexUserId, account?.passwordHash, bulkAddReadings, alertPrefs, profile?.childName, notifyCgmSyncSuccess]);

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

  const clearScrollResetTimers = useCallback(() => {
    if (scrollResetFallbackRef.current) {
      clearTimeout(scrollResetFallbackRef.current);
      scrollResetFallbackRef.current = null;
    }
    if (scrollResetDragFallbackRef.current) {
      clearTimeout(scrollResetDragFallbackRef.current);
      scrollResetDragFallbackRef.current = null;
    }
  }, []);

  const syncAnimatedScrollOffset = useCallback((offsetY: number) => {
    scrollOffsetRef.current = offsetY;
    scrollY.setValue(offsetY);
  }, [scrollY]);

  const finishScrollReset = useCallback(() => {
    clearScrollResetTimers();
    scrollResetInFlightRef.current = false;
    pendingScrollResetRef.current = false;
    deferredScrollResetStartRef.current = null;
    const callbacks = scrollResetSettleCallbacksRef.current.splice(0);
    for (const cb of callbacks) cb();
  }, [clearScrollResetTimers]);

  const returnHomeScrollToRest = useCallback(
    (options?: { animated?: boolean; manualOnly?: boolean; onSettled?: () => void }) => {
      const manualOnly = options?.manualOnly !== false;
      if (manualOnly && !isManualPullRefreshRef.current) {
        options?.onSettled?.();
        return;
      }

      if (options?.onSettled) {
        scrollResetSettleCallbacksRef.current.push(options.onSettled);
      }

      if (scrollResetInFlightRef.current) return;

      const offsetY = scrollOffsetRef.current;
      if (!homeScrollNeedsRecovery(offsetY)) {
        syncAnimatedScrollOffset(HOME_SCROLL_REST_OFFSET);
        finishScrollReset();
        return;
      }

      if (isDraggingRef.current || isMomentumRef.current) {
        pendingScrollResetRef.current = true;
        if (!scrollResetDragFallbackRef.current) {
          scrollResetDragFallbackRef.current = setTimeout(() => {
            scrollResetDragFallbackRef.current = null;
            if (!pendingScrollResetRef.current) return;
            pendingScrollResetRef.current = false;
            returnHomeScrollToRest({ animated: options?.animated, manualOnly: false });
          }, SCROLL_RETURN_DRAG_FALLBACK_MS);
        }
        return;
      }

      const animated = options?.animated !== false;
      scrollResetInFlightRef.current = true;
      scrollViewRef.current?.scrollTo({ y: HOME_SCROLL_REST_OFFSET, animated });

      if (animated) {
        scrollResetFallbackRef.current = setTimeout(() => {
          syncAnimatedScrollOffset(HOME_SCROLL_REST_OFFSET);
          finishScrollReset();
        }, SCROLL_RETURN_FALLBACK_MS);
      } else {
        syncAnimatedScrollOffset(HOME_SCROLL_REST_OFFSET);
        finishScrollReset();
      }
    },
    [finishScrollReset, syncAnimatedScrollOffset],
  );

  const verifyHomeScrollRestOnAlertDismiss = useCallback(() => {
    const offsetY = scrollOffsetRef.current;
    if (isHomeScrollAtRest(offsetY)) return;
    const animated = shouldUseAnimatedScrollCorrection(offsetY);
    scrollViewRef.current?.scrollTo({ y: HOME_SCROLL_REST_OFFSET, animated });
    if (!animated) syncAnimatedScrollOffset(HOME_SCROLL_REST_OFFSET);
  }, [syncAnimatedScrollOffset]);

  const showManualSyncAlert = useCallback((alert: ManualSyncAlert) => {
    if (alert.successHaptic) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    const buttons = (alert.buttons ?? [{ text: "OK" }]).map((btn) => ({
      text: btn.text,
      style: btn.style,
      onPress: () => {
        btn.onPress?.();
        requestAnimationFrame(() => verifyHomeScrollRestOnAlertDismiss());
      },
    }));
    Alert.alert(alert.title, alert.message, buttons);
  }, [verifyHomeScrollRestOnAlertDismiss]);

  const resetPullVisualState = useCallback(() => {
    pullHapticFiredRef.current = false;
    setPullArmed(false);
  }, []);

  const ensureManualPullScrollRecoveryStarted = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const beginAfterGesture = () => {
        returnHomeScrollToRest({ animated: true, manualOnly: false });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      };

      if (isDraggingRef.current || isMomentumRef.current) {
        pendingScrollResetRef.current = true;
        deferredScrollResetStartRef.current = beginAfterGesture;
        if (!scrollResetDragFallbackRef.current) {
          scrollResetDragFallbackRef.current = setTimeout(() => {
            scrollResetDragFallbackRef.current = null;
            pendingScrollResetRef.current = false;
            deferredScrollResetStartRef.current = null;
            beginAfterGesture();
          }, SCROLL_RETURN_DRAG_FALLBACK_MS);
        }
        return;
      }

      beginAfterGesture();
    });
  }, [returnHomeScrollToRest]);

  useEffect(() => {
    return () => {
      clearScrollResetTimers();
      scrollResetSettleCallbacksRef.current = [];
      deferredScrollResetStartRef.current = null;
    };
  }, [clearScrollResetTimers]);

  const tryFinishScrollReset = useCallback(() => {
    if (!scrollResetInFlightRef.current && !pendingScrollResetRef.current) return;
    if (isDraggingRef.current) return;

    if (pendingScrollResetRef.current && !scrollResetInFlightRef.current) {
      pendingScrollResetRef.current = false;
      if (scrollResetDragFallbackRef.current) {
        clearTimeout(scrollResetDragFallbackRef.current);
        scrollResetDragFallbackRef.current = null;
      }
      const deferred = deferredScrollResetStartRef.current;
      deferredScrollResetStartRef.current = null;
      if (deferred) {
        deferred();
        return;
      }
      returnHomeScrollToRest({ animated: true, manualOnly: false });
      return;
    }

    if (scrollResetInFlightRef.current && isHomeScrollAtRest(scrollOffsetRef.current)) {
      finishScrollReset();
    }
  }, [finishScrollReset, returnHomeScrollToRest]);

  async function onRefresh() {
    if (!isConnected) return;
    isManualPullRefreshRef.current = true;
    setRefreshing(true);
    let pendingAlert: ManualSyncAlert | null = null;
    try {
      const outcome = await performSync(false);
      pendingAlert = outcome.manualAlert;
    } finally {
      setRefreshing(false);
      resetPullVisualState();
    }

    await ensureManualPullScrollRecoveryStarted();
    if (pendingAlert) {
      showManualSyncAlert(pendingAlert);
    }
    isManualPullRefreshRef.current = false;
  }

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y;
        scrollOffsetRef.current = y;
        const armed = y <= -PULL_REFRESH_THRESHOLD;
        setPullArmed(armed);
        if (armed && !pullHapticFiredRef.current) {
          pullHapticFiredRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        if (y > -PULL_REFRESH_THRESHOLD * 0.45) {
          pullHapticFiredRef.current = false;
        }
        if (scrollResetInFlightRef.current && isHomeScrollAtRest(y)) {
          finishScrollReset();
        }
      },
    },
  );

  const handleScrollBeginDrag = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const handleScrollEndDrag = useCallback(() => {
    isDraggingRef.current = false;
    tryFinishScrollReset();
  }, [tryFinishScrollReset]);

  const handleMomentumScrollBegin = useCallback(() => {
    isMomentumRef.current = true;
  }, []);

  const handleMomentumScrollEnd = useCallback(() => {
    isMomentumRef.current = false;
    tryFinishScrollReset();
  }, [tryFinishScrollReset]);

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

  const libreBannerMessage =
    syncStatus?.messageKey
      ? cgmDiagnosticMessage(syncStatus.messageKey, cgmConnection.type)
      : null;

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
        ref={scrollViewRef}
        {...NO_AUTO_CONTENT_INSETS}
        contentContainerStyle={[styles.scroll, { paddingTop: topPadding + 8, paddingBottom: tabBarClearance }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartCursorActive}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
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
          {/* Own-account CGM connector — hidden while viewing a linked patient (the patient's own
              device owns the sensor; the co-guardian just reads the stream). */}
          {!isViewingLinkedPatient && (
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
          )}
        </View>

        {isViewingLinkedPatient && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              exitViewingMode();
            }}
            style={[styles.viewingBanner, { backgroundColor: withAlpha(T.color.violet, 0.12), borderColor: withAlpha(T.color.violet, 0.4) }]}
          >
            <Feather name="eye" size={15} color={T.color.violetActive} />
            <Text style={[styles.viewingBannerText, { color: c.textSecondary }]} numberOfLines={1}>
              Viewing {viewingPatientName ?? "linked patient"}'s data
            </Text>
            <Text style={[styles.viewingBannerExit, { color: T.color.violetActive }]}>Exit</Text>
          </Pressable>
        )}

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

        {libreBannerKind && libreBannerKind !== "backup_missing" && libreBannerMessage && (
          <Pressable
            onPress={() => {
              if (libreBannerKind === "reconnect_required" || libreBannerKind === "sharing_not_enabled") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/cgm-setup");
              }
            }}
            style={[
              styles.banner,
              {
                backgroundColor: withAlpha(
                  libreBannerKind === "connected_no_data" ? T.color.emerald : T.color.amber,
                  0.12,
                ),
                borderColor: withAlpha(
                  libreBannerKind === "connected_no_data" ? T.color.emerald : T.color.amber,
                  0.4,
                ),
              },
            ]}
          >
            <Feather
              name={libreBannerKind === "connected_no_data" ? "check-circle" : "info"}
              size={16}
              color={libreBannerKind === "connected_no_data" ? T.color.emerald : T.color.amber}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.bannerTitle,
                  { color: libreBannerKind === "connected_no_data" ? T.color.emerald : T.color.amber },
                ]}
              >
                {libreBannerKind === "no_shared_patient"
                  ? "No shared Libre patient"
                  : libreBannerKind === "connected_no_data"
                    ? "Libre connected — no readings yet"
                    : libreBannerKind === "sharing_not_enabled"
                      ? "LibreLinkUp sharing required"
                      : libreBannerKind === "provider_unavailable"
                        ? "Libre temporarily unavailable"
                        : "Libre reconnect needed"}
              </Text>
              <Text style={[styles.bannerMessage, { color: c.textSecondary }]}>{libreBannerMessage}</Text>
            </View>
            {(libreBannerKind === "reconnect_required" || libreBannerKind === "sharing_not_enabled") && (
              <Feather name="chevron-right" size={18} color={c.textMuted} />
            )}
          </Pressable>
        )}

        {/* Pull-to-sync helper — centered in the open header space, above the glucose summary card.
            Page-centered (its own full-width row), not anchored to the greeting or the Dexcom card. */}
        {isConnected && !isViewingLinkedPatient && (
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
              trendInfo={effectiveTrend}
              lowThreshold={alertPrefs.lowThreshold}
              highThreshold={alertPrefs.highThreshold}
              recentReadings={history}
              updatedLabel={updatedLabel}
              onGaugePress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRecentReadingsVisible(true);
              }}
              onTrendPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setInsightsVisible(true);
              }}
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
              onCursorActiveChange={setChartCursorActive}
            />
          </Surface>
        )}

      </Animated.ScrollView>

      {/* ── Recent Readings popup — opened by tapping inside the gauge circle ── */}
      <DashboardSectionModal
        visible={recentReadingsVisible}
        onClose={() => setRecentReadingsVisible(false)}
        accessibilityLabel="Recent readings"
      >
        <View style={[styles.popupCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.popupTitle, { color: c.textPrimary }]}>Recent Readings</Text>
          {recentHistory.length === 0 ? (
            <View style={styles.popupEmpty}>
              <Feather name="clipboard" size={22} color={c.textMuted} />
              <Text style={[styles.popupEmptyText, { color: c.textMuted }]}>
                {isConnected ? "Pull down to sync readings from your CGM" : "No readings yet. Connect a CGM to begin."}
              </Text>
            </View>
          ) : (
            recentHistory.map((entry, i) => (
              <ReadingCard key={i} entry={entry} last={i === recentHistory.length - 1} />
            ))
          )}
        </View>
      </DashboardSectionModal>

      {/* ── Insights & Recommendations popup — opened by tapping the trend pill ── */}
      <DashboardSectionModal
        visible={insightsVisible}
        onClose={() => setInsightsVisible(false)}
        accessibilityLabel="Insights and recommendations"
      >
        <View style={[styles.popupCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.popupTitle, { color: c.textPrimary }]}>
            {isMinor ? "Tips for You 💡" : "Insights & Recommendations"}
          </Text>
          <InsightsRecommendations
            suggestions={insightSuggestions}
            onChat={(prompt) => {
              setInsightsVisible(false);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/(tabs)/chat", params: { prompt } });
            }}
          />
        </View>
      </DashboardSectionModal>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: T.space.xs },
  headerText: { flex: 1 },
  /** Centered pull-to-sync helper row above the glucose summary card (page-centered, own row). */
  viewingBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, marginBottom: T.space.md },
  viewingBannerText: { flex: 1, fontSize: 13, fontWeight: T.font.medium },
  viewingBannerExit: { fontSize: 13, fontWeight: T.font.bold },
  syncHintRow: { alignItems: "center", gap: 3, marginBottom: T.space.xs },
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
  popupCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  popupTitle: { fontSize: 18, fontWeight: T.font.bold },
  popupEmpty: { padding: 12, alignItems: "center", gap: 10 },
  popupEmptyText: { fontSize: 14, fontWeight: T.font.regular, textAlign: "center", lineHeight: 20 },
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
});
