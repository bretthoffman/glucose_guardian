import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlucoseGauge } from "@/components/GlucoseGauge";
import type { GlucoseTrend } from "@/components/GlucoseGauge";
import { ReadingCard } from "@/components/ReadingCard";
import { CGMChart } from "@/components/CGMChart";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";
import { useAuth } from "@/context/AuthContext";

const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

async function simulateGlucoseReading(prevGlucose: number | null) {
  let newGlucose: number;
  if (prevGlucose !== null) {
    const delta = (Math.random() - 0.45) * 30;
    newGlucose = Math.max(40, Math.min(350, Math.round(prevGlucose + delta)));
  } else {
    newGlucose = Math.floor(Math.random() * 100) + 90;
  }
  const res = await fetch(`${BASE_URL}/api/glucose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ glucose: newGlucose }),
  });
  return res.json();
}

function formatLastSync(date: Date | null): string {
  if (!date) return "";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { history, latestReading, addReading, bulkAddReadings, targetGlucose } = useGlucose();
  const { profile, cgmConnection, emergencyContacts, alertPrefs } = useAuth();
  const [isSimulating, setIsSimulating] = useState(false);
  const [isSyncingCGM, setIsSyncingCGM] = useState(false);
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [cgmLatestReading, setCgmLatestReading] = useState<{ glucose: number; timestamp: string } | null>(null);
  const [, forceUpdate] = useState(0);
  const autoSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncingRef = useRef(false);

  const displayGlucose = isConnected && cgmLatestReading
    ? cgmLatestReading.glucose
    : latestReading?.glucose ?? 0;
  const recentHistory = [...history].reverse().slice(0, 10);

  const glucoseTrend: GlucoseTrend | undefined = (() => {
    if (history.length < 2) return undefined;
    const last = history[history.length - 1].glucose;
    const prev = history[history.length - 2].glucose;
    const diff = last - prev;
    if (diff > 30) return "rapidly_rising";
    if (diff > 15) return "rising";
    if (diff < -30) return "rapidly_falling";
    if (diff < -15) return "falling";
    return "stable";
  })();

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const childName = profile?.childName ?? "Gluco Guardian";
  const isConnected = !!cgmConnection.type;

  const performSync = useCallback(async (silent: boolean) => {
    if (isSyncingRef.current || !cgmConnection.type) return false;
    isSyncingRef.current = true;
    if (silent) {
      setIsAutoSyncing(true);
    } else {
      setIsSyncingCGM(true);
    }
    try {
      const endpoint =
        cgmConnection.type === "dexcom" ? "/api/cgm/dexcom/readings" : "/api/cgm/libre/readings";
      const body =
        cgmConnection.type === "dexcom"
          ? { sessionId: cgmConnection.sessionId, outsideUS: cgmConnection.outsideUS, count: 5 }
          : { token: cgmConnection.token };

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        if (!silent) {
          const err = await res.json();
          Alert.alert(
            "Sync Failed",
            err.error || "Could not fetch CGM readings.",
            [
              { text: "Reconnect", onPress: () => router.push("/cgm-setup") },
              { text: "OK", style: "cancel" },
            ]
          );
        }
        return false;
      }

      const data = await res.json();
      const readings: any[] = data.readings ?? [];
      const entries = readings.map((r) => ({
        glucose: r.glucose,
        timestamp: r.timestamp,
        anomaly: r.anomaly,
      }));
      bulkAddReadings(entries);
      if (entries.length > 0) {
        const mostRecent = entries[entries.length - 1];
        setCgmLatestReading({ glucose: mostRecent.glucose, timestamp: mostRecent.timestamp });
      }
      if (readings.length > 0) {
        setLastSyncTime(new Date());
        if (!silent) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert(
            "Synced!",
            `${readings.length} readings imported from ${cgmConnection.type === "dexcom" ? "Dexcom" : "FreeStyle Libre"}.`
          );
        }
      }
      return true;
    } catch {
      if (!silent) {
        Alert.alert("Error", "Could not sync CGM. Check your connection.");
      }
      return false;
    } finally {
      isSyncingRef.current = false;
      setIsSyncingCGM(false);
      setIsAutoSyncing(false);
    }
  }, [cgmConnection, bulkAddReadings, setCgmLatestReading]);

  useEffect(() => {
    if (!isConnected) return;

    performSync(true);

    autoSyncTimerRef.current = setInterval(() => {
      performSync(true);
      forceUpdate((n) => n + 1);
    }, AUTO_SYNC_INTERVAL_MS);

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        performSync(true);
        forceUpdate((n) => n + 1);
      }
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

  async function handleSimulate() {
    if (isSimulating) return;
    setIsSimulating(true);
    try {
      const prev = latestReading?.glucose ?? null;
      const data = await simulateGlucoseReading(prev);
      addReading({ glucose: data.current, timestamp: data.timestamp, anomaly: data.anomaly });
      if (data.anomaly.warning) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (data.anomaly.message) {
          Alert.alert("Heads Up!", data.anomaly.message, [{ text: "Got it" }]);
        }
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      Alert.alert("Error", "Could not get reading. Check your connection.");
    } finally {
      setIsSimulating(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    if (isConnected) {
      await syncCGM();
    } else {
      await handleSimulate();
    }
    setRefreshing(false);
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPadding + 12, paddingBottom: 120 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: colors.textSecondary }]}>
              Good {getTimeOfDay()}
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>{childName}</Text>
          </View>
          <Pressable
            onPress={() => router.push("/cgm-setup")}
            style={[
              styles.cgmButton,
              {
                backgroundColor: isConnected
                  ? COLORS.success + "20"
                  : colors.backgroundTertiary,
                borderWidth: 1,
                borderColor: isConnected ? COLORS.success + "50" : colors.border,
              },
            ]}
          >
            {isAutoSyncing ? (
              <ActivityIndicator size={12} color={COLORS.success} />
            ) : (
              <View style={[styles.liveDot, { backgroundColor: isConnected ? COLORS.success : colors.textMuted }]} />
            )}
            <View>
              <Text
                style={[
                  styles.cgmButtonText,
                  { color: isConnected ? COLORS.success : colors.textMuted },
                ]}
              >
                {isConnected
                  ? cgmConnection.type === "dexcom"
                    ? "Dexcom"
                    : "Libre"
                  : "Connect CGM"}
              </Text>
              {isConnected && lastSyncTime && (
                <Text style={[styles.lastSyncText, { color: COLORS.success + "99" }]}>
                  {formatLastSync(lastSyncTime)}
                </Text>
              )}
            </View>
          </Pressable>
        </View>

        <View style={styles.gaugeSection}>
          {latestReading ? (
            <GlucoseGauge value={displayGlucose} size={200} trend={glucoseTrend} />
          ) : (
            <View
              style={[
                styles.emptyGaugeBox,
                { backgroundColor: colors.backgroundTertiary, borderColor: colors.border },
              ]}
            >
              <Feather name="activity" size={32} color={colors.textMuted} />
              <Text style={[styles.emptyGaugeText, { color: colors.text }]}>No readings yet</Text>
              <Text style={[styles.emptyGaugeSub, { color: colors.textSecondary }]}>
                {isConnected ? "Pull down to sync CGM" : 'Tap "Simulate Reading" or connect a CGM'}
              </Text>
            </View>
          )}

          {latestReading?.anomaly.warning && (
            <View style={[styles.anomalyBanner, { backgroundColor: COLORS.dangerLight }]}>
              <Feather name="alert-triangle" size={16} color={COLORS.danger} />
              <Text style={[styles.anomalyText, { color: COLORS.danger }]}>
                {latestReading.anomaly.message}
              </Text>
            </View>
          )}

          {latestReading && alertPrefs.emergencyAlertsEnabled && emergencyContacts.length > 0 &&
            (latestReading.glucose < alertPrefs.lowThreshold || latestReading.glucose > alertPrefs.highThreshold) && (
              <View style={[styles.emergencyBanner, { backgroundColor: COLORS.danger + "12", borderColor: COLORS.danger + "40" }]}>
                <View style={styles.emergencyBannerTop}>
                  <Feather name="phone-call" size={15} color={COLORS.danger} />
                  <Text style={[styles.emergencyBannerTitle, { color: COLORS.danger }]}>Emergency Alert Ready</Text>
                </View>
                <Text style={[styles.emergencyBannerSub, { color: colors.textSecondary }]}>
                  Glucose is {latestReading.glucose < alertPrefs.lowThreshold ? "critically low" : "critically high"} — tap to alert your emergency contact{emergencyContacts.length > 1 ? "s" : ""}.
                </Text>
                <View style={styles.emergencyContactList}>
                  {emergencyContacts.map((c) => (
                    <Pressable
                      key={c.id}
                      style={({ pressed }) => [
                        styles.emergencyContactBtn,
                        { backgroundColor: COLORS.danger, opacity: pressed ? 0.85 : 1 },
                      ]}
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
                      <Text style={styles.emergencyContactBtnText}>Alert {c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
        </View>

        <View style={styles.actionRow}>
          {isConnected ? (
            <Pressable
              style={({ pressed }) => [
                styles.syncBtn,
                { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1, flex: 1 },
              ]}
              onPress={syncCGM}
              disabled={isSyncingCGM || isAutoSyncing}
            >
              {isSyncingCGM || isAutoSyncing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Feather name="refresh-cw" size={18} color="#fff" />
              )}
              <View style={{ alignItems: "flex-start" }}>
                <Text style={styles.actionBtnText}>
                  {isSyncingCGM || isAutoSyncing ? "Syncing..." : "Sync Now"}
                </Text>
                <Text style={styles.syncSubText}>Auto every 5 min</Text>
              </View>
            </Pressable>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.simulateBtn,
              {
                backgroundColor: isConnected ? colors.card : COLORS.primary,
                borderColor: isConnected ? colors.border : "transparent",
                borderWidth: isConnected ? 1 : 0,
                opacity: pressed ? 0.85 : 1,
                flex: isConnected ? undefined : 1,
              },
            ]}
            onPress={handleSimulate}
            disabled={isSimulating}
          >
            {isSimulating ? (
              <ActivityIndicator
                color={isConnected ? COLORS.primary : "#fff"}
                size="small"
              />
            ) : (
              <Feather
                name="activity"
                size={18}
                color={isConnected ? COLORS.primary : "#fff"}
              />
            )}
            <Text
              style={[
                styles.actionBtnText,
                { color: isConnected ? COLORS.primary : "#fff" },
              ]}
            >
              {isSimulating ? "Reading..." : "Simulate"}
            </Text>
          </Pressable>
        </View>

        {history.length > 1 && (
          <View style={[styles.cgmCard, { backgroundColor: isDark ? "#0D1526" : "#0F172A" }]}>
            <CGMChart
              readings={history}
              targetGlucose={targetGlucose}
              chartHeight={260}
              paddingHorizontal={34}
            />
          </View>
        )}

        <View style={styles.historySection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Readings</Text>
          {recentHistory.length === 0 ? (
            <View
              style={[styles.emptyList, { backgroundColor: colors.backgroundTertiary }]}
            >
              <Feather name="clipboard" size={24} color={colors.textMuted} />
              <Text style={[styles.emptyListText, { color: colors.textMuted }]}>
                {isConnected
                  ? "Pull down to sync readings from your CGM"
                  : "No readings yet. Simulate your first one above!"}
              </Text>
            </View>
          ) : (
            recentHistory.map((entry, i) => <ReadingCard key={i} entry={entry} />)
          )}
        </View>
      </ScrollView>
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
  scroll: { paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  greeting: { fontSize: 14, fontFamily: "Inter_400Regular" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 2 },
  cgmButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  cgmButtonText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  lastSyncText: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  syncSubText: { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 1 },
  gaugeSection: { alignItems: "center", marginBottom: 24, gap: 14 },
  emptyGaugeBox: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
  },
  emptyGaugeText: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptyGaugeSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 16,
  },
  anomalyBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    width: "100%",
  },
  anomalyText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 24 },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  simulateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
  },
  actionBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  chartCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 24, gap: 12 },
  cgmCard: { borderRadius: 18, overflow: "hidden", marginBottom: 20, padding: 14, paddingBottom: 10 },
  historySection: { gap: 0 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 12 },
  emptyList: { borderRadius: 14, padding: 24, alignItems: "center", gap: 10 },
  emptyListText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  emergencyBanner: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  emergencyBannerTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  emergencyBannerTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  emergencyBannerSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  emergencyContactList: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  emergencyContactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  emergencyContactBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
