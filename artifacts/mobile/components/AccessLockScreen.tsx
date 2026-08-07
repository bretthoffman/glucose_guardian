/**
 * Full-screen lock shown when a caregiver (access code) or co-guardian (viewing) session falls
 * outside its schedule window or is removed mid-session — the "full lock, sees nothing" behavior.
 * Rendered as an absolute overlay above the tabs; the only action is to exit the session.
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";
import { useThemeColors } from "@/context/ThemeContext";
import { useAuth } from "@/context/AuthContext";

function fmtNext(ms: number): string {
  const withinDay = ms - Date.now() < 24 * 60 * 60 * 1000;
  const time = new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return withinDay ? time : `${new Date(ms).toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export default function AccessLockScreen() {
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const {
    accessLock,
    isViewingLinkedPatient,
    exitViewingMode,
    caregiverSession,
    exitCaregiverMode,
    viewingPatientName,
    profile,
    isSignedIn,
  } = useAuth();

  if (!accessLock) return null;

  const name = isViewingLinkedPatient ? viewingPatientName : profile?.childName;
  const who = name ? `${name}'s` : "this patient's";

  const title =
    accessLock.reason === "revoked"
      ? "Access removed"
      : accessLock.reason === "disabled"
      ? "Access turned off"
      : "Outside your access window";

  const body =
    accessLock.reason === "revoked"
      ? `Your access to ${who} data has been removed by the account owner.`
      : accessLock.reason === "disabled"
      ? `Your access to ${who} data is currently turned off. The account owner can re-enable it.`
      : accessLock.nextStartMs != null
      ? `Your scheduled access to ${who} data is closed right now. It reopens ${fmtNext(accessLock.nextStartMs)}.`
      : `Your scheduled access to ${who} data is closed right now.`;

  /**
   * An ACCOUNTLESS access-code session — someone who typed a code, with no account of their own.
   *
   * This is the only session type for which leaving is effectively irreversible: they can't sign back
   * in, they need the owner to re-share the code. A caregiver EMAIL account reaches this screen through
   * the `isViewingLinkedPatient` branch instead ("Back to my account"), which just drops the kid view
   * and leaves them signed in — so it is deliberately untouched. `!isSignedIn` makes the distinction
   * explicit rather than relying on branch order.
   */
  const isAccessCodeSession = caregiverSession && !isViewingLinkedPatient && !isSignedIn;

  const doExit = () => {
    if (isViewingLinkedPatient) {
      exitViewingMode();
    } else if (caregiverSession) {
      exitCaregiverMode();
      router.replace("/auth");
    }
  };

  /**
   * Confirm for access-code sessions only. The old single "Exit" button sat where a "dismiss" button
   * normally goes on a blocking screen, so it read as "close this message" — but it ended the session,
   * and a caregiver who tapped it while merely outside their window was locked out until the owner
   * re-shared the code. Waiting for the window to reopen is the common case; leaving is the rare one.
   */
  const confirmLogout = () => {
    const msg = "You are about to log out of your access code. Are you sure?";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(msg)) doExit();
      return;
    }
    Alert.alert("Log out?", msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: doExit },
    ]);
  };

  return (
    <View style={[styles.overlay, { backgroundColor: c.screen, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}>
      <View style={[styles.iconWrap, { backgroundColor: COLORS.primary + "18" }]}>
        <Feather name="lock" size={34} color={COLORS.primary} />
      </View>
      <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
      <Text style={[styles.body, { color: c.textSecondary }]}>{body}</Text>
      {/* Access-code sessions get NO primary action here — being outside the window is temporary, so
          the screen should not offer a one-tap way to lose access. Logging out moves to the corner,
          behind a confirmation. */}
      {!isAccessCodeSession && (
        <Pressable
          style={({ pressed }) => [styles.btn, { backgroundColor: COLORS.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={doExit}
        >
          <Text style={styles.btnText}>{isViewingLinkedPatient ? "Back to my account" : "Exit"}</Text>
        </Pressable>
      )}
      {isAccessCodeSession && (
        <Pressable
          style={({ pressed }) => [styles.logoutTopRight, { top: insets.top + 12, opacity: pressed ? 0.6 : 1 }]}
          onPress={confirmLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out of this access code"
          hitSlop={8}
        >
          <Feather name="log-out" size={13} color={c.textSecondary} />
          <Text style={[styles.logoutTopRightText, { color: c.textSecondary }]}>Logout</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  iconWrap: { width: 76, height: 76, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 22, fontWeight: "800", textAlign: "center" },
  body: { fontSize: 15, fontWeight: "400", textAlign: "center", lineHeight: 22 },
  btn: { marginTop: 10, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  logoutTopRight: {
    position: "absolute", right: 20, flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 6, paddingHorizontal: 8,
  },
  logoutTopRightText: { fontSize: 13, fontWeight: "600" },
});
