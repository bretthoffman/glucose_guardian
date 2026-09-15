import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scheduleGlucoseAlert, scheduleTrendAlert } from "@/services/notifications";
import { classifyGlucose } from "../../../../convex/pushLogic";
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
  useWindowDimensions,
  type ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlucoseGauge } from "@/components/GlucoseGauge";
import { isFastTrend, mapDexcomTrend, trendFromDiff, type TrendInfo } from "@/utils/trend";
import { bannerKindFromSyncStatus, cgmDiagnosticMessage } from "@/utils/cgmDiagnosticMessages";
import { CGMChart } from "@/components/CGMChart";
import LogDetailModal, { type SelectedLog } from "@/components/LogDetailModal";
import { canEditExistingLogs } from "@/utils/logEditPermission";
import type { ChartEventMarker, PositionedChartMarker } from "@/utils/chartEventMarkers";
import Colors from "@/constants/colors";
import { useTheme } from "@/context/ThemeContext";
import { DashboardSectionModal } from "@/components/DashboardSectionModal";
import InsightsRecommendations from "@/components/InsightsRecommendations";
import { ReadingCard } from "@/components/ReadingCard";
import { Surface } from "@/components/Surface";
import { analyzeReadings, type Suggestion } from "@/utils/insights";
import { computePatternTuning, tuningSuggestions } from "@/utils/doseTuning";
import { useQuery } from "convex/react";
import { COLORS } from "@/constants/colors";
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
import { CardShade, ControlShade, ScreenShade, TintShade } from "@/components/Shade";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Matches GlucoseGauge's STALE_READING_MS — past this, label from the reading, not the sync. */
const STALE_READING_LABEL_MS = 20 * 60 * 1000;
/** Visual pull threshold — aligned with iOS RefreshControl release distance (~72pt). */
const PULL_REFRESH_THRESHOLD = 72;

type SyncResultStatus =
  | "ok"
  | "zero"
  | "session_expired"
  | "error"
  | "no_shared_patient"
  | "connected_no_data"
  | "sharing_not_enabled"
  /** The APP's session died mid-run — the CGM side is fine; only signing in fixes it. */
  | "app_signin";

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

/**
 * One notice row under the glucose chart — the page's shared format for every alert it shows: a
 * glyph in the notice's semantic color, a bold title, a muted message, and a chevron when tapping
 * does something. The row is TINTED in the notice's semantic color — fill, border, icon, title —
 * exactly as the old banners were, so urgency stays readable at a glance (coral = act now, amber =
 * attention, emerald = fine); only the layout changed. Text and handlers belong to the callers.
 */
function HomeNotice({
  icon,
  color,
  title,
  message,
  onPress,
  chevron,
  trailing,
  children,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  title?: string;
  /** Optional so a notice whose source has no message renders none — same as the old banners. */
  message?: string;
  onPress?: () => void;
  /** Show the trailing chevron; defaults to "whenever there is an onPress". */
  chevron?: boolean;
  /** A custom trailing control (e.g. a dismiss ×) — replaces the chevron. */
  trailing?: React.ReactNode;
  /** Extra content under the message (e.g. action buttons). */
  children?: React.ReactNode;
}) {
  const c = useThemeColors();
  const showChevron = chevron ?? !!onPress;
  const body = (
    <>
      {/* The ramp runs in the notice's own semantic color, so coral/amber/emerald each shade as themselves. */}
      <TintShade color={color} radius={T.radius.control} />
      <View style={styles.noticeIcon}>
        <Feather name={icon} size={22} color={color} />
      </View>
      <View style={styles.noticeBody}>
        {title ? <Text style={[styles.noticeTitle, { color }]}>{title}</Text> : null}
        {message ? <Text style={[styles.noticeMessage, { color: c.textSecondary }]}>{message}</Text> : null}
        {children}
      </View>
      {trailing ?? (showChevron ? <Feather name="chevron-right" size={20} color={c.textMuted} /> : null)}
    </>
  );
  const base = [styles.notice, { backgroundColor: withAlpha(color, 0.12), borderColor: withAlpha(color, 0.4) }];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [...base, { opacity: pressed ? 0.85 : 1 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={base}>{body}</View>
  );
}

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
    <HomeNotice
      icon={icon}
      color={bannerColor}
      title={title}
      message={message}
      trailing={
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setDismissed(true);
          }}
          hitSlop={10}
        >
          <Feather name="x" size={16} color={c.textMuted} />
        </Pressable>
      }
    />
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
    case "app_signin":
      return `Sign in needed · ${when}`;
    case "error":
      return `Sync failed · ${when}`;
  }
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  // ── iPad PORTRAIT only: the phone-sized gauge/chart cover barely half the tall screen, so both
  // cards and their contents scale up together. Landscape iPad and iPhone keep their exact current
  // sizing (scale 1); useWindowDimensions re-evaluates live on rotation. ──
  const { width: winW, height: winH } = useWindowDimensions();
  const isPadPortrait =
    Platform.OS === "ios" && (Platform as unknown as { isPad?: boolean }).isPad === true && winH > winW;
  const padScale = isPadPortrait ? 1.4 : 1;
  const c = useThemeColors();
  const { history, latestReading, bulkAddReadings, clearHistory, targetGlucose, notifyCgmSyncSuccess } = useGlucose();
  const { profile, cgmConnection, emergencyContacts, alertPrefs, account, caregiverSession, isMinor, foodLog, insulinLog, isViewingLinkedPatient, viewingPatientName, exitViewingMode, accessCodeRole, accessCodePermissions, sessionExpired, signOut } = useAuth();

  // ── Tapped-alert popup: notification taps land HERE with the alert text + a ready-made chat
  // prompt. Nothing is auto-sent — the popup offers Dismiss / Send to chat, it is gated by the
  // "Send Alerts to Chat on open" toggle, and a pending wait-window confirm SUPERSEDES it (the
  // dropped popup never comes back — no stacking). ──
  const { alertMsg, alertPrompt, alertTs } = useLocalSearchParams<{ alertMsg?: string; alertPrompt?: string; alertTs?: string }>();
  const shownAlertTsRef = useRef<string | null>(null);
  const waitGate =
    !!account?.convexUserId && !caregiverSession && !isViewingLinkedPatient && profile?.accountRole === "adult";
  const pendingWait = useQuery(api.push.pendingEmergencyWait, waitGate ? {} : "skip");
  useEffect(() => {
    if (!alertTs || shownAlertTsRef.current === alertTs) return;
    if (waitGate && pendingWait === undefined) return; // wait-state still resolving — decide next render
    shownAlertTsRef.current = alertTs;
    if (pendingWait) return; // the "confirm you are okay" popup owns the screen — drop this one
    if (alertPrefs.alertToChatOnOpenEnabled === false) return; // toggle off → just land on Glucose
    const msg = typeof alertMsg === "string" && alertMsg ? alertMsg : "A glucose alert just fired.";
    const prompt = typeof alertPrompt === "string" ? alertPrompt : "";
    Alert.alert("Glucose Alert", msg, [
      { text: "Dismiss", style: "cancel" },
      {
        text: "Send to chat",
        onPress: () =>
          router.push({ pathname: "/(tabs)/chat", params: { prompt, fromParent: "true", fromNotification: "true" } }),
      },
    ]);
  }, [alertTs, alertMsg, alertPrompt, pendingWait, waitGate, alertPrefs.alertToChatOnOpenEnabled]);
  const [isSyncingCGM, setIsSyncingCGM] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** True while the chart's touch-hold reading cursor is engaged — freezes page scroll. */
  const [chartCursorActive, setChartCursorActive] = useState(false);
  // ── Popups opened from the glucose gauge: circle → recent readings, trend pill → insights ──
  const [recentReadingsVisible, setRecentReadingsVisible] = useState(false);
  const [insightsVisible, setInsightsVisible] = useState(false);

  // ── Log markers on the trend chart + the tapped log's detail popup — the SAME marker system,
  // detail modal, and edit gate the Log page uses (CGMChart renders and windows the icons itself,
  // so style/coloring match by construction). `foodLog`/`insulinLog` already serve the VIEWED
  // patient's pooled logs for a co-guardian / access code / nurse view, so no extra wiring. ──
  const { scheme: homeScheme } = useTheme();
  const modalColors = homeScheme === "dark" ? Colors.dark : Colors.light;
  const [homeSelectedLog, setHomeSelectedLog] = useState<SelectedLog | null>(null);
  const homeChartMarkers = useMemo<ChartEventMarker[]>(
    () => [
      ...(insulinLog ?? []).map((i) => ({ timestamp: i.timestamp, kind: "insulin" as const, id: i.id })),
      ...(foodLog ?? []).map((f) => ({ timestamp: f.timestamp, kind: "food" as const, id: f.id })),
    ],
    [insulinLog, foodLog],
  );
  const openHomeMarkerLog = useCallback(
    (marker: PositionedChartMarker) => {
      if (!marker.id) return;
      if (marker.kind === "insulin") {
        const hit = (insulinLog ?? []).find((i) => i.id === marker.id);
        if (hit) setHomeSelectedLog({ kind: "insulin", data: hit });
      } else {
        const hit = (foodLog ?? []).find((f) => f.id === marker.id);
        if (hit) setHomeSelectedLog({ kind: "food", data: hit });
      }
    },
    [insulinLog, foodLog],
  );
  // Same rule as the Log page — one definition, so the two surfaces can't drift.
  const canEditHomeLogs = canEditExistingLogs({
    isCaregiverAccount: profile?.accountRole === "caregiver",
    caregiverSession,
    accessCodeRole,
    canAddLogs: !!accessCodePermissions?.log,
  });
  // The Insulin screen only offers its Log tab when the session's grant allows it — the shortcut
  // button follows the same rule so it never lands somewhere it can't go.
  const canOpenLogsTab = accessCodeRole == null || !!accessCodePermissions?.log;
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
  // Per-reading local alerting (same model as the server pushes): each NEW reading alerts at most
  // once — the same reading never re-alerts, and no new readings means no new alerts.
  const lastAlertedReadingRef = useRef<string | null>(null);
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
    if (!isConnected || !account?.convexUserId) {
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
    if (!isConnected || !account?.convexUserId) {
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

  /**
   * Identities that only READ the glucose stream and don't own the sensor: email caregiver accounts
   * and every access-code session (caregiver codes + kid codes). They get no CGM connector chip and
   * no connection banners — a caregiver can't reconnect someone else's Dexcom/Libre account, so
   * those prompts are unactionable for them (and their tap target is a setup screen they shouldn't
   * reach). The patient's own guardian still sees them and can act.
   */
  const isCgmViewerOnly = profile?.accountRole === "caregiver" || caregiverSession;

  const libreBannerKind = isCgmViewerOnly
    ? null
    : bannerKindFromSyncStatus({
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
    const base = analyzeReadings(recent, targetGlucose, isMinor, foodLog ?? [], insulinLog ?? []);
    // Dose-tuning cards: when 2 weeks of logged doses consistently run above/below the calculator's
    // recommendations in a meal window, suggest a care-team settings review. The calculator already
    // shows the live "Pattern adjustment" for these — this card explains the WHY and the fix.
    const tuningCards: Suggestion[] = tuningSuggestions(
      computePatternTuning(insulinLog ?? [], Date.now()),
    ).map((t) => ({
      icon: "sliders",
      title: t.title,
      body: t.body,
      color: COLORS.primary,
      priority: 3,
      chatPrompt: `My logged insulin doses at ${t.bucket} have been running consistently different from the calculator's recommendations (${t.title.toLowerCase()}). What would you review with a care team — carb ratio or correction factor — and what questions should I ask?`,
      tag: "Dose settings",
    }));
    return [...base, ...tuningCards].sort((a, b) => a.priority - b.priority);
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
  const TAB_BAR_HEIGHT = 66; // the floating bar in (tabs)/_layout: border + padding + slot + icon + label
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
  // Guardian devices label freshness from their own sync state; caregiver/viewing sessions never
  // run a sync, so they fall back to the newest reading's age — same wording, updates as readings
  // stream in, and gives caregivers the "when did data last arrive" line guardians already have.
  /**
   * Age of the DATA, not of the last attempt.
   *
   * This preferred the sync timestamp, so a sync that ran and returned nothing — exactly what happens
   * when stored CGM credentials stop working — still printed "Updated just now" above a value reading
   * "--". It described our polling, which nobody cares about, and implied fresh data that did not
   * exist. When the newest reading is older than the staleness cutoff, the reading's own age is the
   * honest number; the sync time is only meaningful while data is actually arriving.
   */
  const newestReadingMs = latestReading ? new Date(latestReading.timestamp).getTime() : null;
  const readingIsStale =
    newestReadingMs == null || Date.now() - newestReadingMs > STALE_READING_LABEL_MS;
  const updatedLabel = (!readingIsStale && (lastSyncResult || lastSyncTime))
    ? `Updated ${formatLastSync(lastSyncResult?.at ?? lastSyncTime).toLowerCase()}`
    : latestReading
    ? `Updated ${formatLastSync(new Date(latestReading.timestamp)).toLowerCase()}`
    : "No readings yet";

  const performSync = useCallback(async (silent: boolean): Promise<PerformSyncOutcome> => {
    if (isSyncingRef.current || !cgmConnection.type) return { ok: false, manualAlert: null };
    // Convex is the single ingestion + cursor authority. The app requests an expedited canonical
    // sync and renders the canonical history Convex returns; it no longer calls Dexcom/Libre
    // directly, computes a backfill count, or refreshes provider sessions itself.
    if (!account?.convexUserId) {
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

        if (alertPrefs.notificationsEnabled && mostRecent.timestamp !== lastAlertedReadingRef.current) {
          // Alerts fire per NEW reading — the same reading never alerts twice, and when readings
          // stop arriving (sensor gap, lost connection) no new alerts fire at all. Each reading
          // triggers AT MOST one zone alert (bands are mutually exclusive — urgent low takes over
          // from Low entirely) plus at most one trend alert.
          lastAlertedReadingRef.current = mostRecent.timestamp;
          const g = mostRecent.glucose;
          const kind = classifyGlucose(g, {
            urgentLowThreshold: alertPrefs.urgentLowThreshold,
            lowThreshold: alertPrefs.lowThreshold,
            highThreshold: alertPrefs.highThreshold,
            urgentHighThreshold: alertPrefs.urgentHighThreshold,
          });
          const trendInfo = mostRecent.dexcomTrend != null
            ? mapDexcomTrend(mostRecent.dexcomTrend)
            : trendFromDiff(
                entries.length >= 2
                  ? entries[entries.length - 1].glucose - entries[entries.length - 2].glucose
                  : 0,
              );

          if (kind) {
            const status =
              kind === "urgent_low" ? "critically_low" : kind === "low" ? "low" : kind === "urgent_high" ? "critically_high" : "high";
            scheduleGlucoseAlert({
              childName: profile?.childName ?? "Child",
              glucose: g,
              status,
              trendLabel: trendInfo.label,
            }).catch(() => {});
          }
          if (isFastTrend(trendInfo)) {
            scheduleTrendAlert({
              childName: profile?.childName ?? "Child",
              glucose: g,
              direction: trendInfo.glucoseTrend === "rapidly_rising" ? "rise" : "fall",
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

      /**
       * "unauthorized" is the APP failing to authenticate — a dead Clerk session — NOT the CGM.
       * The server stamps it with the generic invalid_credentials category, and treating that at
       * face value produced the worst support loop this app has had: the banner said the DEXCOM
       * password was wrong, the alert routed to /cgm-setup, the user re-entered perfectly valid
       * credentials, and the save silently failed on the same dead session. Meanwhile the server
       * cron kept ingesting fine the whole time. The ONLY fix is signing back in, so that is the
       * only thing this path may suggest. The stored category is substituted for the same reason:
       * syncStatus outlives this call and drives the banner.
       */
      if (result.status === "unauthorized") {
        setSyncStatus({
          diagnosticCategory: "app_unauthorized",
          messageKey: "cgm.diagnostic.app_unauthorized",
          reconnectRequired: false,
          hasStoredCredentials: true,
        });
        const appMsg = cgmDiagnosticMessage("cgm.diagnostic.app_unauthorized", cgmConnection.type);
        setLastSyncResult({ status: "app_signin", at: now, message: appMsg });
        if (!silent && !isCgmViewerOnly) {
          return {
            ok: false,
            manualAlert: {
              title: "Sign in to keep syncing",
              message: appMsg,
              buttons: [
                { text: "Sign in", onPress: () => { void signOut().then(() => router.replace("/auth")); } },
                { text: "Later", style: "cancel" },
              ],
            },
          };
        }
        return { ok: false, manualAlert: null };
      }

      if (
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
        // Same rule as the banner/chip: a caregiver or kid can't reconnect a sensor they don't
        // own, so don't hand them a "Reconnect" prompt that leads to a setup screen for them.
        if (!silent && !isCgmViewerOnly) {
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
        const msg = cgmDiagnosticMessage(result.messageKey, cgmConnection.type);
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
        const msg = cgmDiagnosticMessage(result.messageKey, cgmConnection.type);
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
  }, [cgmConnection.type, deviceLabel, account?.convexUserId, account?.passwordHash, bulkAddReadings, alertPrefs, profile?.childName, notifyCgmSyncSuccess, isCgmViewerOnly]);

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

  // The notices under the chart. Each condition is exactly what gated the old banner it replaces.
  const showCgmNotice = !sessionExpired && !!libreBannerKind && libreBannerKind !== "backup_missing" && !!libreBannerMessage;
  const showTrendNotice = (glucoseTrend === "rapidly_falling" || glucoseTrend === "rapidly_rising") && history.length > 1;
  const showAnomalyNotice = !!latestReading?.anomaly.warning;
  const showEmergencyNotice =
    !!latestReading && alertPrefs.emergencyAlertsEnabled && alertPrefs.oneTapTextEnabled === true &&
    !caregiverSession && !isViewingLinkedPatient && emergencyContacts.length > 0 &&
    (latestReading.glucose < alertPrefs.lowThreshold || latestReading.glucose > alertPrefs.highThreshold);
  const hasNotices = sessionExpired || showCgmNotice || showTrendNotice || showAnomalyNotice || showEmergencyNotice;

  return (
    <View style={[styles.root, { backgroundColor: c.screen }]}>
      {/* Background shading — see components/Shade; the root keeps its own opaque color beneath. */}
      <ScreenShade />
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
              device owns the sensor; the co-guardian just reads the stream), and hidden for every
              caregiver/kid identity (email caregiver accounts + all access-code sessions): they
              don't own the sensor, so connecting one isn't theirs to do. Hiding it also hands the
              full header width back to the title, which for caregivers is the longer
              "<name>'s Caregiver" and would otherwise wrap to a second line. */}
          {!isViewingLinkedPatient && !isCgmViewerOnly && (
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
            {isConnected && <TintShade color={T.color.emerald} radius={18} />}
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

        {/* ── The glucose card. Gauge on top, trend chart beneath it, and every notice this page shows
            stacked under the chart as inset rows — ONE Surface where there used to be two (summary +
            chart), so the page reads as a single instrument instead of a stack of panels. The notices
            used to sit above the gauge and between the two cards; their text and handlers are
            unchanged, only where they live and the row format (see HomeNotice). ── */}
        <Surface style={styles.section} padding={0}>
          {latestReading ? (
            <View
              // Height is LOCKED to what the 15%-larger gauge needed, and the content centers inside
              // it — the circle reverted to its original size but the window must not shrink.
              style={[
                styles.gaugeBlock,
                {
                  padding: Math.round(T.space.xl * padScale),
                  minHeight: Math.round(172 * 1.15 * padScale) + Math.round(T.space.xl * padScale) * 2,
                },
              ]}
            >
              <GlucoseGauge
                value={displayGlucose}
                // Circle + its contents at original size; arrow + colored trend pill keep the +25%;
                // the grey "Trend"/"Updated…" lines revert to original via mutedTextScale.
                size={Math.round(172 * padScale)}
                contentScale={1.25 * padScale}
                mutedTextScale={padScale}
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
              {canOpenLogsTab && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open the logs page"
                  hitSlop={8}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    // `t` is a nonce so a second tap re-triggers the insulin screen's param effect
                    // even though expo-router keeps the previous params around.
                    router.push({ pathname: "/(tabs)/insulin", params: { tab: "log", t: String(Date.now()) } });
                  }}
                  style={({ pressed }) => [styles.logsShortcut, { backgroundColor: c.cardElevated, borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  {/* Control fill + shade, like the other secondary buttons and chips. */}
                  <ControlShade radius={8} />
                  <Feather name="list" size={11} color={c.textSecondary} />
                  <Text style={[styles.logsShortcutText, { color: c.textSecondary }]}>Logs</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={[styles.gaugeBlock, { padding: T.space.lg }]}>
              <View style={styles.emptyGauge}>
                <Feather name="activity" size={30} color={c.textMuted} />
                <Text style={[styles.emptyGaugeText, { color: c.textPrimary }]}>No readings yet</Text>
                <Text style={[styles.emptyGaugeSub, { color: c.textSecondary }]}>
                  {isConnected ? "Pull down to sync your CGM" : "Connect a CGM to start monitoring"}
                </Text>
              </View>
            </View>
          )}

          {/* No top padding and no divider on the chart block: the gauge block above already ends with
              its own padding, so the range toggle sits directly beneath the gauge and the two halves
              read as one surface. */}
          {history.length > 1 && (
            <View style={{ paddingHorizontal: Math.round(T.space.lg * padScale), paddingBottom: Math.round(T.space.lg * padScale) }}>
              <CGMChart
                readings={history}
                targetGlucose={targetGlucose}
                chartHeight={Math.round(264 * padScale)}
                paddingHorizontal={34}
                urgentLowThreshold={alertPrefs.urgentLowThreshold}
                lowThreshold={alertPrefs.lowThreshold}
                highThreshold={alertPrefs.highThreshold}
                urgentHighThreshold={alertPrefs.urgentHighThreshold}
                onCursorActiveChange={setChartCursorActive}
                eventMarkers={homeChartMarkers}
                onEventMarkerPress={openHomeMarkerLog}
                // 8pt either side of the digits, measured against the WINDOW edge: the chart borrows the
                // rest of the card's side padding so the plot can grow into it.
                axisGap={Math.round(8 * padScale)}
                hostPaddingRight={Math.round(T.space.lg * padScale)}
              />
            </View>
          )}

          {hasNotices && (
            <View style={[styles.noticeList, { paddingHorizontal: Math.round(T.space.lg * padScale), paddingBottom: Math.round(T.space.lg * padScale) }]}>
              {/* The copy deliberately does NOT name a cause — `sessionExpired` only observes that Clerk
                  reports signed-out while we believe otherwise, and a failed cold-start fetch looks
                  identical to a real expiry. Describe the OBSERVABLE state and the remedy only. */}
              {sessionExpired && (
                <HomeNotice
                  icon="alert-circle"
                  color={T.color.coral}
                  title="Sign in to keep syncing"
                  message="This device lost its connection to your account. Readings won't update until you sign in."
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Alert.alert(
                      "Sign in to keep syncing",
                      "This device lost its connection to your account. Your data is safe and nothing has been lost \u2014 but readings won't update and changes won't save until you sign in again.",
                      [
                        { text: "Later", style: "cancel" },
                        { text: "Sign in", onPress: () => { void signOut().then(() => router.replace("/auth")); } },
                      ],
                    );
                  }}
                />
              )}

              {showCgmNotice && libreBannerKind && libreBannerMessage && (
                <HomeNotice
                  icon={libreBannerKind === "connected_no_data" ? "check-circle" : libreBannerKind === "app_auth" ? "alert-circle" : "info"}
                  color={libreBannerKind === "connected_no_data" ? T.color.emerald : libreBannerKind === "app_auth" ? T.color.coral : T.color.amber}
                  // The first three states are LibreLinkUp-only (see bannerKindFromSyncStatus); the rest
                  // can happen on either service, so they name the connected one.
                  title={
                    libreBannerKind === "no_shared_patient"
                      ? "No shared Libre patient"
                      : libreBannerKind === "connected_no_data"
                        ? "Libre connected — no readings yet"
                        : libreBannerKind === "sharing_not_enabled"
                          ? "LibreLinkUp sharing required"
                          : libreBannerKind === "provider_unavailable"
                            ? `${deviceLabel} temporarily unavailable`
                            : libreBannerKind === "app_auth"
                              ? "Sign in to keep syncing"
                              : `${deviceLabel} reconnect needed`
                  }
                  message={libreBannerMessage}
                  chevron={libreBannerKind === "reconnect_required" || libreBannerKind === "sharing_not_enabled" || libreBannerKind === "app_auth"}
                  onPress={() => {
                    if (libreBannerKind === "app_auth") {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      Alert.alert("Sign in to keep syncing", libreBannerMessage ?? "", [
                        { text: "Later", style: "cancel" },
                        { text: "Sign in", onPress: () => { void signOut().then(() => router.replace("/auth")); } },
                      ]);
                      return;
                    }
                    if (libreBannerKind === "reconnect_required" || libreBannerKind === "sharing_not_enabled") {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push("/cgm-setup");
                    }
                  }}
                />
              )}

              {showTrendNotice && (glucoseTrend === "rapidly_falling" || glucoseTrend === "rapidly_rising") && (
                <TrendAlertBanner trend={glucoseTrend} glucose={displayGlucose} />
              )}

              {latestReading?.anomaly.warning && (
                <HomeNotice icon="alert-triangle" color={T.color.coral} message={latestReading.anomaly.message} />
              )}

              {/* One-tap SMS: MAIN accounts only (never code sessions or borrowed views), and only once
                  the account has turned the one-tap text feature on in Emergency settings. */}
              {showEmergencyNotice && latestReading && (
                <HomeNotice
                  icon="phone-call"
                  color={T.color.coral}
                  title="Emergency Alert Ready"
                  message={`Glucose is ${latestReading.glucose < alertPrefs.lowThreshold ? "critically low" : "critically high"} — tap to alert your emergency contact${emergencyContacts.length > 1 ? "s" : ""}.`}
                >
                  <View style={styles.emergencyList}>
                    {/* One-tap target chosen in Emergency Contacts → show ONLY that contact's button;
                        with none chosen, every contact keeps a button (legacy behavior). */}
                    {(emergencyContacts.some((c) => c.primary)
                      ? emergencyContacts.filter((c) => c.primary)
                      : emergencyContacts
                    ).map((c) => (
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
                </HomeNotice>
              )}
            </View>
          )}
        </Surface>

      </Animated.ScrollView>

      {/* Tapped chart marker → the same log detail popup (view / edit / delete) as the Log page. */}
      {homeSelectedLog && (
        <LogDetailModal
          key={homeSelectedLog.data.id}
          entry={homeSelectedLog}
          colors={modalColors}
          canEdit={canEditHomeLogs}
          onClose={() => setHomeSelectedLog(null)}
        />
      )}

      {/* ── Recent Readings popup — opened by tapping inside the gauge circle ── */}
      <DashboardSectionModal
        visible={recentReadingsVisible}
        onClose={() => setRecentReadingsVisible(false)}
        accessibilityLabel="Recent readings"
      >
        <View style={[styles.popupCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <CardShade radius={16} />
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
          <CardShade radius={16} />
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
  // iPad: cap + center the content column so it doesn't stretch across a 13" screen. No-op on phones.
  scroll: { paddingHorizontal: T.space.xl, width: "100%", maxWidth: T.layout.contentMaxWidth, alignSelf: "center" },
  // The pull-to-sync hint that used to sit under the header is gone; this margin is now the only
  // space between the header and the glucose card, so it carries the breathing room itself.
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: T.space.md },
  headerText: { flex: 1 },
  /** Centered pull-to-sync helper row above the glucose summary card (page-centered, own row). */
  viewingBanner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, marginBottom: T.space.md },
  viewingBannerText: { flex: 1, fontSize: 13, fontWeight: T.font.medium },
  viewingBannerExit: { fontSize: 13, fontWeight: T.font.bold },
  /** The combined glucose card's gauge block — see the JSX for why it's one Surface now. */
  gaugeBlock: { justifyContent: "center" },
  noticeList: { gap: T.space.sm },
  /** Inset notice row — the one format every alert on this page shares (see HomeNotice). */
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: T.radius.control,
    borderWidth: 1,
  },
  noticeIcon: { width: 26, alignItems: "center", justifyContent: "center" },
  noticeBody: { flex: 1, gap: 2 },
  noticeTitle: { fontSize: 15, fontWeight: T.font.semibold },
  noticeMessage: { fontSize: 13, fontWeight: T.font.regular, lineHeight: 18 },
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
  bannerTitle: { fontSize: 13, fontWeight: T.font.bold, marginBottom: 2 },
  bannerMessage: { fontSize: 12, fontWeight: T.font.regular, lineHeight: 17 },

  /** Tiny top-right shortcut on the glucose card — quiet outline pill, muted like the card's
      secondary text, absolute so the centered gauge layout is untouched. */
  logsShortcut: {
    position: "absolute", right: 12, top: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
  logsShortcutText: { fontSize: 11, fontWeight: "600" },
  emptyGauge: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyGaugeText: { fontSize: 16, fontWeight: T.font.semibold },
  emptyGaugeSub: { fontSize: 12.5, fontWeight: T.font.regular, textAlign: "center" },

  emergencyList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emergencyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  emergencyBtnText: { fontSize: 13, fontWeight: T.font.semibold, color: "#fff" },
});
