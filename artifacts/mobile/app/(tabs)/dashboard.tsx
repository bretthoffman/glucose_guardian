import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import React, { useState, useCallback } from "react";
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
  const {
    profile,
    dashboardPin,
    setDashboardPin,
    foodLog,
    clearFoodLog,
    updateProfile,
  } = useAuth();

  const [pinUnlocked, setPinUnlocked] = useState(!dashboardPin);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editCarbRatio, setEditCarbRatio] = useState(String(carbRatio));
  const [editTarget, setEditTarget] = useState(String(targetGlucose));
  const [editISF, setEditISF] = useState(String(correctionFactor));
  const [settingPin, setSettingPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editDoctorName, setEditDoctorName] = useState(profile?.doctorName ?? "");
  const [editDoctorEmail, setEditDoctorEmail] = useState(profile?.doctorEmail ?? "");

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

  const handlePinPress = useCallback(
    (digit: string) => {
      const next = pinInput + digit;
      setPinInput(next);
      setPinError(false);
      if (next.length === 4) {
        if (next === dashboardPin) {
          setPinUnlocked(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          setPinError(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setTimeout(() => {
            setPinInput("");
            setPinError(false);
          }, 800);
        }
      }
    },
    [pinInput, dashboardPin]
  );

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
    Alert.alert("Clear History", "Remove all glucose readings?", [
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

  async function savePin() {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      Alert.alert("Invalid PIN", "Please enter exactly 4 digits.");
      return;
    }
    await setDashboardPin(newPin);
    setSettingPin(false);
    setNewPin("");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("PIN Set", "Dashboard is now PIN protected.");
  }

  async function removePin() {
    await setDashboardPin(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("PIN Removed", "Dashboard is no longer PIN protected.");
  }

  async function generateReport() {
    setIsSharing(true);
    try {
      const now = new Date();
      const childName = profile?.childName ?? "Patient";
      const doctorName = profile?.doctorName ?? "";

      let report = `GLUCO GUARDIAN — DIABETES REPORT\n`;
      report += `${"=".repeat(40)}\n\n`;
      report += `Patient: ${childName}\n`;
      report += `Diabetes Type: ${profile?.diabetesType ?? "Unknown"}\n`;
      report += `Report Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}\n`;
      if (doctorName) report += `Doctor: ${doctorName}\n`;
      report += `\n`;

      report += `GLUCOSE SUMMARY\n${"-".repeat(30)}\n`;
      if (history.length > 0) {
        report += `Total Readings: ${history.length}\n`;
        report += `Average Glucose: ${avgGlucose} mg/dL\n`;
        report += `Min Glucose: ${minGlucose} mg/dL\n`;
        report += `Max Glucose: ${maxGlucose} mg/dL\n`;
        report += `Time In Range (80-180): ${inRangePercent}%\n`;
        report += `Alerts Triggered: ${anomalyCount}\n\n`;

        report += `GLUCOSE READINGS (most recent 20)\n${"-".repeat(30)}\n`;
        const recent = [...history].reverse().slice(0, 20);
        for (const r of recent) {
          const t = new Date(r.timestamp).toLocaleString();
          const flag = r.anomaly.warning ? " ⚠️" : "";
          report += `${t}: ${r.glucose} mg/dL${flag}\n`;
        }
        report += `\n`;
      } else {
        report += `No glucose readings recorded.\n\n`;
      }

      report += `INSULIN SETTINGS\n${"-".repeat(30)}\n`;
      report += `Carb Ratio: 1:${carbRatio} (g carbs per unit)\n`;
      report += `Target Glucose: ${targetGlucose} mg/dL\n`;
      report += `Correction Factor (ISF): 1:${correctionFactor}\n\n`;

      report += `FOOD DIARY (most recent 20)\n${"-".repeat(30)}\n`;
      if (foodLog.length > 0) {
        for (const f of foodLog.slice(0, 20)) {
          const t = new Date(f.timestamp).toLocaleString();
          const src = f.fromPhoto ? " [Photo]" : "";
          report += `${t}${src}\n  ${f.foodName}: ${f.estimatedCarbs}g carbs → ${f.insulinUnits} units insulin\n`;
        }
      } else {
        report += `No food entries logged.\n`;
      }

      report += `\n${"=".repeat(40)}\n`;
      report += `Generated by Gluco Guardian App\n`;
      report += `For medical use — not a substitute for clinical advice.\n`;

      const fileName = `gluco_guardian_report_${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}.txt`;
      const fileUri = FileSystem.documentDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, report, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "text/plain",
          dialogTitle: `${childName}'s Diabetes Report`,
        });
      } else {
        Alert.alert("Report Generated", `Saved as: ${fileName}`);
      }
    } catch (err) {
      Alert.alert("Error", "Could not generate report. Please try again.");
    } finally {
      setIsSharing(false);
    }
  }

  if (!pinUnlocked) {
    return (
      <View
        style={[styles.pinRoot, { backgroundColor: colors.background, paddingTop: topPadding + 20 }]}
      >
        <View style={[styles.lockIcon, { backgroundColor: COLORS.primary + "15" }]}>
          <Feather name="lock" size={36} color={COLORS.primary} />
        </View>
        <Text style={[styles.pinTitle, { color: colors.text }]}>Parent Dashboard</Text>
        <Text style={[styles.pinSubtitle, { color: colors.textSecondary }]}>
          Enter your 4-digit PIN to access
        </Text>

        <View style={styles.pinDots}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.pinDot,
                {
                  backgroundColor:
                    i < pinInput.length
                      ? pinError
                        ? COLORS.danger
                        : COLORS.primary
                      : colors.border,
                  transform: [{ scale: pinError ? 1.2 : 1 }],
                },
              ]}
            />
          ))}
        </View>

        {pinError && (
          <Text style={[styles.pinErrorText, { color: COLORS.danger }]}>Incorrect PIN</Text>
        )}

        <View style={styles.keypad}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, idx) => {
            if (!k) return <View key={idx} style={styles.keypadEmpty} />;
            return (
              <Pressable
                key={k}
                style={({ pressed }) => [
                  styles.keypadKey,
                  {
                    backgroundColor: pressed ? colors.backgroundTertiary : colors.card,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => {
                  if (k === "⌫") {
                    setPinInput((p) => p.slice(0, -1));
                    setPinError(false);
                  } else {
                    handlePinPress(k);
                  }
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Text style={[styles.keypadKeyText, { color: colors.text }]}>{k}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
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
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.text }]}>Parent Dashboard</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {profile?.childName ? `${profile.childName}'s overview` : "Overview and settings"}
            </Text>
          </View>
          {dashboardPin && (
            <Pressable
              onPress={() => setPinUnlocked(false)}
              style={[styles.lockBtn, { backgroundColor: colors.backgroundTertiary }]}
            >
              <Feather name="lock" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Avg Glucose" value={avgGlucose > 0 ? `${avgGlucose}` : "—"} unit="mg/dL" icon="activity" color={COLORS.primary} colors={colors} />
          <StatCard label="Time in Range" value={history.length > 0 ? `${inRangePercent}%` : "—"} unit="80-180" icon="target" color={inRangePercent >= 70 ? COLORS.success : COLORS.warning} colors={colors} />
          <StatCard label="Readings" value={String(history.length)} unit="total" icon="bar-chart-2" color={COLORS.accent} colors={colors} />
          <StatCard label="Alerts" value={String(anomalyCount)} unit="flagged" icon="alert-triangle" color={anomalyCount > 0 ? COLORS.danger : COLORS.success} colors={colors} />
        </View>

        {history.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Full Trend</Text>
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
            <Text style={[styles.cardTitle, { color: colors.text }]}>Insulin Settings</Text>
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
          </View>
          <SettingRow label="Carb Ratio" description="grams of carbs per unit" value={editCarbRatio} onChange={setEditCarbRatio} editing={editing} displayValue={`1:${carbRatio} g/unit`} colors={colors} />
          <SettingRow label="Target Glucose" description="desired blood glucose" value={editTarget} onChange={setEditTarget} editing={editing} displayValue={`${targetGlucose} mg/dL`} colors={colors} />
          <SettingRow label="Correction Factor" description="points drop per unit" value={editISF} onChange={setEditISF} editing={editing} displayValue={`1:${correctionFactor}`} colors={colors} last />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Doctor Info & Sharing</Text>
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
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
                  ? `Dr. ${profile.doctorName}${profile.doctorEmail ? ` — ${profile.doctorEmail}` : ""}`
                  : "No doctor info set"}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.outlineBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                onPress={() => {
                  setEditDoctorName(profile?.doctorName ?? "");
                  setEditDoctorEmail(profile?.doctorEmail ?? "");
                  setEditingProfile(true);
                }}
              >
                <Feather name="edit-2" size={14} color={colors.text} />
                <Text style={[styles.outlineBtnText, { color: colors.text }]}>Edit Doctor Info</Text>
              </Pressable>
            </View>
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
              {isSharing ? "Generating Report..." : "Share Report with Doctor"}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Security</Text>
          <Text style={[styles.securityDesc, { color: colors.textSecondary }]}>
            {dashboardPin
              ? "Dashboard is PIN protected. Lock it when done."
              : "Set a PIN to restrict access to this dashboard."}
          </Text>
          {settingPin ? (
            <View style={{ gap: 10 }}>
              <TextInput
                style={[styles.smallInput, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, color: colors.text, textAlign: "center", letterSpacing: 8, fontSize: 24 }]}
                value={newPin}
                onChangeText={(v) => setNewPin(v.replace(/\D/g, "").slice(0, 4))}
                placeholder="••••"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                autoFocus
              />
              <Pressable style={({ pressed }) => [styles.editBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 }]} onPress={savePin}>
                <Feather name="check" size={15} color="#fff" />
                <Text style={[styles.editBtnText, { color: "#fff" }]}>Set PIN</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.outlineBtn, { borderColor: colors.border, backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]} onPress={() => { setSettingPin(false); setNewPin(""); }}>
                <Text style={[styles.outlineBtnText, { color: colors.textMuted }]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <Pressable
                style={({ pressed }) => [styles.outlineBtn, { borderColor: COLORS.primary + "50", backgroundColor: COLORS.primary + "10", opacity: pressed ? 0.8 : 1 }]}
                onPress={() => setSettingPin(true)}
              >
                <Feather name="lock" size={14} color={COLORS.primary} />
                <Text style={[styles.outlineBtnText, { color: COLORS.primary }]}>
                  {dashboardPin ? "Change PIN" : "Set PIN"}
                </Text>
              </Pressable>
              {!!dashboardPin && (
                <Pressable
                  style={({ pressed }) => [styles.outlineBtn, { borderColor: COLORS.danger + "40", backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                  onPress={removePin}
                >
                  <Feather name="unlock" size={14} color={COLORS.danger} />
                  <Text style={[styles.outlineBtnText, { color: COLORS.danger }]}>Remove PIN</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {foodLog.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Food Diary</Text>
            <Text style={[styles.securityDesc, { color: colors.textSecondary }]}>
              {foodLog.length} meal{foodLog.length !== 1 ? "s" : ""} logged
            </Text>
            {foodLog.slice(0, 5).map((f) => (
              <View key={f.id} style={[styles.foodLogRow, { borderBottomColor: colors.separator }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.foodLogName, { color: colors.text }]}>{f.foodName}</Text>
                  <Text style={[styles.foodLogMeta, { color: colors.textMuted }]}>
                    {new Date(f.timestamp).toLocaleDateString()} · {f.estimatedCarbs}g carbs · {f.insulinUnits}u
                    {f.fromPhoto ? " · 📷 AI" : ""}
                  </Text>
                </View>
              </View>
            ))}
            {foodLog.length > 5 && (
              <Text style={[styles.foodLogMore, { color: colors.textMuted }]}>
                +{foodLog.length - 5} more entries in report
              </Text>
            )}
          </View>
        )}

        {history.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.clearBtn, { backgroundColor: colors.card, borderColor: COLORS.danger + "50", opacity: pressed ? 0.8 : 1 }]}
            onPress={promptClear}
          >
            <Feather name="trash-2" size={16} color={COLORS.danger} />
            <Text style={[styles.clearBtnText, { color: COLORS.danger }]}>Clear All Readings</Text>
          </Pressable>
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
  pinRoot: { flex: 1, alignItems: "center", paddingHorizontal: 30, gap: 16 },
  lockIcon: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  pinTitle: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center" },
  pinSubtitle: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },
  pinDots: { flexDirection: "row", gap: 16, marginVertical: 8 },
  pinDot: { width: 18, height: 18, borderRadius: 9 },
  pinErrorText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  keypad: { flexDirection: "row", flexWrap: "wrap", width: 270, gap: 12, justifyContent: "center" },
  keypadKey: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  keypadEmpty: { width: 80, height: 80 },
  keypadKeyText: { fontSize: 24, fontFamily: "Inter_700Bold" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  lockBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  pageTitle: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular" },
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
  doctorInfo: { fontSize: 14, fontFamily: "Inter_400Regular" },
  outlineBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  outlineBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14 },
  shareBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_700Bold" },
  securityDesc: { fontSize: 14, fontFamily: "Inter_400Regular" },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  smallInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: "Inter_400Regular" },
  foodLogRow: { paddingVertical: 10, borderBottomWidth: 1 },
  foodLogName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  foodLogMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  foodLogMore: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  clearBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  clearBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, marginBottom: 8 },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
