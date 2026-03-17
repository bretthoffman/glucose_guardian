import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
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
import { useAuth } from "@/context/AuthContext";

function GuardianLock({ colors }: { colors: (typeof Colors)["light"] }) {
  return (
    <View style={[guardianStyles.container, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
      <View style={[guardianStyles.iconWrap, { backgroundColor: COLORS.warning + "20" }]}>
        <Feather name="lock" size={20} color={COLORS.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[guardianStyles.title, { color: colors.text }]}>
          Guardian Permission Required
        </Text>
        <Text style={[guardianStyles.sub, { color: colors.textMuted }]}>
          A parent or guardian must manage this section. Ask them to make changes.
        </Text>
      </View>
    </View>
  );
}

const guardianStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 3 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});

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
  const { profile, isMinor, ageYears, foodLog, clearFoodLog, updateProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [editCarbRatio, setEditCarbRatio] = useState(String(carbRatio));
  const [editTarget, setEditTarget] = useState(String(targetGlucose));
  const [editISF, setEditISF] = useState(String(correctionFactor));
  const [editingProfile, setEditingProfile] = useState(false);
  const [editDoctorName, setEditDoctorName] = useState(profile?.doctorName ?? "");
  const [editDoctorEmail, setEditDoctorEmail] = useState(profile?.doctorEmail ?? "");
  const [isSharing, setIsSharing] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const values = history.map((h) => h.glucose);
  const inRange = history.filter((h) => h.glucose >= 80 && h.glucose <= 180).length;
  const avgGlucose =
    values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
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

  function promptClearHistory() {
    Alert.alert("Clear Readings", "Remove all glucose readings permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearHistory();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }

  function promptClearFood() {
    Alert.alert("Clear Food Diary", "Remove all food entries permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          clearFoodLog();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }

  async function generateReport() {
    setIsSharing(true);
    try {
      const now = new Date();
      const name = profile?.childName ?? "Patient";
      let report = `GLUCO GUARDIAN — DIABETES REPORT\n${"=".repeat(40)}\n\n`;
      report += `Patient: ${name}\n`;
      report += `Diabetes Type: ${profile?.diabetesType ?? "Unknown"}\n`;
      if (ageYears !== null) report += `Age: ${ageYears} years old\n`;
      report += `Report Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}\n`;
      if (profile?.doctorName) report += `Doctor: ${profile.doctorName}\n`;
      if (profile?.doctorEmail) report += `Doctor Email: ${profile.doctorEmail}\n`;
      report += `\nGLUCOSE SUMMARY\n${"-".repeat(30)}\n`;
      if (history.length > 0) {
        report += `Total Readings: ${history.length}\n`;
        report += `Average Glucose: ${avgGlucose} mg/dL\n`;
        report += `Min: ${minGlucose} mg/dL  Max: ${maxGlucose} mg/dL\n`;
        report += `Time In Range (80-180): ${inRangePercent}%\n`;
        report += `Alerts Triggered: ${anomalyCount}\n\n`;
        report += `READINGS (most recent 20)\n${"-".repeat(30)}\n`;
        [...history].reverse().slice(0, 20).forEach((r) => {
          const flag = r.anomaly.warning ? " ⚠" : "";
          report += `${new Date(r.timestamp).toLocaleString()}: ${r.glucose} mg/dL${flag}\n`;
        });
      } else {
        report += `No glucose readings recorded.\n`;
      }
      report += `\nINSULIN SETTINGS\n${"-".repeat(30)}\n`;
      report += `Carb Ratio: 1:${carbRatio} g/unit\n`;
      report += `Target Glucose: ${targetGlucose} mg/dL\n`;
      report += `Correction Factor: 1:${correctionFactor}\n`;
      report += `\nFOOD DIARY (most recent 20)\n${"-".repeat(30)}\n`;
      if (foodLog.length > 0) {
        foodLog.slice(0, 20).forEach((f) => {
          report += `${new Date(f.timestamp).toLocaleString()}${f.fromPhoto ? " [AI Photo]" : ""}\n`;
          report += `  ${f.foodName}: ${f.estimatedCarbs}g carbs → ${f.insulinUnits} units\n`;
        });
      } else {
        report += `No food entries.\n`;
      }
      report += `\n${"=".repeat(40)}\nGenerated by Gluco Guardian · Not a substitute for clinical advice.\n`;

      const fileName = `gluco_report_${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}.txt`;
      const fileUri = FileSystem.documentDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, report, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/plain",
          dialogTitle: `${name}'s Diabetes Report`,
        });
      } else {
        Alert.alert("Report Ready", `Saved as ${fileName}`);
      }
    } catch {
      Alert.alert("Error", "Could not generate report.");
    } finally {
      setIsSharing(false);
    }
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
        <View style={styles.pageHeader}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.text }]}>Dashboard</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {profile?.childName ? `${profile.childName}'s health summary` : "Health summary"}
            </Text>
          </View>
          {isMinor && (
            <View style={[styles.ageBadge, { backgroundColor: COLORS.accent + "15", borderColor: COLORS.accent + "30" }]}>
              <Feather name="shield" size={13} color={COLORS.accent} />
              <Text style={[styles.ageBadgeText, { color: COLORS.accent }]}>
                {ageYears} yrs
              </Text>
            </View>
          )}
        </View>

        {isMinor && (
          <View style={[styles.childBanner, { backgroundColor: COLORS.primary + "10", borderColor: COLORS.primary + "30" }]}>
            <Feather name="info" size={16} color={COLORS.primary} />
            <Text style={[styles.childBannerText, { color: colors.textSecondary }]}>
              You can view all your health data. Some sections require a parent or guardian to edit.
            </Text>
          </View>
        )}

        <View style={styles.statsGrid}>
          <StatCard label="Avg Glucose" value={avgGlucose > 0 ? `${avgGlucose}` : "—"} unit="mg/dL" icon="activity" color={COLORS.primary} colors={colors} />
          <StatCard label="Time in Range" value={history.length > 0 ? `${inRangePercent}%` : "—"} unit="80-180 mg/dL" icon="target" color={inRangePercent >= 70 ? COLORS.success : COLORS.warning} colors={colors} />
          <StatCard label="Readings" value={String(history.length)} unit="total" icon="bar-chart-2" color={COLORS.accent} colors={colors} />
          <StatCard label="Alerts" value={String(anomalyCount)} unit="flagged" icon="alert-triangle" color={anomalyCount > 0 ? COLORS.danger : COLORS.success} colors={colors} />
        </View>

        {history.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Glucose Trend</Text>
            <View style={styles.rangeRow}>
              <RangeItem label="Min" value={minGlucose} colors={colors} />
              <RangeItem label="Max" value={maxGlucose} colors={colors} />
              <RangeItem label="In Range" value={inRange} unit="readings" colors={colors} />
            </View>
            <TrendChart readings={history} height={130} />

            {isMinor ? (
              <GuardianLock colors={colors} />
            ) : (
              <Pressable
                style={({ pressed }) => [styles.dangerBtn, { borderColor: COLORS.danger + "50", backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                onPress={promptClearHistory}
              >
                <Feather name="trash-2" size={14} color={COLORS.danger} />
                <Text style={[styles.dangerBtnText, { color: COLORS.danger }]}>Clear All Readings</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Insulin Settings</Text>
            {!isMinor && (
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
                <View style={[styles.editBtn, { backgroundColor: editing ? COLORS.primary : colors.backgroundTertiary }]}>
                  <Feather name={editing ? "check" : "edit-2"} size={15} color={editing ? "#fff" : colors.text} />
                  <Text style={[styles.editBtnText, { color: editing ? "#fff" : colors.text }]}>
                    {editing ? "Save" : "Edit"}
                  </Text>
                </View>
              </Pressable>
            )}
          </View>

          <SettingRow
            label="Carb Ratio"
            description="grams of carbs per unit of insulin"
            displayValue={`1:${carbRatio} g/unit`}
            editing={editing && !isMinor}
            value={editCarbRatio}
            onChange={setEditCarbRatio}
            colors={colors}
          />
          <SettingRow
            label="Target Glucose"
            description="desired blood glucose level"
            displayValue={`${targetGlucose} mg/dL`}
            editing={editing && !isMinor}
            value={editTarget}
            onChange={setEditTarget}
            colors={colors}
          />
          <SettingRow
            label="Correction Factor (ISF)"
            description="points glucose drops per unit"
            displayValue={`1:${correctionFactor}`}
            editing={editing && !isMinor}
            value={editISF}
            onChange={setEditISF}
            colors={colors}
            last
          />

          {isMinor && <GuardianLock colors={colors} />}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Doctor Sharing</Text>

          {!isMinor && (
            <>
              {editingProfile ? (
                <View style={{ gap: 10 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Doctor Name</Text>
                  <TextInput
                    style={[styles.smallInput, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, color: colors.text }]}
                    value={editDoctorName}
                    onChangeText={setEditDoctorName}
                    placeholder="Dr. Smith"
                    placeholderTextColor={colors.textMuted}
                  />
                  <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Doctor Email</Text>
                  <TextInput
                    style={[styles.smallInput, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, color: colors.text }]}
                    value={editDoctorEmail}
                    onChangeText={setEditDoctorEmail}
                    placeholder="doctor@clinic.com"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <Pressable
                    style={({ pressed }) => [styles.editBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 }]}
                    onPress={async () => {
                      await updateProfile({ doctorName: editDoctorName, doctorEmail: editDoctorEmail });
                      setEditingProfile(false);
                    }}
                  >
                    <Feather name="check" size={15} color="#fff" />
                    <Text style={[styles.editBtnText, { color: "#fff" }]}>Save</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={[styles.doctorInfo, { color: colors.textSecondary }]}>
                    {profile?.doctorName
                      ? `${profile.doctorName}${profile.doctorEmail ? ` — ${profile.doctorEmail}` : ""}`
                      : "No doctor info added yet"}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.outlineBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => { setEditDoctorName(profile?.doctorName ?? ""); setEditDoctorEmail(profile?.doctorEmail ?? ""); setEditingProfile(true); }}
                  >
                    <Feather name="edit-2" size={14} color={colors.text} />
                    <Text style={[styles.outlineBtnText, { color: colors.text }]}>Edit Doctor Info</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.shareBtn,
              { backgroundColor: COLORS.accent, opacity: pressed || isSharing ? 0.85 : 1 },
            ]}
            onPress={generateReport}
            disabled={isSharing}
          >
            <Feather name="share-2" size={16} color="#fff" />
            <Text style={styles.shareBtnText}>
              {isSharing ? "Generating..." : "Share Report with Doctor"}
            </Text>
          </Pressable>

          {isMinor && (
            <Text style={[styles.shareNote, { color: colors.textMuted }]}>
              Doctor info can be managed by your parent or guardian.
            </Text>
          )}
        </View>

        {foodLog.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Food Diary</Text>
            <Text style={[styles.foodLogCount, { color: colors.textSecondary }]}>
              {foodLog.length} meal{foodLog.length !== 1 ? "s" : ""} logged
            </Text>
            {foodLog.slice(0, 5).map((f) => (
              <View key={f.id} style={[styles.foodLogRow, { borderBottomColor: colors.separator }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.foodLogName, { color: colors.text }]}>{f.foodName}</Text>
                  <Text style={[styles.foodLogMeta, { color: colors.textMuted }]}>
                    {new Date(f.timestamp).toLocaleDateString()} · {f.estimatedCarbs}g carbs · {f.insulinUnits}u
                    {f.fromPhoto ? " · AI Photo" : ""}
                  </Text>
                </View>
              </View>
            ))}
            {foodLog.length > 5 && (
              <Text style={[styles.foodLogMore, { color: colors.textMuted }]}>
                +{foodLog.length - 5} more in report
              </Text>
            )}

            {isMinor ? (
              <GuardianLock colors={colors} />
            ) : (
              <Pressable
                style={({ pressed }) => [styles.dangerBtn, { borderColor: COLORS.danger + "50", backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                onPress={promptClearFood}
              >
                <Feather name="trash-2" size={14} color={COLORS.danger} />
                <Text style={[styles.dangerBtnText, { color: COLORS.danger }]}>Clear Food Diary</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={[styles.disclaimer, { backgroundColor: colors.backgroundTertiary }]}>
          <Feather name="info" size={14} color={colors.textMuted} />
          <Text style={[styles.disclaimerText, { color: colors.textMuted }]}>
            This app provides estimates only and does not replace medical advice. Always follow your doctor's instructions.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, unit, icon, color, colors }: { label: string; value: string; unit: string; icon: React.ComponentProps<typeof Feather>["name"]; color: string; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: color + "20" }]}>
        <Feather name={icon} size={16} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statUnit, { color: color }]}>{unit}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function RangeItem({ label, value, unit, colors }: { label: string; value: number; unit?: string; colors: (typeof Colors)["light"] }) {
  return (
    <View style={styles.rangeItem}>
      <Text style={[styles.rangeValue, { color: colors.text }]}>{value}</Text>
      {unit && <Text style={[styles.rangeUnit, { color: colors.textSecondary }]}>{unit}</Text>}
      <Text style={[styles.rangeLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function SettingRow({ label, description, value, onChange, editing, displayValue, colors, last }: { label: string; description: string; value: string; onChange: (v: string) => void; editing: boolean; displayValue: string; colors: (typeof Colors)["light"]; last?: boolean }) {
  return (
    <View style={[styles.settingRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.separator }]}>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.settingDesc, { color: colors.textMuted }]}>{description}</Text>
      </View>
      {editing ? (
        <TextInput style={[styles.settingInput, { backgroundColor: colors.backgroundTertiary, color: colors.text, borderColor: colors.border }]} value={value} onChangeText={onChange} keyboardType="numeric" />
      ) : (
        <Text style={[styles.settingValue, { color: COLORS.primary }]}>{displayValue}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular" },
  ageBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  ageBadgeText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  childBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  childBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  statCard: { width: "48%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 28 },
  statUnit: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 16, gap: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  editBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rangeRow: { flexDirection: "row", justifyContent: "space-around" },
  rangeItem: { alignItems: "center", gap: 2 },
  rangeValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  rangeUnit: { fontSize: 11, fontFamily: "Inter_400Regular" },
  rangeLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, gap: 12 },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  settingDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  settingValue: { fontSize: 15, fontFamily: "Inter_700Bold" },
  settingInput: { width: 80, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 15, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  outlineBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  doctorInfo: { fontSize: 14, fontFamily: "Inter_400Regular" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  smallInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: "Inter_400Regular" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  shareBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  shareNote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  foodLogCount: { fontSize: 13, fontFamily: "Inter_400Regular" },
  foodLogRow: { paddingVertical: 10, borderBottomWidth: 1 },
  foodLogName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  foodLogMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  foodLogMore: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  dangerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  dangerBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, marginBottom: 8 },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
