/**
 * The Glucose Guardian brand block for the tab headers' LEFT slot: the mark in its soft circle,
 * the app name, and the same status line the Chat assistant header shows ("Your AI diabetes
 * companion", or "Managing <child>'s care" when a guardian or caregiver is signed in). ONE
 * component so Chat, Insulin, Logs and Food stay pixel-identical — the JSX and style values moved
 * verbatim from the Chat header (2026-11-20).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrandMark } from "@/components/BrandLogo";
import Colors, { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { resolveChatSpeaker } from "@/utils/chatSpeaker";

export default function BrandHeaderLeft() {
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { profile, accessCodeRole, caregiverSession, isChildMode, nurseViewCode, viewingPatientId, ownParentName } = useAuth();
  const name = profile?.childName ?? "there";
  // Same classification the Chat page uses for its header line (utils/chatSpeaker). `fromParent`
  // is a Chat-only deep-link param, so it is simply false here.
  const speaker = resolveChatSpeaker({
    accessCodeRole,
    caregiverSession,
    isChildMode,
    nurseViewCode,
    accountRole: profile?.accountRole,
    viewingPatientId,
    fromParent: false,
    parentName: ownParentName ?? profile?.parentName?.trim() ?? null,
  });
  const speakingToParent = speaker.kind !== "patient";
  return (
    <View style={styles.headerLeft}>
      <View style={[styles.avatarSmall, { backgroundColor: COLORS.primary + "20" }]}>
        <BrandMark size={styles.avatarLogo.width} />
      </View>
      <View style={styles.headerText}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Glucose Guardian</Text>
        <Text style={[styles.headerSub, { color: COLORS.success }]}>
          {speakingToParent ? `Managing ${name}'s care` : "Your AI diabetes companion"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    minWidth: 0,
  },
  headerText: { flex: 1, minWidth: 0 },
  avatarSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLogo: { width: 28, height: 28 },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  headerSub: { fontSize: 11, fontWeight: "400" },
});
