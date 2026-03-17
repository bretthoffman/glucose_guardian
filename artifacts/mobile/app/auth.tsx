import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";

type Mode = "signin" | "create";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme !== "light";
  const { createAccount, signIn, account, isLoading } = useAuth();
  const { resetGlucoseData } = useGlucose();

  const [mode, setMode] = useState<Mode>(account ? "signin" : "create");
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const slideAnim = useRef(new Animated.Value(account ? 1 : 0)).current;
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: mode === "signin" ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [mode]);

  async function handleSubmit() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      Alert.alert("Missing Info", "Please enter your email and password.");
      return;
    }
    if (!trimmedEmail.includes("@")) {
      Alert.alert("Invalid Email", "Please enter a valid email address.");
      return;
    }

    if (mode === "create") {
      if (password.length < 6) {
        Alert.alert("Weak Password", "Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert("Password Mismatch", "Passwords do not match.");
        return;
      }
      setIsSubmitting(true);
      try {
        resetGlucoseData();
        await createAccount(trimmedEmail, password);
      } catch {
        Alert.alert("Error", "Could not create account. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setIsSubmitting(true);
      try {
        const ok = await signIn(trimmedEmail, password);
        if (!ok) {
          Alert.alert("Sign In Failed", "Incorrect email or password.");
        }
      } catch {
        Alert.alert("Error", "Could not sign in. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.loadingScreen, { backgroundColor: "#0B1120" }]}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const bg = "#0B1120";
  const cardBg = isDark ? "#111827" : "#1a2235";
  const inputBg = "rgba(255,255,255,0.06)";
  const borderColor = "rgba(255,255,255,0.10)";
  const textColor = "#FFFFFF";
  const subtextColor = "rgba(255,255,255,0.55)";

  const tabIndicatorLeft = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "50%"],
  });

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: bg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: (Platform.OS === "web" ? 60 : insets.top) + 24, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.logoImg}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.appName, { color: textColor }]}>Glucose Guardian</Text>
          <Text style={[styles.tagline, { color: subtextColor }]}>
            Your AI-powered diabetes companion
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: cardBg, borderColor }]}>
          <View style={[styles.tabRow, { backgroundColor: "rgba(255,255,255,0.06)", borderColor }]}>
            <Animated.View
              style={[
                styles.tabIndicator,
                { backgroundColor: COLORS.primary, left: tabIndicatorLeft },
              ]}
            />
            <Pressable
              style={styles.tab}
              onPress={() => {
                setMode("create");
                setPassword("");
                setConfirmPassword("");
              }}
            >
              <Text style={[styles.tabText, { color: mode === "create" ? "#fff" : subtextColor }]}>
                Create Account
              </Text>
            </Pressable>
            <Pressable
              style={styles.tab}
              onPress={() => {
                setMode("signin");
                setPassword("");
                setConfirmPassword("");
              }}
            >
              <Text style={[styles.tabText, { color: mode === "signin" ? "#fff" : subtextColor }]}>
                Sign In
              </Text>
            </Pressable>
          </View>

          <View style={styles.fields}>
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: subtextColor }]}>Email</Text>
              <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor }]}>
                <Feather name="mail" size={16} color={subtextColor} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: textColor }]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: subtextColor }]}>Password</Text>
              <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor }]}>
                <Feather name="lock" size={16} color={subtextColor} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { color: textColor }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={mode === "create" ? "Min. 6 characters" : "Your password"}
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  secureTextEntry={!showPassword}
                  returnKeyType={mode === "create" ? "next" : "done"}
                  onSubmitEditing={() => {
                    if (mode === "create") confirmRef.current?.focus();
                    else handleSubmit();
                  }}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={16}
                    color={subtextColor}
                  />
                </Pressable>
              </View>
            </View>

            {mode === "create" && (
              <View style={styles.fieldGroup}>
                <Text style={[styles.label, { color: subtextColor }]}>Confirm Password</Text>
                <View style={[styles.inputWrap, { backgroundColor: inputBg, borderColor }]}>
                  <Feather name="lock" size={16} color={subtextColor} style={styles.inputIcon} />
                  <TextInput
                    ref={confirmRef}
                    style={[styles.input, { color: textColor }]}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Re-enter password"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              </View>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: COLORS.primary, opacity: pressed || isSubmitting ? 0.8 : 1 },
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.submitText}>
                  {mode === "create" ? "Create Account" : "Sign In"}
                </Text>
                <Feather name="arrow-right" size={18} color="#fff" />
              </>
            )}
          </Pressable>

          {mode === "create" && (
            <Text style={[styles.disclaimer, { color: subtextColor }]}>
              Your data is stored securely on this device only.
            </Text>
          )}

          {mode === "signin" && account && (
            <Pressable
              onPress={() => {
                setMode("create");
                setEmail("");
                setPassword("");
              }}
              style={styles.switchLink}
            >
              <Text style={[styles.switchText, { color: COLORS.primary }]}>
                Not your account? Create a new one
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.features}>
          {[
            { icon: "activity", text: "Real-time glucose monitoring" },
            { icon: "cpu", text: "AI carb estimation from photos" },
            { icon: "shield", text: "Guardian PIN parental controls" },
          ].map((f) => (
            <View key={f.icon} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: COLORS.primary + "20" }]}>
                <Feather name={f.icon as any} size={14} color={COLORS.primary} />
              </View>
              <Text style={[styles.featureText, { color: subtextColor }]}>{f.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 24 },

  hero: {
    alignItems: "center",
    marginBottom: 32,
  },
  logoWrap: { marginBottom: 16, alignItems: "center" },
  logoImg: {
    width: 110,
    height: 110,
  },
  appName: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },

  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    marginBottom: 28,
  },

  tabRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    marginBottom: 24,
    height: 44,
  },
  tabIndicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "50%",
    borderRadius: 10,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    zIndex: 1,
  },

  fields: { gap: 16, marginBottom: 20 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginLeft: 2 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    height: 50,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  eyeBtn: { padding: 4 },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    height: 52,
    gap: 8,
    marginBottom: 14,
  },
  submitText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },

  disclaimer: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  switchLink: { alignItems: "center", marginTop: 8 },
  switchText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },

  features: { gap: 12 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
