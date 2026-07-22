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
} from "react-native";
import { useTheme } from "@/context/ThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors, { COLORS } from "@/constants/colors";
import { INSULIN_OPTIONS, INSULIN_TYPE_LABEL, insulinChipLabel } from "@/constants/insulin";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";

type Step = "welcome" | "role" | "parent_name" | "organization" | "name" | "birthday" | "diabetes" | "insulin_formula";

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

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { setupProfile } = useAuth();
  const { saveFormula } = useGlucose();

  const [step, setStep] = useState<Step>("welcome");
  const [accountRole, setAccountRole] = useState<"parent" | "adult" | "caregiver">("parent");
  const [parentNameInput, setParentNameInput] = useState("");
  const [parentLastNameInput, setParentLastNameInput] = useState("");
  const [organizationInput, setOrganizationInput] = useState("");
  const [childName, setChildName] = useState("");
  const [childLastName, setChildLastName] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [diabetesType, setDiabetesType] = useState<"type1" | "type2" | "other">("type1");
  const [insulinTypes, setInsulinTypes] = useState<string[]>([]);
  const [carbRatioInput, setCarbRatioInput] = useState("");
  const [carbUnitHalf, setCarbUnitHalf] = useState(false);
  const [targetGlucoseInput, setTargetGlucoseInput] = useState("");
  const [isfInput, setIsfInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function toggleInsulinType(t: string) {
    setInsulinTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const dobValid = isValidDate(birthMonth, birthDay, birthYear);
  const previewAge = dobValid ? getAgeFromDate(birthMonth, birthDay, birthYear) : null;
  const isMinorPreview = previewAge !== null && previewAge < 18;

  async function finishSetup() {
    if (!childName.trim() || !dobValid) return;
    setIsSaving(true);
    try {
      const dobStr = `${birthYear}-${birthMonth.padStart(2, "0")}-${birthDay.padStart(2, "0")}`;
      const parsedWeight = parseFloat(weightLbs);
      await setupProfile({
        childName: childName.trim(),
        childLastName: childLastName.trim() ? childLastName.trim() : undefined,
        parentName: accountRole === "parent" && parentNameInput.trim() ? parentNameInput.trim() : undefined,
        parentLastName: accountRole === "parent" && parentLastNameInput.trim() ? parentLastNameInput.trim() : undefined,
        accountRole,
        diabetesType,
        dateOfBirth: dobStr,
        weightLbs: !isNaN(parsedWeight) && parsedWeight > 0 ? parsedWeight : undefined,
        insulinTypes: insulinTypes.length > 0 ? insulinTypes : undefined,
      });
      const parsedCarbGrams = parseFloat(carbRatioInput);
      const parsedTarget = parseFloat(targetGlucoseInput);
      const parsedISF = parseFloat(isfInput);
      const cr = !isNaN(parsedCarbGrams) && parsedCarbGrams > 0 ? (carbUnitHalf ? parsedCarbGrams * 2 : parsedCarbGrams) : 40;
      const tg = !isNaN(parsedTarget) && parsedTarget > 0 ? parsedTarget : 120;
      const cf = !isNaN(parsedISF) && parsedISF > 0 ? parsedISF : 50;
      saveFormula(cr, tg, cf);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch {
      setIsSaving(false);
    }
  }

  /** Caregiver (school-nurse) accounts: name + optional organization only — no child/CGM/dosing. */
  async function finishCaregiverSetup() {
    const name = parentNameInput.trim();
    if (!name) return;
    setIsSaving(true);
    try {
      await setupProfile({
        // The nurse's own name lives in childName/childLastName so every name/avatar surface reuses
        // it; a placeholder diabetesType + empty DOB satisfy the required profile fields (never shown).
        childName: name,
        childLastName: parentLastNameInput.trim() ? parentLastNameInput.trim() : undefined,
        accountRole: "caregiver",
        organization: organizationInput.trim() ? organizationInput.trim() : undefined,
        diabetesType: "type1",
        dateOfBirth: "",
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch {
      setIsSaving(false);
    }
  }

  function advanceFromDiabetes() {
    setStep("insulin_formula");
  }

  function advanceFromInsulinFormula() {
    finishSetup();
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        {...NO_AUTO_CONTENT_INSETS}
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
                setStep("role");
              }}
            >
              <Text style={styles.primaryBtnText}>Get Started</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
          </View>
        )}

        {step === "role" && (
          <View style={styles.stepContainer}>
            <StepBadge label={accountRole === "parent" ? "Step 1 of 6" : accountRole === "caregiver" ? "Step 1 of 3" : "Step 1 of 5"} colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>Who is this account for?</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              This helps us personalize the app for you
            </Text>

            {(["parent", "adult", "caregiver"] as const).map((role) => {
              const isSelected = accountRole === role;
              const icon = role === "parent" ? "users" : role === "adult" ? "user" : "briefcase";
              const title = role === "parent" ? "Parent or Guardian" : role === "adult" ? "Adult (myself)" : "Caregiver";
              const desc = role === "parent"
                ? "Setting up Glucose Guardian for your child's diabetes management"
                : role === "adult"
                ? "Managing my own diabetes — I'm 18 or older"
                : "A nurse, teacher, or aide watching over one or more kids with access codes";
              return (
                <Pressable
                  key={role}
                  style={({ pressed }) => [
                    styles.typeOption,
                    {
                      backgroundColor: isSelected ? COLORS.primary + "15" : colors.card,
                      borderColor: isSelected ? COLORS.primary : colors.border,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                  onPress={() => { setAccountRole(role); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                >
                  <View style={[styles.roleIcon, { backgroundColor: isSelected ? COLORS.primary + "20" : colors.backgroundTertiary ?? colors.card }]}>
                    <Feather name={icon} size={22} color={isSelected ? COLORS.primary : colors.textMuted ?? colors.textSecondary} />
                  </View>
                  <View style={styles.typeOptionLeft}>
                    <Text style={[styles.typeOptionTitle, { color: colors.text }]}>{title}</Text>
                    <Text style={[styles.typeOptionDesc, { color: colors.textMuted }]}>{desc}</Text>
                  </View>
                  {isSelected && <Feather name="check-circle" size={22} color={COLORS.primary} />}
                </Pressable>
              );
            })}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                // Parent + caregiver both start with the person's own name step; adult goes straight
                // to the (own) name step.
                setStep(accountRole === "adult" ? "name" : "parent_name");
              }}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("welcome")} colors={colors} />
          </View>
        )}

        {step === "parent_name" && (
          <View style={styles.stepContainer}>
            <StepBadge label={accountRole === "caregiver" ? "Step 2 of 3" : "Step 2 of 6"} colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>Your Name</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              {accountRole === "caregiver"
                ? "Shown on the kids' cards you manage, so families know who's watching over them."
                : "What should Glucose Guardian call you? Used when speaking to you in caregiver mode."}
            </Text>

            <TextInput
              style={[
                styles.nameInput,
                {
                  backgroundColor: colors.card,
                  borderColor: parentNameInput.trim() ? COLORS.primary : colors.border,
                  color: colors.text,
                },
              ]}
              value={parentNameInput}
              onChangeText={setParentNameInput}
              placeholder={accountRole === "caregiver" ? "Your first name..." : "Your first name (optional)..."}
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="next"
              maxLength={30}
            />
            <TextInput
              style={[
                styles.nameInput,
                { marginTop: 12, backgroundColor: colors.card, borderColor: parentLastNameInput.trim() ? COLORS.primary : colors.border, color: colors.text },
              ]}
              value={parentLastNameInput}
              onChangeText={setParentLastNameInput}
              placeholder="Last name (optional)..."
              placeholderTextColor={colors.textMuted}
              returnKeyType="next"
              maxLength={30}
              onSubmitEditing={() => {
                if (accountRole === "caregiver" && !parentNameInput.trim()) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStep(accountRole === "caregiver" ? "organization" : "name");
              }}
            />

            <Pressable
              disabled={accountRole === "caregiver" && !parentNameInput.trim()}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: accountRole === "caregiver" && !parentNameInput.trim() ? colors.border : COLORS.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStep(accountRole === "caregiver" ? "organization" : "name"); }}
            >
              <Text style={styles.primaryBtnText}>
                {accountRole === "caregiver" ? "Continue" : parentNameInput.trim() ? "Continue" : "Skip for now"}
              </Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("role")} colors={colors} />
          </View>
        )}

        {step === "organization" && (
          <View style={styles.stepContainer}>
            <StepBadge label="Step 3 of 3" colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>Your Organization</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              Where do you provide care? For example, a school or clinic name. Optional.
            </Text>

            <TextInput
              style={[
                styles.nameInput,
                {
                  backgroundColor: colors.card,
                  borderColor: organizationInput.trim() ? COLORS.primary : colors.border,
                  color: colors.text,
                },
              ]}
              value={organizationInput}
              onChangeText={setOrganizationInput}
              placeholder="Organization (optional)..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              maxLength={60}
              onSubmitEditing={() => { if (!isSaving) finishCaregiverSetup(); }}
            />

            <Pressable
              disabled={isSaving}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: COLORS.primary, opacity: pressed || isSaving ? 0.85 : 1 },
              ]}
              onPress={() => { if (!isSaving) finishCaregiverSetup(); }}
            >
              <Text style={styles.primaryBtnText}>
                {isSaving ? "Setting up…" : organizationInput.trim() ? "Finish" : "Skip & Finish"}
              </Text>
              <Feather name={isSaving ? "loader" : "check"} size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("parent_name")} colors={colors} />
          </View>
        )}

        {step === "name" && (
          <View style={styles.stepContainer}>
            <StepBadge label={accountRole === "parent" ? "Step 3 of 6" : "Step 2 of 5"} colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>
              {accountRole === "parent" ? "What's your child's name?" : "What's your name?"}
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              {accountRole === "parent"
                ? "This personalizes their Glucose Guardian experience"
                : "This personalizes your Glucose Guardian experience"}
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
              placeholder={accountRole === "parent" ? "Child's first name..." : "Your first name..."}
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="next"
              maxLength={30}
            />
            <TextInput
              style={[
                styles.nameInput,
                { marginTop: 12, backgroundColor: colors.card, borderColor: childLastName.trim() ? COLORS.primary : colors.border, color: colors.text },
              ]}
              value={childLastName}
              onChangeText={setChildLastName}
              placeholder="Last name (optional)..."
              placeholderTextColor={colors.textMuted}
              returnKeyType="next"
              maxLength={30}
            />

            <View style={{ width: "100%", gap: 6 }}>
              <Text style={[styles.dobLabel, { color: colors.textMuted }]}>Weight (lbs) — optional</Text>
              <TextInput
                style={[
                  styles.nameInput,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
                ]}
                value={weightLbs}
                onChangeText={(v) => setWeightLbs(v.replace(/[^0-9.]/g, ""))}
                placeholder="e.g. 85"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                returnKeyType="done"
                onSubmitEditing={() => { if (childName.trim()) setStep("birthday"); }}
                maxLength={6}
              />
            </View>

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
            <BackBtn onPress={() => setStep(accountRole === "parent" ? "parent_name" : "role")} colors={colors} />
          </View>
        )}

        {step === "birthday" && (
          <View style={styles.stepContainer}>
            <StepBadge label={accountRole === "parent" ? "Step 4 of 6" : "Step 3 of 5"} colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>
              {accountRole === "parent" && childName.trim() ? `${childName.trim()}'s Date of Birth` : "Date of Birth"}
            </Text>
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
                      ? "Full access to health data and settings"
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
            <StepBadge label={accountRole === "parent" ? "Step 5 of 6" : "Step 4 of 5"} colors={colors} />
            <Text style={[styles.stepTitle, { color: colors.text }]}>Diabetes Type</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              {accountRole === "parent" ? `Helps calibrate insulin calculations for ${childName}` : "Helps calibrate your insulin calculations"}
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

            <View style={[styles.insulinSection, { borderColor: colors.border }]}>
              <View style={styles.insulinSectionHeader}>
                <Feather name="droplet" size={15} color={COLORS.accent} />
                <Text style={[styles.insulinSectionTitle, { color: colors.text }]}>
                  Insulin Types Used
                </Text>
                <Text style={[styles.insulinSectionOptional, { color: colors.textMuted }]}>Optional</Text>
              </View>
              <Text style={[styles.insulinSectionSub, { color: colors.textMuted }]}>
                Select any that apply — you can change this later
              </Text>
              {(["rapid", "long", "ultra-long", "regular", "intermediate", "premixed"] as const).map((groupType) => {
                const groupOptions = INSULIN_OPTIONS.filter((o) => o.type === groupType);
                return (
                  <View key={groupType} style={styles.insulinGroup}>
                    <Text style={[styles.insulinGroupLabel, { color: colors.textMuted }]}>
                      {INSULIN_TYPE_LABEL[groupType].toUpperCase()}
                    </Text>
                    <View style={styles.insulinChipsRow}>
                      {groupOptions.map((opt) => {
                        const chipLabel = insulinChipLabel(opt);
                        const selected = insulinTypes.includes(chipLabel);
                        return (
                          <Pressable
                            key={opt.name}
                            style={[
                              styles.insulinChip,
                              {
                                backgroundColor: selected ? COLORS.accent + "18" : colors.card,
                                borderColor: selected ? COLORS.accent : colors.border,
                              },
                            ]}
                            onPress={() => toggleInsulinType(chipLabel)}
                          >
                            {selected && <Feather name="check" size={12} color={COLORS.accent} />}
                            <View>
                              <Text style={[styles.insulinChipName, { color: selected ? COLORS.accent : colors.text }]}>
                                {opt.name}
                              </Text>
                              <Text style={[styles.insulinChipConc, { color: selected ? COLORS.accent + "99" : colors.textMuted }]}>
                                {opt.concentration}
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 },
              ]}
              onPress={advanceFromDiabetes}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("birthday")} colors={colors} />
          </View>
        )}

        {step === "insulin_formula" && (
          <View style={styles.stepContainer}>
            <StepBadge label={accountRole === "parent" ? "Step 6 of 6" : "Step 5 of 5"} colors={colors} />

            <View style={[styles.logoCircle, { backgroundColor: COLORS.primary + "12" }]}>
              <Feather name="activity" size={32} color={COLORS.primary} />
            </View>

            <Text style={[styles.stepTitle, { color: colors.text }]}>Insulin Formula</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              {accountRole === "parent"
                ? `Enter ${childName || "your child"}'s doctor-prescribed settings. You can update these any time in Settings.`
                : "Enter your doctor-prescribed settings. You can update these any time."}
            </Text>

            <View style={[styles.insulinSection, { borderColor: colors.border }]}>
              <View style={styles.insulinSectionHeader}>
                <Feather name="divide" size={15} color={COLORS.primary} />
                <Text style={[styles.insulinSectionTitle, { color: colors.text }]}>Carb Ratio</Text>
                <Text style={[styles.insulinSectionOptional, { color: colors.textMuted }]}>Optional</Text>
              </View>
              <Text style={[styles.insulinSectionSub, { color: colors.textMuted }]}>
                {accountRole === "parent"
                  ? `Grams of carbs per ${carbUnitHalf ? "½ unit" : "1 unit"} of insulin for ${childName || "your child"}`
                  : `Grams of carbs per ${carbUnitHalf ? "½ unit" : "1 unit"} of insulin`}
              </Text>
              <View style={[styles.carbUnitToggleRow, { marginTop: 10, marginBottom: 8 }]}>
                {([false, true] as const).map((isHalf) => (
                  <Pressable
                    key={String(isHalf)}
                    style={[styles.carbUnitBtn, { backgroundColor: carbUnitHalf === isHalf ? COLORS.primary + "18" : colors.card, borderColor: carbUnitHalf === isHalf ? COLORS.primary : colors.border }]}
                    onPress={() => { setCarbUnitHalf(isHalf); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    {carbUnitHalf === isHalf && <Feather name="check" size={13} color={COLORS.primary} />}
                    <Text style={[styles.carbUnitBtnText, { color: carbUnitHalf === isHalf ? COLORS.primary : colors.textMuted }]}>
                      {isHalf ? "½ unit" : "1 unit"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text style={[styles.insulinSectionSub, { color: colors.textMuted, marginTop: 0 }]}>per</Text>
                <TextInput
                  style={[styles.nameInput, { flex: 1, backgroundColor: colors.card, borderColor: carbRatioInput.trim() ? COLORS.primary : colors.border, color: colors.text, marginTop: 0, textAlign: "center" }]}
                  value={carbRatioInput}
                  onChangeText={(v) => setCarbRatioInput(v.replace(/[^0-9.]/g, ""))}
                  placeholder={carbUnitHalf ? "e.g. 20" : "e.g. 40"}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                  maxLength={5}
                />
                <Text style={[styles.insulinSectionSub, { color: colors.textMuted, marginTop: 0 }]}>g of carbs</Text>
              </View>
              {carbRatioInput.trim() !== "" && !isNaN(parseFloat(carbRatioInput)) && (
                <Text style={[styles.insulinSectionSub, { color: COLORS.primary + "BB", marginTop: 6 }]}>
                  = 1 unit covers {carbUnitHalf ? parseFloat(carbRatioInput) * 2 : parseFloat(carbRatioInput)}g of carbs
                </Text>
              )}
            </View>

            <View style={[styles.insulinSection, { borderColor: colors.border, marginTop: 4 }]}>
              <View style={styles.insulinSectionHeader}>
                <Feather name="crosshair" size={15} color={COLORS.accent} />
                <Text style={[styles.insulinSectionTitle, { color: colors.text }]}>Target Glucose</Text>
                <Text style={[styles.insulinSectionOptional, { color: colors.textMuted }]}>Optional</Text>
              </View>
              <Text style={[styles.insulinSectionSub, { color: colors.textMuted }]}>
                {accountRole === "parent"
                  ? `${childName || "Your child"}'s target blood sugar set by the doctor (e.g. 125 mg/dL)`
                  : "Your target blood sugar set by the doctor (e.g. 110 mg/dL)"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
                <TextInput
                  style={[styles.nameInput, { flex: 1, backgroundColor: colors.card, borderColor: targetGlucoseInput.trim() ? COLORS.accent : colors.border, color: colors.text, marginTop: 0, textAlign: "center" }]}
                  value={targetGlucoseInput}
                  onChangeText={(v) => setTargetGlucoseInput(v.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 125"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <Text style={[styles.insulinSectionSub, { color: colors.textMuted, marginTop: 0 }]}>mg/dL</Text>
              </View>
            </View>

            <View style={[styles.insulinSection, { borderColor: colors.border, marginTop: 4 }]}>
              <View style={styles.insulinSectionHeader}>
                <Feather name="trending-down" size={15} color={COLORS.danger} />
                <Text style={[styles.insulinSectionTitle, { color: colors.text }]}>Sensitivity Factor (ISF)</Text>
                <Text style={[styles.insulinSectionOptional, { color: colors.textMuted }]}>Optional</Text>
              </View>
              <Text style={[styles.insulinSectionSub, { color: colors.textMuted }]}>
                {accountRole === "parent"
                  ? `How many mg/dL 1 unit drops ${childName || "your child"}'s glucose (e.g. 125)`
                  : "How many mg/dL 1 unit drops your glucose (e.g. 50)"}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 }}>
                <TextInput
                  style={[styles.nameInput, { flex: 1, backgroundColor: colors.card, borderColor: isfInput.trim() ? COLORS.danger : colors.border, color: colors.text, marginTop: 0, textAlign: "center" }]}
                  value={isfInput}
                  onChangeText={(v) => setIsfInput(v.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 125"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <Text style={[styles.insulinSectionSub, { color: colors.textMuted, marginTop: 0 }]}>mg/dL / unit</Text>
              </View>
            </View>

            {targetGlucoseInput.trim() !== "" && isfInput.trim() !== "" && carbRatioInput.trim() !== "" && (
              <View style={[styles.insulinSection, { borderColor: COLORS.primary + "50", marginTop: 4, backgroundColor: COLORS.primary + "08" }]}>
                <View style={styles.insulinSectionHeader}>
                  <Feather name="check-circle" size={14} color={COLORS.primary} />
                  <Text style={[styles.insulinSectionTitle, { color: COLORS.primary, fontSize: 12 }]}>Formula preview</Text>
                </View>
                <Text style={[styles.insulinSectionSub, { color: colors.textSecondary }]}>
                  Correction = (glucose − {targetGlucoseInput}) ÷ {isfInput}{"\n"}
                  Carb dose = carbs ÷ {carbUnitHalf ? parseFloat(carbRatioInput || "0") * 2 : parseFloat(carbRatioInput || "0")}{"\n"}
                  Total = correction + carb dose (round at the very end)
                </Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: COLORS.primary, opacity: pressed || isSaving ? 0.85 : 1 },
              ]}
              onPress={advanceFromInsulinFormula}
              disabled={isSaving}
            >
              <Text style={styles.primaryBtnText}>
                {isSaving ? "Setting up..." : `Let's go, ${childName || "you"}!`}
              </Text>
              <Feather name="check" size={18} color="#fff" />
            </Pressable>
            <BackBtn onPress={() => setStep("diabetes")} colors={colors} />
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
  badgeText: { fontSize: 13, fontWeight: "600" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  backBtnText: { fontSize: 14, fontWeight: "500" },
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
  bigTitle: { fontSize: 34, fontWeight: "700", textAlign: "center" },
  bigSubtitle: {
    fontSize: 16,
    fontWeight: "400",
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
  featureText: { fontSize: 15, fontWeight: "500", flex: 1 },
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
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  stepTitle: { fontSize: 28, fontWeight: "700", textAlign: "center" },
  stepSubtitle: {
    fontSize: 15,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 22,
  },
  nameInput: {
    width: "100%",
    fontSize: 20,
    fontWeight: "600",
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
  dobLabel: { fontSize: 12, fontWeight: "600", textAlign: "center" },
  dobInput: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  dobSeparator: { fontSize: 24, fontWeight: "700", paddingBottom: 14 },
  ageBadge: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  ageBadgeTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  ageBadgeSub: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
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
  typeOptionLeft: { flex: 1, gap: 2 },
  typeOptionTitle: { fontSize: 17, fontWeight: "700" },
  typeOptionDesc: { fontSize: 13, fontWeight: "400" },
  roleIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginRight: 6, flexShrink: 0 },

  insulinSection: { width: "100%", borderTopWidth: 1, paddingTop: 16, gap: 12 },
  insulinSectionHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  insulinSectionTitle: { fontSize: 15, fontWeight: "600", flex: 1 },
  insulinSectionOptional: { fontSize: 12, fontWeight: "400", fontStyle: "italic" },
  insulinSectionSub: { fontSize: 12, fontWeight: "400", lineHeight: 17, marginTop: -4 },
  insulinGroup: { gap: 6 },
  insulinGroupLabel: { fontSize: 10, fontWeight: "600", letterSpacing: 0.8 },
  insulinChipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  insulinChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5 },
  insulinChipName: { fontSize: 13, fontWeight: "600" },
  insulinChipConc: { fontSize: 10, fontWeight: "400" },
  insulinChipText: { fontSize: 13, fontWeight: "500" },
  carbUnitToggleRow: { flexDirection: "row", gap: 10 },
  carbUnitBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  carbUnitBtnText: { fontSize: 14, fontWeight: "600" },
});
