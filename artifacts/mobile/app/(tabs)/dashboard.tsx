import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import type { EmergencyContact } from "@/context/AuthContext";

function GuardianLock({ colors }: { colors: (typeof Colors)["light"] }) {
  return (
    <View style={[guardianStyles.container, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
      <View style={[guardianStyles.iconWrap, { backgroundColor: COLORS.warning + "20" }]}>
        <Feather name="lock" size={20} color={COLORS.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[guardianStyles.title, { color: colors.text }]}>Guardian Permission Required</Text>
        <Text style={[guardianStyles.sub, { color: colors.textMuted }]}>
          Use the Guardian Access section to unlock and edit this.
        </Text>
      </View>
    </View>
  );
}

const guardianStyles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginTop: 4 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 3 },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});

function PinDots({ entered, total = 4, shake }: { entered: number; total?: number; shake?: boolean }) {
  return (
    <View style={pinStyles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            pinStyles.dot,
            i < entered ? pinStyles.dotFilled : pinStyles.dotEmpty,
            shake ? { borderColor: COLORS.danger } : undefined,
          ]}
        />
      ))}
    </View>
  );
}

function PinKeypad({
  onPress,
  onDelete,
  colors,
}: {
  onPress: (digit: string) => void;
  onDelete: () => void;
  colors: (typeof Colors)["light"];
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <View style={pinStyles.keypad}>
      {keys.map((k, i) =>
        k === "" ? (
          <View key={i} style={pinStyles.keyEmpty} />
        ) : k === "del" ? (
          <Pressable
            key={i}
            style={({ pressed }) => [pinStyles.key, { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDelete(); }}
          >
            <Feather name="delete" size={22} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable
            key={i}
            style={({ pressed }) => [pinStyles.key, { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(k); }}
          >
            <Text style={[pinStyles.keyText, { color: colors.text }]}>{k}</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const pinStyles = StyleSheet.create({
  dotsRow: { flexDirection: "row", gap: 20, justifyContent: "center", marginVertical: 12 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2 },
  dotFilled: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  dotEmpty: { backgroundColor: "transparent", borderColor: COLORS.accent + "60" },
  keypad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, width: "100%", maxWidth: 300, alignSelf: "center", marginTop: 8 },
  key: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
  keyEmpty: { width: 76, height: 76 },
  keyText: { fontSize: 26, fontFamily: "Inter_600SemiBold" },
});

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const {
    history,
    clearHistory,
    resetGlucoseData,
    carbRatio,
    targetGlucose,
    correctionFactor,
    setCarbRatio,
    setTargetGlucose,
    setCorrectionFactor,
  } = useGlucose();
  const {
    profile,
    isMinor,
    ageYears,
    foodLog,
    clearFoodLog,
    insulinLog,
    clearInsulinLog,
    updateProfile,
    signOut,
    emergencyContacts,
    alertPrefs,
    addEmergencyContact,
    removeEmergencyContact,
    updateAlertPrefs,
    guardianPin,
    isGuardianUnlocked,
    unlockGuardian,
    lockGuardian,
    isChildMode,
    caregiverSession,
    setChildMode,
    generateCaregiverCode,
    exitCaregiverMode,
  } = useAuth();

  const isParent = profile?.accountRole === "parent" || profile?.accountRole === undefined;
  const isAdult = profile?.accountRole === "adult";

  const isGuarded = isMinor && !isGuardianUnlocked;

  const [editing, setEditing] = useState(false);
  const [editCarbRatio, setEditCarbRatio] = useState(String(carbRatio));
  const [editTarget, setEditTarget] = useState(String(targetGlucose));
  const [editISF, setEditISF] = useState(String(correctionFactor));
  const [editingProfile, setEditingProfile] = useState(false);
  const [editDoctorName, setEditDoctorName] = useState(profile?.doctorName ?? "");
  const [editDoctorEmail, setEditDoctorEmail] = useState(profile?.doctorEmail ?? "");
  const [isSharing, setIsSharing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactRelation, setNewContactRelation] = useState("");

  const [showPinModal, setShowPinModal] = useState(false);
  const [pinEntry, setPinEntry] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinShake, setPinShake] = useState(false);

  const [editingThresholds, setEditingThresholds] = useState(false);
  const [editUrgentLow, setEditUrgentLow] = useState(String(alertPrefs.urgentLowThreshold));
  const [editLow, setEditLow] = useState(String(alertPrefs.lowThreshold));
  const [editHigh, setEditHigh] = useState(String(alertPrefs.highThreshold));
  const [editUrgentHigh, setEditUrgentHigh] = useState(String(alertPrefs.urgentHighThreshold));

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const values = history.map((h) => h.glucose);
  const inRange = history.filter((h) => h.glucose >= 80 && h.glucose <= 180).length;
  const avgGlucose = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const minGlucose = values.length > 0 ? Math.min(...values) : 0;
  const maxGlucose = values.length > 0 ? Math.max(...values) : 0;
  const inRangePercent = history.length > 0 ? Math.round((inRange / history.length) * 100) : 0;
  const anomalyCount = history.filter((h) => h.anomaly.warning).length;

  function saveThresholds() {
    const ul = parseInt(editUrgentLow, 10);
    const lo = parseInt(editLow, 10);
    const hi = parseInt(editHigh, 10);
    const uh = parseInt(editUrgentHigh, 10);
    if (isNaN(ul) || isNaN(lo) || isNaN(hi) || isNaN(uh)) {
      Alert.alert("Invalid Values", "Please enter whole numbers for all thresholds.");
      return;
    }
    if (!(ul < lo && lo < hi && hi < uh)) {
      Alert.alert("Invalid Order", "Thresholds must be: Urgent Low < Low < High < Urgent High");
      return;
    }
    if (ul < 40 || uh > 400) {
      Alert.alert("Out of Range", "Values must be between 40 and 400 mg/dL.");
      return;
    }
    updateAlertPrefs({ urgentLowThreshold: ul, lowThreshold: lo, highThreshold: hi, urgentHighThreshold: uh });
    setEditingThresholds(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

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

  function confirmLogout() {
    Alert.alert(
      "Sign Out",
      "Sign out of Glucose Guardian? Your data will be saved.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign Out",
          style: "destructive",
          onPress: async () => {
            await signOut();
          },
        },
      ]
    );
  }

  function promptClearHistory() {
    Alert.alert("Clear Readings", "Remove all glucose readings permanently?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => { clearHistory(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }

  function promptClearFood() {
    Alert.alert("Clear Food Diary", "Remove all food entries permanently?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => { clearFoodLog(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }

  function promptClearInsulin() {
    Alert.alert("Clear Insulin Log", "Remove all insulin entries permanently?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => { clearInsulinLog(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } },
    ]);
  }

  type CombinedEntry =
    | { kind: "food"; id: string; timestamp: string; foodName: string; estimatedCarbs: number; insulinUnits: number; fromPhoto: boolean }
    | { kind: "insulin"; id: string; timestamp: string; units: number; type: string; note?: string };

  const combinedEntries: CombinedEntry[] = [
    ...foodLog.map((f) => ({ kind: "food" as const, id: f.id, timestamp: f.timestamp, foodName: f.foodName, estimatedCarbs: f.estimatedCarbs, insulinUnits: f.insulinUnits, fromPhoto: !!f.fromPhoto })),
    ...insulinLog.map((i) => ({ kind: "insulin" as const, id: i.id, timestamp: i.timestamp, units: i.units, type: i.type, note: i.note })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const groupedByDay = combinedEntries.reduce<Record<string, CombinedEntry[]>>((acc, entry) => {
    const day = new Date(entry.timestamp).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (!acc[day]) acc[day] = [];
    acc[day].push(entry);
    return acc;
  }, {});
  const dayKeys = Object.keys(groupedByDay);

  function confirmRemoveContact(contact: EmergencyContact) {
    Alert.alert(`Remove ${contact.name}?`, "They will no longer receive emergency alerts.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeEmergencyContact(contact.id) },
    ]);
  }

  function sendTestAlert(contact: EmergencyContact) {
    const name = profile?.childName ?? "your child";
    const msg = `🚨 GLUCOSE GUARDIAN ALERT: ${name}'s blood sugar needs attention. Please check in with them immediately. - Glucose Guardian App`;
    const url = Platform.OS === "ios"
      ? `sms:${contact.phone}&body=${encodeURIComponent(msg)}`
      : `sms:${contact.phone}?body=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => Alert.alert("Could not open SMS", "Please check the phone number."));
  }

  async function addContact() {
    if (!newContactName.trim() || !newContactPhone.trim()) {
      Alert.alert("Missing Info", "Please enter a name and phone number.");
      return;
    }
    await addEmergencyContact({
      name: newContactName.trim(),
      phone: newContactPhone.trim(),
      relation: newContactRelation.trim() || "Family",
    });
    setNewContactName("");
    setNewContactPhone("");
    setNewContactRelation("");
    setAddingContact(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      report += `\n${"=".repeat(40)}\nGenerated by Glucose Guardian · Not a substitute for clinical advice.\n`;

      const fileName = `gluco_report_${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}.txt`;
      const fileUri = FileSystem.documentDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, report, { encoding: "utf8" as any });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: "text/plain", dialogTitle: `${name}'s Diabetes Report` });
      } else {
        Alert.alert("Report Ready", `Saved as ${fileName}`);
      }
    } catch {
      Alert.alert("Error", "Could not generate report.");
    } finally {
      setIsSharing(false);
    }
  }

  function handlePinDigit(digit: string) {
    if (pinEntry.length >= 4) return;
    const next = pinEntry + digit;
    setPinEntry(next);
    setPinError("");
    if (next.length === 4) {
      setTimeout(() => {
        const ok = unlockGuardian(next);
        if (ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setShowPinModal(false);
          setPinEntry("");
          setPinError("");
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setPinShake(true);
          setTimeout(() => { setPinShake(false); setPinEntry(""); setPinError("Incorrect PIN — try again"); }, 600);
        }
      }, 200);
    }
  }

  function handlePinDelete() {
    setPinEntry((p) => p.slice(0, -1));
    setPinError("");
  }

  function closePinModal() {
    setShowPinModal(false);
    setPinEntry("");
    setPinError("");
    setPinShake(false);
  }

  const diabetesLabel: Record<string, string> = { type1: "Type 1", type2: "Type 2", other: "Other" };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPadding + 12, paddingBottom: bottomPadding + 80 }]}
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
              <Text style={[styles.ageBadgeText, { color: COLORS.accent }]}>{ageYears} yrs</Text>
            </View>
          )}
        </View>

        {caregiverSession && (
          <View style={[styles.modeBanner, { backgroundColor: COLORS.accent + "15", borderColor: COLORS.accent + "35" }]}>
            <View style={styles.modeBannerLeft}>
              <Feather name="users" size={16} color={COLORS.accent} />
              <View>
                <Text style={[styles.modeBannerTitle, { color: COLORS.accent }]}>Caregiver View</Text>
                <Text style={[styles.modeBannerSub, { color: colors.textSecondary }]}>Read-only access via caregiver code</Text>
              </View>
            </View>
            <Pressable
              style={[styles.modeBannerBtn, { backgroundColor: COLORS.accent + "20" }]}
              onPress={() => { exitCaregiverMode(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
            >
              <Feather name="log-out" size={13} color={COLORS.accent} />
              <Text style={[styles.modeBannerBtnText, { color: COLORS.accent }]}>Exit</Text>
            </Pressable>
          </View>
        )}

        {isChildMode && !caregiverSession && (
          <View style={[styles.modeBanner, { backgroundColor: COLORS.primary + "12", borderColor: COLORS.primary + "30" }]}>
            <View style={styles.modeBannerLeft}>
              <Feather name="eye" size={16} color={COLORS.primary} />
              <View>
                <Text style={[styles.modeBannerTitle, { color: COLORS.primary }]}>Child View Active</Text>
                <Text style={[styles.modeBannerSub, { color: colors.textSecondary }]}>Settings are hidden — guardian PIN required</Text>
              </View>
            </View>
          </View>
        )}

        {!isChildMode && !caregiverSession && isMinor && (
          <View style={[styles.childBanner, { backgroundColor: COLORS.primary + "10", borderColor: COLORS.primary + "30" }]}>
            <Feather name="info" size={16} color={COLORS.primary} />
            <Text style={[styles.childBannerText, { color: colors.textSecondary }]}>
              You can view all your health data. Some sections require guardian access to edit.
            </Text>
          </View>
        )}

        {!isChildMode && !caregiverSession && isMinor && guardianPin && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: isGuardianUnlocked ? COLORS.success + "50" : colors.border }]}>
            <View style={styles.guardianAccessHeader}>
              <View style={[styles.guardianAccessIcon, { backgroundColor: isGuardianUnlocked ? COLORS.success + "18" : COLORS.warning + "18" }]}>
                <Feather
                  name={isGuardianUnlocked ? "unlock" : "lock"}
                  size={20}
                  color={isGuardianUnlocked ? COLORS.success : COLORS.warning}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.guardianAccessTitle, { color: colors.text }]}>Guardian Access</Text>
                <Text style={[styles.guardianAccessSub, { color: isGuardianUnlocked ? COLORS.success : colors.textMuted }]}>
                  {isGuardianUnlocked ? "Unlocked — settings are editable" : "Locked — enter PIN to unlock"}
                </Text>
              </View>
              {isGuardianUnlocked ? (
                <Pressable
                  style={({ pressed }) => [styles.guardianBtn, { backgroundColor: COLORS.success + "18", opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    lockGuardian();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }}
                >
                  <Feather name="lock" size={14} color={COLORS.success} />
                  <Text style={[styles.guardianBtnText, { color: COLORS.success }]}>Lock</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.guardianBtn, { backgroundColor: COLORS.warning + "18", opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowPinModal(true);
                  }}
                >
                  <Feather name="unlock" size={14} color={COLORS.warning} />
                  <Text style={[styles.guardianBtnText, { color: COLORS.warning }]}>Unlock</Text>
                </Pressable>
              )}
            </View>
            {isGuardianUnlocked && (
              <View style={[styles.unlockedNote, { backgroundColor: COLORS.success + "10", borderColor: COLORS.success + "30" }]}>
                <Feather name="check-circle" size={13} color={COLORS.success} />
                <Text style={[styles.unlockedNoteText, { color: COLORS.success }]}>
                  Guardian mode is active. Tap Lock when you're done to protect these settings again.
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.profileTop}>
            <View style={[styles.avatarCircle, { backgroundColor: COLORS.primary + "20" }]}>
              <Text style={styles.avatarInitial}>
                {profile?.childName?.charAt(0)?.toUpperCase() ?? "G"}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.profileName, { color: colors.text }]}>{profile?.childName ?? "User"}</Text>
              <Text style={[styles.profileMeta, { color: colors.textSecondary }]}>
                {ageYears !== null ? `${ageYears} years old · ` : ""}
                {profile?.diabetesType ? diabetesLabel[profile.diabetesType] ?? profile.diabetesType : ""}
              </Text>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.logoutBtn,
              { borderColor: COLORS.danger + "50", backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={confirmLogout}
          >
            <Feather name="log-out" size={16} color={COLORS.danger} />
            <Text style={[styles.logoutBtnText, { color: COLORS.danger }]}>Sign Out</Text>
          </Pressable>
        </View>

        {!isChildMode && !caregiverSession && (<>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Notifications</Text>
          <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
            Get alerted when glucose goes out of range
          </Text>
          <ToggleRow
            label="Glucose Alerts"
            description={`Alerts when outside ${alertPrefs.lowThreshold}–${alertPrefs.highThreshold} mg/dL range`}
            value={alertPrefs.notificationsEnabled}
            onToggle={(v) => updateAlertPrefs({ notificationsEnabled: v })}
            colors={colors}
          />
          <ToggleRow
            label="Emergency Text Alerts"
            description="Auto-open SMS to emergency contacts for critical readings"
            value={alertPrefs.emergencyAlertsEnabled}
            onToggle={(v) => updateAlertPrefs({ emergencyAlertsEnabled: v })}
            colors={colors}
            last
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Glucose Alert Thresholds</Text>
              <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
                Customize each alert level (mg/dL)
              </Text>
            </View>
            {!isGuarded && !editingThresholds && (
              <Pressable
                style={({ pressed }) => [styles.addContactBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  setEditUrgentLow(String(alertPrefs.urgentLowThreshold));
                  setEditLow(String(alertPrefs.lowThreshold));
                  setEditHigh(String(alertPrefs.highThreshold));
                  setEditUrgentHigh(String(alertPrefs.urgentHighThreshold));
                  setEditingThresholds(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <Feather name="edit-2" size={13} color="#fff" />
                <Text style={styles.addContactBtnText}>Edit</Text>
              </Pressable>
            )}
          </View>

          {isGuarded ? (
            <GuardianLock colors={colors} />
          ) : (
            <>
              <View style={styles.thresholdGrid}>
                <ThresholdCell
                  label="URGENT LOW"
                  value={editingThresholds ? editUrgentLow : String(alertPrefs.urgentLowThreshold)}
                  color="#EF4444"
                  editing={editingThresholds}
                  onChangeText={setEditUrgentLow}
                  colors={colors}
                />
                <ThresholdCell
                  label="LOW"
                  value={editingThresholds ? editLow : String(alertPrefs.lowThreshold)}
                  color="#F97316"
                  editing={editingThresholds}
                  onChangeText={setEditLow}
                  colors={colors}
                />
                <ThresholdCell
                  label="HIGH"
                  value={editingThresholds ? editHigh : String(alertPrefs.highThreshold)}
                  color="#F59E0B"
                  editing={editingThresholds}
                  onChangeText={setEditHigh}
                  colors={colors}
                />
                <ThresholdCell
                  label="URGENT HIGH"
                  value={editingThresholds ? editUrgentHigh : String(alertPrefs.urgentHighThreshold)}
                  color="#EF4444"
                  editing={editingThresholds}
                  onChangeText={setEditUrgentHigh}
                  colors={colors}
                />
              </View>
              {editingThresholds && (
                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <Pressable
                    style={({ pressed }) => [styles.threshSaveBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.75 : 1 }]}
                    onPress={saveThresholds}
                  >
                    <Feather name="check" size={14} color="#fff" />
                    <Text style={styles.threshSaveBtnText}>Save</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.threshCancelBtn, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                    onPress={() => setEditingThresholds(false)}
                  >
                    <Text style={[styles.threshCancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                  </Pressable>
                </View>
              )}
              {!editingThresholds && (
                <View style={[styles.threshLegend, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                  <Feather name="info" size={12} color={colors.textMuted} />
                  <Text style={[styles.threshLegendText, { color: colors.textMuted }]}>
                    These levels control chart lines, alert triggers, and dot colors throughout the app.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Emergency Contacts</Text>
              <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
                Up to 5 contacts for urgent glucose alerts
              </Text>
            </View>
            {emergencyContacts.length < 5 && !addingContact && (
              <Pressable
                style={[styles.addContactBtn, { backgroundColor: COLORS.primary }]}
                onPress={() => setAddingContact(true)}
              >
                <Feather name="plus" size={14} color="#fff" />
                <Text style={styles.addContactBtnText}>Add</Text>
              </Pressable>
            )}
          </View>

          {emergencyContacts.length === 0 && !addingContact && (
            <View style={[styles.emptyContacts, { backgroundColor: colors.backgroundTertiary }]}>
              <Feather name="users" size={22} color={colors.textMuted} />
              <Text style={[styles.emptyContactsText, { color: colors.textMuted }]}>
                No emergency contacts yet. Add a parent, guardian, or family member.
              </Text>
            </View>
          )}

          {emergencyContacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              colors={colors}
              onRemove={() => confirmRemoveContact(contact)}
              onSendAlert={() => sendTestAlert(contact)}
            />
          ))}

          {addingContact && (
            <View style={[styles.addContactForm, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Name *</Text>
              <TextInput
                style={[styles.smallInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={newContactName}
                onChangeText={setNewContactName}
                placeholder="Mom, Dad, Grandma..."
                placeholderTextColor={colors.textMuted}
              />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Phone Number *</Text>
              <TextInput
                style={[styles.smallInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={newContactPhone}
                onChangeText={setNewContactPhone}
                placeholder="+1 555 000 0000"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
              />
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Relationship (optional)</Text>
              <TextInput
                style={[styles.smallInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
                value={newContactRelation}
                onChangeText={setNewContactRelation}
                placeholder="Parent, Sibling, Nurse..."
                placeholderTextColor={colors.textMuted}
              />
              <View style={styles.formActions}>
                <Pressable
                  style={({ pressed }) => [styles.cancelFormBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => { setAddingContact(false); setNewContactName(""); setNewContactPhone(""); setNewContactRelation(""); }}
                >
                  <Text style={[styles.cancelFormBtnText, { color: colors.textMuted }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.saveFormBtn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 }]}
                  onPress={addContact}
                >
                  <Feather name="user-plus" size={14} color="#fff" />
                  <Text style={styles.saveFormBtnText}>Save Contact</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={[styles.alertNote, { backgroundColor: COLORS.warning + "12", borderColor: COLORS.warning + "30" }]}>
            <Feather name="info" size={13} color={COLORS.warning} />
            <Text style={[styles.alertNoteText, { color: colors.textSecondary }]}>
              Tapping "Send Alert" opens your phone's SMS app with a pre-written emergency message ready to send.
            </Text>
          </View>
        </View>

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
            {isGuarded ? (
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
            {!isGuarded && (
              <Pressable
                onPress={() => {
                  if (editing) { saveSettings(); } else {
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
          <SettingRow label="Carb Ratio" description="grams of carbs per unit of insulin" displayValue={`1:${carbRatio} g/unit`} editing={editing && !isGuarded} value={editCarbRatio} onChange={setEditCarbRatio} colors={colors} />
          <SettingRow label="Target Glucose" description="desired blood glucose level" displayValue={`${targetGlucose} mg/dL`} editing={editing && !isGuarded} value={editTarget} onChange={setEditTarget} colors={colors} />
          <SettingRow label="Correction Factor (ISF)" description="points glucose drops per unit" displayValue={`1:${correctionFactor}`} editing={editing && !isGuarded} value={editISF} onChange={setEditISF} colors={colors} last />

          <View style={[styles.insulinTypesSection, { borderTopColor: colors.separator }]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>My Insulin Types</Text>
            <View style={styles.insulinChipsRow}>
              {["Rapid-acting", "Short-acting", "Intermediate", "Long-acting", "Ultra-long", "Pre-mixed"].map((t) => {
                const selected = (profile?.insulinTypes ?? []).includes(t);
                return (
                  <Pressable
                    key={t}
                    style={({ pressed }) => [
                      styles.insulinChip,
                      {
                        backgroundColor: selected ? COLORS.accent + "18" : colors.backgroundTertiary,
                        borderColor: selected ? COLORS.accent : colors.border,
                        opacity: (pressed || (isGuarded && !isGuardianUnlocked)) ? 0.7 : 1,
                      },
                    ]}
                    onPress={() => {
                      if (isGuarded) return;
                      const current = profile?.insulinTypes ?? [];
                      const next = selected ? current.filter((x) => x !== t) : [...current, t];
                      updateProfile({ insulinTypes: next });
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    disabled={isGuarded}
                  >
                    {selected && <Feather name="check" size={11} color={COLORS.accent} />}
                    <Text style={[styles.insulinChipText, { color: selected ? COLORS.accent : colors.textSecondary }]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
            {(profile?.insulinTypes ?? []).length === 0 && (
              <Text style={[styles.insulinTypesEmpty, { color: colors.textMuted }]}>Tap to select insulin types you use</Text>
            )}
          </View>

          {isGuarded && <GuardianLock colors={colors} />}
        </View>
        </>)}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>Doctor Sharing</Text>
          {!isGuarded && !isChildMode && !caregiverSession && (
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
                    onPress={async () => { await updateProfile({ doctorName: editDoctorName, doctorEmail: editDoctorEmail }); setEditingProfile(false); }}
                  >
                    <Feather name="check" size={15} color="#fff" />
                    <Text style={[styles.editBtnText, { color: "#fff" }]}>Save</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={[styles.doctorInfo, { color: colors.textSecondary }]}>
                    {profile?.doctorName ? `${profile.doctorName}${profile.doctorEmail ? ` — ${profile.doctorEmail}` : ""}` : "No doctor info added yet"}
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
            style={({ pressed }) => [styles.shareBtn, { backgroundColor: COLORS.accent, opacity: pressed || isSharing ? 0.85 : 1 }]}
            onPress={generateReport}
            disabled={isSharing}
          >
            <Feather name="share-2" size={16} color="#fff" />
            <Text style={styles.shareBtnText}>{isSharing ? "Generating..." : "Share Report with Doctor"}</Text>
          </Pressable>
          {isGuarded && (
            <Text style={[styles.shareNote, { color: colors.textMuted }]}>
              Doctor info can be managed by unlocking Guardian Access above.
            </Text>
          )}
        </View>

        {combinedEntries.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Activity Log</Text>
            <Text style={[styles.foodLogCount, { color: colors.textSecondary }]}>
              {foodLog.length} meal{foodLog.length !== 1 ? "s" : ""}
              {insulinLog.length > 0 ? ` · ${insulinLog.length} insulin dose${insulinLog.length !== 1 ? "s" : ""}` : ""}
            </Text>
            {dayKeys.slice(0, 3).map((day) => (
              <View key={day} style={{ gap: 6 }}>
                <Text style={[styles.logDayHeader, { color: colors.textMuted, borderBottomColor: colors.separator }]}>{day}</Text>
                {groupedByDay[day].map((entry) => (
                  <View key={entry.id} style={[styles.logEntryRow, { borderBottomColor: colors.separator }]}>
                    <View style={[styles.logEntryIcon, {
                      backgroundColor: entry.kind === "food" ? COLORS.primary + "15" : COLORS.accent + "15",
                    }]}>
                      <Feather
                        name={entry.kind === "food" ? "coffee" : "droplet"}
                        size={13}
                        color={entry.kind === "food" ? COLORS.primary : COLORS.accent}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      {entry.kind === "food" ? (
                        <>
                          <Text style={[styles.logEntryName, { color: colors.text }]}>{entry.foodName}</Text>
                          <Text style={[styles.logEntryMeta, { color: colors.textMuted }]}>
                            {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {entry.estimatedCarbs}g carbs · {entry.insulinUnits}u{entry.fromPhoto ? " · AI Photo" : ""}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={[styles.logEntryName, { color: colors.text }]}>
                            {entry.units}u {entry.type.charAt(0).toUpperCase() + entry.type.slice(1)} Insulin
                          </Text>
                          <Text style={[styles.logEntryMeta, { color: colors.textMuted }]}>
                            {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{entry.note ? ` · ${entry.note}` : ""}
                          </Text>
                        </>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            ))}
            {dayKeys.length > 3 && (
              <Text style={[styles.foodLogMore, { color: colors.textMuted }]}>+{dayKeys.length - 3} earlier days in report</Text>
            )}
            {isGuarded ? (
              <GuardianLock colors={colors} />
            ) : (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {foodLog.length > 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.dangerBtnSmall, { borderColor: COLORS.danger + "50", backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                    onPress={promptClearFood}
                  >
                    <Feather name="trash-2" size={13} color={COLORS.danger} />
                    <Text style={[styles.dangerBtnText, { color: COLORS.danger }]}>Clear Meals</Text>
                  </Pressable>
                )}
                {insulinLog.length > 0 && (
                  <Pressable
                    style={({ pressed }) => [styles.dangerBtnSmall, { borderColor: COLORS.danger + "50", backgroundColor: colors.backgroundTertiary, opacity: pressed ? 0.8 : 1 }]}
                    onPress={promptClearInsulin}
                  >
                    <Feather name="trash-2" size={13} color={COLORS.danger} />
                    <Text style={[styles.dangerBtnText, { color: COLORS.danger }]}>Clear Insulin</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}

        {isParent && !isChildMode && !caregiverSession && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.guardianAccessIcon, { backgroundColor: COLORS.primary + "15" }]}>
                <Feather name="eye" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.guardianAccessTitle, { color: colors.text }]}>Child View Mode</Text>
                <Text style={[styles.guardianAccessSub, { color: colors.textMuted }]}>
                  Hides settings — safe for child to use the app
                </Text>
              </View>
              {isMinor && !isGuardianUnlocked ? (
                <View style={[styles.guardianBtn, { backgroundColor: colors.backgroundTertiary }]}>
                  <Feather name="lock" size={14} color={colors.textMuted} />
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.guardianBtn, { backgroundColor: COLORS.primary + "18", opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    if (isMinor && !isGuardianUnlocked) {
                      setShowPinModal(true);
                    } else {
                      setChildMode(true);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    }
                  }}
                >
                  <Feather name="toggle-right" size={14} color={COLORS.primary} />
                  <Text style={[styles.guardianBtnText, { color: COLORS.primary }]}>Enable</Text>
                </Pressable>
              )}
            </View>
            {isMinor && !isGuardianUnlocked && (
              <View style={[styles.unlockedNote, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
                <Feather name="lock" size={13} color={colors.textMuted} />
                <Text style={[styles.unlockedNoteText, { color: colors.textMuted }]}>
                  Unlock Guardian Access above to enable Child View Mode
                </Text>
              </View>
            )}
          </View>
        )}

        {isChildMode && !caregiverSession && isParent && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: COLORS.primary + "35" }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.guardianAccessIcon, { backgroundColor: COLORS.primary + "15" }]}>
                <Feather name="eye-off" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.guardianAccessTitle, { color: colors.text }]}>Child View Mode On</Text>
                <Text style={[styles.guardianAccessSub, { color: colors.textMuted }]}>Settings are hidden for child safety</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.guardianBtn, { backgroundColor: COLORS.danger + "15", opacity: pressed ? 0.7 : 1 }]}
                onPress={() => { setChildMode(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
              >
                <Feather name="toggle-left" size={14} color={COLORS.danger} />
                <Text style={[styles.guardianBtnText, { color: COLORS.danger }]}>Turn Off</Text>
              </Pressable>
            </View>
          </View>
        )}

        {isParent && !isChildMode && !caregiverSession && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.guardianAccessIcon, { backgroundColor: COLORS.accent + "15" }]}>
                <Feather name="users" size={20} color={COLORS.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.guardianAccessTitle, { color: colors.text }]}>Caregiver Access</Text>
                <Text style={[styles.guardianAccessSub, { color: colors.textMuted }]}>
                  Share a code with caregivers (nurses, grandparents)
                </Text>
              </View>
              {profile?.caregiverCode && (isMinor ? isGuardianUnlocked : true) && (
                <Pressable
                  style={({ pressed }) => [styles.guardianBtn, { backgroundColor: COLORS.accent + "15", opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    Alert.alert(
                      "Caregiver Code",
                      `Share this code with your caregiver:\n\n${profile.caregiverCode}\n\nThey enter it on the login screen to access a read-only view.`,
                      [{ text: "OK" }]
                    );
                  }}
                >
                  <Feather name="share-2" size={14} color={COLORS.accent} />
                  <Text style={[styles.guardianBtnText, { color: COLORS.accent }]}>Share</Text>
                </Pressable>
              )}
            </View>
            {!profile?.caregiverCode ? (
              <Pressable
                style={({ pressed }) => [styles.outlineBtn, { borderColor: COLORS.accent + "50", backgroundColor: COLORS.accent + "08", opacity: pressed ? 0.8 : 1 }]}
                onPress={async () => {
                  if (isMinor && !isGuardianUnlocked) {
                    setShowPinModal(true);
                    return;
                  }
                  const code = await generateCaregiverCode();
                  Alert.alert("Caregiver Code Created", `Your caregiver code is:\n\n${code}\n\nShare this with your caregiver. They'll enter it on the login screen to view your data.`, [{ text: "OK" }]);
                }}
              >
                <Feather name="plus" size={14} color={COLORS.accent} />
                <Text style={[styles.outlineBtnText, { color: COLORS.accent }]}>Generate Caregiver Code</Text>
              </Pressable>
            ) : (
              <View style={[styles.caregiverCodeDisplay, { backgroundColor: COLORS.accent + "0A", borderColor: COLORS.accent + "30" }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.caregiverCodeLabel, { color: colors.textMuted }]}>Your caregiver code</Text>
                  <Text style={[styles.caregiverCodeValue, { color: colors.text }]}>
                    {isMinor && !isGuardianUnlocked ? "••••••" : profile.caregiverCode}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.guardianBtn, { backgroundColor: COLORS.danger + "12", opacity: pressed ? 0.7 : 1 }]}
                  onPress={() => {
                    if (isMinor && !isGuardianUnlocked) { setShowPinModal(true); return; }
                    Alert.alert("Reset Code?", "This will invalidate the old code. Caregivers with the old code will no longer have access.", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Reset", style: "destructive", onPress: async () => { await generateCaregiverCode(); } },
                    ]);
                  }}
                >
                  <Feather name="refresh-cw" size={14} color={COLORS.danger} />
                  <Text style={[styles.guardianBtnText, { color: COLORS.danger }]}>Reset</Text>
                </Pressable>
              </View>
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

      <Modal
        visible={showPinModal}
        transparent
        animationType="slide"
        onRequestClose={closePinModal}
      >
        <View style={modalStyles.overlay}>
          <Pressable style={modalStyles.backdrop} onPress={closePinModal} />
          <View style={[modalStyles.sheet, { backgroundColor: colors.card }]}>
            <View style={modalStyles.handle} />

            <View style={[modalStyles.iconCircle, { backgroundColor: COLORS.warning + "18" }]}>
              <Feather name="shield" size={28} color={COLORS.warning} />
            </View>

            <Text style={[modalStyles.title, { color: colors.text }]}>Guardian Access</Text>
            <Text style={[modalStyles.sub, { color: colors.textSecondary }]}>
              Enter the 4-digit guardian PIN to unlock settings
            </Text>

            <PinDots entered={pinEntry.length} shake={pinShake} />

            {pinError ? (
              <View style={[modalStyles.errorBadge, { backgroundColor: COLORS.danger + "15" }]}>
                <Feather name="alert-circle" size={13} color={COLORS.danger} />
                <Text style={[modalStyles.errorText, { color: COLORS.danger }]}>{pinError}</Text>
              </View>
            ) : null}

            <PinKeypad onPress={handlePinDigit} onDelete={handlePinDelete} colors={colors} />

            <Pressable style={modalStyles.cancelBtn} onPress={closePinModal}>
              <Text style={[modalStyles.cancelBtnText, { color: colors.textMuted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingBottom: 40, paddingTop: 16, alignItems: "center", gap: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#ccc", marginBottom: 8 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, marginTop: -4 },
  errorBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  errorText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 24, marginTop: 4 },
  cancelBtnText: { fontSize: 15, fontFamily: "Inter_500Medium" },
});

function ToggleRow({
  label, description, value, onToggle, colors, last,
}: {
  label: string; description: string; value: boolean;
  onToggle: (v: boolean) => void; colors: (typeof Colors)["light"]; last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !last && { borderBottomWidth: 1, borderBottomColor: colors.separator }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.toggleLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.toggleDesc, { color: colors.textMuted }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.backgroundTertiary, true: COLORS.primary + "80" }}
        thumbColor={value ? COLORS.primary : colors.textMuted}
        ios_backgroundColor={colors.backgroundTertiary}
      />
    </View>
  );
}

function ContactRow({
  contact, colors, onRemove, onSendAlert,
}: {
  contact: EmergencyContact; colors: (typeof Colors)["light"];
  onRemove: () => void; onSendAlert: () => void;
}) {
  return (
    <View style={[styles.contactRow, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
      <View style={[styles.contactAvatar, { backgroundColor: COLORS.primary + "20" }]}>
        <Text style={[styles.contactAvatarText, { color: COLORS.primary }]}>
          {contact.name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.contactName, { color: colors.text }]}>{contact.name}</Text>
        <Text style={[styles.contactPhone, { color: colors.textMuted }]}>{contact.phone} · {contact.relation}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.contactAlertBtn, { backgroundColor: COLORS.danger + "18", opacity: pressed ? 0.7 : 1 }]}
        onPress={onSendAlert}
      >
        <Feather name="send" size={13} color={COLORS.danger} />
        <Text style={[styles.contactAlertBtnText, { color: COLORS.danger }]}>Alert</Text>
      </Pressable>
      <Pressable onPress={onRemove} style={styles.contactRemoveBtn} hitSlop={8}>
        <Feather name="x" size={16} color={colors.textMuted} />
      </Pressable>
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
      <Text style={[styles.statUnit, { color }]}>{unit}</Text>
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

function ThresholdCell({ label, value, color, editing, onChangeText, colors }: { label: string; value: string; color: string; editing: boolean; onChangeText: (v: string) => void; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[styles.thresholdCell, { backgroundColor: color + "12", borderColor: color + "40" }]}>
      <Text style={[styles.thresholdCellLabel, { color }]}>{label}</Text>
      {editing ? (
        <TextInput
          style={[styles.thresholdCellInput, { color: colors.text, borderColor: color + "60", backgroundColor: color + "08" }]}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          maxLength={3}
          selectTextOnFocus
        />
      ) : (
        <Text style={[styles.thresholdCellValue, { color: colors.text }]}>{value}</Text>
      )}
      <Text style={[styles.thresholdCellUnit, { color }]}>mg/dL</Text>
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
  childBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  childBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },

  guardianAccessHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  guardianAccessIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  guardianAccessTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 2 },
  guardianAccessSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  guardianBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  guardianBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  unlockedNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  unlockedNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  profileTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.primary },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold" },
  profileMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, justifyContent: "center", marginTop: 4 },
  logoutBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },

  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  toggleLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  toggleDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },

  addContactBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  addContactBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  emptyContacts: { padding: 20, borderRadius: 12, alignItems: "center", gap: 8 },
  emptyContactsText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },

  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 10 },
  contactAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  contactAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  contactName: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginBottom: 5 },
  contactPhone: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  contactAlertBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  contactAlertBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  contactRemoveBtn: { padding: 4 },

  addContactForm: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8, marginTop: 8 },
  formActions: { flexDirection: "row", gap: 8, marginTop: 4 },
  cancelFormBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  cancelFormBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  saveFormBtn: { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  saveFormBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  alertNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  alertNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  thresholdGrid: { flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" },
  thresholdCell: { flex: 1, minWidth: "44%", borderRadius: 12, borderWidth: 1, padding: 12, alignItems: "center", gap: 4 },
  thresholdCellLabel: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  thresholdCellValue: { fontSize: 26, fontFamily: "Inter_700Bold", lineHeight: 30 },
  thresholdCellInput: { fontSize: 24, fontFamily: "Inter_700Bold", width: 70, textAlign: "center", borderWidth: 1.5, borderRadius: 8, paddingVertical: 4 },
  thresholdCellUnit: { fontSize: 10, fontFamily: "Inter_400Regular" },
  threshSaveBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 11 },
  threshSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  threshCancelBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 11, borderRadius: 11, borderWidth: 1 },
  threshCancelBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  threshLegend: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginTop: 12 },
  threshLegendText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  statCard: { width: "48%", borderRadius: 14, borderWidth: 1, padding: 14, gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  statValue: { fontSize: 24, fontFamily: "Inter_700Bold", lineHeight: 28 },
  statUnit: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },

  card: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 16, gap: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  cardSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 3 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  editBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  rangeRow: { flexDirection: "row", justifyContent: "space-around" },
  rangeItem: { alignItems: "center", gap: 2 },
  rangeValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  rangeUnit: { fontSize: 11, fontFamily: "Inter_400Regular" },
  rangeLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },

  settingRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: 15, fontFamily: "Inter_500Medium", marginBottom: 2 },
  settingDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  settingValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  settingInput: { width: 80, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "right" },

  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  smallInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" },

  dangerBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  dangerBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  outlineBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  outlineBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 14 },
  shareBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  shareNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 16 },
  doctorInfo: { fontSize: 14, fontFamily: "Inter_400Regular" },

  foodLogCount: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: -8 },
  foodLogRow: { paddingVertical: 10, borderBottomWidth: 1, gap: 2 },
  foodLogName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  foodLogMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  foodLogMore: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },

  logDayHeader: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, paddingBottom: 6, borderBottomWidth: 1, marginTop: 4, marginBottom: 4 },
  logEntryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1 },
  logEntryIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  logEntryName: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 1 },
  logEntryMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  dangerBtnSmall: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },

  insulinTypesSection: { borderTopWidth: 1, paddingTop: 14, gap: 10 },
  insulinChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  insulinChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  insulinChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  insulinTypesEmpty: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },

  disclaimer: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 14, borderRadius: 12, marginTop: 4 },
  disclaimerText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  modeBanner: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  modeBannerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  modeBannerTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 1 },
  modeBannerSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modeBannerBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  modeBannerBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  caregiverCodeDisplay: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  caregiverCodeLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },
  caregiverCodeValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: 3 },
});
