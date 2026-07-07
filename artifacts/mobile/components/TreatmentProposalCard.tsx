import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useGlucose } from "@/context/GlucoseContext";
import { useTheme } from "@/context/ThemeContext";

const INDIGO = "#6366F1";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface ChangeRow {
  label: string;
  from: string;
  to: string;
}

/**
 * The caregiver's approval card for a doctor-proposed treatment change. Renders only for the
 * account owner (hidden in doctor/caregiver-view sessions) when a proposal is pending. Approving
 * applies the new settings to live dosing (GlucoseContext) and the doctor-facing profile mirror,
 * then records the decision; declining just records the decision. Nothing changes until the
 * caregiver acts.
 */
export default function TreatmentProposalCard() {
  const { scheme } = useTheme();
  const colors = scheme === "dark" ? Colors.dark : Colors.light;
  const { therapyProposal, decideTherapyProposal, updateProfile, doctorSession, caregiverSession } =
    useAuth();
  const { carbRatio, correctionFactor, targetGlucose, saveFormula } = useGlucose();
  const [submitting, setSubmitting] = useState<null | "approved" | "declined">(null);

  if (!therapyProposal || doctorSession || caregiverSession) return null;
  const p = therapyProposal;

  const rows: ChangeRow[] = [];
  if (typeof p.carbRatio === "number") {
    rows.push({ label: "Carb ratio", from: `1:${carbRatio}`, to: `1:${p.carbRatio}` });
  }
  if (typeof p.correctionFactor === "number") {
    rows.push({ label: "Correction factor", from: `1:${correctionFactor}`, to: `1:${p.correctionFactor}` });
  }
  if (typeof p.targetGlucose === "number") {
    rows.push({ label: "Target glucose", from: `${targetGlucose} mg/dL`, to: `${p.targetGlucose} mg/dL` });
  }

  async function runApprove() {
    setSubmitting("approved");
    try {
      const cr = typeof p.carbRatio === "number" ? p.carbRatio : carbRatio;
      const tg = typeof p.targetGlucose === "number" ? p.targetGlucose : targetGlucose;
      const cf = typeof p.correctionFactor === "number" ? p.correctionFactor : correctionFactor;
      // Live dosing store (persisted) + doctor-facing profile mirror.
      saveFormula(cr, tg, cf);
      await updateProfile({ carbRatio: cr, targetGlucose: tg, correctionFactor: cf });
      await decideTherapyProposal("approved");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      Alert.alert("Couldn't apply the change", "Please try again in a moment.");
    } finally {
      setSubmitting(null);
    }
  }

  async function runDecline() {
    setSubmitting("declined");
    try {
      await decideTherapyProposal("declined");
    } catch {
      /* the local decision stands */
    } finally {
      setSubmitting(null);
    }
  }

  function confirmApprove() {
    if (submitting) return;
    Alert.alert(
      "Approve this change?",
      `These settings will start driving dosing in the app right away.${
        p.note ? `\n\nNote from ${p.proposedByName}: “${p.note}”` : ""
      }`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", style: "default", onPress: () => void runApprove() },
      ],
    );
  }

  function confirmDecline() {
    if (submitting) return;
    Alert.alert(
      "Decline this change?",
      "Your current settings stay as they are. Your care team will see that you declined.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => void runDecline() },
      ],
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: INDIGO + "10", borderColor: INDIGO + "40" }]}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: INDIGO + "22" }]}>
          <Feather name="clipboard" size={16} color={INDIGO} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Treatment change proposed</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {p.proposedByName}
            {p.proposedAt ? ` • ${fmtDate(p.proposedAt)}` : ""}
          </Text>
        </View>
      </View>

      <View style={[styles.changes, { borderColor: colors.border }]}>
        {rows.map((r) => (
          <View key={r.label} style={styles.changeRow}>
            <Text style={[styles.changeLabel, { color: colors.textSecondary }]}>{r.label}</Text>
            <View style={styles.changeValues}>
              <Text style={[styles.fromValue, { color: colors.textSecondary }]}>{r.from}</Text>
              <Feather name="arrow-right" size={12} color={colors.textSecondary} />
              <Text style={[styles.toValue, { color: colors.text }]}>{r.to}</Text>
            </View>
          </View>
        ))}
      </View>

      {p.note ? (
        <Text style={[styles.note, { color: colors.textSecondary }]} numberOfLines={4}>
          “{p.note}”
        </Text>
      ) : null}

      <Text style={[styles.disclaimer, { color: colors.textSecondary }]}>
        Nothing changes until you approve. Approving updates the app's dosing settings.
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.declineBtn, { borderColor: colors.border }]}
          onPress={confirmDecline}
          disabled={!!submitting}
        >
          {submitting === "declined" ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Text style={[styles.declineText, { color: colors.textSecondary }]}>Decline</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.btn, styles.approveBtn, { backgroundColor: INDIGO, opacity: submitting ? 0.7 : 1 }]}
          onPress={confirmApprove}
          disabled={!!submitting}
        >
          {submitting === "approved" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="check" size={15} color="#fff" />
              <Text style={styles.approveText}>Approve</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    gap: 12,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "700" },
  subtitle: { fontSize: 12, marginTop: 1 },
  changes: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8, gap: 8 },
  changeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  changeLabel: { fontSize: 13 },
  changeValues: { flexDirection: "row", alignItems: "center", gap: 6 },
  fromValue: { fontSize: 13, textDecorationLine: "line-through" },
  toValue: { fontSize: 14, fontWeight: "700" },
  note: { fontSize: 13, fontStyle: "italic", lineHeight: 18 },
  disclaimer: { fontSize: 11, lineHeight: 15 },
  actions: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  declineBtn: { borderWidth: 1 },
  declineText: { fontSize: 14, fontWeight: "600" },
  approveBtn: {},
  approveText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});
