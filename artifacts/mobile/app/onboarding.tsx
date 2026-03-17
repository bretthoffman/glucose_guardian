import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Image,
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
import { useAuth } from "@/context/AuthContext";

type Step = "welcome" | "name" | "birthday" | "diabetes" | "guardian_pin";

function isValidDate(month: string, day: string, year: string): boolean {
  const m = parseInt(month);
  const d = parseInt(day);
  const y = parseInt(year);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1900 || y > new Date().getFullYear()) return false;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d;
}

function getAgeFromDate(month: string, day: string, year: string): number {
  const dob = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function PinDots({ entered, total = 4 }: { entered: number; total?: number }) {
  return (
    <View style={pinStyles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            pinStyles.dot,
            i < entered ? pinStyles.dotFilled : pinStyles.dotEmpty,
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
            style={({ pressed }) => [
              pinStyles.key,
              { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onDelete();
            }}
          >
            <Feather name="delete" size={22} color={colors.text} />
          </Pressable>
        ) : (
          <Pressable
            key={i}
            style={({ pressed }) => [
              pinStyles.key,
              { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onPress(k);
            }}
          >
            <Text style={[pinStyles.keyText, { color: colors.text }]}>{k}</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { setupProfile, setGuardianPin } = useAuth();

  const [step, setStep] = useState<Step>("welcome");
  const [childName, setChildName] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [diabetesType, setDiabetesType] = useState<"type1" | "type2" | "other">("type1");
  const [isSaving, setIsSaving] = useState(false);

  const [pinEntry, setPinEntry] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinPhase, setPinPhase] = useState<"set" | "confirm">("set");
  const [pinError, setPinError] = useState("");

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const dobValid = isValidDate(birthMonth, birthDay, birthYear);
  const previewAge = dobValid ? getAgeFromDate(birthMonth, birthDay, birthYear) : null;
  const isMinorPreview = previewAge !== null && previewAge < 18;

  function handlePinDigit(digit: string) {
    const current = pinPhase === "set" ? pinEntry : pinConfirm;
    if (current.length >= 4) return;
    const next = current + digit;
    if (pinPhase === "set") {
      setPinEntry(next);
      if (next.length === 4) {
        setTimeout(() => setPinPhase("confirm"), 200);
      }
    } else {
      setPinConfirm(next);
      if (next.length === 4) {
        setTimeout(() => checkPinMatch(pinEntry, next), 200);
      }
    }
  }

  function handlePinDelete() {
    if (pinPhase === "set") {
      setPinEntry((p) => p.slice(0, -1));
    } else {
      setPinConfirm((p) => p.slice(0, -1));
    }
    setPinError("");
  }

  function checkPinMatch(set: string, confirm: string) {
    if (set === confirm) {
      finishSetup(set);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPinError("PINs don't match — try again");
      setPinConfirm("");
      setPinPhase("set");
      setPinEntry("");
    }
  }

  async function finishSetup(pin?: string) {
    if (!childName.trim() || !dobValid) return;
    setIsSaving(true);
    try {
      const dobStr = `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`;
      await setupProfile({ childName: childName.trim(), diabetesType, dateOfBirth: dobStr });
      if (pin) await setGuardianPin(pin);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch {
      setIsSaving(false);
    }
  }

  function advanceFromDiabetes() {
    if (isMinorPreview) {
      setStep("guardian_pin");
    } else {
      finishSetup();
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: topPadding + 40, paddingBottom: bottomPadding + 40, minHeight: "100%" },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === "welcome" && (
          <View style={styles.stepContainer}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.logoImg}
              resizeMode="contain"
            />
            <Text style={[styles.bigTitle, { color: colors.text }]}>Glucose Guardian</Text>
            <Text style={[styles.bigSubtitle, { color: colors.textSecondary }]}>
              Your AI-powered diabetes companion
            </Text>

            <View style={styles.featureList}>
              {[
                { icon: "activity", text: "Real-time glucose monitoring" },
                { icon: "camera", text: "AI food photo carb analysis" },
                { icon: "droplet", text: "Insulin dose calculator" },
                { icon: "wifi", text: "Dexcom & FreeStyle Libre sync" },
                { icon: "users", text: "Parent dashboard & doctor sharing" },
              ].map((f) => (
                <View key={f.text} style={styles.featureRow}>
                  <View style={[styles.featureIcon, { backgroundColor: COLORS.primary + "15" }]}>
                    <Feather name={f.icon as any} size={16} color={COLORS.primary} />
                  </View>
                  <Text style={[styles.featureText, { color: colors.textSecondary }]}>{f.text}</Text>
                </View>
              ))}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setStep("name");
              }}
            >
              <Text style={styles.primaryBtnText}>Get Started</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
          </View>
        )}

        {step === "name" && (
          <View style={styles.stepContainer}>
            <StepBadge label="Step 1 of 3" colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>What's your name?</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              This personalizes your Glucose Guardian experience
            </Text>

            <TextInput
              style={[
                styles.nameInput,
                {
                  backgroundColor: colors.card,
                  borderColor: childName.trim() ? COLORS.primary : colors.border,
                  color: colors.text,
                },
              ]}
              value={childName}
              onChangeText={setChildName}
              placeholder="Enter your name..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => { if (childName.trim()) setStep("birthday"); }}
              maxLength={30}
            />

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: childName.trim() ? COLORS.primary : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              onPress={() => { if (childName.trim()) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep("birthday"); } }}
              disabled={!childName.trim()}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("welcome")} colors={colors} />
          </View>
        )}

        {step === "birthday" && (
          <View style={styles.stepContainer}>
            <StepBadge label="Step 2 of 3" colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>Date of Birth</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              Used to set the right access level in the app
            </Text>

            <View style={styles.dobRow}>
              <View style={styles.dobField}>
                <Text style={[styles.dobLabel, { color: colors.textMuted }]}>Month</Text>
                <TextInput
                  style={[
                    styles.dobInput,
                    {
                      backgroundColor: colors.card,
                      borderColor:
                        birthMonth && !isNaN(parseInt(birthMonth)) ? COLORS.primary : colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={birthMonth}
                  onChangeText={(v) => setBirthMonth(v.replace(/\D/g, "").slice(0, 2))}
                  placeholder="MM"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                />
              </View>
              <Text style={[styles.dobSeparator, { color: colors.textMuted }]}>/</Text>
              <View style={styles.dobField}>
                <Text style={[styles.dobLabel, { color: colors.textMuted }]}>Day</Text>
                <TextInput
                  style={[
                    styles.dobInput,
                    {
                      backgroundColor: colors.card,
                      borderColor:
                        birthDay && !isNaN(parseInt(birthDay)) ? COLORS.primary : colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={birthDay}
                  onChangeText={(v) => setBirthDay(v.replace(/\D/g, "").slice(0, 2))}
                  placeholder="DD"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                />
              </View>
              <Text style={[styles.dobSeparator, { color: colors.textMuted }]}>/</Text>
              <View style={[styles.dobField, { flex: 1.6 }]}>
                <Text style={[styles.dobLabel, { color: colors.textMuted }]}>Year</Text>
                <TextInput
                  style={[
                    styles.dobInput,
                    {
                      backgroundColor: colors.card,
                      borderColor: birthYear.length === 4 ? COLORS.primary : colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={birthYear}
                  onChangeText={(v) => setBirthYear(v.replace(/\D/g, "").slice(0, 4))}
                  placeholder="YYYY"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            </View>

            {previewAge !== null && (
              <View
                style={[
                  styles.ageBadge,
                  {
                    backgroundColor: isMinorPreview ? COLORS.accent + "15" : COLORS.success + "15",
                    borderColor: isMinorPreview ? COLORS.accent + "40" : COLORS.success + "40",
                  },
                ]}
              >
                <Feather
                  name={isMinorPreview ? "shield" : "check-circle"}
                  size={16}
                  color={isMinorPreview ? COLORS.accent : COLORS.success}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.ageBadgeTitle,
                      { color: isMinorPreview ? COLORS.accent : COLORS.success },
                    ]}
                  >
                    {previewAge} years old
                    {isMinorPreview ? " — Child account" : " — Adult account"}
                  </Text>
                  <Text style={[styles.ageBadgeSub, { color: colors.textMuted }]}>
                    {isMinorPreview
                      ? "A guardian PIN will protect sensitive settings"
                      : "Full access to all app features and settings"}
                  </Text>
                </View>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: dobValid ? COLORS.primary : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              onPress={() => { if (dobValid) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep("diabetes"); } }}
              disabled={!dobValid}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("name")} colors={colors} />
          </View>
        )}

        {step === "diabetes" && (
          <View style={styles.stepContainer}>
            <StepBadge label={isMinorPreview ? "Step 3 of 4" : "Step 3 of 3"} colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>Diabetes Type</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              Helps calibrate insulin calculations for {childName}
            </Text>

            {(["type1", "type2", "other"] as const).map((type) => (
              <Pressable
                key={type}
                style={({ pressed }) => [
                  styles.typeOption,
                  {
                    backgroundColor: diabetesType === type ? COLORS.primary + "15" : colors.card,
                    borderColor: diabetesType === type ? COLORS.primary : colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={() => { setDiabetesType(type); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <View style={styles.typeOptionLeft}>
                  <Text style={[styles.typeOptionTitle, { color: colors.text }]}>
                    {type === "type1" ? "Type 1" : type === "type2" ? "Type 2" : "Other"}
                  </Text>
                  <Text style={[styles.typeOptionDesc, { color: colors.textMuted }]}>
                    {type === "type1"
                      ? "Insulin-dependent diabetes"
                      : type === "type2"
                      ? "Lifestyle-managed diabetes"
                      : "MODY, LADA, or other type"}
                  </Text>
                </View>
                {diabetesType === type && (
                  <Feather name="check-circle" size={22} color={COLORS.primary} />
                )}
              </Pressable>
            ))}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: COLORS.primary, opacity: pressed || isSaving ? 0.85 : 1 },
              ]}
              onPress={advanceFromDiabetes}
              disabled={isSaving}
            >
              <Text style={styles.primaryBtnText}>
                {isSaving
                  ? "Setting up..."
                  : isMinorPreview
                  ? "Continue"
                  : `Let's go, ${childName}!`}
              </Text>
              <Feather name={isMinorPreview ? "arrow-right" : "check"} size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("birthday")} colors={colors} />
          </View>
        )}

        {step === "guardian_pin" && (
          <View style={styles.stepContainer}>
            <StepBadge label="Step 4 of 4" colors={colors} />

            <View style={[styles.logoCircle, { backgroundColor: COLORS.accent + "15", width: 80, height: 80, borderRadius: 40 }]}>
              <Feather name="lock" size={36} color={COLORS.accent} />
            </View>

            <Text style={[styles.stepTitle, { color: colors.text }]}>
              {pinPhase === "set" ? "Set Guardian PIN" : "Confirm PIN"}
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              {pinPhase === "set"
                ? `Choose a 4-digit PIN that only you know. You'll use it to access settings on ${childName}'s account.`
                : "Enter the same PIN again to confirm"}
            </Text>

            <PinDots entered={pinPhase === "set" ? pinEntry.length : pinConfirm.length} />

            {pinError ? (
              <View style={[pinStyles.errorBadge, { backgroundColor: COLORS.danger + "15" }]}>
                <Feather name="alert-circle" size={14} color={COLORS.danger} />
                <Text style={[pinStyles.errorText, { color: COLORS.danger }]}>{pinError}</Text>
              </View>
            ) : null}

            <PinKeypad onPress={handlePinDigit} onDelete={handlePinDelete} colors={colors} />

            {pinPhase === "confirm" && (
              <Pressable
                onPress={() => {
                  setPinPhase("set");
                  setPinEntry("");
                  setPinConfirm("");
                  setPinError("");
                }}
                style={pinStyles.resetBtn}
              >
                <Feather name="refresh-ccw" size={14} color={colors.textMuted} />
                <Text style={[pinStyles.resetText, { color: colors.textMuted }]}>Start over</Text>
              </Pressable>
            )}

            <BackBtn onPress={() => { setStep("diabetes"); setPinPhase("set"); setPinEntry(""); setPinConfirm(""); setPinError(""); }} colors={colors} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function StepBadge({ label, colors }: { label: string; colors: (typeof Colors)["light"] }) {
  return (
    <View style={[stepStyles.badge, { backgroundColor: COLORS.primary + "20" }]}>
      <Text style={[stepStyles.badgeText, { color: COLORS.primary }]}>{label}</Text>
    </View>
  );
}

function BackBtn({ onPress, colors }: { onPress: () => void; colors: (typeof Colors)["light"] }) {
  return (
    <Pressable onPress={onPress} style={stepStyles.backBtn}>
      <Feather name="arrow-left" size={16} color={colors.textMuted} />
      <Text style={[stepStyles.backBtnText, { color: colors.textMuted }]}>Back</Text>
    </Pressable>
  );
}

const stepStyles = StyleSheet.create({
  badge: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  backBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});

const pinStyles = StyleSheet.create({
  dotsRow: {
    flexDirection: "row",
    gap: 20,
    justifyContent: "center",
    marginVertical: 8,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  dotFilled: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  dotEmpty: {
    backgroundColor: "transparent",
    borderColor: COLORS.accent + "60",
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 14,
    width: "100%",
    maxWidth: 300,
    alignSelf: "center",
    marginTop: 8,
  },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  keyEmpty: {
    width: 76,
    height: 76,
  },
  keyText: {
    fontSize: 26,
    fontFamily: "Inter_600SemiBold",
  },
  errorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  resetText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  stepContainer: { flex: 1, alignItems: "center", gap: 16 },
  logoCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  logoImg: {
    width: 130,
    height: 130,
    marginBottom: 8,
  },
  bigTitle: { fontSize: 34, fontFamily: "Inter_700Bold", textAlign: "center" },
  bigSubtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 8,
  },
  featureList: { width: "100%", gap: 10, marginBottom: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { fontSize: 15, fontFamily: "Inter_500Medium", flex: 1 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontFamily: "Inter_700Bold" },
  stepTitle: { fontSize: 28, fontFamily: "Inter_700Bold", textAlign: "center" },
  stepSubtitle: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  nameInput: {
    width: "100%",
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 8,
    textAlign: "center",
  },
  dobRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    width: "100%",
    marginBottom: 8,
  },
  dobField: { flex: 1, gap: 6 },
  dobLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  dobInput: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 14,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  dobSeparator: { fontSize: 24, fontFamily: "Inter_700Bold", paddingBottom: 14 },
  ageBadge: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  ageBadgeTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  ageBadgeSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  typeOption: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  typeOptionLeft: { gap: 2 },
  typeOptionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  typeOptionDesc: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
