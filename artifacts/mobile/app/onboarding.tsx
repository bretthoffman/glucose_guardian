import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
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
import { useAuth } from "@/context/AuthContext";

type Step = "welcome" | "name" | "diabetes" | "done";

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { setupProfile } = useAuth();

  const [step, setStep] = useState<Step>("welcome");
  const [childName, setChildName] = useState("");
  const [diabetesType, setDiabetesType] = useState<"type1" | "type2" | "other">("type1");
  const [isSaving, setIsSaving] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  async function finish() {
    if (!childName.trim()) return;
    setIsSaving(true);
    try {
      await setupProfile({ childName: childName.trim(), diabetesType });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch {
      setIsSaving(false);
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
          {
            paddingTop: topPadding + 40,
            paddingBottom: bottomPadding + 40,
            minHeight: "100%",
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === "welcome" && (
          <View style={styles.stepContainer}>
            <View style={[styles.logoCircle, { backgroundColor: COLORS.primary + "20" }]}>
              <Feather name="shield" size={56} color={COLORS.primary} />
            </View>
            <Text style={[styles.bigTitle, { color: colors.text }]}>Gluco Guardian</Text>
            <Text style={[styles.bigSubtitle, { color: colors.textSecondary }]}>
              Your AI-powered diabetes companion for kids
            </Text>

            <View style={styles.featureList}>
              {[
                { icon: "activity", text: "Real-time glucose monitoring" },
                { icon: "camera", text: "AI food carb analysis" },
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
            <View style={[styles.stepBadge, { backgroundColor: COLORS.primary + "20" }]}>
              <Text style={[styles.stepBadgeText, { color: COLORS.primary }]}>Step 1 of 2</Text>
            </View>
            <Text style={[styles.stepTitle, { color: colors.text }]}>What's the child's name?</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              This helps personalize their experience
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
              placeholder="Enter child's name..."
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => {
                if (childName.trim()) setStep("diabetes");
              }}
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
              onPress={() => {
                if (childName.trim()) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setStep("diabetes");
                }
              }}
              disabled={!childName.trim()}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </Pressable>

            <Pressable onPress={() => setStep("welcome")} style={styles.backBtn}>
              <Feather name="arrow-left" size={16} color={colors.textMuted} />
              <Text style={[styles.backBtnText, { color: colors.textMuted }]}>Back</Text>
            </Pressable>
          </View>
        )}

        {step === "diabetes" && (
          <View style={styles.stepContainer}>
            <View style={[styles.stepBadge, { backgroundColor: COLORS.primary + "20" }]}>
              <Text style={[styles.stepBadgeText, { color: COLORS.primary }]}>Step 2 of 2</Text>
            </View>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Diabetes Type</Text>
            <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
              This helps calibrate insulin calculations
            </Text>

            {(["type1", "type2", "other"] as const).map((type) => (
              <Pressable
                key={type}
                style={({ pressed }) => [
                  styles.typeOption,
                  {
                    backgroundColor:
                      diabetesType === type ? COLORS.primary + "15" : colors.card,
                    borderColor:
                      diabetesType === type ? COLORS.primary : colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                onPress={() => {
                  setDiabetesType(type);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
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
                      : "MODY, LADA, or other"}
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
                {
                  backgroundColor: COLORS.primary,
                  opacity: pressed || isSaving ? 0.85 : 1,
                },
              ]}
              onPress={finish}
              disabled={isSaving}
            >
              <Text style={styles.primaryBtnText}>
                {isSaving ? "Setting up..." : `Let's Go, ${childName}!`}
              </Text>
              <Feather name="check" size={18} color="#fff" />
            </Pressable>

            <Pressable onPress={() => setStep("name")} style={styles.backBtn}>
              <Feather name="arrow-left" size={16} color={colors.textMuted} />
              <Text style={[styles.backBtnText, { color: colors.textMuted }]}>Back</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  stepContainer: {
    flex: 1,
    alignItems: "center",
    gap: 16,
  },
  logoCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  bigTitle: {
    fontSize: 34,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  bigSubtitle: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 8,
  },
  featureList: {
    width: "100%",
    gap: 10,
    marginBottom: 8,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
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
  primaryBtnText: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  backBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  stepBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 4,
  },
  stepBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  stepTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
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
  typeOptionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
  },
  typeOptionDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});
