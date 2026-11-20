/**
 * The Logs tab — the day-by-day record of insulin, meals and finger sticks, moved out of the
 * Insulin page's old Dose/Log toggle onto its own tab (2026-11-20). This file is a thin shell:
 * the entire view is components/LogHistory, exactly as it rendered inside Insulin. The shell
 * provides the glucose header, the access-grant gate (the tab bar already hides the tab, this
 * covers deep links), and the shortcut deep-link params: /logs?add=menu|insulin|stick|low with a
 * `t` nonce so a repeat tap re-opens the pop-up.
 */
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { defaultInsulinChipLabel, findInsulinByChipLabel, type InsulinOption } from "@/constants/insulin";
import { DOSE_INSULIN_TYPE_STORAGE_KEY } from "@/constants/storage-keys";
import LogHistory from "@/components/LogHistory";
import { ScreenShade } from "@/components/Shade";
import TabGlucoseHeaderRow, { TabGlucoseHeaderShell } from "@/components/TabGlucoseHeaderRow";
import { useAuth } from "@/context/AuthContext";
import { useHelpPage } from "@/context/HelpContext";
import { useTheme } from "@/context/ThemeContext";

export default function LogsScreen() {
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { profile, caregiverSession, accessCodeRole, accessCodePermissions } = useAuth();
  // Same grant rule the old Log view used: any non-code session, or a code with the log grant.
  const canLog = accessCodeRole == null || !!accessCodePermissions?.log;
  // Reports this page to Help Mode so its tour starts and stops on tab switches.
  useHelpPage();
  // Shortcut deep links; LogHistory re-opens the add flow whenever the key (nonce included) changes.
  const linkParams = useLocalSearchParams<{ add?: string; t?: string }>();

  // The Dose page's persisted insulin selection seeds Add Entry's insulin picker here too,
  // validated against the profile's configured insulins the same way the Insulin page does it.
  const [storedInsulinLabel, setStoredInsulinLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DOSE_INSULIN_TYPE_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && stored) setStoredInsulinLabel(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const configured = profile?.insulinTypes;
  const insulinLabel = useMemo(() => {
    const list = configured ?? [];
    return storedInsulinLabel && list.includes(storedInsulinLabel)
      ? storedInsulinLabel
      : defaultInsulinChipLabel(list);
  }, [storedInsulinLabel, configured]);
  const insulinOptions = useMemo<InsulinOption[]>(
    () => (configured ?? []).map(findInsulinByChipLabel).filter((o): o is InsulinOption => o != null),
    [configured],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Background shading — see components/Shade; the root keeps its own opaque color beneath. */}
      <ScreenShade />
      <TabGlucoseHeaderShell
        borderBottomColor={colors.border}
        style={[styles.screenHeader, { backgroundColor: colors.background }]}
      >
        <TabGlucoseHeaderRow left={null} />
      </TabGlucoseHeaderShell>
      {canLog ? (
        <LogHistory
          colors={colors}
          openAddMenuKey={linkParams.add ? `${linkParams.add}:${linkParams.t ?? ""}` : undefined}
          openAddKind={linkParams.add === "insulin" || linkParams.add === "stick" ? linkParams.add : "menu"}
          restrictToDay={caregiverSession}
          insulinOptions={insulinOptions}
          selectedInsulinLabel={insulinLabel}
        />
      ) : (
        <View style={[styles.lockedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="lock" size={26} color={colors.textMuted} />
          <Text style={[styles.lockedTitle, { color: colors.text }]}>Logs aren't available</Text>
          <Text style={[styles.lockedSub, { color: colors.textSecondary }]}>
            Logging isn't turned on for you. Ask a parent to enable it.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  screenHeader: { paddingBottom: 10 },
  lockedCard: { margin: 20, borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10 },
  lockedTitle: { fontSize: 17, fontWeight: "700" },
  lockedSub: { fontSize: 13, fontWeight: "400", textAlign: "center", lineHeight: 19 },
});
