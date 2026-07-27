import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { NO_AUTO_CONTENT_INSETS } from "@/utils/scrollInsets";
import AccessCodeScanner from "@/components/AccessCodeScanner";
import * as Haptics from "expo-haptics";

type Mode = "signin" | "create";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const isDark = scheme !== "light";
  const { createAccount, signIn, signInWithGoogle, verifyEmailCode, requestPasswordReset, resetPassword, account, isLoading, enterCaregiverMode, enterDoctorMode } = useAuth();
  const { resetGlucoseData } = useGlucose();

  const [mode, setMode] = useState<Mode>(account ? "signin" : "create");
  const [email, setEmail] = useState(account?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Sub-flows layered over the main form: "verify" collects the sign-up code, "forgot" collects the
  // reset code + a new password. Both are Clerk-driven.
  const [subFlow, setSubFlow] = useState<"none" | "verify" | "forgot">("none");
  const [codeInput, setCodeInput] = useState("");
  const [resetPasswordInput, setResetPasswordInput] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [showCaregiverEntry, setShowCaregiverEntry] = useState(false);
  const [caregiverCode, setCaregiverCode] = useState("");
  const [caregiverError, setCaregiverError] = useState("");
  const [caregiverSubmitting, setCaregiverSubmitting] = useState(false);
  const [codeScannerOpen, setCodeScannerOpen] = useState(false);

  /** Shared by the Enter button and the QR scanner (which passes its freshly-scanned code). */
  const submitAccessCode = async (code: string) => {
    if (code.length < 6 || caregiverSubmitting) return;
    setCaregiverSubmitting(true);
    try {
      const ok = await enterCaregiverMode(code);
      if (ok) {
        router.replace("/(tabs)");
      } else {
        setCaregiverError("Invalid, expired, or out-of-schedule code. Ask the account owner for a caregiver code.");
      }
    } finally {
      setCaregiverSubmitting(false);
    }
  };
  const [showDoctorEntry, setShowDoctorEntry] = useState(false);
  const [doctorCode, setDoctorCode] = useState("");
  const [doctorError, setDoctorError] = useState("");

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
        const res = await createAccount(trimmedEmail, password);
        if (res.status === "needs_verification") {
          setSubFlow("verify");
          Alert.alert("Check your email", `We sent a verification code to ${trimmedEmail}.`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not create account. Please try again.";
        Alert.alert("Error", msg);
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

  async function handleGoogle() {
    setIsSubmitting(true);
    try {
      resetGlucoseData();
      const ok = await signInWithGoogle();
      // `false` also means "user closed the browser sheet", so stay quiet unless it truly failed.
      if (!ok) setIsSubmitting(false);
    } catch {
      Alert.alert("Google sign-in failed", "Please try again, or use your email and password.");
      setIsSubmitting(false);
    }
  }

  async function handleVerifyCode() {
    if (!codeInput.trim()) return;
    setIsSubmitting(true);
    try {
      const ok = await verifyEmailCode(codeInput.trim());
      if (!ok) Alert.alert("Incorrect code", "That code didn't work. Check your email and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendReset() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail.includes("@")) {
      Alert.alert("Enter your email", "Type the email address for your account first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const ok = await requestPasswordReset(trimmedEmail);
      // Deliberately identical messaging either way — never reveal whether an email is registered.
      setResetSent(true);
      Alert.alert("Check your email", `If an account exists for ${trimmedEmail}, we sent a reset code.`);
      if (!ok) setResetSent(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword() {
    if (!codeInput.trim() || resetPasswordInput.length < 8) {
      Alert.alert("Missing info", "Enter the emailed code and a new password (8+ characters).");
      return;
    }
    setIsSubmitting(true);
    try {
      const ok = await resetPassword(codeInput.trim(), resetPasswordInput);
      if (!ok) Alert.alert("Couldn't reset", "That code didn't work or has expired. Request a new one.");
    } finally {
      setIsSubmitting(false);
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
        {...NO_AUTO_CONTENT_INSETS}
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
          {/* Google sits ABOVE the email form — it's the fastest path in, and the divider makes clear
              the form below is the alternative rather than a required step. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
            disabled={isSubmitting}
            onPress={handleGoogle}
            style={({ pressed }) => [styles.googleBtn, { opacity: pressed || isSubmitting ? 0.75 : 1 }]}
          >
            <Text style={styles.googleG}>G</Text>
            <Text style={styles.googleText}>Continue with Google</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: borderColor }]} />
            <Text style={[styles.dividerText, { color: subtextColor }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: borderColor }]} />
          </View>

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
                // Already on Sign In: just close the keyboard — don't clear a typed password.
                if (mode === "signin") {
                  Keyboard.dismiss();
                  return;
                }
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

          {mode === "signin" && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCodeInput("");
                setResetPasswordInput("");
                setResetSent(false);
                setSubFlow("forgot");
              }}
              style={styles.forgotBtn}
            >
              <Text style={[styles.forgotText, { color: subtextColor }]}>Forgot your password?</Text>
            </Pressable>
          )}

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

        <View style={[styles.caregiverSection, { borderColor: "rgba(255,255,255,0.10)" }]}>
          {!showCaregiverEntry && !showDoctorEntry ? (
            <View style={{ gap: 10 }}>
              <Pressable
                style={styles.caregiverLink}
                onPress={() => { setShowCaregiverEntry(true); setCaregiverError(""); }}
              >
                <Feather name="users" size={14} color={COLORS.accent} />
                <Text style={[styles.caregiverLinkText, { color: COLORS.accent }]}>
                  Sign in with access code →
                </Text>
              </Pressable>
              <Pressable
                style={styles.caregiverLink}
                onPress={() => { setShowDoctorEntry(true); setDoctorError(""); }}
              >
                <Feather name="activity" size={14} color="#6366F1" />
                <Text style={[styles.caregiverLinkText, { color: "#6366F1" }]}>
                  Doctor / Provider? Enter your code →
                </Text>
              </Pressable>
            </View>
          ) : showCaregiverEntry ? (
            <View style={styles.caregiverForm}>
              <Text style={[styles.caregiverFormTitle, { color: "#fff" }]}>Sign In with Access Code</Text>
              <Text style={[styles.caregiverFormSub, { color: "rgba(255,255,255,0.55)" }]}>
                Enter the code shared by the account owner
              </Text>
              <View style={[styles.caregiverInputWrap, { backgroundColor: "rgba(255,255,255,0.06)", borderColor: caregiverError ? COLORS.danger : "rgba(255,255,255,0.15)" }]}>
                <Feather name="key" size={15} color="rgba(255,255,255,0.5)" />
                <TextInput
                  style={[styles.caregiverInput, { color: "#fff" }]}
                  value={caregiverCode}
                  onChangeText={(v) => { setCaregiverCode(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)); setCaregiverError(""); }}
                  placeholder="ABCD2345"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                />
                <Text style={[styles.caregiverCounter, { color: "rgba(255,255,255,0.35)" }]}>{caregiverCode.length}</Text>
                {/* Scan the QR shown on the sharer's device — fills the field and signs in itself. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan access code QR"
                  hitSlop={8}
                  style={({ pressed }) => [styles.caregiverScanBtn, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCodeScannerOpen(true); }}
                >
                  <Feather name="camera" size={17} color={COLORS.accent} />
                </Pressable>
              </View>
              {caregiverError ? (
                <Text style={[styles.caregiverError, { color: COLORS.danger }]}>{caregiverError}</Text>
              ) : null}
              <View style={styles.caregiverBtns}>
                <Pressable
                  style={[styles.caregiverCancelBtn, { borderColor: "rgba(255,255,255,0.15)" }]}
                  onPress={() => { setShowCaregiverEntry(false); setCaregiverCode(""); setCaregiverError(""); }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "500" }}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.caregiverSubmitBtn, { backgroundColor: caregiverCode.length >= 6 ? COLORS.accent : "rgba(255,255,255,0.12)", opacity: caregiverCode.length >= 6 ? 1 : 0.6 }]}
                  disabled={caregiverCode.length < 6 || caregiverSubmitting}
                  onPress={() => void submitAccessCode(caregiverCode)}
                >
                  {caregiverSubmitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="unlock" size={15} color="#fff" />
                      <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Enter</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.caregiverForm}>
              <Text style={[styles.caregiverFormTitle, { color: "#fff" }]}>Doctor / Provider Access</Text>
              <Text style={[styles.caregiverFormSub, { color: "rgba(255,255,255,0.55)" }]}>
                Enter the 6-character doctor code to access editing permissions
              </Text>
              <View style={[styles.caregiverInputWrap, { backgroundColor: "rgba(255,255,255,0.06)", borderColor: doctorError ? COLORS.danger : "rgba(99,102,241,0.35)" }]}>
                <Feather name="activity" size={15} color="rgba(99,102,241,0.7)" />
                <TextInput
                  style={[styles.caregiverInput, { color: "#fff" }]}
                  value={doctorCode}
                  onChangeText={(v) => { setDoctorCode(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)); setDoctorError(""); }}
                  placeholder="ABC123"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                />
                <Text style={[styles.caregiverCounter, { color: "rgba(255,255,255,0.35)" }]}>{doctorCode.length}/6</Text>
              </View>
              {doctorError ? (
                <Text style={[styles.caregiverError, { color: COLORS.danger }]}>{doctorError}</Text>
              ) : null}
              <View style={styles.caregiverBtns}>
                <Pressable
                  style={[styles.caregiverCancelBtn, { borderColor: "rgba(255,255,255,0.15)" }]}
                  onPress={() => { setShowDoctorEntry(false); setDoctorCode(""); setDoctorError(""); }}
                >
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: "500" }}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.caregiverSubmitBtn, { backgroundColor: doctorCode.length === 6 ? "#6366F1" : "rgba(255,255,255,0.12)", opacity: doctorCode.length === 6 ? 1 : 0.6 }]}
                  disabled={doctorCode.length < 6}
                  onPress={() => {
                    const ok = enterDoctorMode(doctorCode);
                    if (ok) {
                      router.replace("/(tabs)");
                    } else {
                      setDoctorError("Invalid code. Ask the patient's account holder for the correct doctor code.");
                    }
                  }}
                >
                  <Feather name="unlock" size={15} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Enter</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sub-flows. Both are Clerk-driven and layered over the form so the user never loses context. */}
      <Modal visible={subFlow !== "none"} transparent animationType="fade" onRequestClose={() => setSubFlow("none")}>
        <View style={styles.flowBackdrop}>
          <View style={[styles.flowCard, { backgroundColor: cardBg, borderColor }]}>
            {subFlow === "verify" ? (
              <>
                <Text style={[styles.flowTitle, { color: textColor }]}>Verify your email</Text>
                <Text style={[styles.flowSub, { color: subtextColor }]}>
                  Enter the code we sent to {email.trim().toLowerCase()} to finish creating your account.
                </Text>
                <TextInput
                  style={[styles.flowInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                  value={codeInput}
                  onChangeText={setCodeInput}
                  placeholder="6-digit code"
                  placeholderTextColor={subtextColor}
                  keyboardType="number-pad"
                  autoFocus
                />
                <View style={styles.flowActions}>
                  <Pressable
                    style={[styles.flowBtn, { backgroundColor: inputBg }]}
                    onPress={() => setSubFlow("none")}
                    disabled={isSubmitting}
                  >
                    <Text style={[styles.flowBtnText, { color: subtextColor }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.flowBtn, { backgroundColor: COLORS.primary, opacity: isSubmitting ? 0.7 : 1 }]}
                    onPress={handleVerifyCode}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={[styles.flowBtnText, { color: "#fff" }]}>Verify</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.flowTitle, { color: textColor }]}>Reset your password</Text>
                <Text style={[styles.flowSub, { color: subtextColor }]}>
                  {resetSent
                    ? "Enter the code from your email and choose a new password."
                    : `We'll email a reset code to ${email.trim().toLowerCase() || "your account"}.`}
                </Text>
                {resetSent && (
                  <>
                    <TextInput
                      style={[styles.flowInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                      value={codeInput}
                      onChangeText={setCodeInput}
                      placeholder="Reset code"
                      placeholderTextColor={subtextColor}
                      keyboardType="number-pad"
                    />
                    <TextInput
                      style={[styles.flowInput, { backgroundColor: inputBg, borderColor, color: textColor }]}
                      value={resetPasswordInput}
                      onChangeText={setResetPasswordInput}
                      placeholder="New password (8+ characters)"
                      placeholderTextColor={subtextColor}
                      secureTextEntry
                    />
                  </>
                )}
                <View style={styles.flowActions}>
                  <Pressable
                    style={[styles.flowBtn, { backgroundColor: inputBg }]}
                    onPress={() => setSubFlow("none")}
                    disabled={isSubmitting}
                  >
                    <Text style={[styles.flowBtnText, { color: subtextColor }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.flowBtn, { backgroundColor: COLORS.primary, opacity: isSubmitting ? 0.7 : 1 }]}
                    onPress={resetSent ? handleResetPassword : handleSendReset}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={[styles.flowBtnText, { color: "#fff" }]}>
                        {resetSent ? "Reset password" : "Send code"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* QR scanner for "Sign in with access code": on recognition it fills the field, closes
          itself, and signs in automatically. */}
      <AccessCodeScanner
        visible={codeScannerOpen}
        onClose={() => setCodeScannerOpen(false)}
        onScanned={(code) => {
          setCodeScannerOpen(false);
          setCaregiverCode(code);
          setCaregiverError("");
          void submitAccessCode(code);
        }}
      />
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
    fontWeight: "700",
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    fontWeight: "400",
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
    fontWeight: "600",
    zIndex: 1,
  },

  fields: { gap: 16, marginBottom: 20 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 12, fontWeight: "500", marginLeft: 2 },
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
    fontWeight: "400",
  },
  eyeBtn: { padding: 4 },

  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 14,
  },
  googleG: { fontSize: 18, fontWeight: "800", color: "#4285F4" },
  googleText: { fontSize: 15, fontWeight: "700", color: "#1F1F1F" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: "500" },
  forgotBtn: { alignItems: "center", paddingVertical: 12 },
  forgotText: { fontSize: 13, fontWeight: "500", textDecorationLine: "underline" },
  flowBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 24 },
  flowCard: { borderRadius: 20, borderWidth: 1, padding: 22, gap: 12 },
  flowTitle: { fontSize: 18, fontWeight: "800" },
  flowSub: { fontSize: 13, fontWeight: "400", lineHeight: 19 },
  flowInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "500",
  },
  flowActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  flowBtn: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  flowBtnText: { fontSize: 14, fontWeight: "700" },
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
    fontWeight: "700",
    color: "#fff",
  },

  disclaimer: {
    fontSize: 11,
    fontWeight: "400",
    textAlign: "center",
  },
  switchLink: { alignItems: "center", marginTop: 8 },
  switchText: {
    fontSize: 13,
    fontWeight: "500",
  },

  features: { gap: 12, marginBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 13, fontWeight: "400", flex: 1 },

  caregiverSection: { borderTopWidth: 1, paddingTop: 20 },
  caregiverLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 8 },
  caregiverLinkText: { fontSize: 14, fontWeight: "500" },
  caregiverForm: { gap: 12 },
  caregiverFormTitle: { fontSize: 16, fontWeight: "700", textAlign: "center" },
  caregiverFormSub: { fontSize: 13, fontWeight: "400", textAlign: "center", lineHeight: 18 },
  caregiverInputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  caregiverInput: { flex: 1, fontSize: 20, fontWeight: "700", letterSpacing: 4, textAlign: "center" },
  caregiverCounter: { fontSize: 12, fontWeight: "400" },
  caregiverScanBtn: { paddingLeft: 8, paddingVertical: 2 },
  caregiverError: { fontSize: 12, fontWeight: "400", textAlign: "center" },
  caregiverBtns: { flexDirection: "row", gap: 10 },
  caregiverCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  caregiverSubmitBtn: { flex: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 12 },
});
