import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
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

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

interface InsulinResult {
  insulin: number;
  mealDose: number;
  correctionDose: number;
}

export default function InsulinScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { carbRatio, targetGlucose, correctionFactor, latestReading } =
    useGlucose();

  const [carbs, setCarbs] = useState("");
  const [currentGlucose, setCurrentGlucose] = useState(
    latestReading ? String(latestReading.glucose) : ""
  );
  const [result, setResult] = useState<InsulinResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  async function calculate() {
    const carbsNum = parseFloat(carbs);
    if (!carbs || isNaN(carbsNum) || carbsNum <= 0) {
      setError("Enter a valid carb amount.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const body: Record<string, number> = {
        carbs: carbsNum,
        ratio: carbRatio,
      };
      const cgNum = parseFloat(currentGlucose);
      if (currentGlucose && !isNaN(cgNum)) {
        body.currentGlucose = cgNum;
        body.targetGlucose = targetGlucose;
        body.correctionFactor = correctionFactor;
      }
      const res = await fetch(`${BASE_URL}/api/insulin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: InsulinResult = await res.json();
      setResult(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError("Could not calculate. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }

  function reset() {
    setCarbs("");
    setCurrentGlucose(latestReading ? String(latestReading.glucose) : "");
    setResult(null);
    setError("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

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
        <Text style={[styles.pageTitle, { color: colors.text }]}>
          Insulin Calculator
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Get a dose estimate based on your carb intake
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text }]}>
            Carbohydrates (g)
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundTertiary,
                color: colors.text,
                borderColor: error ? COLORS.danger : colors.border,
              },
            ]}
            value={carbs}
            onChangeText={setCarbs}
            placeholder="e.g. 45"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="next"
          />
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <Text style={[styles.label, { color: colors.text, marginTop: 16 }]}>
            Current Glucose (mg/dL){" "}
            <Text style={[styles.optional, { color: colors.textMuted }]}>
              optional
            </Text>
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundTertiary,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
            value={currentGlucose}
            onChangeText={setCurrentGlucose}
            placeholder="e.g. 150"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            returnKeyType="done"
            onSubmitEditing={calculate}
          />

          <View style={[styles.settingsRow, { borderTopColor: colors.separator }]}>
            <SettingPill label="Carb Ratio" value={`1:${carbRatio}`} />
            <SettingPill label="Target" value={`${targetGlucose} mg/dL`} />
            <SettingPill label="ISF" value={`1:${correctionFactor}`} />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.calcBtn,
            {
              backgroundColor: COLORS.primary,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
          onPress={calculate}
          disabled={isLoading}
        >
          <Text style={styles.calcBtnText}>
            {isLoading ? "Calculating..." : "Calculate Dose"}
          </Text>
        </Pressable>

        {result && (
          <View
            style={[
              styles.resultCard,
              { backgroundColor: COLORS.primary + "14", borderColor: COLORS.primary + "40" },
            ]}
          >
            <View style={styles.resultHeader}>
              <Feather name="check-circle" size={20} color={COLORS.primary} />
              <Text style={[styles.resultTitle, { color: colors.text }]}>
                Recommended Dose
              </Text>
              <Pressable onPress={reset} hitSlop={8}>
                <Feather name="x" size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            <Text style={[styles.totalDose, { color: COLORS.primary }]}>
              {result.insulin}
              <Text style={styles.doseUnit}> units</Text>
            </Text>

            <View style={styles.breakdown}>
              <BreakdownRow
                label="Meal dose"
                value={`${result.mealDose}u`}
                color={COLORS.primary}
                colors={colors}
              />
              {result.correctionDose > 0 && (
                <BreakdownRow
                  label="Correction dose"
                  value={`+${result.correctionDose}u`}
                  color={COLORS.warning}
                  colors={colors}
                />
              )}
            </View>

            <View style={[styles.disclaimer, { backgroundColor: COLORS.warningLight }]}>
              <Feather name="alert-circle" size={14} color={COLORS.warning} />
              <Text style={[styles.disclaimerText, { color: "#92400E" }]}>
                Always verify doses with your care team. This is an estimate only.
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SettingPill({ label, value }: { label: string; value: string }) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  return (
    <View style={[styles.pill, { backgroundColor: colors.backgroundTertiary }]}>
      <Text style={[styles.pillLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.pillValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

function BreakdownRow({
  label,
  value,
  color,
  colors,
}: {
  label: string;
  value: string;
  color: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={styles.breakdownRow}>
      <View style={[styles.breakdownDot, { backgroundColor: color }]} />
      <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.breakdownValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  pageTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 24,
    lineHeight: 22,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  optional: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
  },
  settingsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  pill: {
    flex: 1,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
  },
  pillLabel: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    marginBottom: 2,
  },
  pillValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  calcBtn: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 20,
  },
  calcBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  resultCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  totalDose: {
    fontSize: 52,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 60,
  },
  doseUnit: {
    fontSize: 22,
    fontFamily: "Inter_500Medium",
  },
  breakdown: { gap: 8 },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  breakdownValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginTop: 4,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
