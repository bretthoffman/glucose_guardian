import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Updates from "expo-updates";
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "@/constants/colors";

/**
 * "App version" panel — shows WHICH JavaScript bundle is actually running, and can force an update
 * check.
 *
 * Why this exists: a device on the correct native build (same channel, same runtimeVersion as every
 * other phone) sat many OTA updates behind, and there was no way to tell from inside the app whether
 * it was running the downloaded update or the bundle baked into the binary. Both look identical apart
 * from the features themselves, so diagnosing it meant guessing. `Updates.isEmbeddedLaunch` answers it
 * outright.
 *
 * The manual check matters just as much: `checkAutomatically` defaults to ON_LOAD with a 0 ms fallback
 * timeout, so the app always launches from cache and downloads in the BACKGROUND, applying on the next
 * launch. If that background transfer keeps failing — Low Data Mode, Low Power Mode, full storage, a
 * wrong device clock breaking TLS, or an MDM/DNS rule blocking u.expo.dev on a managed clinic phone —
 * it fails silently forever. Running the check in the foreground surfaces the actual error instead.
 */
/** Just the `ThemeColors` tokens this panel draws with — see constants/theme.ts. */
type PanelColors = { textPrimary: string; textSecondary: string; border: string };

export default function UpdateDiagnostics({ colors }: { colors: PanelColors }) {
  const [checking, setChecking] = useState(false);

  // In Expo Go / a dev client these are undefined; the panel still renders, just without ids.
  const runningEmbedded = Updates.isEmbeddedLaunch;
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : null;
  const createdAt = Updates.createdAt ? new Date(Updates.createdAt) : null;

  async function checkNow() {
    if (checking) return;
    setChecking(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        Alert.alert(
          "You're up to date",
          runningEmbedded
            ? "No newer update is being offered for this build, and this device is running the version built into the app."
            : "This device already has the newest update.",
        );
        return;
      }
      await Updates.fetchUpdateAsync();
      Alert.alert("Update downloaded", "The app will restart to finish updating.", [
        { text: "Later" },
        { text: "Restart now", onPress: () => void Updates.reloadAsync() },
      ]);
    } catch (e) {
      // Surfacing the real message is the whole point — this is what a silent background failure hides.
      Alert.alert(
        "Couldn't check for updates",
        `${e instanceof Error ? e.message : String(e)}\n\nIf this device is on Low Data Mode, Low Power Mode, very low storage, or a managed/filtered network, any of those can block the download.`,
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>App version</Text>
        <Text style={[styles.value, { color: colors.textPrimary }]}>
          {Updates.runtimeVersion ?? "—"}
          {Updates.channel ? ` · ${Updates.channel}` : ""}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Running</Text>
        <Text
          style={[styles.value, { color: runningEmbedded ? COLORS.warning : COLORS.success }]}
        >
          {runningEmbedded ? "Built-in version" : `Update ${updateId ?? "—"}`}
        </Text>
      </View>
      {createdAt && (
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Updated</Text>
          <Text style={[styles.value, { color: colors.textPrimary }]}>
            {createdAt.toLocaleDateString()} {createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>
      )}
      <Pressable
        onPress={checkNow}
        disabled={checking}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.btn,
          { backgroundColor: COLORS.primary + "18", opacity: pressed || checking ? 0.6 : 1 },
        ]}
      >
        <Feather name="refresh-cw" size={13} color={COLORS.primary} />
        <Text style={[styles.btnText, { color: COLORS.primary }]}>
          {checking ? "Checking…" : "Check for updates"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: 1, paddingTop: 12, marginTop: 12, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 12, fontWeight: "600" },
  value: { fontSize: 12, fontWeight: "700" },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 9, borderRadius: 10, marginTop: 6,
  },
  btnText: { fontSize: 12, fontWeight: "700" },
});
