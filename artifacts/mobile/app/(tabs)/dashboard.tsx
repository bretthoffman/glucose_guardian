import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Alert,
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
import { TrendChart } from "@/components/TrendChart";
import Colors, { COLORS } from "@/constants/colors";
import { useGlucose } from "@/context/GlucoseContext";

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const {
    history,
    clearHistory,
    carbRatio,
    targetGlucose,
    correctionFactor,
    setCarbRatio,
    setTargetGlucose,
    setCorrectionFactor,
  } = useGlucose();

  const [editing, setEditing] = useState(false);
  const [editCarbRatio, setEditCarbRatio] = useState(String(carbRatio));
  const [editTarget, setEditTarget] = useState(String(targetGlucose));
  const [editISF, setEditISF] = useState(String(correctionFactor));

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const values = history.map((h) => h.glucose);
  const inRange = history.filter((h) => h.glucose >= 80 && h.glucose <= 180).length;
  const avgGlucose =
    values.length > 0
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : 0;
  const minGlucose = values.length > 0 ? Math.min(...values) : 0;
  const maxGlucose = values.length > 0 ? Math.max(...values) : 0;
  const inRangePercent =
    history.length > 0 ? Math.round((inRange / history.length) * 100) : 0;
  const anomalyCount = history.filter((h) => h.anomaly.warning).length;

  function saveSettings() {
    const cr = parseFloat(editCarbRatio);
    const tg = parseFloat(editTarget);
    const isf = parseFloat(editISF);
    if (isNaN(cr) || cr <= 0 || isNaN(tg) || tg <= 0 || isNaN(isf) || isf <= 0) {
      Alert.alert("Invalid Values", "Please enter valid positive numbers.");
      return;
    }
    setCarbRatio(cr);
    setTargetGlucose(tg);
    setCorrectionFactor(isf);
    setEditing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function promptClear() {
    Alert.alert(
      "Clear History",
      "This will remove all glucose readings. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            clearHistory();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPadding + 12, paddingBottom: bottomPadding + 80 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.pageTitle, { color: colors.text }]}>
          Parent Dashboard
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Overview and settings
        </Text>

        <View style={styles.statsGrid}>
          <StatCard
            label="Avg Glucose"
            value={avgGlucose > 0 ? `${avgGlucose}` : "—"}
            unit="mg/dL"
            icon="activity"
            color={COLORS.primary}
            colors={colors}
          />
          <StatCard
            label="Time in Range"
            value={history.length > 0 ? `${inRangePercent}%` : "—"}
            unit="80-180"
            icon="target"
            color={inRangePercent >= 70 ? COLORS.success : COLORS.warning}
            colors={colors}
          />
          <StatCard
            label="Readings"
            value={String(history.length)}
            unit="total"
            icon="bar-chart-2"
            color={COLORS.accent}
            colors={colors}
          />
          <StatCard
            label="Alerts"
            value={String(anomalyCount)}
            unit="flagged"
            icon="alert-triangle"
            color={anomalyCount > 0 ? COLORS.danger : COLORS.success}
            colors={colors}
          />
        </View>

        {history.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Full Trend
            </Text>
            <View style={styles.rangeRow}>
              <RangeItem label="Min" value={minGlucose} colors={colors} />
              <RangeItem label="Max" value={maxGlucose} colors={colors} />
              <RangeItem label="In Range" value={inRange} unit="readings" colors={colors} />
            </View>
            <TrendChart readings={history} height={130} />
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Settings
            </Text>
            <Pressable
              onPress={() => {
                if (editing) {
                  saveSettings();
                } else {
                  setEditCarbRatio(String(carbRatio));
                  setEditTarget(String(targetGlucose));
                  setEditISF(String(correctionFactor));
                  setEditing(true);
                }
              }}
              hitSlop={8}
            >
              <View
                style={[
                  styles.editBtn,
                  {
                    backgroundColor: editing
                      ? COLORS.primary
                      : colors.backgroundTertiary,
                  },
                ]}
              >
                <Feather
                  name={editing ? "check" : "edit-2"}
                  size={15}
                  color={editing ? "#fff" : colors.text}
                />
                <Text
                  style={[
                    styles.editBtnText,
                    { color: editing ? "#fff" : colors.text },
                  ]}
                >
                  {editing ? "Save" : "Edit"}
                </Text>
              </View>
            </Pressable>
          </View>

          <SettingRow
            label="Carb Ratio"
            description="grams of carbs per unit of insulin"
            value={editCarbRatio}
            onChange={setEditCarbRatio}
            editing={editing}
            displayValue={`1:${carbRatio} g/unit`}
            colors={colors}
          />
          <SettingRow
            label="Target Glucose"
            description="desired blood glucose level"
            value={editTarget}
            onChange={setEditTarget}
            editing={editing}
            displayValue={`${targetGlucose} mg/dL`}
            colors={colors}
          />
          <SettingRow
            label="Correction Factor (ISF)"
            description="points glucose drops per unit"
            value={editISF}
            onChange={setEditISF}
            editing={editing}
            displayValue={`1:${correctionFactor}`}
            colors={colors}
            last
          />
        </View>

        {history.length > 0 && (
          <Pressable
            style={({ pressed }) => [
              styles.clearBtn,
              {
                backgroundColor: colors.card,
                borderColor: COLORS.danger + "50",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
            onPress={promptClear}
          >
            <Feather name="trash-2" size={16} color={COLORS.danger} />
            <Text style={[styles.clearBtnText, { color: COLORS.danger }]}>
              Clear All Readings
            </Text>
          </Pressable>
        )}

        <View
          style={[styles.disclaimer, { backgroundColor: colors.backgroundTertiary }]}
        >
          <Feather name="info" size={14} color={colors.textMuted} />
          <Text style={[styles.disclaimerText, { color: colors.textMuted }]}>
            This app provides estimates only and does not replace medical advice.
            Always follow your doctor's instructions.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  value,
  unit,
  icon,
  color,
  colors,
}: {
  label: string;
  value: string;
  unit: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.statIcon, { backgroundColor: color + "20" }]}
      >
        <Feather name={icon} size={16} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statUnit, { color: color }]}>{unit}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function RangeItem({
  label,
  value,
  unit,
  colors,
}: {
  label: string;
  value: number;
  unit?: string;
  colors: (typeof Colors)["light"];
}) {
  return (
    <View style={styles.rangeItem}>
      <Text style={[styles.rangeValue, { color: colors.text }]}>{value}</Text>
      {unit && (
        <Text style={[styles.rangeUnit, { color: colors.textSecondary }]}>
          {unit}
        </Text>
      )}
      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function SettingRow({
  label,
  description,
  value,
  onChange,
  editing,
  displayValue,
  colors,
  last,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  displayValue: string;
  colors: (typeof Colors)["light"];
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.settingRow,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.separator },
      ]}
    >
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.settingDesc, { color: colors.textMuted }]}>
          {description}
        </Text>
      </View>
      {editing ? (
        <TextInput
          style={[
            styles.settingInput,
            {
              backgroundColor: colors.backgroundTertiary,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          value={value}
          onChangeText={onChange}
          keyboardType="numeric"
        />
      ) : (
        <Text style={[styles.settingValue, { color: COLORS.primary }]}>
          {displayValue}
        </Text>
      )}
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
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    width: "48%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  statValue: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    lineHeight: 28,
  },
  statUnit: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    gap: 14,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  rangeRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  rangeItem: {
    alignItems: "center",
    gap: 2,
  },
  rangeValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  rangeUnit: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  rangeLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    gap: 12,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  settingValue: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  settingInput: {
    width: 80,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  clearBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  disclaimerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
