import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { ReadingCard } from "@/components/ReadingCard";
import { TrendChart } from "@/components/TrendChart";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

async function simulateGlucoseReading(
  prevGlucose: number | null
): Promise<{ current: number; anomaly: { warning: boolean; message?: string }; timestamp: string }> {
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { history, latestReading, addReading } = useGlucose();
  const [isSimulating, setIsSimulating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const displayGlucose = latestReading?.glucose ?? 0;
  const recentHistory = [...history].reverse().slice(0, 10);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  async function handleSimulate() {
    if (isSimulating) return;
    setIsSimulating(true);
    try {
      const prev = latestReading?.glucose ?? null;
      const data = await simulateGlucoseReading(prev);
      addReading({
        glucose: data.current,
        timestamp: data.timestamp,
        anomaly: data.anomaly,
      });
      if (data.anomaly.warning) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        if (data.anomaly.message) {
          Alert.alert("Heads Up!", data.anomaly.message, [{ text: "Got it" }]);
        }
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      Alert.alert("Error", "Could not get reading. Check your connection.");
    } finally {
      setIsSimulating(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await handleSimulate();
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
            <Text style={[styles.title, { color: colors.text }]}>
              Gluco Guardian
            </Text>
          </View>
          <View
            style={[styles.headerIcon, { backgroundColor: colors.backgroundTertiary }]}
          >
            <Feather name="shield" size={22} color={COLORS.primary} />
          </View>
        </View>

        <View style={styles.gaugeSection}>
          {latestReading ? (
            <GlucoseGauge value={displayGlucose} size={200} />
          ) : (
            <View
              style={[
                styles.emptyGaugeBox,
                {
                  backgroundColor: colors.backgroundTertiary,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="activity" size={32} color={colors.textMuted} />
              <Text style={[styles.emptyGaugeText, { color: colors.text }]}>
                No readings yet
              </Text>
              <Text style={[styles.emptyGaugeSub, { color: colors.textSecondary }]}>
                Tap "Simulate Reading" to take your first glucose reading
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
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.simulateBtn,
            {
              backgroundColor: COLORS.primary,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
          onPress={handleSimulate}
          disabled={isSimulating}
        >
          {isSimulating ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Feather name="activity" size={20} color="#fff" />
          )}
          <Text style={styles.simulateBtnText}>
            {isSimulating ? "Reading..." : "Simulate Reading"}
          </Text>
        </Pressable>

        {history.length > 1 && (
          <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Trend
            </Text>
            <TrendChart readings={history} height={110} />
          </View>
        )}

        <View style={styles.historySection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Recent Readings
          </Text>
          {recentHistory.length === 0 ? (
            <View style={[styles.emptyList, { backgroundColor: colors.backgroundTertiary }]}>
              <Feather name="clipboard" size={24} color={colors.textMuted} />
              <Text style={[styles.emptyListText, { color: colors.textMuted }]}>
                No readings yet. Simulate your first one above!
              </Text>
            </View>
          ) : (
            recentHistory.map((entry, i) => (
              <ReadingCard key={i} entry={entry} />
            ))
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
  greeting: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  gaugeSection: {
    alignItems: "center",
    marginBottom: 24,
    gap: 14,
  },
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
  emptyGaugeText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
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
  anomalyText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  simulateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  simulateBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  chartCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
    gap: 12,
  },
  historySection: { gap: 0 },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 12,
  },
  emptyList: {
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyListText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
