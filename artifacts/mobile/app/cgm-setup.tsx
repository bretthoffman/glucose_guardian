import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "";

type CGMType = "dexcom" | "libre";

export default function CGMSetupScreen() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = isDark ? Colors.dark : Colors.light;
  const { cgmConnection, setCGMConnection } = useAuth();

  const [selectedType, setSelectedType] = useState<CGMType>(
    (cgmConnection.type as CGMType) ?? "dexcom"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [outsideUS, setOutsideUS] = useState(cgmConnection.outsideUS ?? false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isConnected = !!cgmConnection.type;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  async function connect() {
    if (!username.trim() || !password.trim()) {
      Alert.alert("Missing Info", "Please enter both username/email and password.");
      return;
    }

    setIsConnecting(true);
    try {
      const endpoint =
        selectedType === "dexcom" ? "/api/cgm/dexcom/connect" : "/api/cgm/libre/connect";
      const body =
        selectedType === "dexcom"
          ? { username: username.trim(), password, outsideUS }
          : { email: username.trim(), password };

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        Alert.alert("Connection Failed", data.error || "Could not connect. Check your credentials.");
        setIsConnecting(false);
        return;
      }

      await setCGMConnection({
        type: selectedType,
        sessionId: data.sessionId,
        token: data.token,
        outsideUS,
        connectedAt: new Date().toISOString(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Connected!",
        `Your ${selectedType === "dexcom" ? "Dexcom" : "FreeStyle Libre"} is now connected. Pull to refresh on the home screen to sync readings.`,
        [{ text: "Great!", onPress: () => router.back() }]
      );
    } catch {
      Alert.alert("Error", "Could not connect. Check your internet connection.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function disconnect() {
    Alert.alert(
      "Disconnect CGM",
      `Disconnect your ${cgmConnection.type === "dexcom" ? "Dexcom" : "FreeStyle Libre"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setIsDisconnecting(true);
            await setCGMConnection({ type: null });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setIsDisconnecting(false);
            router.back();
          },
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isConnected ? (
          <View style={styles.connectedSection}>
            <View
              style={[
                styles.connectedBadge,
                { backgroundColor: COLORS.success + "15", borderColor: COLORS.success + "40" },
              ]}
            >
              <Feather name="check-circle" size={20} color={COLORS.success} />
              <Text style={[styles.connectedTitle, { color: COLORS.success }]}>
                {cgmConnection.type === "dexcom" ? "Dexcom" : "FreeStyle Libre"} Connected
              </Text>
            </View>
            <Text style={[styles.connectedSub, { color: colors.textSecondary }]}>
              Connected{" "}
              {cgmConnection.connectedAt
                ? new Date(cgmConnection.connectedAt).toLocaleDateString()
                : "recently"}
            </Text>
            <Text style={[styles.connectedHint, { color: colors.textMuted }]}>
              Pull down on the home screen to sync your latest CGM readings.
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.disconnectBtn,
                {
                  borderColor: COLORS.danger + "60",
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
              onPress={disconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <ActivityIndicator color={COLORS.danger} size="small" />
              ) : (
                <Feather name="wifi-off" size={16} color={COLORS.danger} />
              )}
              <Text style={[styles.disconnectBtnText, { color: COLORS.danger }]}>
                Disconnect CGM
              </Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {isConnected ? "Switch Device" : "Choose Your CGM Device"}
        </Text>

        <View style={styles.typeRow}>
          {(["dexcom", "libre"] as const).map((type) => (
            <Pressable
              key={type}
              style={({ pressed }) => [
                styles.typeCard,
                {
                  backgroundColor:
                    selectedType === type ? COLORS.primary + "15" : colors.card,
                  borderColor:
                    selectedType === type ? COLORS.primary : colors.border,
                  opacity: pressed ? 0.85 : 1,
                  flex: 1,
                },
              ]}
              onPress={() => {
                setSelectedType(type);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Feather
                name="activity"
                size={24}
                color={selectedType === type ? COLORS.primary : colors.textMuted}
              />
              <Text
                style={[
                  styles.typeCardTitle,
                  { color: selectedType === type ? COLORS.primary : colors.text },
                ]}
              >
                {type === "dexcom" ? "Dexcom" : "FreeStyle Libre"}
              </Text>
              <Text style={[styles.typeCardSub, { color: colors.textMuted }]}>
                {type === "dexcom" ? "G6 / G7 / One" : "2 / 3 / Sense"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View
          style={[
            styles.formCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            {selectedType === "dexcom" ? "Dexcom Username" : "LibreLink Email"}
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.backgroundTertiary,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            value={username}
            onChangeText={setUsername}
            placeholder={
              selectedType === "dexcom" ? "Your Dexcom username" : "your@email.com"
            }
            placeholderTextColor={colors.textMuted}
            keyboardType={selectedType === "libre" ? "email-address" : "default"}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Password</Text>
          <View style={[styles.passwordRow, { backgroundColor: colors.backgroundTertiary, borderColor: colors.border }]}>
            <TextInput
              style={[styles.passwordInput, { color: colors.text }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={() => { setShowPassword((v) => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={styles.eyeBtn}
              hitSlop={10}
            >
              <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          {selectedType === "dexcom" && (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.switchLabel, { color: colors.text }]}>Outside US</Text>
                <Text style={[styles.switchSub, { color: colors.textMuted }]}>
                  Use international Dexcom server
                </Text>
              </View>
              <Switch
                value={outsideUS}
                onValueChange={setOutsideUS}
                trackColor={{ false: colors.border, true: COLORS.primary + "60" }}
                thumbColor={outsideUS ? COLORS.primary : colors.textMuted}
              />
            </View>
          )}
        </View>

        <View
          style={[
            styles.infoBox,
            { backgroundColor: COLORS.primary + "10", borderColor: COLORS.primary + "30" },
          ]}
        >
          <Feather name="lock" size={14} color={COLORS.primary} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            {selectedType === "dexcom"
              ? "Uses your Dexcom Share credentials. Readings sync through Dexcom's servers."
              : "Uses your LibreLink Up account. Share must be enabled in your LibreLink app."}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.connectBtn,
            { backgroundColor: COLORS.primary, opacity: pressed || isConnecting ? 0.85 : 1 },
          ]}
          onPress={connect}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Feather name="wifi" size={18} color="#fff" />
          )}
          <Text style={styles.connectBtnText}>
            {isConnecting ? "Connecting..." : `Connect ${selectedType === "dexcom" ? "Dexcom" : "FreeStyle Libre"}`}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  connectedSection: { gap: 10, marginBottom: 8 },
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  connectedTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  connectedSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  connectedHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  disconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  disconnectBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  typeRow: {
    flexDirection: "row",
    gap: 12,
  },
  typeCard: {
    borderWidth: 2,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  typeCardTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  typeCardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  formCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 4,
    overflow: "hidden",
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  eyeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  switchLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  switchSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  connectBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
});
